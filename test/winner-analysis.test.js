import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {winnerScore} from '../scripts/winner-analysis.mjs';
const p=JSON.parse(fs.readFileSync('docs/benchmarks/2026-10-08-winner-protocol.json'));
test('winner scoring never treats an unrelated request as recovered work',()=>{
  const queries=p.corpus.queries.filter(q=>q.suite==='real'&&q.gold.length===0);
  const data={completedAt:'fixture',model:'lexical',strategies:['whole'],rows:queries.map(q=>({query:q.id,suite:q.suite,strategy:'whole',raw:[{id:p.corpus.sources[0].id}],eligible:[{id:p.corpus.sources[0].id}],searchSeconds:0,identityEstablished:false,verification:'not_checked',decision:'candidate_only'}))};
  const s=winnerScore(data,p);assert.equal(s.readOnly,true);assert.equal(s.scores[0].matching,0);assert.equal(s.scores[0].raw.mrr10,null);assert.equal(s.scores[0].unmatchedWithCandidates,8);
});
test('winner scoring distinguishes source recovery from heading and dangerous completion claims',()=>{
  const q=p.corpus.queries.find(q=>q.suite==='documents');
  const data={completedAt:'fixture',model:'lexical',strategies:['sections'],rows:[{query:q.id,suite:q.suite,strategy:'sections',raw:[{id:q.gold[0],heading:'incorrect section'}],eligible:[{id:q.gold[0]}],searchSeconds:0,identityEstablished:false,verification:'not_checked',decision:'candidate_only'}]};
  const s=winnerScore(data,p);assert.equal(s.scores[0].raw.r1,1);assert.equal(s.scores[0].heading1,0);assert.equal(s.readOnly,true);
  data.rows[0].decision='mark_done';assert.equal(winnerScore(data,p).readOnly,false);
});
test('winner late stress preserves requirements and known cases remain explicitly exploratory',()=>{
  for(const source of p.corpus.late){const original=p.corpus.sources.find(x=>x.id===source.id);assert.ok(source.text.endsWith(original.text));assert.ok(source.text.length>original.text.length+12000);assert.deepEqual(source.fields,original.fields);}
  const known=p.corpus.queries.filter(q=>q.suite==='known-synthetic');assert.equal(known.length,96);assert.ok(known.every(q=>q.known));
  const data=JSON.parse(gunzipSync(fs.readFileSync('docs/benchmarks/2026-10-08-winner-intfloat--multilingual-e5-small.json.gz')));assert.equal(winnerScore(data,p).readOnly,true);assert.equal(data.cacheChecks.filter(x=>x.restart.encoded===0).length,10);
});
