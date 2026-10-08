"""Explicit frozen-source winner follow-up. Embedding inference never mutates DIP."""
import argparse
import gzip
import hashlib
import importlib.util
import importlib.metadata
import json
import os
from pathlib import Path
import platform
import re
import subprocess
import sys
import threading
import time
import traceback

p=argparse.ArgumentParser();p.add_argument('--protocol',required=True);p.add_argument('--model',required=True);p.add_argument('--output',required=True);p.add_argument('--cache',required=True);p.add_argument('--index-dir',required=True);args=p.parse_args()
protocol_bytes=Path(args.protocol).read_bytes();protocol=json.loads(protocol_bytes)
for k,v in {'TOKENIZERS_PARALLELISM':'false','USE_TF':'0','HF_HUB_DISABLE_IMPLICIT_TOKEN':'1','HF_HUB_DISABLE_TELEMETRY':'1','HF_HUB_DISABLE_XET':'1','OMP_NUM_THREADS':'4','OPENBLAS_NUM_THREADS':'4','MKL_NUM_THREADS':'4'}.items():os.environ[k]=v
os.environ.pop('HF_TOKEN',None);os.environ.pop('HUGGING_FACE_HUB_TOKEN',None)
import numpy as np
import psutil
module_spec=importlib.util.spec_from_file_location('winner_index',Path(__file__).with_name('winner-index.py'));module=importlib.util.module_from_spec(module_spec);module_spec.loader.exec_module(module)
DerivedIndex,sections=module.DerivedIndex,module.sections
output=Path(args.output)
if output.exists():raise RuntimeError('Never overwrite an attempted result')
out={'schemaVersion':1,'model':args.model,'protocolHash':hashlib.sha256(protocol_bytes).hexdigest(),'startedAt':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'rows':[],'indexes':[],'cacheChecks':[],'strategies':['whole','sections'] if args.model=='lexical' else ['whole','sections','hybrid-whole','hybrid-sections'],'resources':{'platform':platform.system(),'python':platform.python_version(),'device':'cpu','threads':4,'packages':{k:importlib.metadata.version(k) for k in protocol['packages']},'tokenCounts':{},'availableRamAtStartBytes':psutil.virtual_memory().available}}
mutex=threading.RLock()
def save():
    with mutex:
        output.parent.mkdir(parents=True,exist_ok=True);temp=output.with_suffix('.tmp');temp.write_text(json.dumps(out,ensure_ascii=False,separators=(',',':'))+'\n',encoding='utf-8');os.replace(temp,output)
save();running=True;peak=0
def sample():
    global peak
    low=0;process=psutil.Process()
    while running:
        peak=max(peak,process.memory_info().rss);low=low+1 if psutil.virtual_memory().available<128*2**20 else 0
        if peak>4*2**30 or low>=300:
            out['resourceAbort']='4GiB process RSS or30s available RAM below128MiB';out['resources']['peakRssBytes']=peak;save();os._exit(3)
        time.sleep(.1)
threading.Thread(target=sample,daemon=True).start()

def terms(text):return re.findall(r'\w+',text.lower(),flags=re.UNICODE)
class BM25:
    def __init__(self,entries):
        self.n=len(entries);self.postings={};self.lengths=np.array([len(terms(x['text'])) for x in entries],dtype=np.float32);self.avg=float(self.lengths.mean())
        for i,entry in enumerate(entries):
            counts={}
            for term in terms(entry['text']):counts[term]=counts.get(term,0)+1
            for term,count in counts.items():self.postings.setdefault(term,[]).append((i,count))
    def score(self,q):
        result=np.zeros(self.n,dtype=np.float32)
        for term in set(terms(q)):
            posting=self.postings.get(term,[])
            if not posting:continue
            ids=np.array([i for i,_ in posting]);tf=np.array([n for _,n in posting],dtype=np.float32)
            idf=np.log(1+(self.n-len(ids)+.5)/(len(ids)+.5))
            result[ids]+=idf*tf*2.2/(tf+1.2*(.25+.75*self.lengths[ids]/self.avg))
        return result
def collapsed(scores,entries):
    best={}
    for i,entry in enumerate(entries):
        current=best.get(entry['source'])
        if current is None or float(scores[i])>current['score']:best[entry['source']]={'id':entry['source'],'score':float(scores[i]),'entry':entry}
    return sorted(best.values(),key=lambda x:(-x['score'],x['id']))
