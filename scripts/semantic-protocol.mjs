import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {semanticCorpus} from './semantic-corpus.mjs';
const sha = f=>createHash('sha256').update(fs.readFileSync(f,'utf8').replaceAll('\r\n','\n')).digest('hex');
const candidates = ['static','contextual'].flatMap(x=>JSON.parse(fs.readFileSync(`docs/benchmarks/2026-10-07-semantic-alternatives-${x}.json`)));
const selected = [
  ['minishlab/potion-base-8M','static',null],
  ['minishlab/potion-retrieval-32M','static',null],
  ['minishlab/potion-multilingual-128M','static',null],
  ['intfloat/multilingual-e5-small','e5',512],
  ['sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2','sentence',128],
  ['BAAI/bge-small-en-v1.5','bge',512],
  ['sentence-transformers/all-MiniLM-L6-v2','sentence',256],
].map(([id,kind,maxTokens])=>({...candidates.find(x=>x.id===id),languageTags:undefined,config:undefined,kind,maxTokens}));
const protocol = {
  schemaVersion:1, createdAt:new Date().toISOString(), seed:41729, device:'cpu', threads:4, batchSize:32,
  models:selected, sizes:[100,1000,10000], modes:['Q','A','QA','fusion'], fusionQWeight:0.75,
  packages:{'torch':'2.8.0+cpu','transformers':'4.57.6','sentence-transformers':'5.1.2','model2vec':'0.9.0'},
  identityCalibration:'Fit cosine threshold on the first eight entirely separate authored families, Q-only pair scores. Among thresholds allowing at most 5% false positives, maximize recall, then minimize false positives, then choose the higher cutoff. Zero positives is allowed. Freeze for the other sixteen families and the old public Laya pairs. No threshold changes after test.',
  retrievalCalibration:'Fit a separate best eligible top-1 score cutoff per model and query mode on 8 calibration families at 100 items. Treat correct target top-1 as positives; no-match requests and incorrect top-1 as negatives. Allow at most 5% false links among these negative calibration examples, maximize successful target links, then lower false links, then higher threshold. Freeze for test, all scales and both store representations.',
  arms:'A/C: identical capable BM25 k1=1.2 b=0.75 index over Markdown/structured projections. B/D: same dense model and cosine index over those projections. Both representations provide identical scope/version/status metadata and use the same eligibility rule; no DIP structure advantage is presumed. Synthetic Markdown consists of indexed record sections, not forced whole-document reads. This is an experimental store adapter, not actual production project_search nor live agent behavior.',
  ranking:'Stable score-descending, ID-ascending ties. Raw top10 retained separately from eligible top10. Eligibility uses only supplied scope/version and excludes cancelled/superseded; verified remains searchable. Gold appears only in scoring, never encoding/filtering. MRR@10 rather than full MRR; report exact target recovery, no-match false links, stale raw recommendations and assistant-misinterpretation effects separately.',
  assistant:'Manually authored before retrieval, not model-generated or extracted from the answer task. Fixed faithful and deliberately opposite replies plus no-match requests. No task IDs or retrieved excerpts in queries. Role-marked QA concatenation; fusion=0.75*cos(Q,D)+0.25*cos(A,D). This synthetic diagnostic does not establish naturally generated response quality.',
  identity:'Cosine threshold is a diagnostic suggestion, not semantic identity probability, four-way classifier or completion evidence. No real task mutations.',
  limitations:'24 synthetic families; 8 calibration/16 test split, no training, independently adjudicated labels, multi-day agents or downstream implementation. Original 96 Laya cases are known exploratory comparison only; not held-out. Large histories reuse templated distractors, not independent projects. Larger references and custom 10M/100M training/vocabulary ablations remain open.',
  resources:'Fresh process per model, sequential pinned safetensors downloads, no custom remote code/implicit Hub token. Four CPU threads, FP32. Download/load, initial and warm encode, query tokens/truncation, index update and search latency/RSS recorded. Abort >4 GiB process RSS or sustained <128 MiB available RAM; retain failed attempts without quality scores or silent retries.',
  sources:Object.fromEntries(['scripts/semantic-corpus.mjs','scripts/semantic-alternatives.py','scripts/semantic-analysis.mjs'].map(f=>[f,sha(f)])),
  corpus:semanticCorpus(),
  layaExploratory:JSON.parse(fs.readFileSync('docs/benchmarks/2026-10-07-laya-protocol.json')).cases,
};
const file=process.argv[2] || 'docs/benchmarks/2026-10-08-semantic-protocol.json';
if(fs.existsSync(file)) throw new Error('Never overwrite a registered protocol');
fs.writeFileSync(file,JSON.stringify(protocol,null,2)+'\n');
console.log(JSON.stringify({file,models:protocol.models.length,queries:protocol.corpus.queries.length,pairs:protocol.corpus.pairs.length}));
