import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {ensure,append,linkDocument} from '../src/core.js';
import {semanticSources} from '../src/semantic.js';
import {execute} from '../src/actions.js';
import {loadDocument} from '../src/documents.js';
import {sha} from './semantic-agent-fixtures.mjs';
const protocol='docs/benchmarks/2026-10-09-production-bounds-protocol.json',output='docs/benchmarks/2026-10-09-production-bounds.json';
if(process.argv.includes('--protocol')){
  if(fs.existsSync(protocol))throw new Error('Never overwrite protocol');
  fs.writeFileSync(protocol,JSON.stringify({createdAt:new Date().toISOString(),sourceHash:sha(fs.readFileSync('src/semantic.js')),harnessHash:sha(fs.readFileSync(import.meta.filename)),cases:['twenty-mib-doc-budget','unicode-at-task-truncation-boundary','directory-junction-rejection','structured-plan-source-coverage'],expected:'Explicit budget truncation; well-formed Unicode; reject redirected document directories. Plan coverage is descriptive, not a promised prototype feature.'},null,2)+'\n');process.exit(0);
}
if(fs.existsSync(output))throw new Error('Never overwrite evidence');
const p=JSON.parse(fs.readFileSync(protocol));if(p.sourceHash!==sha(fs.readFileSync('src/semantic.js'))||p.harnessHash!==sha(fs.readFileSync(import.meta.filename)))throw new Error('Frozen source changed');
const sandbox=fs.mkdtempSync(path.join(os.tmpdir(),'dip-production-bounds-'));Object.assign(process.env,{DIP_HOME:path.join(sandbox,'runtime'),DIP_USER_HOME:path.join(sandbox,'user'),DIP_GIT_CONFIG:path.join(sandbox,'gitconfig'),GIT_CONFIG_GLOBAL:path.join(sandbox,'gitconfig'),GIT_TRACE2_EVENT:'0'});
const root=path.join(sandbox,'project');fs.mkdirSync(root);execFileSync(process.env.DIP_BENCH_GIT||'git',['init','-b','main',root],{stdio:'pipe'});const repo=ensure(root,{instructions:false});
append(repo,'task_bounds','task.create',{title:'Document bounds',description:'Keep source budgets explicit',acceptance:[],scope:[],kind:'work',status:'backlog'},{actor:'fixture'});
const rows=[];
for(let i=0;i<21;i++){const file='doc'+i+'.md';fs.writeFileSync(path.join(root,file),'# Source\n'+'a'.repeat(1024*1024-9));linkDocument(repo,'task_bounds',{path:file,role:'reference'},'fixture');}
const budget=semanticSources(root);rows.push({name:'twenty-mib-doc-budget',productionPass:budget.truncated&&budget.sources.filter(x=>x.kind==='document').length===20&&budget.errors.some(x=>x.error.includes('byte budget')),documents:budget.sources.filter(x=>x.kind==='document').length,truncated:budget.truncated,errors:budget.errors});
const title='Unicode boundary';const description='a'.repeat(39999-(`# ${title}\n\n`).length)+'😀 suffix';append(repo,'task_unicode','task.create',{title,description,acceptance:[],scope:[],kind:'work',status:'backlog'},{actor:'fixture'});
const unicode=semanticSources(root).sources.find(x=>x.id==='task_unicode');rows.push({name:'unicode-at-task-truncation-boundary',productionPass:unicode.text.isWellFormed(),sourceTruncated:unicode.sourceTruncated,lastCodeUnit:unicode.text.charCodeAt(unicode.text.length-1),length:unicode.text.length});
const outside=path.join(sandbox,'outside');fs.mkdirSync(outside);fs.writeFileSync(path.join(outside,'plan.md'),'PRIVATE-SYNTHETIC-CANARY');
try{fs.symlinkSync(outside,path.join(root,'redirect'),'junction');let rejected=false;try{loadDocument(repo,'redirect/plan.md');}catch{rejected=true;}rows.push({name:'directory-junction-rejection',productionPass:rejected});}catch(e){rows.push({name:'directory-junction-rejection',productionPass:null,notTested:true,error:e.message});}
await execute('plan',{id:'task_unicode',steps:[{step:'UNIQUE_STRUCTURED_PLAN_REQUIREMENT',status:'pending'}]},root);
const plan=semanticSources(root).sources.find(x=>x.id==='task_unicode');rows.push({name:'structured-plan-source-coverage',productionPass:null,indexed:plan.text.includes('UNIQUE_STRUCTURED_PLAN_REQUIREMENT'),note:'Native structured plan text is outside this prototype collector; existing plan/requirements tools remain necessary.'});
fs.writeFileSync(output,JSON.stringify({protocolHash:sha(fs.readFileSync(protocol)),sourceHash:p.sourceHash,modelCalls:0,rows},null,2)+'\n');console.log(JSON.stringify(rows));
