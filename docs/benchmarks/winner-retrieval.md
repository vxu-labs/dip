# Shortlisted encoders: project sources and long-document follow-up

This is a new bounded stage following the [seven-model exploratory comparison](semantic-retrieval-pilot.md). E5-small and multilingual MiniLM were selected on those known outcomes; this is not an independent model-selection holdout. The models remain pinned, local CPU research dependencies. No neural tool is installed into production DIP.

The [frozen protocol](2026-10-08-winner-protocol.json) records every source, query, strategy and source hash before scored inference. Version 1 is retained as [preflight metadata](2026-10-08-winner-protocol-v1.json); before inference, the final version added structured snapshots alongside source text for independent provenance validation. No query, label, ranking rule or model was changed by that preflight amendment.

Real-source retrieval uses sixteen public project task records and their eighteen distinct committed Markdown references. Thirty-two authored English/Hebrew requests target designated task sources; twelve additional questions target document sources and headings. Eight unrelated requests diagnose candidate-only behavior. These labels are authored in this project, not independently adjudicated or exhaustive relevance judgments. Recorded verified tasks are searchable, but their present code verification is not inferred from that status.

A placement stress moves each real task's unchanged requirements behind 120 unrelated appendix paragraphs. The baseline still gets the entire source; contextual encoder truncation is counted. Heading-aware overlapping 160-character sections retain their exact source spans, with 40-character overlap. A fixed hybrid combines dense and BM25 source ranks using [Reciprocal Rank Fusion](https://cormack.uwaterloo.ca/cormacksigir09-rrf.pdf), k=60. Each source takes its highest section score; hybrid citations use the dense-selected section. There is no test-fitted weight or threshold.

The known sixteen synthetic test families from the previous pilot are explicitly reused at 1,000 items per language as a diagnostic, including opposite/extended requirements and cancelled/superseded/version distractors. They are not a new hidden test. No oracle component filter is applied. Raw ranks and separate explicit status/version eligibility ranks are retained. Markdown and structured data receive identical searchable information; this is not a test of live DIP versus a weaker Markdown workflow.

A derived NPZ index caches normalized vectors by pinned encoder settings and exact content. All ten indexes per model are tested after a fresh subprocess restart, with zero re-encoding for unchanged content, changed/deleted entries, and a separate corrupt-cache recovery. Metadata and citations always come from the supplied current source. Infrastructure recovery tests are excluded from scored retrieval and never provide a second scored attempt.

Every result is a bounded candidate list with source path, content hash, offsets and recorded status. The interface states identityEstablished=false, verification=not_checked and decision=candidate_only. No-match requests still return candidates; this stage does not claim learned no-match abstention or semantic identity. Source text, including agent instructions in Markdown, is untrusted retrieval data. The experiment does not execute document instructions, merge tasks or assert code completion.

Reproduce actual inference explicitly with the [previous isolated environment lock](2026-10-08-semantic-requirements.txt), pinned cached weights and scripts/winner-retrieval.py. Set --protocol docs/benchmarks/2026-10-08-winner-protocol.json, --model one-pinned-id (or lexical), --output a-new-private-result.json, --cache an-isolated-model-cache, --index-dir a-new-private-index-directory. Each initial scored index and outcome must be fresh. Scripts/winner-index-test.py runs deterministic cache/section contract checks without a model; final published evidence can be re-scored offline through scripts/winner-check.mjs.

Independent labels, project/time-separated data, naturally generated user revisions, downstream coding quality, learned relation decisions and full custom 10M/100M training remain open. Experimental use is at the user's responsibility; no product guarantee is made.

## Results

All three scheduled attempts completed without failed or repeated scored inference: 188 query cases, 1,880 retained ranking rows across the fixed strategies. The real task pool has sixteen sources; the document pool has eighteen. Thirty-two matching task requests are English/Hebrew variants of sixteen task families in one project, not thirty-two independent projects.

### Real task source recovery

| Retriever | Strategy | R@1 /32 | R@5 /32 | R@10 /32 | MRR@10 |
| --- | --- | ---: | ---: | ---: | ---: |
| BM25 | whole | 17/32 | 23/32 | 26/32 | 0.61 |
| BM25 | sections | 18/32 | 23/32 | 26/32 | 0.63 |
| E5-small multilingual | whole | 24/32 | 28/32 | 30/32 | 0.81 |
| E5-small multilingual | sections | 18/32 | 30/32 | 31/32 | 0.69 |
| E5-small multilingual | hybrid-whole | 19/32 | 24/32 | 32/32 | 0.68 |
| E5-small multilingual | hybrid-sections | 20/32 | 25/32 | 31/32 | 0.71 |
| MiniLM multilingual | whole | 19/32 | 30/32 | 31/32 | 0.72 |
| MiniLM multilingual | sections | 15/32 | 27/32 | 31/32 | 0.64 |
| MiniLM multilingual | hybrid-whole | 18/32 | 27/32 | 32/32 | 0.69 |
| MiniLM multilingual | hybrid-sections | 17/32 | 25/32 | 31/32 | 0.64 |

