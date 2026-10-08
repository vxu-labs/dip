import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {fitThreshold,scoreResult} from '../scripts/semantic-analysis.mjs';

test('semantic calibration retains the false-link cap even when rejecting positives',()=>{
  const fitted=fitThreshold([{score:.95,identity:true},{score:.8,identity:true},{score:.85,identity:false},{score:.7,identity:false}]);
  assert.equal(fitted.threshold,.95); assert.equal(fitted.tp,1); assert.equal(fitted.fp,0);
  const allRejected=fitThreshold([{score:.2,identity:true},{score:.9,identity:false}]);
  assert.ok(allRejected.threshold>.9); assert.equal(allRejected.tp,0); assert.equal(allRejected.fp,0);
});

test('semantic thresholds do not learn from held-out pair or retrieval outcomes',()=>{
  const protocol=JSON.parse(fs.readFileSync('docs/benchmarks/2026-10-08-semantic-protocol.json'));
  const file='docs/benchmarks/2026-10-08-semantic-minishlab--potion-base-8M.json.gz';
  const data=JSON.parse(gunzipSync(fs.readFileSync(file)));
  const original=scoreResult(data,protocol);
  const pairTest=new Set(protocol.corpus.pairs.filter(x=>x.split==='test').map(x=>x.id));
  const queryTest=new Set(protocol.corpus.queries.filter(x=>x.split==='test').map(x=>x.id));
  for(const row of data.pairs) if(pairTest.has(row.id)) row.score=1;
  for(const row of data.rows) if(queryTest.has(row.query)) for(const candidate of row.eligible) candidate[1]=1e6;
  const perturbed=scoreResult(data,protocol);
  assert.deepEqual(perturbed.identity.calibration,original.identity.calibration);
  assert.deepEqual(perturbed.thresholds,original.thresholds);
  assert.notDeepEqual(perturbed.identity.test,original.identity.test);
  assert.notDeepEqual(perturbed.retrieval,original.retrieval);
});

test('semantic corpus separates calibration families and records each assistant failure',()=>{
  const protocol=JSON.parse(fs.readFileSync('docs/benchmarks/2026-10-08-semantic-protocol.json'));
  const cal=new Set(protocol.corpus.queries.filter(x=>x.split==='calibration').map(x=>x.family));
  const held=new Set(protocol.corpus.queries.filter(x=>x.split==='test').map(x=>x.family));
  assert.equal(cal.size,8); assert.equal(held.size,16); assert.ok([...cal].every(x=>!held.has(x)));
  for(const query of protocol.corpus.queries) {
    assert.equal(cal.has(query.family),query.split==='calibration');
    assert.ok(!query.q.includes('-current')&&!query.a.includes('-current'));
    if(query.scenario==='no-match') assert.equal(query.gold,null);
    else assert.ok(query.gold.endsWith('-current'));
  }
  for(const pair of protocol.corpus.pairs) assert.equal(cal.has(pair.family),pair.split==='calibration');
});