def fused(dense,lexical):
    lexical_rank={x['id']:i+1 for i,x in enumerate(lexical)}
    rows=[{**x,'score':1/(protocol['rrfK']+i+1)+1/(protocol['rrfK']+lexical_rank[x['id']])} for i,x in enumerate(dense)]
    return sorted(rows,key=lambda x:(-x['score'],x['id']))
def candidates(ranking,sources,query):
    source_map={x['id']:x for x in sources}
    def view(row):
        source=source_map[row['id']];entry=row['entry']
        return {'id':row['id'],'score':row['score'],'path':source['path'],'contentHash':source['contentHash'],'recordedStatus':source['recordedStatus'],'heading':entry['heading'],'start':entry['start'],'end':entry['end'],'excerpt':entry['text'][:160],'excerptTruncated':len(entry['text'])>160}
    eligible=[r for r in ranking if source_map[r['id']]['recordedStatus'] not in ['cancelled','superseded'] and (not query.get('version') or source_map[r['id']].get('version')==query['version'])]
    return [view(r) for r in ranking[:protocol['topK']]],[view(r) for r in eligible[:protocol['topK']]]

encoder=None;spec=None
def encode(texts,label,role='document'):
    inputs=[('passage: ' if role=='document' else 'query: ')+x for x in texts] if spec['kind']=='e5' else texts
    counts=[len(x) for x in encoder.tokenizer(inputs,truncation=False)['input_ids']]
    metrics=out['resources']['tokenCounts'].setdefault(label,{'inputs':0,'tokens':0,'truncated':0,'max':0})
    metrics['inputs']+=len(inputs);metrics['tokens']+=sum(counts);metrics['truncated']+=sum(x>spec['maxTokens'] for x in counts);metrics['max']=max(metrics['max'],max(counts,default=0))
    return encoder.encode(inputs,batch_size=protocol['batchSize'],show_progress_bar=False,convert_to_numpy=True,normalize_embeddings=True)

