"""Opt-in local E5 prototype. JSON-lines in/out; no canonical writes or downloads."""
import hashlib,json,os,re,sys,time
from pathlib import Path
os.environ.update({'TOKENIZERS_PARALLELISM':'false','USE_TF':'0','HF_HUB_OFFLINE':'1','HF_HUB_DISABLE_IMPLICIT_TOKEN':'1','HF_HUB_DISABLE_TELEMETRY':'1','OMP_NUM_THREADS':'4'})
os.environ.pop('HF_TOKEN',None)
import numpy as np

REVISION='614241f622f53c4eeff9890bdc4f31cfecc418b3'
def sha(b):return hashlib.sha256(b).hexdigest()

def spans(text):
    """Heading ancestry and exact offsets; fenced pseudo-headings are ignored."""
    cuts=[(0,[])];stack=[];pos=0;fence=None
    for line in text.splitlines(keepends=True):
        marker=re.match(r'^\s*(`{3,}|~{3,})',line)
        if marker:
            c=marker.group(1)[0]
            if fence==c:fence=None
            elif fence is None:fence=c
        m=re.match(r'^(#{1,6})\s+(.+?)\s*#*\s*$',line.rstrip('\r\n')) if fence is None and not marker else None
        if m:
            depth=len(m.group(1));stack=[x for x in stack if x[0]<depth]+[(depth,m.group(2))]
            heading=[x[1] for x in stack]
            if pos==0:cuts[0]=(0,heading)
            else:cuts.append((pos,heading))
        pos+=len(line)
    return [(start,cuts[i+1][0] if i+1<len(cuts) else len(text),heading) for i,(start,heading) in enumerate(cuts)]

