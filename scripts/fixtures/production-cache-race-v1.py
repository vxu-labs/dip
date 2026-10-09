"""Filesystem race isolation: production cache algorithm, mocked encoder.
No retrieval accuracy or inference performance claim. Four low-memory processes
are synchronized after writing the production fixed temporary pathname.
"""
import hashlib,importlib.util,json,multiprocessing,os,sys,tempfile
from pathlib import Path
import numpy as np

def sha(b):return hashlib.sha256(b).hexdigest()
class Model:
    def tokenizer(self,text,truncation=False):return {'input_ids':list(range(min(10,len(text))))}
    def encode(self,texts,**kwargs):return np.tile(np.ones(384,dtype=np.float32)/np.sqrt(384),(len(texts),1))
def run(index,cache,barrier,out):
    spec=importlib.util.spec_from_file_location('production_worker',Path('src/semantic-worker.py'));m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
    engine=m.Engine.__new__(m.Engine);engine.model=Model();engine.identity=sha(b'controlled-cache-race');engine.cache=Path(cache)
    replace=os.replace
    def synchronized_replace(a,b):barrier.wait(timeout=30);return replace(a,b)
    m.os.replace=synchronized_replace
    sources=[{'id':'task','kind':'task','path':'task.md','text':'Keep input order.','contentHash':sha(b'Keep input order.'),'status':'backlog'}]
    try:r=engine.retrieve({'query':'input order','sources':sources,'namespace':sha(b'race'),'channel':'tasks','limit':5});out.put({'index':index,'completed':True,'encoded':r['encoded']})
    except Exception as e:out.put({'index':index,'completed':False,'error':type(e).__name__+': '+str(e)})
def main():
    protocol=Path('docs/benchmarks/2026-10-09-production-cache-race-protocol.json');output=Path('docs/benchmarks/2026-10-09-production-cache-race.json')
    source=Path('src/semantic-worker.py').read_bytes();harness=Path(__file__).read_bytes()
    if '--protocol' in sys.argv:
        if protocol.exists():raise RuntimeError('Never overwrite protocol')
        protocol.write_text(json.dumps({'sourceHash':sha(source),'harnessHash':sha(harness),'processes':4,'synchronization':'Barrier immediately before production os.replace, after each writer saves the same fixed tmp file','encoderMocked':True,'expected':'All four requests complete; final NPZ loads safely with matching checksum'},indent=2)+'\n');return
    if output.exists():raise RuntimeError('Never overwrite evidence')
    p=json.loads(protocol.read_text());assert p['sourceHash']==sha(source) and p['harnessHash']==sha(harness)
    cache=tempfile.mkdtemp(prefix='dip-production-cache-fault-');barrier=multiprocessing.Barrier(4);out=multiprocessing.Queue();children=[multiprocessing.Process(target=run,args=(i,cache,barrier,out)) for i in range(4)]
    for child in children:child.start()
    for child in children:child.join(timeout=45)
    rows=[]
    while not out.empty():rows.append(out.get())
    for i,child in enumerate(children):
        if child.is_alive():child.terminate();child.join();rows.append({'index':i,'completed':False,'error':'fault subprocess timeout'})
    valid=False;error=None
    try:
        with np.load(Path(cache)/(sha(b'race')+'-tasks.npz'),allow_pickle=False) as d:valid=str(d['checksum'])==sha(d['vectors'].tobytes()+d['keys'].tobytes())
    except Exception as e:error=type(e).__name__+': '+str(e)
    result={'protocolHash':sha(protocol.read_bytes()),'sourceHash':p['sourceHash'],'encoderMocked':True,'rows':sorted(rows,key=lambda x:x['index']),'finalCacheValid':valid,'cacheError':error,'productionPass':len(rows)==4 and all(x['completed'] for x in rows) and valid}
    output.write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result))
if __name__=='__main__':main()
