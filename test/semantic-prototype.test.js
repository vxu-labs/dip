import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {semanticEnabled,validateRetrieval,semanticSources,SemanticWorker,semanticRetrieve,closeSemanticWorker} from '../src/semantic.js';
import {ensure} from '../src/core.js';
import {execute} from '../src/actions.js';
import {execFileSync} from 'node:child_process';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {fileURLToPath} from 'node:url';
const sandbox=fs.mkdtempSync(path.join(os.tmpdir(),'dip-semantic-runtime-'));
process.env.DIP_HOME=path.join(sandbox,'runtime');
process.env.DIP_USER_HOME=path.join(sandbox,'user');
process.env.DIP_GIT_CONFIG=path.join(sandbox,'gitconfig');
process.env.GIT_CONFIG_GLOBAL=process.env.DIP_GIT_CONFIG;
process.env.GIT_TRACE2_EVENT='0';

test('semantic setup is opt-in and bounds malformed requests before inference',()=>{
  assert.equal(semanticEnabled({}),false);
  assert.equal(semanticEnabled({DIP_SEMANTIC_PYTHON:'x',DIP_SEMANTIC_MODEL:'y'}),false);
  for(const query of ['',null,'x'.repeat(1001)])assert.throws(()=>validateRetrieval({query}));
  assert.throws(()=>validateRetrieval({query:'test',channel:'private'}));
  assert.throws(()=>validateRetrieval({query:'test',limit:11}));
  assert.equal(validateRetrieval({query:'שלום'}).channel,'all');
});
test('real MCP exposes the experimental tool only with explicit setup and does not start inference for discovery',async()=>{
  for(const enabled of [false,true]){
    const env={...process.env};for(const k of ['DIP_SEMANTIC_PYTHON','DIP_SEMANTIC_MODEL','DIP_SEMANTIC_CACHE'])delete env[k];
    if(enabled)Object.assign(env,{DIP_SEMANTIC_PYTHON:path.join(sandbox,'missing-python'),DIP_SEMANTIC_MODEL:path.join(sandbox,'missing-model'),DIP_SEMANTIC_CACHE:path.join(sandbox,'cache')});
    const client=new Client({name:'semantic-discovery',version:'1'});
    const transport=new StdioClientTransport({command:process.execPath,args:['--disable-warning=ExperimentalWarning',fileURLToPath(new URL('../bin/dip.js',import.meta.url)),'mcp'],env,stderr:'pipe'});
    try{await client.connect(transport);const listed=await client.listTools();assert.equal(listed.tools.some(t=>t.name==='project_retrieve'),enabled);assert.equal(fs.existsSync(path.join(sandbox,'cache')),false);}
    finally{await client.close();}
  }
});
test('semantic snapshots use current linked documents, exclude cancelled intent and omit missing sources',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'dip-semantic-unit-'));
  assert.throws(()=>semanticSources(root),/Initialize/);
  execFileSync('git',['init','-b','main',root],{stdio:'pipe'});
  ensure(root,{instructions:false});
  const t=await execute('create',{title:'Useful requirement',acceptance:['Preserve Unicode']},root);
  fs.writeFileSync(path.join(root,'plan.md'),'# Current\n\nKeep Unicode 😀.');
  await execute('document-link',{id:t.id,path:'plan.md',role:'plan'},root);
  const before=semanticSources(root);
  assert.equal(before.sources.length,2);
  const doc=before.sources.find(s=>s.kind==='document');
  assert.equal(doc.links[0].freshness,'current');
  fs.writeFileSync(path.join(root,'plan.md'),'# Revised\n\nKeep UTF-8.');
  const after=semanticSources(root).sources.find(s=>s.kind==='document');
  assert.notEqual(after.contentHash,doc.contentHash);
  assert.equal(after.links[0].freshness,'changed');
  fs.unlinkSync(path.join(root,'plan.md'));
  const missing=semanticSources(root);assert.equal(missing.sources.length,1);assert.equal(missing.errors.length,1);
  await execute('update',{id:t.id,patch:{status:'cancelled'}},root);
  assert.equal(semanticSources(root).sources.length,0);
});
test('a document changed during asynchronous retrieval is omitted instead of returning an obsolete citation',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'dip-semantic-race-'));execFileSync('git',['init','-b','main',root],{stdio:'pipe'});ensure(root,{instructions:false});
  const task=await execute('create',{title:'Export criteria'},root);
  fs.writeFileSync(path.join(root,'plan.md'),'# Original\nKeep old order.');await execute('document-link',{id:task.id,path:'plan.md',role:'plan'},root);
  t.mock.method(SemanticWorker.prototype,'request',async payload=>{
    const doc=payload.sources.find(s=>s.kind==='document');
    fs.writeFileSync(path.join(root,'plan.md'),'# Revised\nKeep input order.');
    return {candidates:[{id:doc.id,contentHash:doc.contentHash,path:doc.path,excerpt:'Keep old order.'}]};
  });
  try{const result=await semanticRetrieve(root,{query:'export order',channel:'documents'});assert.deepEqual(result.candidates,[]);assert.deepEqual(result.changedDuringRead,['document:plan.md']);assert.equal(result.identityEstablished,false);}
  finally{closeSemanticWorker();}
});
