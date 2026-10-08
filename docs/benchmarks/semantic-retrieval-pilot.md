# Pretrained alternatives retrieval pilot

Preregistered on 8 October 2026 before task-pair or retrieval inference. This is the first execution stage of the [broader alternatives plan](semantic-alternatives.md). Custom training, independently adjudicated real-project labels and downstream agent/code quality remain open.

The frozen [protocol](2026-10-08-semantic-protocol.json) includes seven pinned models, source hashes and every input: three Potion models, multilingual E5-small, multilingual MiniLM, BGE-small-en and all-MiniLM-L6. CPU inference is sequential in the existing isolated research environment; no weights or Python packages become product dependencies. Weight-card licenses and safetensor hashes are checked at the pinned revisions. Model2Vec implementation is MIT; Sentence Transformers implementation is Apache-2.0. See the [Model2Vec source](https://github.com/MinishLab/model2vec) and [Sentence Transformers source](https://github.com/huggingface/sentence-transformers).

There are 24 newly authored families, split into eight calibration families and sixteen test families, with English, Hebrew and Hebrew-query/English-store variants. The 288 pair cases distinguish equivalent work, extensions, opposite work and disjoint API versions. The 216 retrieval cases include faithful assistant responses, deliberately opposite responses and new work with no matching task. Assistant responses are authored before retrieval; they are synthetic diagnostics, not naturally generated model outputs. No test or existing Laya label is used to fit a threshold.

Q, A, role-marked Q+A and fixed 75% Q / 25% A score fusion are evaluated in histories of 100, 1,000 and 10,000 items. Raw ranking is the main scale/semantic metric. A separate eligibility view uses explicitly supplied component/version metadata and excludes cancelled/superseded entries. Both storage representations have exactly the same information, metadata filters and index. This narrow experiment deliberately gives a capable indexed Markdown store the same search: A/C lexical results and B/D dense results should be identical. It measures retrieval models and representation roundtrip cost, not a live-agent DIP quality advantage or production project_search performance.

Score thresholds are selected on calibration only with at most 5% false positive/link rate and then applied unchanged to test and scale variants. Similarity remains candidate evidence; no real task is merged, closed or verified. Precision, recall, Recall@1/5/10 and MRR@10 are reported separately. The known 96 Laya pairs are an exploratory bridge using the frozen new calibration threshold, not a new hidden test or a four-way classification comparison.

Every scheduled attempt, infrastructure failure, raw shortlist score and resource result is retained. Downloads and process load are separated from warm encoding/search. Model token counts are not agent tokens. Histories use repeated distractor templates, not 10,000 independent projects; labels have not received blinded independent review. A model ranking here does not establish autonomous duplicate detection, completion recognition or real implementation quality.

Reproduce explicitly with Python 3.12, CPU PyTorch 2.8.0 and the [locked research environment](2026-10-08-semantic-requirements.txt). Run scripts/semantic-alternatives.py with --protocol docs/benchmarks/2026-10-08-semantic-protocol.json --model the-pinned-model-id --output a-new-private-result.json --cache an-isolated-cache. Use --model lexical for the BM25 baseline. Never overwrite a published outcome. Use scripts/semantic-publish.mjs with all eight results to generate raw compressed evidence and summaries; scripts/semantic-evidence.mjs validates inputs, source hashes, retained outputs, calibrations and scores without model inference.

Experimental use is at the user's responsibility; this benchmark is not a product guarantee.

## Results

All eight scheduled attempts completed: seven neural alternatives plus BM25, with no failed or retried candidate inference. There are 20,736 retained ranking rows across scales/modes, not independent examples. The test set is sixteen families with three language variants. No training or automatic task mutation was performed.

### Finding candidates

Q-only, faithful-response slice, 10,000 items: 48 matching queries. Q is unchanged in the misleading-response slice, so counting both would duplicate the same Q-only experiment. Raw ranking includes all history, before the explicit metadata filter. MRR is truncated at ten.

| Retriever | Raw R@1 | Raw R@5 | Raw R@10 | Raw MRR@10 | Eligible R@1 | Warm query encode, ms | Weights, MiB | Peak process RSS, MiB |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| BM25 | 7/48 | 19/48 | 24/48 | 0.27 | 35/48 | n/a | n/a | 101.07 |
| potion-base-8M | 2/48 | 19/48 | 22/48 | 0.19 | 21/48 | 0.26 | 28.84 | 262.95 |
| potion-retrieval-32M | 5/48 | 20/48 | 20/48 | 0.22 | 19/48 | 0.27 | 123.22 | 393.10 |
| potion-multilingual-128M | 7/48 | 30/48 | 37/48 | 0.37 | 16/48 | 0.23 | 488.63 | 1530.60 |
| multilingual-e5-small | 13/48 | 41/48 | 43/48 | 0.52 | 26/48 | 19.44 | 448.84 | 876.09 |
| paraphrase-multilingual-MiniLM-L12-v2 | 11/48 | 42/48 | 44/48 | 0.50 | 24/48 | 17.67 | 448.84 | 879.04 |
| bge-small-en-v1.5 | 7/48 | 18/48 | 19/48 | 0.26 | 14/48 | 47.72 | 127.28 | 728.54 |
| all-MiniLM-L6-v2 | 6/48 | 24/48 | 25/48 | 0.29 | 24/48 | 13.09 | 86.66 | 668.07 |

All eligible R@5/R@10 results are 48/48 by construction: supplied scope/version filtering leaves only three current candidates. This is not strong retrieval evidence. Both Markdown and structured adapters produce identical rankings; this experiment cannot attribute model gains to DIP itself. The synthetic Markdown stores serialize canonical record JSON in Markdown sections, and the baseline parses/indexes those sections. These are not real handwritten plans or the production DIP search engine.

| Retriever | English raw R@10 | Hebrew raw R@10 | Hebrew to English raw R@10 |
| --- | ---: | ---: | ---: |
| BM25 | 11/16 | 11/16 | 2/16 |
| potion-base-8M | 16/16 | 5/16 | 1/16 |
| potion-retrieval-32M | 15/16 | 5/16 | 0/16 |
| potion-multilingual-128M | 15/16 | 11/16 | 11/16 |
| multilingual-e5-small | 14/16 | 15/16 | 14/16 |
| paraphrase-multilingual-MiniLM-L12-v2 | 16/16 | 14/16 | 14/16 |
| bge-small-en-v1.5 | 16/16 | 2/16 | 1/16 |
| all-MiniLM-L6-v2 | 16/16 | 8/16 | 1/16 |

### Identity and abstention

The identity threshold was fitted on 8 new calibration families under the fixed 5% negative false-positive cap; 16 families were held out. Each held-out candidate has 48 identical and 144 non-identical pairs. These are cosine-threshold suggestions, not four-way relation classification. High aggregate accuracy with zero recall is the always-not-identical baseline, not useful matching.

| Candidate | Threshold | True identities /48 | False identities /144 | Precision | Recall | Old Laya pairs: true /24, false /72 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| potion-base-8M | 0.99 | 0/48 | 0/144 | n/a | 0.00 | 0/24, 2/72 |
| potion-retrieval-32M | 0.96 | 0/48 | 1/144 | 0.00 | 0.00 | 0/24, 3/72 |
| potion-multilingual-128M | 0.96 | 0/48 | 2/144 | 0.00 | 0.00 | 0/24, 3/72 |
| multilingual-e5-small | 0.99 | 0/48 | 0/144 | n/a | 0.00 | 0/24, 0/72 |
| paraphrase-multilingual-MiniLM-L12-v2 | 0.95 | 0/48 | 0/144 | n/a | 0.00 | 0/24, 4/72 |
| bge-small-en-v1.5 | 0.97 | 2/48 | 4/144 | 0.33 | 0.04 | 0/24, 6/72 |
| all-MiniLM-L6-v2 | 0.98 | 0/48 | 0/144 | n/a | 0.00 | 0/24, 2/72 |

The preserved Laya pilot detected 23/24 identities but produced 52/72 false identities. The alternatives above use thresholds calibrated on a different corpus and text-only embedding inputs, while Laya used structured state and two classifier questions. This exploratory bridge is not an interchangeable-interface, four-way head-to-head comparison. Reduced false positives obtained by abstaining from nearly every true identity are not a successful replacement for Laya.

Retrieval link cutoffs are separately calibrated. The following 10,000-item test slice contains 96 matching and 48 no-match queries. A false link includes choosing the wrong existing task or linking a genuinely new request. This gate is a simulation: no real tasks were merged.

| Retriever, Q-only | Suggestions | Correct target links | False links | No-match false links /48 | Raw stale top-1 /144 |
| --- | ---: | ---: | ---: | ---: | ---: |
| BM25 | 49 | 10 | 39 | 19/48 | 0/144 |
| potion-base-8M | 2 | 2 | 0 | 0/48 | 17/144 |
| potion-retrieval-32M | 0 | 0 | 0 | 0/48 | 57/144 |
| potion-multilingual-128M | 6 | 0 | 6 | 0/48 | 30/144 |
| multilingual-e5-small | 2 | 0 | 2 | 0/48 | 52/144 |
| paraphrase-multilingual-MiniLM-L12-v2 | 2 | 0 | 2 | 0/48 | 54/144 |
| bge-small-en-v1.5 | 11 | 8 | 3 | 3/48 | 32/144 |
| all-MiniLM-L6-v2 | 3 | 0 | 3 | 3/48 | 22/144 |

The BM25 score cutoff learned on a 100-item calibration history is not guaranteed to remain calibrated as corpus IDF changes at larger scales. Its scale-transfer failures are retained. Dense-model cutoffs can also fail on new families; a calibration constraint is not a test-set guarantee.

### Assistant response effects

Deliberately misleading replies, 10,000 items, 48 held-out matching requests. Numbers are raw R@1 then R@10. Q remains authoritative. The four modes were fixed before inference, including the 75/25 fusion; no better weight was fitted after results.

| Retriever | Q | A | Q+A | 75% Q /25% A fusion |
| --- | ---: | ---: | ---: | ---: |
| BM25 | 7/48, 24/48 | 1/48, 34/48 | 2/48, 34/48 | 3/48, 34/48 |
| potion-base-8M | 2/48, 22/48 | 1/48, 23/48 | 4/48, 23/48 | 2/48, 23/48 |
| potion-retrieval-32M | 5/48, 20/48 | 0/48, 25/48 | 0/48, 23/48 | 2/48, 21/48 |
| potion-multilingual-128M | 7/48, 37/48 | 5/48, 42/48 | 5/48, 41/48 | 9/48, 41/48 |
| multilingual-e5-small | 13/48, 43/48 | 0/48, 45/48 | 5/48, 46/48 | 10/48, 47/48 |
| paraphrase-multilingual-MiniLM-L12-v2 | 11/48, 44/48 | 0/48, 41/48 | 8/48, 43/48 | 9/48, 44/48 |
| bge-small-en-v1.5 | 7/48, 19/48 | 1/48, 18/48 | 4/48, 20/48 | 6/48, 19/48 |
| all-MiniLM-L6-v2 | 6/48, 25/48 | 4/48, 26/48 | 8/48, 25/48 | 6/48, 25/48 |

### Resource and scale audit

These are Windows CPU measurements with four requested threads, batch size 32, pinned weights and FP32. The desktop/resident recorder remained active, and measurement is not exclusive hardware or an end-to-end agent cost benchmark. Download/cache lookup, process load, batched initial indexing and warm single-query encoding are separate. Peak RSS includes imports, hashing/download buffers and index arrays; it is not steady-state serving memory. Query token counts are encoder tokens, not coding-agent tokens.

| Retriever | Download/cache lookup, s | Load, s | English/Hebrew 10k encode, s | Incremental 10-doc median, ms | Q search median at100 /1000 /10000, ms |
| --- | ---: | ---: | ---: | ---: | ---: |
| BM25 | n/a | n/a | n/a / n/a | n/a / n/a | 0.10 / 0.90 / 12.69 |
| potion-base-8M | 8.06 | 0.17 | 1.50 / 1.94 | 1.62 / 2.28 | 0.05 / 0.55 / 8.97 |
| potion-retrieval-32M | 20.57 | 0.36 | 1.58 / 2.06 | 1.52 / 2.30 | 0.05 / 0.64 / 9.82 |
| potion-multilingual-128M | 77.84 | 3.39 | 2.55 / 2.99 | 3.78 / 3.09 | 0.05 / 0.59 / 9.03 |
| multilingual-e5-small | 70.45 | 18.04 | 94.54 / 97.86 | 98.48 / 110.96 | 0.06 / 0.66 / 10.40 |
| paraphrase-multilingual-MiniLM-L12-v2 | 70.00 | 7.81 | 85.49 / 99.81 | 123.61 / 112.41 | 0.08 / 0.65 / 10.49 |
| bge-small-en-v1.5 | 21.29 | 8.45 | 90.18 / 175.49 | 103.68 / 163.90 | 0.07 / 0.66 / 10.36 |
| all-MiniLM-L6-v2 | 16.02 | 7.07 | 43.72 / 89.55 | 47.95 / 84.57 | 0.07 / 0.65 / 10.32 |

Recorded truncated encoder inputs: **0**. Search timing includes candidate scoring, stable ranking and shortlist construction, but excludes query encoding. Incremental timing is encoding ten documents; the dense arrays were rebuilt for each scale, so it does not prove persistent live index maintenance. Raw stores include serialization/parse setup timings and byte counts for both representations.

The read-only [safetensor header audit](2026-10-08-semantic-tensors.json) distinguishes learned parameters from integer buffers. The contextual Hub tensor totals include 512 integer position IDs; loaded parameter counts exclude those buffers. No scores, models or thresholds were altered to resolve that metadata discrepancy.

### Interpretation and remaining work

Multilingual E5 and multilingual MiniLM are useful shortlist candidates in this synthetic corpus; Potion provides much faster warm encoding with retrieval tradeoffs. The report does not establish a universal winning model. No evaluated cosine gate provides demonstrated safe, useful autonomous identity matching on this held-out set. Requirements, negation, target scope and current evidence need a separate reviewed relation decision.

Custom 10M/100M encoders, distillation and 100k/200k vocabulary ablations are still untrained. Larger rerankers/reference models, independent real-project labels, chronological/project splits, natural assistant replies and downstream implementation quality remain open. The measured pretrained stage is tracked separately from the broader alternatives task in DIP.

[All calibrated scores, language/scenario/scale slices and resource summaries](2026-10-08-semantic-summary.json). Compressed raw per-candidate files are listed with SHA-256 hashes in that summary. Offline validation: node scripts/semantic-evidence.mjs; scorer leakage/cap checks: node --test test/semantic-analysis.test.js. The model runner is frozen at preregistration commit [44d6f4f](https://github.com/vxu-labs/dip/commit/44d6f4f252ae83e2721d410d1011290f67ec4829). Raw predictions can be re-scored without installing Python or a model. Re-running actual inference is a separate explicit operation.
