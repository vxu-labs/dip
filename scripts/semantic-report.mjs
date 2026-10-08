import fs from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {median} from './semantic-analysis.mjs';
const summary=JSON.parse(fs.readFileSync('docs/benchmarks/2026-10-08-semantic-summary.json'));
const attempts=summary.attempts, complete=attempts.filter(x=>x.summary.complete);
if(complete.length!==8) throw new Error('Retain failures and explicitly report an incomplete comparison');
const short=id=>id==='lexical'?'BM25':id.split('/')[1];
const row=(s,mode='Q',language='all',scenario='faithful',size=10000)=>s.retrieval.find(x=>x.size===size&&x.mode===mode&&x.language===language&&x.scenario===scenario);
const num=x=>Number.isFinite(x)?x.toFixed(2):'n/a';
const lines=[
  '## Results', '',
  'All eight scheduled attempts completed: seven neural alternatives plus BM25, with no failed or retried candidate inference. There are 20,736 retained ranking rows across scales/modes, not independent examples. The test set is sixteen families with three language variants. No training or automatic task mutation was performed.', '',
  '### Finding candidates', '',
  'Q-only, faithful-response slice, 10,000 items: 48 matching queries. Q is unchanged in the misleading-response slice, so counting both would duplicate the same Q-only experiment. Raw ranking includes all history, before the explicit metadata filter. MRR is truncated at ten.', '',
  '| Retriever | Raw R@1 | Raw R@5 | Raw R@10 | Raw MRR@10 | Eligible R@1 | Warm query encode, ms | Weights, MiB | Peak process RSS, MiB |',
  '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
];
for(const a of attempts) {const s=a.summary,r=row(s);lines.push(`| ${short(s.model)} | ${r.raw.recall1}/48 | ${r.raw.recall5}/48 | ${r.raw.recall10}/48 | ${num(r.raw.mrr10)} | ${r.eligible.recall1}/48 | ${num(s.resources.warmQueryMedianMs)} | ${num(s.resources.weightBytes/2**20)} | ${num(s.resources.peakRssBytes/2**20)} |`);}
lines.push('', 'All eligible R@5/R@10 results are 48/48 by construction: supplied scope/version filtering leaves only three current candidates. This is not strong retrieval evidence. Both Markdown and structured adapters produce identical rankings; this experiment cannot attribute model gains to DIP itself. The synthetic Markdown stores serialize canonical record JSON in Markdown sections, and the baseline parses/indexes those sections. These are not real handwritten plans or the production DIP search engine.', '',
  '| Retriever | English raw R@10 | Hebrew raw R@10 | Hebrew to English raw R@10 |', '| --- | ---: | ---: | ---: |');
for(const a of attempts) lines.push(`| ${short(a.summary.model)} | ${row(a.summary,'Q','en').raw.recall10}/16 | ${row(a.summary,'Q','he').raw.recall10}/16 | ${row(a.summary,'Q','cross').raw.recall10}/16 |`);
lines.push('', '### Identity and abstention', '',
  'The identity threshold was fitted on 8 new calibration families under the fixed 5% negative false-positive cap; 16 families were held out. Each held-out candidate has 48 identical and 144 non-identical pairs. These are cosine-threshold suggestions, not four-way relation classification. High aggregate accuracy with zero recall is the always-not-identical baseline, not useful matching.', '',
  '| Candidate | Threshold | True identities /48 | False identities /144 | Precision | Recall | Old Laya pairs: true /24, false /72 |', '| --- | ---: | ---: | ---: | ---: | ---: | ---: |');
for(const a of attempts.filter(x=>x.summary.identity)) {const i=a.summary.identity;lines.push(`| ${short(a.summary.model)} | ${num(i.calibration.threshold)} | ${i.test.tp}/48 | ${i.test.fp}/144 | ${num(i.test.precision)} | ${num(i.test.recall)} | ${i.legacy.tp}/24, ${i.legacy.fp}/72 |`);}
lines.push('', 'The preserved Laya pilot detected 23/24 identities but produced 52/72 false identities. The alternatives above use thresholds calibrated on a different corpus and text-only embedding inputs, while Laya used structured state and two classifier questions. This exploratory bridge is not an interchangeable-interface, four-way head-to-head comparison. Reduced false positives obtained by abstaining from nearly every true identity are not a successful replacement for Laya.', '',
  'Retrieval link cutoffs are separately calibrated. The following 10,000-item test slice contains 96 matching and 48 no-match queries. A false link includes choosing the wrong existing task or linking a genuinely new request. This gate is a simulation: no real tasks were merged.', '',
  '| Retriever, Q-only | Suggestions | Correct target links | False links | No-match false links /48 | Raw stale top-1 /144 |', '| --- | ---: | ---: | ---: | ---: | ---: |');
