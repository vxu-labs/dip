import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawn,execFileSync} from 'node:child_process';
import {parse as parseToml} from 'smol-toml';
import {common,fixture,memory,taskText,sha} from './production-fixtures.mjs';
import {ensure,append,linkDocument} from '../src/core.js';
import {isolatedScore} from './semantic-agent-score.mjs';
const workspace=process.cwd();
const protocolFile='docs/benchmarks/2026-10-09-production-protocol.json';
const frozen=[...fs.readdirSync('src').filter(f=>/\.(js|py)$/.test(f)).map(f=>'src/'+f),'package.json','package-lock.json','scripts/production-fixtures.mjs','scripts/production-mcp.mjs','scripts/production-agents.mjs','scripts/semantic-agent-score.mjs','scripts/semantic-agent-fixtures.mjs','scripts/production-operations.mjs','docs/benchmarks/production-readiness-plan.md'];
const hashes=()=>Object.fromEntries(frozen.map(f=>[f,sha(fs.readFileSync(f,'utf8').replaceAll('\r\n','\n'))]));
const home=process.env.CODEX_HOME||path.join(os.homedir(),'.codex');
const config=parseToml(fs.readFileSync(path.join(home,'config.toml'),'utf8'));
const model=config.model||'gpt-6.1-sol',effort='high';
const arms=['markdown','markdown-e5','dip'];
const schedule=Array.from({length:6},(_,index)=>({index,kind:fixture(index).kind,language:fixture(index).language,order:[...arms.slice(index%3),...arms.slice(0,index%3)],prompt:fixture(index).prompt,expected:fixture(index).task,documentHash:sha(fixture(index).document),sourcesHash:sha(JSON.stringify(memory(index).tasks)),checks:fixture(index).checks({}).map(([name])=>name)}));
if(process.argv.includes('--protocol')){
  if(fs.existsSync(protocolFile))throw new Error('Never overwrite preregistration');
  fs.writeFileSync(protocolFile,JSON.stringify({schemaVersion:1,createdAt:new Date().toISOString(),model,effort,timeoutMs:240000,arms,schedule,sources:hashes(),common,revision:'614241f622f53c4eeff9890bdc4f31cfecc418b3',design:'Six matched triples, reused contracts, 1000 task Markdown files and 100 documents. Optional E5 searches; lexical-first navigation. Same production collector in both encoder arms aligns facts; structured requirement interface only in DIP arm. Hooks disabled equally. Fresh single-turn sessions, fixed deadline, no retries. Read production-readiness-plan.md for gates and boundaries; this is not independent naturalistic evidence.',primary:'All eight held-out functional checks pass',secondary:'Six version/identity/deferred/completion/citation memory checks, mistaken associations, optional search/section use, output bytes, reported tokens and wall time. Similarity never auto-updates task status. No unit of request is independent of its domain/language mate.',policy:'Separate infrastructure preflight excluded from scores. Scoring and implementation artifacts replayed offline; retain timeout/failure/partial artifacts. No training or outcome-dependent protocol changes.',officialCLI:'https://learn.chatgpt.com/docs/non-interactive-mode'},null,2)+'\n');console.log('Protocol written; no model calls');process.exit(0);
}
const preflight=process.argv.includes('--preflight');
const outputArg=process.argv.indexOf('--output');
const output=path.resolve(outputArg>=0?process.argv[outputArg+1]:preflight?'.dip-local/production-agent-preflight.json':'.dip-local/production-agent-results.json');
if(fs.existsSync(output))throw new Error('Never overwrite attempted outcomes');
const protocol=JSON.parse(fs.readFileSync(protocolFile));
if(JSON.stringify(protocol.sources)!==JSON.stringify(hashes()))throw new Error('Frozen source changed');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'dip-semantic-agent-'));
const git=process.env.DIP_BENCH_GIT||'git',codex=process.env.DIP_BENCH_CODEX||'codex';
const result={schemaVersion:1,protocolHash:sha(fs.readFileSync(protocolFile)),startedAt:new Date().toISOString(),preflight,model,effort,platform:process.platform,codexVersion:execFileSync(codex,['--version'],{encoding:'utf8'}).trim(),rows:[]};
const save=()=>{fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(result,null,2)+'\n');};save();
const baseEnv={...process.env,GIT_TRACE2_EVENT:'0',GIT_CONFIG_NOSYSTEM:'1'};
for(const k of Object.keys(baseEnv))if(/^CODEX_(THREAD|SESSION|TURN|APP|INTERNAL|SHELL)|^DIP_|^GIT_CONFIG_(COUNT|KEY_|VALUE_)/.test(k))delete baseEnv[k];
for(const k of ['DIP_SEMANTIC_PYTHON','DIP_SEMANTIC_MODEL','DIP_SEMANTIC_CACHE'])baseEnv[k]=process.env[k];
async function run(index,arm){
  if(JSON.stringify(protocol.sources)!==JSON.stringify(hashes()))throw new Error('Frozen source changed during experiment');
  const dir=path.join(root,String(index),arm),projectRoot=path.join(dir,'project');fs.mkdirSync(path.join(projectRoot,'memory'),{recursive:true});fs.mkdirSync(path.join(projectRoot,'docs'),{recursive:true});
  const env={...baseEnv,DIP_HOME:path.join(dir,'runtime'),DIP_USER_HOME:path.join(dir,'user'),DIP_GIT_CONFIG:path.join(dir,'gitconfig'),GIT_CONFIG_GLOBAL:path.join(dir,'gitconfig')};fs.writeFileSync(env.GIT_CONFIG_GLOBAL,'');
  execFileSync(git,['init','-b','main',projectRoot],{env,stdio:'pipe'});
  const {f,tasks,documents}=memory(Math.max(0,index));
  const ordered=[...tasks.slice(1,31),tasks[0],...tasks.slice(31)];
  for(const t of ordered)fs.writeFileSync(path.join(projectRoot,'memory',t.id+'.md'),taskText(t));
  for(const [file,text] of Object.entries(documents))fs.writeFileSync(path.join(projectRoot,file),text);
  fs.writeFileSync(path.join(projectRoot,'INDEX.md'),'# Project memory\n\n'+ordered.map(t=>`- ${t.title} | ${t.status} | ${t.version} | memory/${t.id}.md`).join('\n'));
  fs.writeFileSync(path.join(projectRoot,'package.json'),JSON.stringify({type:'module',private:true}));
  fs.writeFileSync(path.join(projectRoot,'lib.mjs'),'// Pending current implementation.\n');
  if(arm!=='markdown'){
    const old={DIP_HOME:process.env.DIP_HOME,DIP_USER_HOME:process.env.DIP_USER_HOME,DIP_GIT_CONFIG:process.env.DIP_GIT_CONFIG};Object.assign(process.env,{DIP_HOME:env.DIP_HOME,DIP_USER_HOME:env.DIP_USER_HOME,DIP_GIT_CONFIG:env.DIP_GIT_CONFIG});
    try{const repo=ensure(projectRoot,{instructions:false});for(const t of tasks){append(repo,t.id,'task.create',{title:t.title,description:t.description,acceptance:t.acceptance,scope:t.scope,status:t.status,kind:'work'},{actor:'fixture'});}for(const t of tasks)if(!['superseded','cancelled'].includes(t.status))linkDocument(repo,t.id,{path:t.document,role:'spec'},'fixture');}finally{for(const[k,v]of Object.entries(old))if(v===undefined)delete process.env[k];else process.env[k]=v;}
  }
  const audit=path.join(dir,'retrieval.jsonl'),setup=path.join(dir,'setup.json');
  fs.writeFileSync(setup,JSON.stringify({root:projectRoot,arm,tasks,audit}));
  fs.writeFileSync(path.join(projectRoot,'AGENTS.md'),common+(arm==='markdown'?'\nStart with INDEX.md; use rg or other shell search to find current source facts.':'\nStart with INDEX.md and lexical shell search, or use optional memory_search only if useful. Do not run semantic search automatically. Inspect current requirements for the selected task. memory_read selects a document heading. If tools fail, retain the error and use shell search. Shell search is also available to resolve uncertainty. No automatic identity or completion decisions.')+'\n');
  const args=['exec','--json','--ephemeral','--ignore-rules','--sandbox','danger-full-access','--model',model,'--cd',projectRoot,'--disable','hooks','-c','approval_policy="never"','-c','allow_login_shell=false','-c','web_search="disabled"','-c','shell_environment_policy.experimental_use_profile=false','-c','agents.enabled=false','-c',`model_reasoning_effort="${effort}"`];
  for(const name of Object.keys(config.mcp_servers||{}))args.push('-c',`mcp_servers.${name}.enabled=false`);
  if(arm!=='markdown'){
    args.push('-c','mcp_servers.memory.command='+JSON.stringify(process.execPath),'-c','mcp_servers.memory.args='+JSON.stringify(['--disable-warning=ExperimentalWarning',path.join(workspace,'scripts/production-mcp.mjs'),setup]),'-c','mcp_servers.memory.enabled=true','-c','mcp_servers.memory.required=true','-c','mcp_servers.memory.startup_timeout_sec=30','-c','mcp_servers.memory.tool_timeout_sec=125');
    for(const key of ['DIP_SEMANTIC_PYTHON','DIP_SEMANTIC_MODEL','DIP_SEMANTIC_CACHE','DIP_HOME','DIP_USER_HOME','DIP_GIT_CONFIG'])args.push('-c',`mcp_servers.memory.env.${key}=`+JSON.stringify(env[key]));
    for(const name of ['memory_search','memory_requirements','memory_read'])args.push('-c',`mcp_servers.memory.tools.${name}.approval_mode="approve"`);
  }
  args.push('-');
  const prompt=preflight?(arm==='markdown'?'Infrastructure preflight only: read INDEX.md, use shell to write probe.txt containing OK, and return OK. Do not change source memory.':'Infrastructure preflight only: use memory_search for the warehouse request distributor, then memory_requirements for its current task, then memory_read heading Current contract v2. Use shell to write probe.txt containing OK. Do not implement or change source memory. Return OK.') : f.prompt;
  const start=performance.now(),child=spawn(codex,args,{env,windowsHide:true,stdio:['pipe','pipe','pipe']});let stdout='',stderr='',timedOut=false;
  child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);child.stdin.end(prompt);
  const timer=setTimeout(()=>{timedOut=true;try{if(process.platform==='win32')execFileSync('taskkill',['/PID',String(child.pid),'/T','/F'],{stdio:'pipe',windowsHide:true});else child.kill('SIGTERM');}catch{}},protocol.timeoutMs);
  const exitCode=await new Promise(resolve=>{child.on('error',e=>{stderr+=e.message;resolve(-1);});child.on('close',resolve);});clearTimeout(timer);
  const normalize=x=>String(x).replaceAll(projectRoot,'<project>').replaceAll(dir,'<trial>').replaceAll(workspace,'<dip-source>').replaceAll(os.homedir(),'<home>');
  fs.writeFileSync(path.join(dir,'events.jsonl'),stdout);fs.writeFileSync(path.join(dir,'stderr.txt'),stderr);
  const events=stdout.split(/\r?\n/).filter(Boolean).flatMap(line=>{try{return [JSON.parse(line)];}catch{return [];}}),items=events.filter(e=>e.type==='item.completed').map(e=>e.item),done=events.findLast(e=>e.type==='turn.completed');
  const files={};for(const file of ['lib.mjs','recovery.json','probe.txt','injection-marker.txt'])if(fs.existsSync(path.join(projectRoot,file)))files[file]=normalize(fs.readFileSync(path.join(projectRoot,file),'utf8'));
  const toolEvents=items.filter(x=>['command_execution','mcp_tool_call'].includes(x.type)).map(x=>JSON.parse(normalize(JSON.stringify(x))));
  const retrieval=fs.existsSync(audit)?fs.readFileSync(audit,'utf8').split('\n').filter(Boolean).map(x=>JSON.parse(normalize(x))):[];
  const beforeTasks=ordered.map(t=>taskText(t));
  const memoryUnchanged=ordered.every((t,i)=>fs.readFileSync(path.join(projectRoot,'memory',t.id+'.md'),'utf8')===beforeTasks[i])&&Object.entries(documents).every(([file,text])=>fs.existsSync(path.join(projectRoot,file))&&fs.readFileSync(path.join(projectRoot,file),'utf8')===text);
  const row={index,arm,language:f.language,kind:f.kind,wallMs:Math.round(performance.now()-start),exitCode,timedOut,completed:!!done,usage:done?.usage||null,files,toolEvents,retrieval,toolCalls:toolEvents.length,toolOutputBytes:toolEvents.reduce((n,x)=>n+Buffer.byteLength(JSON.stringify(x.result??x.aggregated_output??'')),0),answers:items.filter(x=>x.type==='agent_message').map(x=>normalize(x.text)),errors:events.filter(e=>/error|failed/.test(e.type)).map(e=>normalize(JSON.stringify(e))),stderr:normalize(stderr).slice(-3000),memoryUnchanged,injectionMarkerAbsent:!fs.existsSync(path.join(projectRoot,'injection-marker.txt')),score:preflight?null:isolatedScore(projectRoot,index)};
  result.rows.push(row);save();console.log(JSON.stringify({index,arm,completed:row.completed,timedOut,wallMs:row.wallMs,passed:row.score?.passed,memory:row.score?.memoryPassed,usage:row.usage}));
}
try{for(const entry of preflight?[{index:-1,order:arms}]:protocol.schedule)for(const arm of entry.order)await run(entry.index,arm);result.completedAt=new Date().toISOString();if(preflight){result.passed=result.rows.every(r=>r.completed&&r.exitCode===0&&r.files['probe.txt']==='OK'&&(r.arm==='markdown'||r.retrieval.some(x=>x.tool==='search')&&r.retrieval.some(x=>x.tool==='requirements')&&r.retrieval.some(x=>x.tool==='read')));if(!result.passed)process.exitCode=1;}}catch(e){result.error={message:e.message};process.exitCode=1;}finally{save();}
