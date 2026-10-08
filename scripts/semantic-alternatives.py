"""Explicit synthetic CPU retrieval experiment, never routine agent capture."""
import argparse
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path
import platform
import re
import sys
import threading
import time
import traceback

parser = argparse.ArgumentParser()
parser.add_argument('--protocol', required=True)
parser.add_argument('--model', required=True, help='Pinned Hub ID or lexical')
parser.add_argument('--output', required=True)
parser.add_argument('--cache', required=True)
args = parser.parse_args()
protocol_bytes = Path(args.protocol).read_bytes()
protocol = json.loads(protocol_bytes)
for key, value in {'HF_HOME':str(Path(args.cache).resolve()), 'HF_HUB_DISABLE_IMPLICIT_TOKEN':'1', 'HF_HUB_DISABLE_TELEMETRY':'1', 'HF_HUB_DISABLE_XET':'1', 'TOKENIZERS_PARALLELISM':'false', 'USE_TF':'0', 'OMP_NUM_THREADS':str(protocol['threads']), 'OPENBLAS_NUM_THREADS':str(protocol['threads']), 'MKL_NUM_THREADS':str(protocol['threads'])}.items():
    os.environ[key] = value
os.environ.pop('HF_TOKEN', None)
os.environ.pop('HUGGING_FACE_HUB_TOKEN', None)
import numpy as np
import psutil

output = Path(args.output)
if output.exists():
    raise RuntimeError('Do not overwrite an attempted outcome')
output.parent.mkdir(parents=True, exist_ok=True)
out = {'schemaVersion':1, 'model':args.model, 'protocolHash':hashlib.sha256(protocol_bytes).hexdigest(), 'startedAt':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()), 'platform':platform.system(), 'python':platform.python_version(), 'cpu':platform.processor(), 'threads':protocol['threads'], 'device':'cpu', 'packages':{k:importlib.metadata.version(k) for k in protocol['packages']}, 'rows':[], 'pairs':[], 'legacyPairs':[], 'stores':[], 'tokenCounts':{}}
mutex = threading.RLock()
def save():
    with mutex:
        temp = output.with_suffix('.tmp')
        temp.write_text(json.dumps(out, ensure_ascii=False, separators=(',',':'))+'\n',encoding='utf-8')
        os.replace(temp,output)
save()
running = True
peak = 0
def sample():
    global peak
    low = 0
    process = psutil.Process()
    while running:
        peak = max(peak,process.memory_info().rss)
        low = low+1 if psutil.virtual_memory().available < 128*2**20 else 0
        if peak > 4*2**30 or low >= 300:
            out['resourceAbort']='4GiB RSS or 30s sustained available RAM below128MiB'
            out['peakRssBytes']=peak
            save()
            os._exit(3)
        time.sleep(.1)
threading.Thread(target=sample,daemon=True).start()
ops = {'en':['Validate invoice references','Rotate service certificates','Render shipment labels','Monitor database lag','Resize product thumbnails','Sort event timestamps','Calculate tax rebates','Parse calendar attachments'], 'he':['אמת הפניות לחשבוניות','החלף תעודות שירות','הצג תוויות משלוח','נטר פיגור במסד הנתונים','הקטן תמונות מוצרים','מיין זמני אירועים','חשב החזרי מס','פענח קבצים מצורפים ליומן']}
def history(language,size):
    tasks=list(protocol['corpus']['tasks'][language])
    for i in range(len(tasks),size):
        tasks.append({'id':f'distractor-{i}','family':None,'title':f"{ops[language][i%8]} {'for service' if language=='en' else 'עבור שירות'} svc-{(i*97)%997} {'with limit' if language=='en' else 'עם הגבלה'} {3+i%51}.",'scope':f'service-{i%997}','version':f'v{1+i%4}','status':['backlog','verified','cancelled','superseded'][i%4]})
    return [t for _,t in sorted(enumerate(tasks),key=lambda it:((it[0]+1)*2654435761)&0xffffffff)]
def text(t):
    return f"{t['title']}\nScope: {t['scope']}\nAPI: {t['version']}\nStatus: {t['status']}"
def digest_text(texts):
    return hashlib.sha256('\n\0\n'.join(texts).encode()).hexdigest()
def tokens(s):
    return re.findall(r'\w+',s.lower(),flags=re.UNICODE)
class BM25:
    def __init__(self,docs):
        self.n=len(docs)
        self.postings={}
        self.lengths=np.array([len(tokens(x)) for x in docs],dtype=np.float32)
        self.avg=float(self.lengths.mean())
        for i,doc in enumerate(docs):
            counts={}
            for term in tokens(doc): counts[term]=counts.get(term,0)+1
            for term,tf in counts.items(): self.postings.setdefault(term,[]).append((i,tf))
    def score(self,q):
        scores=np.zeros(self.n,dtype=np.float32)
        for term in set(tokens(q)):
            postings=self.postings.get(term,[])
            if not postings: continue
            ids=np.array([i for i,_ in postings])
            tf=np.array([v for _,v in postings],dtype=np.float32)
            idf=np.log(1+(self.n-len(ids)+.5)/(len(ids)+.5))
            scores[ids]+=idf*tf*2.2/(tf+1.2*(.25+.75*self.lengths[ids]/self.avg))
        return scores

