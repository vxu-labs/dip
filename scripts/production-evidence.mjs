import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {gunzipSync} from 'node:zlib';
import {sha} from './semantic-agent-fixtures.mjs';
const base='docs/benchmarks/2026-10-09-production-';
const summary=JSON.parse(fs.readFileSync(base+'summary.json'));
assert.equal(summary.collectionComplete,true,'Do not verify incomplete collection');
assert.equal(summary.verdict,'NOT_READY_FOR_DEFAULT_PRODUCTION');
for(const[file,h]of Object.entries(summary.artifactHashes))assert.equal(sha(fs.readFileSync('docs/benchmarks/'+file)),h,'Artifact changed: '+file);
const archive=JSON.parse(gunzipSync(fs.readFileSync(base+'source.json.gz')));
const protocol=JSON.parse(fs.readFileSync(base+'protocol.json'));
assert.equal(archive.head,summary.head);
for(const[file,h]of Object.entries(protocol.sources))assert.equal(sha(archive.files[file].replaceAll('\r\n','\n')),h,'Frozen product/harness mismatch: '+file);
assert.equal(sha(archive.files['scripts/production-faults.mjs']),JSON.parse(fs.readFileSync(base+'fault-protocol.json')).harnessHash);
const r=JSON.parse(gunzipSync(fs.readFileSync(base+'agent-results.json.gz')));
assert.equal(sha(fs.readFileSync(base+'agent-results.json.gz')),summary.agentRawHash);
assert.equal(r.protocolHash,sha(fs.readFileSync(base+'protocol.json')));
assert.equal(r.rows.length,18);assert.ok(r.completedAt);assert.ok(!r.error);
const expected=protocol.schedule.flatMap(s=>s.order.map(arm=>`${s.index}:${arm}`));
assert.deepEqual(r.rows.map(x=>`${x.index}:${x.arm}`),expected,'No omitted, repeated or reordered scored attempts');
const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'dip-production-replay-'));fs.mkdirSync(path.join(scratch,'scripts'));
for(const file of ['semantic-agent-fixtures.mjs','semantic-agent-score.mjs'])fs.writeFileSync(path.join(scratch,'scripts',file),archive.files['scripts/'+file]);
let replays=0;
for(const row of r.rows){
  const dir=path.join(scratch,String(replays));fs.mkdirSync(dir);
  for(const[file,text]of Object.entries(row.files))fs.writeFileSync(path.join(dir,file),text);
  const replay=JSON.parse(execFileSync(process.execPath,[path.join(scratch,'scripts/semantic-agent-score.mjs'),'--worker',dir,String(row.index)],{encoding:'utf8',timeout:30000,windowsHide:true,maxBuffer:1024*1024}).trim().split('\n').at(-1));
  for(const key of ['passed','memoryPassed','allPassed','checks','memory'])assert.deepEqual(replay[key],row.score[key],'Retained artifact does not reproduce '+key);
  assert.equal(row.injectionMarkerAbsent,!Object.hasOwn(row.files,'injection-marker.txt'));
  replays++;
}
for(const a of summary.arms){const rows=r.rows.filter(x=>x.arm===a.arm);assert.equal(a.runs,rows.length);assert.equal(a.functional,rows.reduce((n,x)=>n+x.score.passed,0));assert.equal(a.memory,rows.reduce((n,x)=>n+x.score.memoryPassed,0));assert.equal(a.searchAttempts,rows.reduce((n,x)=>n+x.toolEvents.filter(t=>t.type==='mcp_tool_call'&&t.tool==='memory_search').length,0));assert.equal(a.successfulSearches,rows.reduce((n,x)=>n+x.retrieval.filter(t=>t.tool==='search').length,0));}
const ops=JSON.parse(fs.readFileSync(base+'operations.json'));assert.equal(ops.protocolHash,r.protocolHash);assert.equal(ops.rows.length,32);assert.equal(new Set(ops.rows.map(x=>x.name)).size,32);assert.ok(ops.completedAt);
assert.equal(summary.operational.reportedFail,ops.rows.filter(x=>x.productionPass===false).length);
const faults=JSON.parse(fs.readFileSync(base+'faults.json')),faultProtocol=JSON.parse(fs.readFileSync(base+'fault-protocol.json'));
assert.equal(faults.protocolHash,sha(fs.readFileSync(base+'fault-protocol.json')));assert.equal(faultProtocol.sourceHash,sha(archive.files['src/semantic.js']));
assert.equal(faults.modelMocked,true);assert.ok(faults.rows.every(x=>x.productionPass===false));
for(const suffix of ['cache-race','cache-race-serialized']){
  const data=JSON.parse(fs.readFileSync(base+suffix+'.json')),p=JSON.parse(fs.readFileSync(base+suffix+'-protocol.json'));
  assert.equal(data.protocolHash,sha(fs.readFileSync(base+suffix+'-protocol.json')));assert.equal(p.sourceHash,sha(archive.files['src/semantic-worker.py']));assert.equal(data.encoderMocked,true);assert.equal(data.rows.length,4);
  assert.equal(p.harnessHash,sha(archive.files[suffix==='cache-race'?'scripts/fixtures/production-cache-race-v1.py':'scripts/production-cache-race.py']));
  assert.equal(data.productionPass,data.rows.every(x=>x.completed)&&data.finalCacheValid);
}
const live=JSON.parse(fs.readFileSync(base+'live-mcp.json')),lp=JSON.parse(fs.readFileSync(base+'live-mcp-protocol.json'));
assert.equal(live.protocolHash,sha(fs.readFileSync(base+'live-mcp-protocol.json')));assert.equal(live.modelMocked,false);assert.ok(live.completedAt);
for(const[file,h]of Object.entries(lp.sourceHashes))assert.equal(h,sha(archive.files[file]));
assert.equal(lp.harnessHash,sha(archive.files['scripts/production-live-mcp.mjs']));
const bounds=JSON.parse(fs.readFileSync(base+'bounds.json')),bp=JSON.parse(fs.readFileSync(base+'bounds-protocol.json'));
assert.equal(bounds.protocolHash,sha(fs.readFileSync(base+'bounds-protocol.json')));assert.equal(bp.sourceHash,sha(archive.files['src/semantic.js']));assert.equal(bp.harnessHash,sha(archive.files['scripts/production-bounds.mjs']));assert.equal(bounds.rows.length,4);
assert.equal(bounds.rows.find(x=>x.name==='unicode-at-task-truncation-boundary').productionPass,false);
assert.ok(!fs.readFileSync('docs/benchmarks/production-readiness.md','utf8').includes('\u2014'));
console.log(JSON.stringify({agentArtifactReplays:replays,liveDiagnosticRows:ops.rows.length,controlledTransportFaults:faults.rows.length,verdict:summary.verdict,productReadinessVerified:false,modelCalls:0,note:'Evidence integrity and reproducibility only; NOT a production approval'}));
