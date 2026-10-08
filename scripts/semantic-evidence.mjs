import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {semanticCorpus,history,projectText,markdownStore,parseMarkdown} from './semantic-corpus.mjs';
import {scoreResult} from './semantic-analysis.mjs';
const protocolFile='docs/benchmarks/2026-10-08-semantic-protocol.json';
const protocolBytes=fs.readFileSync(protocolFile), protocol=JSON.parse(protocolBytes);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
assert.deepEqual(protocol.corpus,semanticCorpus());
for(const [file,hash] of Object.entries(protocol.sources)) assert.equal(sha(fs.readFileSync(file,'utf8').replaceAll('\r\n','\n')),hash);
const summaryFile=process.argv[2]||'docs/benchmarks/2026-10-08-semantic-summary.json';
const summary=JSON.parse(fs.readFileSync(summaryFile));
const audits=JSON.parse(fs.readFileSync('docs/benchmarks/2026-10-08-semantic-tensors.json')).audits;
assert.equal(summary.protocolHash,sha(protocolBytes));
assert.equal(summary.attempts.length,8);
const successful=new Set();
const histories=new Map();
for(const language of ['en','he']) for(const size of protocol.sizes) histories.set(`${language}/${size}`,new Map(history(protocol.corpus.tasks[language],size,language).map(t=>[t.id,t])));
for(const attempt of summary.attempts) {
  const bytes=gunzipSync(fs.readFileSync(attempt.file));
  assert.equal(sha(bytes),attempt.resultHash);
  const data=JSON.parse(bytes);
  assert.equal(data.protocolHash,sha(protocolBytes));
  // JSON omits unavailable lexical-only neural resource fields; do not turn them into zeroes.
  assert.deepEqual(attempt.summary,JSON.parse(JSON.stringify(scoreResult(data,protocol))));
  if(!data.completedAt||data.error||data.resourceAbort) continue;
  assert.ok(!successful.has(data.model)); successful.add(data.model);
  assert.equal(data.device,'cpu'); assert.equal(data.threads,4);
  for(const [name,version] of Object.entries(protocol.packages)) assert.equal(data.packages[name],version);
  assert.equal(data.rows.length,protocol.corpus.queries.length*protocol.sizes.length*protocol.modes.length);
  const seen=new Set();
  const queries=new Map(protocol.corpus.queries.map(q=>[q.id,q]));
  for(const row of data.rows) {
    assert.ok(queries.has(row.query)); assert.ok(protocol.sizes.includes(row.size)); assert.ok(protocol.modes.includes(row.mode));
    const key=`${row.query}/${row.size}/${row.mode}`; assert.ok(!seen.has(key)); seen.add(key);
    assert.ok(Number.isFinite(row.searchSeconds)&&row.searchSeconds>=0);
    const query=queries.get(row.query), taskMap=histories.get(`${query.store}/${row.size}`);
    for(const field of ['raw','eligible']) {
      assert.equal(row[field].length,field==='raw'?10:3);
      const ids=new Set();
      for(let i=0;i<row[field].length;i++) {
        const [id,score]=row[field][i]; assert.ok(taskMap.has(id)); assert.ok(!ids.has(id)); ids.add(id); assert.ok(Number.isFinite(score));
        if(i) {const previous=row[field][i-1];assert.ok(previous[1]>=score); if(previous[1]===score) assert.ok(previous[0]<=id);}
        if(field==='eligible') {const task=taskMap.get(id);assert.equal(task.scope,query.scope);assert.equal(task.version,query.version);assert.ok(!['cancelled','superseded'].includes(task.status));}
      }
    }
  }
  for(const store of data.stores) {
    const tasks=history(protocol.corpus.tasks[store.language],10000,store.language);
    assert.deepEqual(parseMarkdown(markdownStore(tasks)),tasks);
    assert.equal(store.projectionHash,sha(tasks.map(projectText).join('\n\0\n')));
    assert.equal(store.storeEquivalent,true);
  }
  if(data.model!=='lexical') {
    const spec=protocol.models.find(x=>x.id===data.model); assert.ok(spec);
    assert.equal(data.loadedRevision,spec.revision); assert.equal(data.license,spec.license);
    const audit=audits.find(x=>x.model===data.model); assert.ok(audit);
    assert.equal(audit.revision,spec.revision);
    const tensors=audit.files.flatMap(x=>x.tensors);
    assert.equal(audit.totalTensorElements,tensors.reduce((n,x)=>n+x.elements,0));
    assert.equal(audit.integerBufferElements,tensors.filter(x=>/^[IU]/.test(x.dtype)).reduce((n,x)=>n+x.elements,0));
    assert.equal(audit.floatingElements,audit.totalTensorElements-audit.integerBufferElements);
    assert.equal(audit.totalTensorElements,spec.parameters);
    assert.equal(data.parameterCount,audit.floatingElements);
    for(const tensor of tensors) assert.equal(tensor.elements,tensor.shape.reduce((n,x)=>n*x,1));
    assert.equal(data.pairs.length,protocol.corpus.pairs.length); assert.equal(data.legacyPairs.length,96);
    for(const [rows,labels] of [[data.pairs,protocol.corpus.pairs],[data.legacyPairs,protocol.layaExploratory]]) {
      assert.deepEqual(rows.map(x=>x.id),labels.map(x=>x.id));
      for(const row of rows) assert.ok(Number.isFinite(row.score)&&Math.abs(row.score)<=1.00001);
    }
    assert.equal(data.weightBytes,data.assets.filter(x=>x.file.endsWith('.safetensors')).reduce((n,x)=>n+x.bytes,0));
    for(const asset of data.assets) {assert.ok(asset.bytes>0);assert.match(asset.sha256,/^[a-f0-9]{64}$/);}
  }
}
assert.equal(successful.size,8,'All preregistered attempts must complete to claim a complete comparison');
console.log(JSON.stringify({verified:true,models:successful.size-1,lexicalBaselines:1,queries:protocol.corpus.queries.length,holdoutFamilies:16,pairCases:protocol.corpus.pairs.length,rows:successful.size*protocol.corpus.queries.length*3*4,modelCalls:0}));
