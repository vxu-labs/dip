"""Derived, content-keyed research cache. Canonical source/status never live here."""
import hashlib
import io
import json
import os
from pathlib import Path
import re
import time
import numpy as np

def sha(value):
    return hashlib.sha256(value).hexdigest()

def sections(source, strategy, width=160, overlap=40):
    text=source['text']
    if strategy=='whole':
        return [{'source':source['id'],'start':0,'end':len(text),'heading':None,'text':text}]
    if width<=overlap or overlap<0:
        raise ValueError('Chunk width must exceed non-negative overlap')
    starts=[(0,'preamble')]
    cursor=0
    fence=None
    for line in text.splitlines(keepends=True):
        opening=re.match(r'^\s*(`{3,}|~{3,})',line)
        if opening:
            marker=opening.group(1)[0]
            if fence==marker: fence=None
            elif fence is None: fence=marker
        if fence is None and not opening:
            heading=re.match(r'^#{1,6}\s+(.+?)\s*#*\s*$',line.rstrip('\n'))
            if heading:
                if cursor==0: starts[0]=(0,heading.group(1))
                else: starts.append((cursor,heading.group(1)))
        cursor+=len(line)
    chunks=[]
    for i,(start,heading) in enumerate(starts):
        end=starts[i+1][0] if i+1<len(starts) else len(text)
        for pos in range(start,end,width-overlap):
            stop=min(pos+width,end)
            if text[pos:stop].strip():chunks.append({'source':source['id'],'start':pos,'end':stop,'heading':heading,'text':text[pos:stop]})
            if stop==end: break
    return chunks

class DerivedIndex:
    def __init__(self,path,identity):
        self.path=Path(path)
        self.meta=self.path.with_suffix('.json')
        self.identity=identity
        self.values={}
        self.reason=None
        start=time.perf_counter()
        try:
            metadata=json.loads(self.meta.read_text(encoding='utf-8'))
            if metadata['identity']!=identity: raise ValueError('encoder identity mismatch')
            blob=self.path.read_bytes()
            if metadata['sha256']!=sha(blob): raise ValueError('cache checksum mismatch')
            with np.load(io.BytesIO(blob),allow_pickle=False) as data:
                keys=data['keys']; values=data['vectors']
                if values.ndim!=2 or len(keys)!=len(values) or values.dtype!=np.float32 or not np.isfinite(values).all(): raise ValueError('invalid vector array')
                if len(set(keys))!=len(keys) or any(not re.fullmatch('[a-f0-9]{64}',str(k)) for k in keys): raise ValueError('invalid content keys')
                if metadata['count']!=len(keys) or metadata['width']!=values.shape[1]: raise ValueError('invalid dimensions')
                self.values={str(key):value.copy() for key,value in zip(keys,values)}
        except (OSError,ValueError,KeyError,TypeError,EOFError) as exc:
            self.values={}
            self.reason=type(exc).__name__
        self.load_seconds=time.perf_counter()-start
    def key(self,text):
        return sha((json.dumps(self.identity,sort_keys=True)+'\0'+text).encode())
    def update(self,entries,encode):
        requested={self.key(x['text']):x['text'] for x in entries}
        missing=[key for key in requested if key not in self.values]
        previous=set(self.values)
        start=time.perf_counter()
        if missing:
            vectors=np.asarray(encode([requested[key] for key in missing]),dtype=np.float32)
            if vectors.ndim!=2 or len(vectors)!=len(missing) or not np.isfinite(vectors).all():raise ValueError('encoder produced invalid vectors')
            if self.values and vectors.shape[1]!=len(next(iter(self.values.values()))):raise ValueError('encoder dimensions changed')
            for key,vector in zip(missing,vectors):self.values[key]=vector
        self.values={key:self.values[key] for key in requested}
        result=np.array([self.values[self.key(x['text'])] for x in entries],dtype=np.float32)
        self.path.parent.mkdir(parents=True,exist_ok=True)
        ordered=sorted(self.values)
        blob=io.BytesIO()
        np.savez_compressed(blob,keys=np.array(ordered),vectors=np.array([self.values[k] for k in ordered],dtype=np.float32))
        raw=blob.getvalue()
        temp=self.path.with_suffix('.tmp.npz'); temp.write_bytes(raw); os.replace(temp,self.path)
        meta={'identity':self.identity,'sha256':sha(raw),'count':len(ordered),'width':result.shape[1]}
        tmp=self.meta.with_suffix('.tmp.json'); tmp.write_text(json.dumps(meta),encoding='utf-8');os.replace(tmp,self.meta)
        return result,{'entries':len(entries),'uniqueEntries':len(requested),'encoded':len(missing),'reused':len(requested)-len(missing),'pruned':len(previous-set(requested)),'loadSeconds':self.load_seconds,'updateSeconds':time.perf_counter()-start,'cacheBytes':len(raw),'rebuildReason':self.reason}

if __name__=='__main__':
    import argparse
    p=argparse.ArgumentParser();p.add_argument('--probe',required=True);args=p.parse_args()
    data=json.loads(Path(args.probe).read_text(encoding='utf-8'))
    index=DerivedIndex(data['path'],data['identity'])
    def forbidden(_):raise RuntimeError('Unchanged restart must not call encoder')
    vectors,stats=index.update(data['entries'],forbidden)
    assert sha(vectors.tobytes())==data['vectorHash']
    print(json.dumps({'restartVerified':True,'encoded':stats['encoded'],'reused':stats['reused'],'vectorHash':sha(vectors.tobytes())}))
