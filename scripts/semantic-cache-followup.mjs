import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {sha} from './semantic-agent-fixtures.mjs';
const output='docs/benchmarks/2026-10-08-semantic-cache-followup.json';
if(fs.existsSync(output))throw new Error('Never overwrite cache follow-up evidence');
const sources=[{id:'task_export',kind:'task',path:'memory/export.md',text:'# Export rows\nPreserve Unicode and request order.',status:'backlog'},{id:'task_queue',kind:'task',path:'memory/queue.md',text:'# Work queue\nKeep waiting work open.',status:'backlog'},{id:'doc_export',kind:'document',path:'docs/export.md',text:'# Export\n\n## Current contract\nPreserve Unicode and request order.\n\n## Future\nPriority sorting is deferred.',status:'source'}].map(s=>({...s,contentHash:sha(s.text)}));
const result={schemaVersion:1,startedAt:new Date().toISOString(),sources,rows:[],readOnly:true};
async function processWorker(file,label){
  const cache=path.resolve('.dip-local/semantic-cache-followup-'+label);fs.mkdirSync(cache,{recursive:true});
  const child=spawn(process.env.DIP_SEMANTIC_PYTHON,[path.resolve(file)],{env:{...process.env,DIP_SEMANTIC_CACHE:cache,PYTHONIOENCODING:'utf-8'},windowsHide:true,stdio:['pipe','pipe','pipe']});let buffer='',pending;
  child.stderr.on('data',()=>{});child.stdout.on('data',b=>{buffer+=b;let at;while((at=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,at);buffer=buffer.slice(at+1);const x=JSON.parse(line);pending?.resolve(x);pending=null;}});
  const request=payload=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Cache QA timeout')),120000);pending={resolve:x=>{clearTimeout(timer);if(x.error)reject(new Error(x.error));else resolve(x);}};child.stdin.write(JSON.stringify(payload)+'\n');});
  const namespace=sha('alternating-cache-'+label);
  try{for(const channel of ['tasks','documents','tasks','documents']){const response=await request({query:'export Unicode request order',channel,limit:5,sources,namespace});result.rows.push({label,channel,...response});}
    if(label==='after'){
      assert.equal(result.rows.filter(x=>x.label===label)[2].encoded,0);assert.equal(result.rows.filter(x=>x.label===label)[3].encoded,0);
      const changed=sources.map(s=>s.id==='task_export'?{...s,text:s.text+' New criterion.',contentHash:sha(s.text+' New criterion.')}:s);
      const updated=await request({query:'export',channel:'tasks',limit:5,sources:changed,namespace});assert.equal(updated.encoded,1);result.rows.push({label,case:'changed',channel:'tasks',...updated});
      const deleted=await request({query:'export',channel:'tasks',limit:5,sources:changed.slice(1),namespace});assert.equal(deleted.encoded,0);assert.ok(!deleted.candidates.some(x=>x.id==='task_export'));result.rows.push({label,case:'deleted',channel:'tasks',...deleted});
    }
  }finally{child.kill();}
}
try{
  result.beforeHash=sha(fs.readFileSync('scripts/fixtures/semantic-worker-protocol.py','utf8').replaceAll('\r\n','\n'));
  result.afterHash=sha(fs.readFileSync('src/semantic-worker.py','utf8').replaceAll('\r\n','\n'));
  await processWorker('scripts/fixtures/semantic-worker-protocol.py','before');await processWorker('src/semantic-worker.py','after');
  assert.ok(result.rows.filter(x=>x.label==='before')[2].encoded>0);result.completedAt=new Date().toISOString();
}catch(e){result.error=e.message;process.exitCode=1;}finally{fs.writeFileSync(output,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({rows:result.rows.map(x=>({label:x.label,channel:x.channel,case:x.case,encoded:x.encoded})),error:result.error}));}
