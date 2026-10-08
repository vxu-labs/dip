import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import zlib from 'node:zlib';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {score,sha,fixture,memory,common} from './semantic-agent-fixtures.mjs';
import {isolatedScore} from './semantic-agent-score.mjs';
const protocol=JSON.parse(fs.readFileSync('docs/benchmarks/2026-10-08-semantic-agent-protocol.json'));
const data=JSON.parse(zlib.gunzipSync(fs.readFileSync('docs/benchmarks/2026-10-08-semantic-agent-results.json.gz')));
assert.equal(data.protocolHash,sha(fs.readFileSync('docs/benchmarks/2026-10-08-semantic-agent-protocol.json')));
assert.equal(data.preflight,false);assert.ok(data.completedAt);assert.equal(data.rows.length,18);assert.equal(data.error,undefined);
assert.equal(protocol.common,common);
for(const [file,hash]of Object.entries(protocol.sources))assert.equal(sha(fs.readFileSync(file,'utf8').replaceAll('\r\n','\n')),hash,file);
const root=fs.mkdtempSync(path.join(os.tmpdir(),'dip-semantic-replay-'));
const flags=s=>({checks:s.checks.map(({name,passed})=>({name,passed})),memory:s.memory,passed:s.passed,total:s.total,memoryPassed:s.memoryPassed,memoryTotal:s.memoryTotal,allPassed:s.allPassed,recovery:s.recovery});
let replayed=0;
for(const scheduled of protocol.schedule){
  assert.deepEqual(scheduled.expected,fixture(scheduled.index).task);
  assert.equal(scheduled.sourcesHash,sha(JSON.stringify(memory(scheduled.index).tasks)));
  assert.equal(scheduled.documentHash,sha(fixture(scheduled.index).document));
  assert.equal(scheduled.prompt,fixture(scheduled.index).prompt);
  assert.deepEqual(data.rows.filter(r=>r.index===scheduled.index).map(r=>r.arm),scheduled.order);
  for(const arm of scheduled.order){const r=data.rows.find(r=>r.index===scheduled.index&&r.arm===arm);const dir=path.join(root,scheduled.index+'-'+arm);fs.mkdirSync(dir);
    for(const [file,text]of Object.entries(r.files)){assert.ok(['lib.mjs','recovery.json'].includes(file));fs.writeFileSync(path.join(dir,file),text);}
    const s=isolatedScore(dir,scheduled.index);assert.deepEqual(flags(s),flags(r.score));assert.equal(r.memoryUnchanged,true);
    assert.equal(r.toolCalls,r.toolEvents.length);
    assert.equal(r.toolOutputBytes,r.toolEvents.reduce((n,x)=>n+Buffer.byteLength(JSON.stringify(x.result??x.aggregated_output??'')),0));
    for(const event of r.retrieval)if(event.tool==='search')for(const c of event.result.candidates){const text=c.kind==='task'?memory(r.index).tasks.find(t=>t.id===c.id):null;if(c.kind==='task')assert.ok(text);assert.equal(event.result.identityEstablished,false);assert.equal(event.result.verification,'not_checked');}
    replayed++;
  }
}
const live=JSON.parse(fs.readFileSync('docs/benchmarks/2026-10-08-semantic-prototype-live.json'));
assert.ok(live.completedAt&&live.bridge.readOnly&&live.bridge.foundTask);assert.equal(live.rows.length,12);assert.equal(live.workerHash,sha(fs.readFileSync('src/semantic-worker.py','utf8').replaceAll('\r\n','\n')));
assert.equal(live.cache.find(x=>x.case==='fresh-process').encoded,0);
assert.equal(live.cache.find(x=>x.case==='deleted-source').encoded,0);
assert.ok(live.cache.find(x=>x.case==='corrupt-cache').encoded>0);
console.log(JSON.stringify({verified:true,replayed,modelCalls:0,readOnlyPrototype:true,knownDocumentQueries:12}));