def entries(source,tokenizer):
    text=source['text'];out=[]
    groups=[(0,len(text),[])] if source['kind']=='task' else spans(text)
    for begin,end,heading in groups:
        prefix='passage: '+(' > '.join(heading)+'\n' if heading else '')
        if len(tokenizer(prefix,truncation=False)['input_ids'])>470:raise ValueError('Heading exceeds token budget')
        pos=begin
        while pos<end:
            stop=end if source['kind']=='task' and len(tokenizer(prefix+text[pos:end],truncation=False)['input_ids'])<=480 else min(pos+1000,end)
            # Prefer complete paragraphs; fall back to bounded exact windows.
            boundary=text.rfind('\n\n',pos+200,stop)
            if boundary>pos:stop=boundary+2
            while stop>pos and len(tokenizer(prefix+text[pos:stop],truncation=False)['input_ids'])>480:stop=pos+max(1,(stop-pos)//2)
            if stop==pos:raise ValueError('Heading exceeds token budget')
            body=text[pos:stop]
            if body.strip():out.append({'source':source['id'],'start':pos,'end':stop,'heading':heading,'embeddingText':prefix+body})
            if stop==end:break
            pos=max(pos+1,stop-120)
    return out

class Engine:
    def __init__(self):
        import torch
        torch.set_num_threads(4);torch.set_num_interop_threads(1)
        from sentence_transformers import SentenceTransformer
        snapshot=Path(os.environ['DIP_SEMANTIC_MODEL'])
        if snapshot.name!=REVISION:raise ValueError('Use the pinned E5-small snapshot revision')
        assets={'model.safetensors':'1a55775f53449dac10a2bcbc312469fac40b96d53198c407081a831f81c98477','config.json':'69137736cab8b8903a07fe8afaafdda25aac55415a12a55d1bffa9f581abf959','modules.json':'c6e29747481e8b5dd2b58401966aeac910de39092f90cda9a704b1545f902b04','1_Pooling/config.json':'987f7a67a38fa564c849bb5d277c52ab9088a84368fc0be31a354125aebb12a0','sentence_bert_config.json':'948201d8329907aae938fa62f9ceeed53f5694dacc2b87b9f3b78b37ee986529','tokenizer.json':'0b44a9d7b51c3c62626640cda0e2c2f70fdacdc25bbbd68038369d14ebdf4c39','tokenizer_config.json':'a1d6bc8734a6f635dc158508bef000f8e2e5a759c7d92f984b2c86e5ff53425b','sentencepiece.bpe.model':'cfc8146abe2a0488e9e2a0c56de7952f7c11ab059eca145a0a727afce0db2865','special_tokens_map.json':'d05497f1da52c5e09554c0cd874037a083e1dc1b9cfd48034d1c717f1afc07a7'}
        for name,expected in assets.items():
            digest=hashlib.sha256()
            with (snapshot/name).open('rb') as file:
                while block:=file.read(2**20):digest.update(block)
            if digest.hexdigest()!=expected:raise ValueError('Pinned asset hash mismatch: '+name)
        # A snapshot is local data; never load remote/custom Python code.
        self.model=SentenceTransformer(str(snapshot),device='cpu',trust_remote_code=False,local_files_only=True)
        self.model.max_seq_length=512
        self.identity=sha(json.dumps({'model':'intfloat/multilingual-e5-small','revision':REVISION,'format':2,'window':480,'headingBoost':0.04}).encode())
        self.cache=Path(os.environ['DIP_SEMANTIC_CACHE']);self.cache.mkdir(parents=True,exist_ok=True)
    def retrieve(self,request):
        start=time.perf_counter();sources=request['sources']
        if len(sources)>2100 or sum(len(s['text']) for s in sources)>100*1024*1024:raise ValueError('Source budget exceeded')
        source_map={s['id']:s for s in sources}
        if len(source_map)!=len(sources):raise ValueError('Duplicate source identity')
        channel=request.get('channel','all');limit=request.get('limit',5)
        query=request['query']
        if not isinstance(query,str) or not query.strip() or len(query)>1000 or channel not in ['all','tasks','documents'] or not 1<=limit<=10:raise ValueError('Invalid bounded query')
        selected=[s for s in sources if s.get('status') not in ['cancelled','superseded'] and (channel=='all' or s['kind']=={'tasks':'task','documents':'document'}[channel])]
        chunks=[e for s in selected for e in entries(s,self.model.tokenizer)]
        if len(chunks)>100000:raise ValueError('Section budget exceeded')
        keys=[sha((self.identity+'\0'+e['embeddingText']).encode()) for e in chunks]
        namespace=request.get('namespace','')
        if not re.fullmatch('[a-f0-9]{64}',namespace):raise ValueError('Invalid cache namespace')
        file=self.cache/(namespace+'.npz');cached={};reason=None
        try:
            with np.load(file,allow_pickle=False) as data:
                if str(data['identity'])!=self.identity:raise ValueError('Cache identity changed')
                vectors=data['vectors'];old_keys=data['keys']
                if vectors.shape!=(len(old_keys),384) or vectors.dtype!=np.float32 or not np.isfinite(vectors).all() or len(set(old_keys))!=len(old_keys):raise ValueError('Invalid vectors')
                if str(data['checksum'])!=sha(vectors.tobytes()+old_keys.tobytes()):raise ValueError('Cache checksum mismatch')
                cached=dict(zip(map(str,old_keys),vectors))
        except (OSError,ValueError,KeyError,EOFError):reason='missing_or_invalid'
        missing={key:e['embeddingText'] for key,e in zip(keys,chunks) if key not in cached}
        if missing:
            computed=self.model.encode(list(missing.values()),batch_size=32,normalize_embeddings=True,show_progress_bar=False,convert_to_numpy=True).astype(np.float32)
            cached.update(zip(missing,computed))
        unique=sorted(set(keys));saved=np.array([cached[k] for k in unique],dtype=np.float32).reshape((-1,384));key_array=np.array(unique,dtype='<U64')
        temp=file.with_suffix('.tmp.npz')
        np.savez_compressed(temp,identity=np.array(self.identity),keys=key_array,vectors=saved,checksum=np.array(sha(saved.tobytes()+key_array.tobytes())));os.replace(temp,file)
        if not chunks:return {'candidates':[],'encoded':0,'revision':REVISION,'elapsedMs':(time.perf_counter()-start)*1000}
        query_input='query: '+query
        if len(self.model.tokenizer(query_input,truncation=False)['input_ids'])>512:raise ValueError('Query exceeds encoder token budget; shorten explicitly')
        q=self.model.encode([query_input],normalize_embeddings=True,show_progress_bar=False,convert_to_numpy=True)[0]
        matrix=np.array([cached[k] for k in keys]);scores=matrix@q
        terms=set(re.findall(r'\w+',query.lower()))
        # Fixed small heading tie signal, not a learned identity threshold.
        for i,e in enumerate(chunks):
            h=set(re.findall(r'\w+',' '.join(e['heading']).lower()))
            scores[i]+=0.04*len(terms&h)/max(1,len(terms))
        ordered=sorted(range(len(chunks)),key=lambda i:(-float(scores[i]),chunks[i]['source'],chunks[i]['start']))
        best=[];seen=set()
        for i in ordered:
            e=chunks[i];s=source_map[e['source']]
            if s['id'] in seen:continue
            seen.add(s['id']);excerpt=s['text'][e['start']:e['end']]
            best.append({'id':s['id'],'kind':s['kind'],'path':s['path'],'contentHash':s['contentHash'],'status':s.get('status'),'sourceTruncated':s.get('sourceTruncated',False),'heading':e['heading'],'start':e['start'],'end':e['end'],'offsetUnit':'Unicode code points','excerpt':excerpt[:800],'excerptTruncated':len(excerpt)>800,'links':s.get('links',[])[:10],'score':float(scores[i])})
            if len(best)>=limit:break
        return {'candidates':best,'revision':REVISION,'encoded':len(missing),'reused':len(unique)-len(missing),'sections':len(chunks),'cacheRebuilt':reason is not None,'elapsedMs':(time.perf_counter()-start)*1000,'identityEstablished':False,'verification':'not_checked'}

if __name__=='__main__':
    engine=None
    for line in sys.stdin:
        try:
            engine=engine or Engine()
            result=engine.retrieve(json.loads(line))
        except Exception as e:result={'error':type(e).__name__+': '+str(e)}
        print(json.dumps(result,ensure_ascii=False),flush=True)