for(const a of attempts) {const r=row(a.summary,'Q','all','all');lines.push(`| ${short(a.summary.model)} | ${r.links} | ${r.correctLinks} | ${r.falseLinks} | ${r.noMatchFalseLinks}/48 | ${r.rawStaleTop1}/144 |`);}
lines.push('', 'The BM25 score cutoff learned on a 100-item calibration history is not guaranteed to remain calibrated as corpus IDF changes at larger scales. Its scale-transfer failures are retained. Dense-model cutoffs can also fail on new families; a calibration constraint is not a test-set guarantee.', '',
  '### Assistant response effects', '',
  'Deliberately misleading replies, 10,000 items, 48 held-out matching requests. Numbers are raw R@1 then R@10. Q remains authoritative. The four modes were fixed before inference, including the 75/25 fusion; no better weight was fitted after results.', '',
  '| Retriever | Q | A | Q+A | 75% Q /25% A fusion |', '| --- | ---: | ---: | ---: | ---: |');
for(const a of attempts) lines.push(`| ${short(a.summary.model)} | ${['Q','A','QA','fusion'].map(mode=>{const r=row(a.summary,mode,'all','misleading');return `${r.raw.recall1}/48, ${r.raw.recall10}/48`;}).join(' | ')} |`);
lines.push('', '### Resource and scale audit', '',
  'These are Windows CPU measurements with four requested threads, batch size 32, pinned weights and FP32. The desktop/resident recorder remained active, and measurement is not exclusive hardware or an end-to-end agent cost benchmark. Download/cache lookup, process load, batched initial indexing and warm single-query encoding are separate. Peak RSS includes imports, hashing/download buffers and index arrays; it is not steady-state serving memory. Query token counts are encoder tokens, not coding-agent tokens.', '',
  '| Retriever | Download/cache lookup, s | Load, s | English/Hebrew 10k encode, s | Incremental 10-doc median, ms | Q search median at100 /1000 /10000, ms |', '| --- | ---: | ---: | ---: | ---: | ---: |');
for(const a of attempts) {const s=a.summary,r=s.resources;lines.push(`| ${short(s.model)} | ${num(r.downloadAndCacheLookupSeconds)} | ${num(r.loadSeconds)} | ${r.stores.map(x=>num(x.initialEncodeSeconds)).join(' / ')} | ${r.stores.map(x=>x.incrementalEncodeSeconds?num(median(x.incrementalEncodeSeconds)*1000):'n/a').join(' / ')} | ${[100,1000,10000].map(size=>num(row(s,'Q','all','faithful',size).medianSearchMs)).join(' / ')} |`);}
const truncations=attempts.reduce((total,a)=>total+Object.values(a.summary.resources.tokenCounts).reduce((n,x)=>n+x.truncatedInputs,0),0);
lines.push('', `Recorded truncated encoder inputs: **${truncations}**. Search timing includes candidate scoring, stable ranking and shortlist construction, but excludes query encoding. Incremental timing is encoding ten documents; the dense arrays were rebuilt for each scale, so it does not prove persistent live index maintenance. Raw stores include serialization/parse setup timings and byte counts for both representations.`, '',
  'The read-only [safetensor header audit](2026-10-08-semantic-tensors.json) distinguishes learned parameters from integer buffers. The contextual Hub tensor totals include 512 integer position IDs; loaded parameter counts exclude those buffers. No scores, models or thresholds were altered to resolve that metadata discrepancy.', '',
  '### Interpretation and remaining work', '',
  'Multilingual E5 and multilingual MiniLM are useful shortlist candidates in this synthetic corpus; Potion provides much faster warm encoding with retrieval tradeoffs. The report does not establish a universal winning model. No evaluated cosine gate provides demonstrated safe, useful autonomous identity matching on this held-out set. Requirements, negation, target scope and current evidence need a separate reviewed relation decision.', '',
  'Custom 10M/100M encoders, distillation and 100k/200k vocabulary ablations are still untrained. Larger rerankers/reference models, independent real-project labels, chronological/project splits, natural assistant replies and downstream implementation quality remain open. The measured pretrained stage is tracked separately from the broader alternatives task in DIP.', '',
  '[All calibrated scores, language/scenario/scale slices and resource summaries](2026-10-08-semantic-summary.json). Compressed raw per-candidate files are listed with SHA-256 hashes in that summary. Offline validation: node scripts/semantic-evidence.mjs; scorer leakage/cap checks: node --test test/semantic-analysis.test.js. The model runner is frozen at preregistration commit [44d6f4f](https://github.com/vxu-labs/dip/commit/44d6f4f252ae83e2721d410d1011290f67ec4829). Raw predictions can be re-scored without installing Python or a model. Re-running actual inference is a separate explicit operation.',
);
const file='docs/benchmarks/semantic-retrieval-pilot.md';
const introduction=fs.readFileSync(file,'utf8').split('\n## Results')[0].replace('Results will be added below after all scheduled attempts finish. Experimental use is at the user\'s responsibility; this benchmark is not a product guarantee.', 'Experimental use is at the user\'s responsibility; this benchmark is not a product guarantee.');
fs.writeFileSync(file,introduction.trimEnd()+'\n\n'+lines.join('\n')+'\n');
console.log(file);