try:
    if args.model!='lexical':
        spec=next(x for x in protocol['models'] if x['id']==args.model)
        legacy=Path('docs/benchmarks')/('2026-10-08-semantic-'+spec['id'].replace('/','--')+'.json.gz')
        previous=json.loads(gzip.decompress(legacy.read_bytes()))
        assert previous['loadedRevision']==spec['revision'] and previous['license']==spec['license']
        snapshot=Path(args.cache)/'hub'/('models--'+spec['id'].replace('/','--'))/'snapshots'/spec['revision']
        for asset in previous['assets']:
            digest=hashlib.sha256()
            with (snapshot/asset['file']).open('rb') as stream:
                while block:=stream.read(2**20):digest.update(block)
            assert digest.hexdigest()==asset['sha256']
        import torch
        torch.set_num_threads(4);torch.set_num_interop_threads(1);torch.manual_seed(protocol['seed'])
        from sentence_transformers import SentenceTransformer
        start=time.perf_counter();encoder=SentenceTransformer(str(snapshot),device='cpu',trust_remote_code=False,local_files_only=True);encoder.max_seq_length=spec['maxTokens'];out['resources']['loadSeconds']=time.perf_counter()-start
        out['resources']['loadedRevision']=spec['revision'];out['resources']['parameterCount']=sum(x.numel() for x in encoder.parameters());out['resources']['license']=spec['license']
        start=time.perf_counter();query_vectors=encode([x['q'] for x in protocol['corpus']['queries']],'queries','query');out['resources']['queryEncodeSeconds']=time.perf_counter()-start
    suites=[('real',protocol['corpus']['sources'],'task',None),('late',protocol['corpus']['late'],'task',None),('documents',protocol['corpus']['sources'],'document',None),('known-synthetic',protocol['corpus']['synthetic']['en'],'task','en'),('known-synthetic',protocol['corpus']['synthetic']['he'],'task','he')]
    first_cache_check=True
    for suite,pool,kind,store in suites:
        sources=[x for x in pool if x['kind']==kind]
        queries=[(i,q) for i,q in enumerate(protocol['corpus']['queries']) if q['suite']==suite and (store is None or q.get('store')==store)]
        for strategy in ['whole','sections']:
            entries=[entry for s in sources for entry in sections(s,strategy,protocol['chunkChars'],protocol['overlapChars'])]
            start=time.perf_counter();lexical=BM25(entries);lex_seconds=time.perf_counter()-start
            metric={'suite':suite,'store':store,'strategy':strategy,'sources':len(sources),'entries':len(entries),'lexicalBuildSeconds':lex_seconds}
            if spec:
                identity={'model':spec['id'],'revision':spec['revision'],'maxTokens':spec['maxTokens'],'packages':protocol['packages'],'role':'document','normalized':True}
                path=Path(args.index_dir)/spec['id'].replace('/','--')/(suite+'-'+str(store)+'-'+strategy+'.npz')
                if path.exists():raise RuntimeError('Scored initial index must be fresh')
                index=DerivedIndex(path,identity);vectors,stats=index.update(entries,lambda x:encode(x,'index-'+suite+'-'+str(store)+'-'+strategy));metric['cache']=stats
                # A real fresh subprocess verifies unchanged vectors without loading the model.
                probe=path.with_suffix('.probe.json');probe.write_text(json.dumps({'path':str(path.resolve()),'identity':identity,'entries':entries,'vectorHash':module.sha(vectors.tobytes())},ensure_ascii=False),encoding='utf-8')
                restarted=subprocess.run([sys.executable,str(Path(__file__).with_name('winner-index.py')),'--probe',str(probe)],check=True,capture_output=True,text=True,encoding='utf-8')
                proof=json.loads(restarted.stdout);assert proof['restartVerified'] and proof['encoded']==0
                check={'suite':suite,'store':store,'strategy':strategy,'restart':proof}
                # Test change/removal on a copied research index; no canonical source mutation.
                import shutil
                updated=path.with_name(path.stem+'-updated.npz');shutil.copyfile(path,updated);shutil.copyfile(path.with_suffix('.json'),updated.with_suffix('.json'))
                changed=[{**x} for x in entries];changed[0]['text']='Z'+changed[0]['text'][1:]
                derived=DerivedIndex(updated,identity);new_vectors,update_stats=derived.update(changed,lambda x:encode(x,'cache-change'));assert update_stats['encoded']<=1
                removed_source=sources[-1]['id'];retained=[x for x in changed if x['source']!=removed_source]
                derived=DerivedIndex(updated,identity);_,remove_stats=derived.update(retained,lambda _:(_ for _ in ()).throw(RuntimeError('Deletion must not encode')));assert remove_stats['encoded']==0
                assert not any(x['source']==removed_source for x in retained)
                check['changed']=update_stats;check['deleted']={'source':removed_source,**remove_stats}
                if first_cache_check:
                    corrupt=path.with_name(path.stem+'-corrupt.npz');corrupt.write_bytes(b'broken derived cache');shutil.copyfile(path.with_suffix('.json'),corrupt.with_suffix('.json'))
                    recovery=DerivedIndex(corrupt,identity);recovered,recovery_stats=recovery.update(entries,lambda x:encode(x,'cache-corruption-rebuild'))
                    assert recovery_stats['rebuildReason'] and recovery_stats['encoded']==len(set(index.key(x['text']) for x in entries))
                    assert np.allclose(recovered,vectors,atol=1e-6,rtol=1e-6)
                    check['corruptRecovery']=recovery_stats;first_cache_check=False
                out['cacheChecks'].append(check)
            out['indexes'].append(metric)
            for qi,query in queries:
                start=time.perf_counter();lex_rank=collapsed(lexical.score(query['q']),entries)
                if spec:
                    dense=collapsed(vectors@query_vectors[qi],entries);methods=[(strategy,dense),('hybrid-'+strategy,fused(dense,lex_rank))]
                else:methods=[(strategy,lex_rank)]
                for method,ranking in methods:
                    raw,eligible=candidates(ranking,sources,query)
                    out['rows'].append({'query':query['id'],'suite':suite,'strategy':method,'raw':raw,'eligible':eligible,'searchSeconds':time.perf_counter()-start,'identityEstablished':False,'verification':'not_checked','decision':'candidate_only'})
            save();print(json.dumps({'model':args.model,'suite':suite,'store':store,'strategy':strategy,'rows':len(out['rows'])}),flush=True)
    out['completedAt']=time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime())
except Exception as exc:
    out['error']={'type':type(exc).__name__,'message':str(exc),'trace':traceback.format_exc()};print(json.dumps({'model':args.model,'error':type(exc).__name__,'message':str(exc)}),flush=True)
finally:
    running=False;out['resources']['peakRssBytes']=peak;save()
sys.exit(1 if 'error' in out else 0)