model=None
spec=None
def normalize(a):
    a=np.asarray(a,dtype=np.float32)
    return a/np.maximum(np.linalg.norm(a,axis=1,keepdims=True),1e-12)
def encode(strings,role='query',label=None):
    if spec['kind']=='e5': strings=[('passage: ' if role=='document' else 'query: ')+s for s in strings]
    elif spec['kind']=='bge' and role=='query': strings=['Represent this sentence for searching relevant passages: '+s for s in strings]
    if spec['kind']=='static':
        ids=model.tokenizer.encode_batch(strings)
        counts=[len(x.ids) for x in ids]
        values=model.encode(strings,max_length=None,batch_size=protocol['batchSize'],use_multiprocessing=False)
    else:
        counts=[len(x) for x in model.tokenizer(strings,truncation=False)['input_ids']]
        values=model.encode(strings,batch_size=protocol['batchSize'],show_progress_bar=False,convert_to_numpy=True,normalize_embeddings=True)
    if label:
        out['tokenCounts'][label]={'inputs':len(strings),'totalTokens':sum(counts),'maxTokens':max(counts,default=0),'truncatedInputs':sum(x>spec['maxTokens'] for x in counts) if spec['maxTokens'] else 0}
    return normalize(values)
def top(scores,tasks,eligible=None):
    indexes=range(len(tasks)) if eligible is None else eligible
    ranked=sorted(indexes,key=lambda i:(-float(scores[i]),tasks[i]['id']))[:10]
    return [[tasks[i]['id'],float(scores[i])] for i in ranked]

