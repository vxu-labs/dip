import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {ensure,project} from './core.js';
import {loadDocument} from './documents.js';
import {digest} from './util.js';

export function semanticEnabled(env=process.env) {
  return !!(env.DIP_SEMANTIC_PYTHON && env.DIP_SEMANTIC_MODEL && env.DIP_SEMANTIC_CACHE);
}
export function semanticSources(root) {
  if(!fs.existsSync(path.join(root,'.dip','config.json'))) throw new Error('Initialize DIP explicitly before semantic retrieval');
  const repo=ensure(root,{instructions:false});
  const state=project(repo,null,null,{includeActivity:false});
  const sources=[],errors=[...state.errors];
  const tasks=state.tasks.filter(t=>t.kind==='work'&&!['cancelled','superseded'].includes(t.status)).sort((a,b)=>a.id.localeCompare(b.id));
  const paths=new Map();
  for(const t of tasks.slice(0,2000)) {
    const original=`# ${t.title}\n\n${t.description||''}\n\n## Current criteria\n${t.acceptance.map(x=>'- '+x).join('\n')}\n\n## Metadata\n${JSON.stringify({id:t.id,status:t.status,scope:t.scope,dependencies:t.dependencies,documents:t.documents.map(d=>({path:d.path,role:d.role,hash:d.hash}))})}`;
    const text=original.slice(0,40000);
    sources.push({id:t.id,kind:'task',path:`.dip/events/${t.id}`,text,contentHash:digest(text),sourceTruncated:original.length>text.length,status:t.status});
    for(const d of t.documents) {
      if(!paths.has(d.path))paths.set(d.path,[]);
      paths.get(d.path).push({taskId:t.id,role:d.role,recordedHash:d.hash});
    }
  }
  let bytes=0;
  for(const [file,links] of [...paths].sort(([a],[b])=>a.localeCompare(b)).slice(0,100)) {
    try {
      const d=loadDocument(repo,file);bytes+=d.bytes;
      if(bytes>20*1024*1024) {errors.push({path:file,error:'Document byte budget exceeded'});break;}
      sources.push({id:'document:'+file,kind:'document',path:file,text:d.text,contentHash:d.hash,status:'source',links:links.map(x=>({...x,freshness:x.recordedHash===d.hash?'current':'changed'}))});
    } catch(e) {errors.push({path:file,error:e.message});}
  }
  return {sources,errors,truncated:tasks.length>2000||paths.size>100||bytes>20*1024*1024};
}

export function validateRetrieval(args) {
  if(typeof args.query!=='string'||!args.query.trim()||args.query.length>1000)throw new Error('query must contain 1..1000 characters');
  if(!['all','tasks','documents'].includes(args.channel||'all'))throw new Error('Invalid retrieval channel');
  const limit=args.limit??5;
  if(!Number.isInteger(limit)||limit<1||limit>10)throw new Error('limit must be 1..10');
  return {...args,channel:args.channel||'all',limit};
}

export class SemanticWorker {
  constructor(env=process.env) {this.env=env;this.pending=null;this.child=null;this.buffer='';}
  start() {
    if(!semanticEnabled(this.env))throw new Error('Experimental semantic retrieval needs explicit Python, pinned model snapshot and cache paths');
    for(const key of ['DIP_SEMANTIC_PYTHON','DIP_SEMANTIC_MODEL','DIP_SEMANTIC_CACHE'])if(!path.isAbsolute(this.env[key]))throw new Error(`${key} must be absolute`);
    this.child=spawn(this.env.DIP_SEMANTIC_PYTHON,[fileURLToPath(new URL('./semantic-worker.py',import.meta.url))],{env:{...this.env,PYTHONIOENCODING:'utf-8',HF_HUB_OFFLINE:'1',HF_HUB_DISABLE_IMPLICIT_TOKEN:'1'},windowsHide:true,stdio:['pipe','pipe','pipe']});
    this.child.stderr.on('data',()=>{});
    this.child.stdout.on('data',b=>{
      this.buffer+=b;
      if(this.buffer.length>2*1024*1024){this.fail(new Error('Worker response exceeds budget'));return;}
      let nl;
      while((nl=this.buffer.indexOf('\n'))>=0){const line=this.buffer.slice(0,nl);this.buffer=this.buffer.slice(nl+1);try{const r=JSON.parse(line);if(r.error)this.fail(new Error(r.error));else if(this.pending){const p=this.pending;this.pending=null;clearTimeout(p.timer);p.resolve(r);}}catch(e){this.fail(e);}}
    });
    this.child.on('error',e=>this.fail(e));
    const child=this.child;
    child.on('exit',()=>{if(this.child===child){this.child=null;this.fail(new Error('Semantic worker exited'));}});
  }
  fail(error) {if(this.pending){clearTimeout(this.pending.timer);this.pending.reject(error);this.pending=null;}}
  close(){const child=this.child;this.child=null;child?.kill();this.fail(new Error('Semantic worker closed'));}
  async request(payload) {
    if(this.pending)throw new Error('Semantic worker is busy; retry after the current read completes');
    if(!this.child)this.start();
    return new Promise((resolve,reject)=>{this.pending={resolve,reject,timer:setTimeout(()=>{this.fail(new Error('Semantic read timed out after120s'));this.close();},120000)};this.child.stdin.write(JSON.stringify(payload)+'\n',e=>{if(e)this.fail(e);});});
  }
}
let worker;
export async function semanticRetrieve(root,args) {
  args=validateRetrieval(args);
  const snapshot=semanticSources(root);
  worker??=new SemanticWorker();
  const result=await worker.request({...args,sources:snapshot.sources,namespace:digest(path.resolve(root))});
  const latest=semanticSources(root),current=new Map(latest.sources.map(s=>[s.id,s]));
  const changed=[];
  result.candidates=result.candidates.filter(c=>{const now=current.get(c.id);if(!now||now.contentHash!==c.contentHash){changed.push(c.id);return false;}c.status=now.status;c.links=now.links?.slice(0,10);return true;});
  return {...result,changedDuringRead:changed,errors:latest.errors,sourceSetTruncated:latest.truncated,verification:'not_checked',identityEstablished:false,sourceTextTrusted:false};
}
export function closeSemanticWorker(){worker?.close();worker=null;}
