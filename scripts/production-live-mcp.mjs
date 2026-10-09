import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {ensure,append,linkDocument} from '../src/core.js';
import {sha} from './semantic-agent-fixtures.mjs';
const protocol='docs/benchmarks/2026-10-09-production-live-mcp-protocol.json',output='docs/benchmarks/2026-10-09-production-live-mcp.json';
if(process.argv.includes('--protocol')){
  if(fs.existsSync(protocol))throw new Error('Never overwrite protocol');
  fs.writeFileSync(protocol,JSON.stringify({createdAt:new Date().toISOString(),sourceHashes:Object.fromEntries(['src/semantic.js','src/semantic-worker.py','src/mcp.js'].map(f=>[f,sha(fs.readFileSync(f))])),harnessHash:sha(fs.readFileSync(import.meta.filename)),cases:['actual-tool-discovery','actual-task-document-read','channel-cache-reuse','canonical-read-only','ordinary-fallback','server-close-descendants'],modelMocked:false},null,2)+'\n');process.exit(0);
}
if(fs.existsSync(output))throw new Error('Never overwrite evidence');
const p=JSON.parse(fs.readFileSync(protocol));for(const[f,h]of Object.entries(p.sourceHashes))if(sha(fs.readFileSync(f))!==h)throw new Error('Frozen source changed');
if(p.harnessHash!==sha(fs.readFileSync(import.meta.filename)))throw new Error('Harness changed');
const sandbox=fs.mkdtempSync(path.join(os.tmpdir(),'dip-production-sdk-'));
const root=path.join(sandbox,'project');fs.mkdirSync(root);const env={...process.env,DIP_HOME:path.join(sandbox,'runtime'),DIP_USER_HOME:path.join(sandbox,'user'),DIP_GIT_CONFIG:path.join(sandbox,'gitconfig'),GIT_CONFIG_GLOBAL:path.join(sandbox,'gitconfig'),GIT_TRACE2_EVENT:'0',DIP_SEMANTIC_CACHE:path.join(sandbox,'cache')};
Object.assign(process.env,env);execFileSync(process.env.DIP_BENCH_GIT||'git',['init','-b','main',root],{env,stdio:'pipe'});
const repo=ensure(root,{instructions:false});append(repo,'task_sdk','task.create',{title:'Unicode export',description:'Keep Hebrew text and input order.',kind:'work',status:'backlog',acceptance:['Preserve Unicode and input order'],scope:[]},{actor:'fixture'});fs.writeFileSync(path.join(root,'plan.md'),'# Unicode export\n\n## Current criteria\nKeep Hebrew text and input order.');linkDocument(repo,'task_sdk',{path:'plan.md',role:'plan'},'fixture');
const ledger=()=>sha(JSON.stringify(fs.readdirSync(path.join(repo.dir,'events','task_sdk')).sort().map(f=>fs.readFileSync(path.join(repo.dir,'events','task_sdk',f),'utf8'))));
const before=ledger();const result={schemaVersion:1,startedAt:new Date().toISOString(),protocolHash:sha(fs.readFileSync(protocol)),rows:[],modelMocked:false};
const client=new Client({name:'production-sdk-qa',version:'1'}),transport=new StdioClientTransport({command:process.execPath,args:['--disable-warning=ExperimentalWarning',path.resolve('bin/dip.js'),'mcp'],env,stderr:'pipe'});
let stderr='';transport.stderr?.on('data',b=>stderr+=b);
const save=()=>fs.writeFileSync(output,JSON.stringify(result,null,2)+'\n');
const sample=pid=>{
  if(process.platform!=='win32')return [];
  const command=`$all=Get-CimInstance Win32_Process; $ids=@(${pid}); for($i=0;$i -lt 3;$i++){$ids+=@($all | Where-Object {$ids -contains $_.ParentProcessId} | ForEach-Object {$_.ProcessId})}; @($all | Where-Object {$ids -contains $_.ProcessId} | Select-Object Name,ProcessId,ParentProcessId,WorkingSetSize,PrivatePageCount) | ConvertTo-Json -Compress`;
  const text=execFileSync('powershell',['-NoProfile','-Command',command],{encoding:'utf8',windowsHide:true});if(!text.trim())return [];const r=JSON.parse(text);return Array.isArray(r)?r:[r];
};
try{
  await client.connect(transport);const tools=await client.listTools();result.rows.push({name:'actual-tool-discovery',productionPass:tools.tools.some(t=>t.name==='project_retrieve')});
  const requests=[{channel:'tasks',query:'Unicode Hebrew export'},{channel:'documents',query:'Hebrew input order'},{channel:'tasks',query:'Unicode Hebrew export'}];
  for(const a of requests){const at=performance.now();const reply=await client.callTool({name:'project_retrieve',arguments:{root,...a}},undefined,{timeout:130000});const data=reply.isError?null:JSON.parse(reply.content[0].text);result.rows.push({name:'read-'+a.channel,productionPass:!reply.isError&&data?.candidates.length>0,wallMs:performance.now()-at,error:reply.isError?reply.content[0]?.text:null,data});save();}
  const ordinary=await client.callTool({name:'task_requirements',arguments:{root,id:'task_sdk'}});result.rows.push({name:'ordinary-fallback',productionPass:!ordinary.isError});
  result.rows.push({name:'canonical-read-only',productionPass:ledger()===before});
  result.processSample=sample(transport.pid);result.sampleKind='One warm process-tree sample including Python descendants, not peak memory';
}catch(e){result.error=e.message;}
finally{
  const ids=(result.processSample||[]).map(x=>x.ProcessId);await client.close();await new Promise(r=>setTimeout(r,750));
  if(process.platform==='win32'&&ids.length){const cmd=`@(Get-CimInstance Win32_Process | Where-Object {@(${ids.join(',')}) -contains $_.ProcessId} | Select-Object Name,ProcessId,ParentProcessId) | ConvertTo-Json -Compress`;const raw=execFileSync('powershell',['-NoProfile','-Command',cmd],{encoding:'utf8',windowsHide:true});result.afterClose=raw.trim()?JSON.parse(raw):[];result.rows.push({name:'server-close-descendants',productionPass:Array.isArray(result.afterClose)&&result.afterClose.length===0});}
  result.stderr=stderr.replaceAll(sandbox,'<sandbox>').slice(-2000);result.completedAt=new Date().toISOString();save();console.log(JSON.stringify({rows:result.rows.map(x=>({name:x.name,pass:x.productionPass,wallMs:x.wallMs,error:x.error})),error:result.error,afterClose:result.afterClose}));
}