try:
    if args.model!='lexical':
        spec=next(x for x in protocol['models'] if x['id']==args.model)
        from huggingface_hub import HfApi, snapshot_download
        start=time.perf_counter()
        info=HfApi().model_info(spec['id'],revision=spec['revision'],token=False)
        assert info.sha==spec['revision']
        card=info.card_data.to_dict() if info.card_data else {}
        assert card.get('license')==spec['license'], 'Pinned card license mismatch'
        files=HfApi().list_repo_files(spec['id'],revision=spec['revision'],token=False)
        selected=[f for f in files if not any(x in f.split('/') for x in ['onnx','openvino','.git']) and (f.endswith('.safetensors') or f.endswith('.json') or f.endswith('.txt') or f.endswith('.model') or f in ['README.md','LICENSE'])]
        snapshot=snapshot_download(spec['id'],revision=spec['revision'],allow_patterns=selected,token=False,max_workers=1)
        assert Path(snapshot).name==spec['revision']
        out['downloadAndCacheLookupSeconds']=time.perf_counter()-start
        out['assets']=[{'file':f,'bytes':(Path(snapshot)/f).stat().st_size,'sha256':hashlib.sha256((Path(snapshot)/f).read_bytes()).hexdigest()} for f in selected]
        out['weightBytes']=sum(x['bytes'] for x in out['assets'] if x['file'].endswith('.safetensors'))
        out['license']=card.get('license')
        out['loadedRevision']=spec['revision']
        start=time.perf_counter()
        if spec['kind']=='static':
            from model2vec import StaticModel
            model=StaticModel.from_pretrained(snapshot,token=False)
            out['parameterCount']=int(model.embedding.size)
            out['embeddingTableParameters']=int(model.embedding.size)
            out['embeddingWidth']=int(model.embedding.shape[1])
            out['vocabularySize']=int(model.embedding.shape[0])
        else:
            import torch
            torch.set_num_threads(protocol['threads'])
            torch.set_num_interop_threads(1)
            torch.manual_seed(protocol['seed'])
            from sentence_transformers import SentenceTransformer
            model=SentenceTransformer(snapshot,device='cpu',trust_remote_code=False,local_files_only=True)
            model.max_seq_length=spec['maxTokens']
            out['parameterCount']=sum(x.numel() for x in model.parameters())
            table=model[0].auto_model.get_input_embeddings().weight
            out['embeddingTableParameters']=table.numel()
            out['embeddingWidth']=int(table.shape[1])
            out['vocabularySize']=int(table.shape[0])
        out['loadSeconds']=time.perf_counter()-start
        start=time.perf_counter()
        encode(['The sky is blue.'],'query','infrastructureWarmup')
        out['warmupSeconds']=time.perf_counter()-start
        save()
        # Pair similarity uses symmetric query prefixes for E5, documented BGE query prefix.
        pairs=protocol['corpus']['pairs']
        start=time.perf_counter()
        left=encode([p['left'] for p in pairs],'query','pairLeft')
        right=encode([p['right'] for p in pairs],'query','pairRight')
        out['pairEncodeSeconds']=time.perf_counter()-start
        out['pairs']=[{'id':p['id'],'score':float(np.dot(left[i],right[i]))} for i,p in enumerate(pairs)]
        legacy=protocol['layaExploratory']
        left=encode([p['state']['existingTask']['title'] for p in legacy],'query','legacyLeft')
        right=encode([p['state']['newRequest']['text'] for p in legacy],'query','legacyRight')
        out['legacyPairs']=[{'id':p['id'],'score':float(np.dot(left[i],right[i]))} for i,p in enumerate(legacy)]
        queries=protocol['corpus']['queries']
        start=time.perf_counter()
        q=encode([x['q'] for x in queries],'query','Q')
        a=encode([x['a'] for x in queries],'query','A')
        qa=encode([f"User request: {x['q']}\nAssistant response: {x['a']}" for x in queries],'query','QA')
        out['queryBatchEncodeSeconds']=time.perf_counter()-start
        # Repeated single-query measurement, no retrieval context included.
        out['warmQueryEncodeSeconds']=[]
        for item in queries[:9]:
            start=time.perf_counter(); encode([item['q']]); out['warmQueryEncodeSeconds'].append(time.perf_counter()-start)
        save()
    else:
        queries=protocol['corpus']['queries']
    for language in ['en','he']:
        tasks=history(language,max(protocol['sizes']))
        docs=[text(t) for t in tasks]
        # Serialize and independently parse the same complete information.
        start=time.perf_counter(); structured=json.dumps(tasks,ensure_ascii=False); parsed=json.loads(structured); structured_seconds=time.perf_counter()-start
        start=time.perf_counter(); markdown='\n'.join(f"## {t['id']}\n"+json.dumps(t,ensure_ascii=False) for t in tasks); parsed_md=[json.loads(line) for line in markdown.splitlines() if line.startswith('{')]; markdown_seconds=time.perf_counter()-start
        assert parsed==parsed_md==tasks
        store={'language':language,'items':len(tasks),'structuredBytes':len(structured.encode()),'markdownBytes':len(markdown.encode()),'structuredRoundtripSeconds':structured_seconds,'markdownRoundtripSeconds':markdown_seconds,'projectionHash':digest_text(docs),'storeEquivalent':True}
        if spec:
            start=time.perf_counter(); vectors=encode(docs,'document',f'documents-{language}'); store['initialEncodeSeconds']=time.perf_counter()-start
            store['incrementalEncodeSeconds']=[]
            for _ in range(3):
                start=time.perf_counter(); encode(docs[-10:],'document'); store['incrementalEncodeSeconds'].append(time.perf_counter()-start)
        out['stores'].append(store)
        for size in protocol['sizes']:
            small=history(language,size)
            small_docs=[text(t) for t in small]
            assert len(small)==size
            if spec:
                lookup={t['id']:i for i,t in enumerate(tasks)}
                index=np.array([vectors[lookup[t['id']]] for t in small],dtype=np.float32)
            else:
                start=time.perf_counter(); index=BM25(small_docs); store.setdefault('indexSeconds',{})[str(size)]=time.perf_counter()-start
            for qi,item in enumerate(queries):
                if item['store']!=language: continue
                eligible=[i for i,t in enumerate(small) if t['scope']==item['scope'] and t['version']==item['version'] and t['status'] not in ['cancelled','superseded']]
                for mode in protocol['modes']:
                    start=time.perf_counter()
                    if spec:
                        scores=(index@q[qi]) if mode=='Q' else (index@a[qi]) if mode=='A' else (index@qa[qi]) if mode=='QA' else protocol['fusionQWeight']*(index@q[qi])+(1-protocol['fusionQWeight'])*(index@a[qi])
                    else:
                        scores=index.score(item['q']) if mode=='Q' else index.score(item['a']) if mode=='A' else index.score(f"User request: {item['q']}\nAssistant response: {item['a']}") if mode=='QA' else protocol['fusionQWeight']*index.score(item['q'])+(1-protocol['fusionQWeight'])*index.score(item['a'])
                    raw=top(scores,small); selected=top(scores,small,eligible)
                    out['rows'].append({'query':item['id'],'size':size,'mode':mode,'raw':raw,'eligible':selected,'searchSeconds':time.perf_counter()-start})
            save()
            print(json.dumps({'model':args.model,'language':language,'size':size,'rows':len(out['rows'])}),flush=True)
    out['completedAt']=time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime())
except Exception as exc:
    out['error']={'type':type(exc).__name__,'message':str(exc),'trace':traceback.format_exc()}
    print(json.dumps({'model':args.model,'error':type(exc).__name__,'message':str(exc)}),flush=True)
finally:
    running=False
    out['peakRssBytes']=peak
    save()
sys.exit(1 if 'error' in out else 0)
