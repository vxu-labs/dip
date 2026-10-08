import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {scoreResult} from './semantic-analysis.mjs';
const protocolFile='docs/benchmarks/2026-10-08-semantic-protocol.json';
const protocolBytes=fs.readFileSync(protocolFile), protocol=JSON.parse(protocolBytes);
const sha=x=>createHash('sha256').update(x).digest('hex');
const inputs=process.argv.slice(2);
if(inputs.length!==8) throw new Error('Retain all seven preregistered models and lexical baseline');
const attempts=inputs.map(file=>{
  const data=JSON.parse(fs.readFileSync(file));
  // No raw trace with local paths is exported; failure details remain private.
  if(data.error) data.error={type:data.error.type,message:data.error.message.replaceAll(process.cwd(),'[REPOSITORY]')};
  const bytes=Buffer.from(JSON.stringify(data,null,2)+'\n');
  const slug=data.model.replaceAll('/','--');
  const target=`docs/benchmarks/2026-10-08-semantic-${slug}.json.gz`;
  fs.writeFileSync(target,gzipSync(bytes,{level:9}));
  return {file:target,resultHash:sha(bytes),summary:scoreResult(data,protocol)};
});
const summary={schemaVersion:1,createdAt:new Date().toISOString(),protocolHash:sha(protocolBytes),limitations:protocol.limitations,attempts};
fs.writeFileSync('docs/benchmarks/2026-10-08-semantic-summary.json',JSON.stringify(summary,null,2)+'\n');
for(const {summary:s} of attempts) console.log(JSON.stringify({model:s.model,complete:s.complete,identity:s.identity?.test,retrieval:s.retrieval?.find(x=>x.size===10000&&x.mode==='Q'&&x.language==='all'&&x.scenario==='all'),warmQueryMs:s.resources?.warmQueryMedianMs}));
