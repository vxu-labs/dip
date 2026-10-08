import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {winnerScore} from './winner-analysis.mjs';
const bytes=fs.readFileSync('docs/benchmarks/2026-10-08-winner-protocol.json'),p=JSON.parse(bytes);const sha=x=>createHash('sha256').update(x).digest('hex');
const files=process.argv.slice(2);if(files.length!==3)throw new Error('Preserve all three scheduled attempts');
const attempts=files.map(file=>{
  const data=JSON.parse(fs.readFileSync(file));
  if(data.error)data.error={type:data.error.type,message:data.error.message.replaceAll(process.cwd(),'[REPOSITORY]')};
  const raw=Buffer.from(JSON.stringify(data,null,2)+'\n');const target='docs/benchmarks/2026-10-08-winner-'+data.model.replaceAll('/','--')+'.json.gz';fs.writeFileSync(target,gzipSync(raw,{level:9}));return {file:target,resultHash:sha(raw),summary:winnerScore(data,p)};
});
fs.writeFileSync('docs/benchmarks/2026-10-08-winner-summary.json',JSON.stringify({schemaVersion:1,createdAt:new Date().toISOString(),protocolHash:sha(bytes),limitations:p.limitations,attempts},null,2)+'\n');
for(const a of attempts)console.log(JSON.stringify({model:a.summary.model,complete:a.summary.complete,scores:a.summary.scores?.filter(x=>x.language==='all'),readOnly:a.summary.readOnly}));
