"""Post-run, read-only safetensor metadata audit. No inference or scored retries."""
import argparse
import hashlib
import json
import math
from pathlib import Path
import struct

p=argparse.ArgumentParser()
p.add_argument('--protocol',required=True)
p.add_argument('--cache',required=True)
p.add_argument('--output',required=True)
args=p.parse_args()
protocol=json.loads(Path(args.protocol).read_text(encoding='utf-8'))
audits=[]
for spec in protocol['models']:
    root=Path(args.cache)/'hub'/('models--'+spec['id'].replace('/','--'))/'snapshots'/spec['revision']
    files=[]
    for file in sorted(root.rglob('*.safetensors')):
        with file.open('rb') as stream:
            length=struct.unpack('<Q',stream.read(8))[0]
            assert 0<length<10*2**20
            raw=stream.read(length)
            header=json.loads(raw)
        tensors=[{'name':name,'dtype':value['dtype'],'shape':value['shape'],'elements':math.prod(value['shape'])} for name,value in header.items() if name!='__metadata__']
        files.append({'file':file.relative_to(root).as_posix(),'headerHash':hashlib.sha256(raw).hexdigest(),'tensors':tensors})
    assert files
    total=sum(t['elements'] for f in files for t in f['tensors'])
    integer=sum(t['elements'] for f in files for t in f['tensors'] if t['dtype'].startswith(('I','U')))
    audits.append({'model':spec['id'],'revision':spec['revision'],'totalTensorElements':total,'integerBufferElements':integer,'floatingElements':total-integer,'files':files})
Path(args.output).write_text(json.dumps({'note':'Pinned Hub tensor totals include integer position-id buffers; these are not learned parameters. Read-only post-run header audit, no outcome rescoring.', 'audits':audits},ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps([{'model':x['model'],'floatingElements':x['floatingElements'],'integerBuffers':x['integerBufferElements']} for x in audits]))