E5 whole-intent retrieval had the highest observed first-source recovery in this small real-project sample. Splitting every short intent into small sections reduced first-place precision; sections are not automatically the better representation. The hybrid reached 32/32 in the top ten for both models but lowered first-place recovery. This supports further testing of separate compact-intent and long-document channels, not a universal model winner.

### Requirements placed after a long appendix

| Retriever | Strategy | R@1 /32 | R@5 /32 | R@10 /32 | MRR@10 |
| --- | --- | ---: | ---: | ---: | ---: |
| BM25 | whole | 17/32 | 23/32 | 26/32 | 0.61 |
| BM25 | sections | 19/32 | 23/32 | 26/32 | 0.64 |
| E5-small multilingual | whole | 2/32 | 10/32 | 20/32 | 0.18 |
| E5-small multilingual | sections | 18/32 | 30/32 | 31/32 | 0.69 |
| E5-small multilingual | hybrid-whole | 6/32 | 19/32 | 26/32 | 0.35 |
| E5-small multilingual | hybrid-sections | 20/32 | 25/32 | 31/32 | 0.71 |
| MiniLM multilingual | whole | 2/32 | 10/32 | 20/32 | 0.18 |
| MiniLM multilingual | sections | 15/32 | 28/32 | 31/32 | 0.64 |
| MiniLM multilingual | hybrid-whole | 6/32 | 19/32 | 26/32 | 0.35 |
| MiniLM multilingual | hybrid-sections | 17/32 | 25/32 | 32/32 | 0.64 |

All sixteen whole-intent stress inputs exceeded both encoder windows. Their early padding was identical, so whole-source vectors lost the distinguishing requirements: 2/32 first-place and 20/32 top-ten results are tied-rank recovery, not semantic success. Section retrieval recovered the actual late requirements; E5 rose to 18/32 first and 31/32 top ten, MiniLM to 15/32 and 31/32. BM25 searched the full text and did not suffer encoder truncation. This is controlled placement stress, not naturally collected giant-project history. Offsets in this suite resolve to the frozen synthetic snapshots, not live canonical ledger files.

### Linked Markdown sources and headings

| Retriever | Strategy | Source R@1 /12 | Source R@5 /12 | Source R@10 /12 | Correct source and heading at1 /12 |
| --- | --- | ---: | ---: | ---: | ---: |
| BM25 | whole | 2/12 | 7/12 | 8/12 | 0/12 |
| BM25 | sections | 3/12 | 5/12 | 8/12 | 2/12 |
| E5-small multilingual | whole | 4/12 | 8/12 | 11/12 | 0/12 |
| E5-small multilingual | sections | 3/12 | 11/12 | 11/12 | 2/12 |
| E5-small multilingual | hybrid-whole | 4/12 | 8/12 | 11/12 | 0/12 |
| E5-small multilingual | hybrid-sections | 3/12 | 7/12 | 11/12 | 2/12 |
| MiniLM multilingual | whole | 3/12 | 8/12 | 10/12 | 0/12 |
| MiniLM multilingual | sections | 2/12 | 10/12 | 11/12 | 0/12 |
| MiniLM multilingual | hybrid-whole | 2/12 | 9/12 | 11/12 | 0/12 |
| MiniLM multilingual | hybrid-sections | 3/12 | 8/12 | 11/12 | 2/12 |

Finding the correct document is easier than choosing the exact useful section. E5 sections recovered the designated document in the top five for 11/12 questions, but selected the designated source and heading first in only 2/12. Source recovery does not prove answer extraction, requirement coverage or trustworthy interpretation of an instruction in Markdown. Whole methods have no heading selection and their zero heading counts are structural, not a separate model failure.

### Known adversarial synthetic diagnostic

| Retriever | Strategy | Raw R@1 /48 | Raw R@10 /48 | Eligible R@1 /48 | Eligible R@10 /48 |
| --- | --- | ---: | ---: | ---: | ---: |
| BM25 | whole | 7/48 | 24/48 | 7/48 | 25/48 |
| BM25 | sections | 7/48 | 24/48 | 7/48 | 25/48 |
| E5-small multilingual | whole | 13/48 | 44/48 | 21/48 | 47/48 |
| E5-small multilingual | sections | 13/48 | 44/48 | 21/48 | 47/48 |
| E5-small multilingual | hybrid-whole | 12/48 | 34/48 | 16/48 | 36/48 |
| E5-small multilingual | hybrid-sections | 12/48 | 34/48 | 16/48 | 36/48 |
| MiniLM multilingual | whole | 11/48 | 44/48 | 22/48 | 44/48 |
| MiniLM multilingual | sections | 11/48 | 44/48 | 22/48 | 44/48 |
| MiniLM multilingual | hybrid-whole | 11/48 | 33/48 | 14/48 | 36/48 |
| MiniLM multilingual | hybrid-sections | 11/48 | 33/48 | 14/48 | 36/48 |

These are the known previous sixteen synthetic families at 1,000 items, including extensions/opposites and old versions. They are not new independent test data. Fixed equal-rank hybrid fusion reduced raw top-ten recovery from 44/48 to 34/48 for E5 and 33/48 for MiniLM. Combining a weak lexical signal with a dense rank can hurt; no fusion parameters were changed after this outcome. Eligibility removes explicitly cancelled/superseded and wrong-version records, but does not decide semantic identity or infer scope.

