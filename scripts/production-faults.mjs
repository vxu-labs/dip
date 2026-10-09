// Controlled IPC faults against the frozen worker logic. Encoder/transport mocked,
// so these results make no inference, model-quality or latency claim.
import fs from 'node:fs';
import path from 'node:path';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {pathToFileURL} from 'node:url';
import {sha} from './semantic-agent-fixtures.mjs';
const protocol='docs/benchmarks/2026-10-09-production-fault-protocol.json',output='docs/benchmarks/2026-10-09-production-faults.json';
const source=fs.readFileSync('src/semantic.js','utf8');
if(process.argv.includes('--protocol')){
  if(fs.existsSync(protocol))throw new Error('Never overwrite protocol');
  fs.writeFileSync(protocol,JSON.stringify({createdAt:new Date().toISOString(),sourceHash:sha(source),harnessHash:sha(fs.readFileSync(import.meta.filename)),cases:['malformed-response-isolation','overbudget-response-recovery','late-response-after-close'],expected:'Every current request receives its own response or explicit failure; stale transport bytes never satisfy another request. Parser/size failures reset the broken transport.',modelMocked:true},null,2)+'\n');process.exit(0);
}
if(fs.existsSync(output))throw new Error('Never overwrite evidence');
const p=JSON.parse(fs.readFileSync(protocol));if(p.sourceHash!==sha(source)||p.harnessHash!==sha(fs.readFileSync(import.meta.filename)))throw new Error('Frozen source changed');
const children=[];
globalThis.__dipFaultSpawn=()=>{
  const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.stdin={write:(value,callback)=>{child.request=value;callback?.();}};child.kill=()=>{};children.push(child);return child;
};
const rewritten=source.replace("import {spawn} from 'node:child_process';","const spawn=globalThis.__dipFaultSpawn;").replace("from './core.js'","from "+JSON.stringify(pathToFileURL(path.resolve('src/core.js')).href)).replace("from './documents.js'","from "+JSON.stringify(pathToFileURL(path.resolve('src/documents.js')).href)).replace("from './util.js'","from "+JSON.stringify(pathToFileURL(path.resolve('src/util.js')).href)).replace("fileURLToPath(new URL('./semantic-worker.py',import.meta.url))","'controlled-fault-worker'");
const {SemanticWorker}=await import('data:text/javascript;base64,'+Buffer.from(rewritten).toString('base64'));
const env={DIP_SEMANTIC_PYTHON:path.resolve('mock-python'),DIP_SEMANTIC_MODEL:path.resolve('mock-model'),DIP_SEMANTIC_CACHE:path.resolve('mock-cache')};
const response=(child,id)=>child.stdout.emit('data',Buffer.from(JSON.stringify({candidates:[{id}]})+'\n'));
const rows=[];
{
  const w=new SemanticWorker(env),first=w.request({id:'first'}),child=w.child;
  child.stdout.emit('data',Buffer.from('malformed\n'));await Promise.allSettled([first]);
  const second=w.request({id:'second'});response(child,'first');const observed=await second;w.close();
  rows.push({name:'malformed-response-isolation',productionPass:observed.candidates.every(x=>x.id==='second'),receivedIds:observed.candidates.map(x=>x.id)});
}
{
  const w=new SemanticWorker(env),first=w.request({id:'first'}),child=w.child;
  child.stdout.emit('data',Buffer.alloc(2*1024*1024+1,120));await Promise.allSettled([first]);
  const second=w.request({id:'second'});response(w.child,'second');const observed=await Promise.allSettled([second]);w.close();
  rows.push({name:'overbudget-response-recovery',productionPass:observed[0].status==='fulfilled',error:observed[0].reason?.message});
}
{
  const w=new SemanticWorker(env),first=w.request({id:'first'}),old=w.child;w.close();await Promise.allSettled([first]);
  const second=w.request({id:'second'});response(old,'first');const observed=await second;w.close();
  rows.push({name:'late-response-after-close',productionPass:observed.candidates.every(x=>x.id==='second'),receivedIds:observed.candidates.map(x=>x.id)});
}
delete globalThis.__dipFaultSpawn;
fs.writeFileSync(output,JSON.stringify({createdAt:new Date().toISOString(),protocolHash:sha(fs.readFileSync(protocol)),sourceHash:p.sourceHash,transformedHash:sha(rewritten),modelMocked:true,rows},null,2)+'\n');
console.log(JSON.stringify(rows));
