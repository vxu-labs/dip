import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {SemanticWorker,semanticRetrieve,closeSemanticWorker} from '../src/semantic.js';
import {ensure,createTask,linkDocument} from '../src/core.js';
import {sha} from './semantic-agent-fixtures.mjs';
const output='docs/benchmarks/2026-10-08-semantic-prototype-live.json';
if(fs.existsSync(output))throw new Error('Never overwrite live evidence');
const protocol=JSON.parse(fs.readFileSync('docs/benchmarks/2026-10-08-winner-protocol.json'));
const sources=protocol.corpus.sources.filter(s=>s.kind==='document').map(s=>({...s,status:'source'}));
const worker=new SemanticWorker(),namespace=sha('prototype-known-document-localization');
const result={schemaVersion:1,startedAt:new Date().toISOString(),sourceHash:sha(JSON.stringify(sources)),workerHash:sha(fs.readFileSync('src/semantic-worker.py','utf8').replaceAll('\r\n','\n')),knownQueries:true,rows:[],cache:[]};
try{
  for(const q of protocol.corpus.queries.filter(q=>q.suite==='documents')){
    const r=await worker.request({query:q.q,channel:'documents',limit:5,sources,namespace});
    for(const c of r.candidates){const s=sources.find(s=>s.id===c.id);assert.equal(c.contentHash,s.contentHash);assert.equal(c.excerpt,Array.from(s.text).slice(c.start,c.end).join('').slice(0,800));}
    const top=r.candidates[0];result.rows.push({query:q.id,gold:q.gold,goldHeading:q.goldHeading,...r,sourceHit:q.gold.includes(top?.path),headingHit:q.gold.includes(top?.path)&&top?.heading?.at(-1)===q.goldHeading});
  }
  const request={query:'current requirements',channel:'documents',limit:5,sources,namespace};
  const first=await worker.request(request);assert.equal(first.encoded,0);result.cache.push({case:'unchanged-warm',...first});worker.close();
  const fresh=new SemanticWorker();const restarted=await fresh.request(request);assert.equal(restarted.encoded,0);result.cache.push({case:'fresh-process',...restarted});
  const changed=sources.map((s,i)=>i===0?{...s,text:s.text+'\n\n## Added note\nNEW-LOCAL-CONTENT',contentHash:sha(s.text+'\n\n## Added note\nNEW-LOCAL-CONTENT')}:s);
  const update=await fresh.request({...request,sources:changed});assert.ok(update.encoded>0);result.cache.push({case:'changed-source',...update});
  const removed=await fresh.request({...request,sources:changed.slice(1)});assert.equal(removed.encoded,0);assert.ok(!removed.candidates.some(c=>c.id===changed[0].id));result.cache.push({case:'deleted-source',...removed});
  fs.writeFileSync(path.join(process.env.DIP_SEMANTIC_CACHE,namespace+'.npz'),'corrupt');const rebuilt=await fresh.request({...request,sources:changed.slice(1)});assert.ok(rebuilt.cacheRebuilt&&rebuilt.encoded>0);result.cache.push({case:'corrupt-cache',...rebuilt});fresh.close();
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'dip-e5-live-'));execFileSync('git',['init','-b','main',root],{stdio:'pipe',env:{...process.env,GIT_TRACE2_EVENT:'0'}});
  process.env.DIP_HOME=path.join(root,'.runtime');process.env.DIP_USER_HOME=path.join(root,'.user');process.env.DIP_GIT_CONFIG=path.join(root,'.gitconfig');
  const repo=ensure(root,{instructions:false});const id=createTask(repo,{title:'Keep Hebrew text intact in exported rows',acceptance:['Preserve Unicode and current request order'],scope:['lib.mjs']});
  fs.writeFileSync(path.join(root,'plan.md'),'# Export\n\n## Current criteria\nPreserve Unicode and request order.');linkDocument(repo,id,{path:'plan.md',role:'plan'},'qa');
  const ledger=()=>sha(JSON.stringify(fs.readdirSync(path.join(repo.dir,'events',id)).sort().map(f=>fs.readFileSync(path.join(repo.dir,'events',id,f),'utf8'))));
  const before=ledger();const bridged=await semanticRetrieve(root,{query:'export Hebrew Unicode',channel:'tasks'});assert.equal(bridged.candidates[0].id,id);assert.equal(bridged.identityEstablished,false);assert.equal(before,ledger());result.bridge={readOnly:true,foundTask:true,...bridged};
  result.completedAt=new Date().toISOString();fs.writeFileSync(output,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({sourceR1:result.rows.filter(r=>r.sourceHit).length,headingR1:result.rows.filter(r=>r.headingHit).length,total:result.rows.length,cacheCases:result.cache.length,readOnly:result.bridge.readOnly}));
}finally{worker.close();closeSemanticWorker();}
