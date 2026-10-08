import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {winnerScore} from './winner-analysis.mjs';
const file='docs/benchmarks/2026-10-08-winner-protocol.json', bytes=fs.readFileSync(file),p=JSON.parse(bytes);
const sha=x=>createHash('sha256').update(x).digest('hex');
for(const [source,hash] of Object.entries(p.sources))assert.equal(sha(fs.readFileSync(source,'utf8').replaceAll('\r\n','\n')),hash);
const original=JSON.parse(fs.readFileSync('docs/benchmarks/2026-10-08-winner-protocol-v1.json'));
assert.deepEqual(original.corpus.queries,p.corpus.queries);assert.deepEqual(original.models,p.models);
for(const source of [...p.corpus.sources,...p.corpus.late,...Object.values(p.corpus.synthetic).flat()]) {
  assert.equal(source.contentHash,sha(source.text));assert.equal(source.verification,'not_checked');
  if(source.fields)assert.equal(source.intentHash,sha(JSON.stringify(source.fields)));
}
assert.equal(p.corpus.sources.filter(x=>x.kind==='task').length,16);assert.equal(p.corpus.sourceFiles.length,18);
assert.equal(p.corpus.queries.length,188);assert.equal(new Set(p.corpus.queries.map(q=>q.id)).size,188);
for(const query of p.corpus.queries)assert.ok(!query.q.includes('task_'),'No answer identifiers in query');
const results=JSON.parse(fs.readFileSync('docs/benchmarks/2026-10-08-winner-summary.json'));assert.equal(results.protocolHash,sha(bytes));assert.equal(results.attempts.length,3);
const resolve=q=>q.suite==='known-synthetic'?p.corpus.synthetic[q.store]:q.suite==='late'?p.corpus.late:p.corpus.sources.filter(s=>s.kind===q.kind);
const queryMap=new Map(p.corpus.queries.map(q=>[q.id,q]));
const headingCache=new Map();
function headingSpans(source) {
  if(headingCache.has(source.contentHash))return headingCache.get(source.contentHash);
  const starts=[{start:0,heading:'preamble'}];let cursor=0,fence=null;
  for(const line of source.text.match(/[^\n]*(?:\n|$)/g)||[]) {
    if(!line)continue;
    const opening=line.match(/^\s*(`{3,}|~{3,})/);
    if(opening){const marker=opening[1][0];if(fence===marker)fence=null;else if(fence===null)fence=marker;}
    if(fence===null&&!opening){const heading=line.replace(/\n$/,'').match(/^#{1,6}\s+(.+?)\s*#*\s*$/);if(heading){if(cursor===0)starts[0].heading=heading[1];else starts.push({start:cursor,heading:heading[1]});}}
    cursor+=[...line].length;
  }
  const spans=starts.map((x,i)=>({...x,end:i+1<starts.length?starts[i+1].start:[...source.text].length}));headingCache.set(source.contentHash,spans);return spans;
}
const successful=new Set();
for(const attempt of results.attempts) {
  const raw=gunzipSync(fs.readFileSync(attempt.file));assert.equal(sha(raw),attempt.resultHash);
  const data=JSON.parse(raw);assert.equal(data.protocolHash,sha(bytes));assert.deepEqual(attempt.summary,JSON.parse(JSON.stringify(winnerScore(data,p))));
  assert.ok(data.completedAt&&!data.error&&!data.resourceAbort,'All scheduled attempts must finish to claim a complete comparison');
  assert.ok(!successful.has(data.model));successful.add(data.model);
  const methods=data.model==='lexical'?['whole','sections']:['whole','sections','hybrid-whole','hybrid-sections'];assert.deepEqual(data.strategies,methods);
  assert.equal(data.rows.length,p.corpus.queries.length*methods.length);const seen=new Set();
  for(const row of data.rows) {
    const q=queryMap.get(row.query);assert.ok(q);assert.equal(row.suite,q.suite);assert.ok(methods.includes(row.strategy));
    const key=row.query+'/'+row.strategy;assert.ok(!seen.has(key));seen.add(key);
    assert.equal(row.identityEstablished,false);assert.equal(row.verification,'not_checked');assert.equal(row.decision,'candidate_only');assert.ok(row.searchSeconds>=0&&Number.isFinite(row.searchSeconds));
    const pool=resolve(q),sources=new Map(pool.map(s=>[s.id,s]));
    for(const kind of ['raw','eligible']) {
      assert.equal(row[kind].length,Math.min(10,pool.length));const ids=new Set();
      for(let i=0;i<row[kind].length;i++) {
        const r=row[kind][i],s=sources.get(r.id);assert.ok(s);assert.ok(!ids.has(r.id));ids.add(r.id);assert.ok(Number.isFinite(r.score));
        if(i){const previous=row[kind][i-1];assert.ok(previous.score>=r.score);if(previous.score===r.score)assert.ok(previous.id<=r.id);}
        assert.equal(r.path,s.path);assert.equal(r.contentHash,s.contentHash);assert.equal(r.recordedStatus,s.recordedStatus);
        const chars=[...s.text];assert.ok(Number.isInteger(r.start)&&Number.isInteger(r.end)&&r.start>=0&&r.end>r.start&&r.end<=chars.length);
        const excerpt=chars.slice(r.start,r.end).slice(0,160).join('');assert.equal(r.excerpt,excerpt);assert.equal(r.excerptTruncated,r.end-r.start>160);
        if(row.strategy.endsWith('whole')){assert.equal(r.start,0);assert.equal(r.end,chars.length);assert.equal(r.heading,null);}
        else {assert.ok(r.end-r.start<=p.chunkChars);const span=headingSpans(s).find(x=>r.start>=x.start&&r.start<x.end);assert.ok(span);assert.equal(r.heading,span.heading);assert.equal((r.start-span.start)%(p.chunkChars-p.overlapChars),0);assert.equal(r.end,Math.min(r.start+p.chunkChars,span.end));}
        if(kind==='eligible'){assert.ok(!['cancelled','superseded'].includes(s.recordedStatus));if(q.version)assert.equal(s.version,q.version);}
      }
    }
  }
  assert.equal(data.indexes.length,10);
  if(data.model!=='lexical') {
    const model=p.models.find(x=>x.id===data.model);assert.ok(model);assert.equal(data.resources.loadedRevision,model.revision);assert.equal(data.resources.license,model.license);
    assert.equal(data.resources.device,'cpu');assert.equal(data.resources.threads,4);for(const [name,version] of Object.entries(p.packages))assert.equal(data.resources.packages[name],version);
    assert.equal(data.cacheChecks.length,10);assert.equal(data.cacheChecks.filter(x=>x.corruptRecovery).length,1);
    const checked=new Set();
    for(const check of data.cacheChecks) {
      const key=[check.suite,check.store,check.strategy].join('/');assert.ok(!checked.has(key));checked.add(key);
      assert.equal(check.restart.restartVerified,true);assert.equal(check.restart.encoded,0);assert.match(check.restart.vectorHash,/^[a-f0-9]{64}$/);
      assert.ok(check.changed.encoded<=1);assert.equal(check.deleted.encoded,0);assert.ok(check.deleted.entries<check.changed.entries);
      if(check.corruptRecovery){assert.ok(check.corruptRecovery.rebuildReason);assert.equal(check.corruptRecovery.encoded,check.corruptRecovery.uniqueEntries);}
    }
  }
}
assert.equal(successful.size,3);
console.log(JSON.stringify({verified:true,models:2,lexicalBaselines:1,sourceTasks:16,documents:18,queries:188,rows:1880,restartedIndexes:20,readOnly:true,modelCalls:0}));