### Cache, source freshness and resource checks

| Model | Fresh-process restarts | Unchanged re-encodes | Incremental checks | Corrupt-cache rebuild | Load, s | Query batch encode, s | Peak process RSS, MiB |
| --- | ---: | ---: | ---: | --- | ---: | ---: | ---: |
| E5-small multilingual | 10 | 0 | 10 changes, 10 deletions | Passed, current sources re-encoded | 1.75 | 2.46 | 1008.63 |
| MiniLM multilingual | 10 | 0 | 10 changes, 10 deletions | Passed, current sources re-encoded | 1.39 | 1.77 | 860.09 |

All twenty unchanged indexes were loaded in fresh subprocesses without loading an encoder. Content changes encoded at most one new entry per check; source removal needed zero encodes and removed applicable entries. A separate corrupt-copy recovery per model rebuilt the sixteen-source initial index and matched its vectors within the fixed tolerance. Cached status is never authoritative: citations and recorded status are attached from supplied source metadata. These are research-cache contract checks, not crash-proof concurrent production index maintenance.

| Model | Source set | Representation | Unique encoded entries | Truncated encoder inputs | Initial encode/cache write, s | Cache size, KiB |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| E5-small multilingual | real | whole | 16 | 2 | 3.83 | 23.31 |
| E5-small multilingual | real | sections | 191 | 0 | 5.63 | 272.53 |
| E5-small multilingual | late | whole | 16 | 16 | 3.88 | 2.89 |
| E5-small multilingual | late | sections | 354 | 0 | 8.66 | 504.63 |
| E5-small multilingual | documents | whole | 18 | 14 | 4.29 | 26.15 |
| E5-small multilingual | documents | sections | 1162 | 0 | 34.03 | 1654.36 |
| E5-small multilingual | known-synthetic en | whole | 1000 | 0 | 14.54 | 1425.09 |
| E5-small multilingual | known-synthetic en | sections | 1000 | 0 | 14.51 | 1425.09 |
| E5-small multilingual | known-synthetic he | whole | 1000 | 0 | 14.93 | 1425.88 |
| E5-small multilingual | known-synthetic he | sections | 1000 | 0 | 15.02 | 1425.88 |
| MiniLM multilingual | real | whole | 16 | 15 | 0.94 | 23.55 |
| MiniLM multilingual | real | sections | 191 | 0 | 4.98 | 275.02 |
| MiniLM multilingual | late | whole | 16 | 16 | 1.40 | 2.90 |
| MiniLM multilingual | late | sections | 354 | 0 | 7.84 | 509.29 |
| MiniLM multilingual | documents | whole | 18 | 18 | 1.24 | 26.39 |
| MiniLM multilingual | documents | sections | 1162 | 0 | 33.77 | 1669.62 |
| MiniLM multilingual | known-synthetic en | whole | 1000 | 0 | 12.42 | 1437.49 |
| MiniLM multilingual | known-synthetic en | sections | 1000 | 0 | 13.00 | 1437.49 |
| MiniLM multilingual | known-synthetic he | whole | 1000 | 0 | 14.58 | 1437.82 |
| MiniLM multilingual | known-synthetic he | sections | 1000 | 0 | 14.33 | 1437.82 |

All section-encoding inputs fit both models; whole-document truncations are retained in the table and raw metrics. Cache-change and corruption-rebuild encodes are infrastructure checks, excluded from quality scoring. Initial update time includes encoding, compression and writing the derived cache. Per-row search time includes shared lexical/dense ranking and candidate view construction; it is not isolated neural inference or an end-to-end agent latency comparison. The Windows desktop and recorder stayed active; this is not exclusive hardware.

### Safety and unresolved questions

Every returned result includes its frozen content hash, source path, exact offsets, excerpt and recorded status, with identityEstablished=false, verification=not_checked and decision=candidate_only. No-match queries still returned candidates: all eight unrelated real requests and all forty-eight known synthetic no-match requests. This design prevents the interface from claiming a verified answer; it does not detect no-match automatically. No real task was merged, closed or verified by model inference.

The next candidate architecture is E5 for compact intent, a separate section index for long linked Markdown, and an agent-reviewed relation/source check. That is an inference from these results, not a deployed feature. Heading localization needs improvement, fusion requires signal-aware evaluation, and independent multi-project labels plus downstream agent code quality remain open. Neither this study nor the previous one trained a custom 10M/100M model.

[All results, language slices, cache checks and resource counts](2026-10-08-winner-summary.json). Compressed raw candidate lists and SHA-256 hashes are listed in the summary. Validation: node scripts/winner-check.mjs; deterministic local cache contracts: python scripts/winner-index-test.py. Preregistration and frozen runner source: [6e0ceae](https://github.com/vxu-labs/dip/commit/6e0ceae6a3d4339ee549f2160c5857fbb6a211d7). The source snapshot came from published commit 88e2bf4. Validation reads frozen sources and never executes their Markdown instructions.
