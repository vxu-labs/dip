# Laya task-matching zero-shot pilot

**This checkpoint/prompt is not ready to merge DIP tasks automatically.** It found 23/24 true identity pairs but also labeled 52/72 non-identical pairs as identical. The precision of its identical-task suggestions was 30.7%. This is an initial author-defined synthetic pilot, not a proof that all Laya variants fail or that fine-tuning will fix it.

## Results

| Measure                                 |                    Result |
| --------------------------------------- | ------------------------: |
| Four-way relationship accuracy          |             33/96 (34.4%) |
| Binary exact-identity accuracy          |             43/96 (44.8%) |
| Constant not-identical binary baseline  |             72/96 (75.0%) |
| Constant single-class four-way baseline |             24/96 (25.0%) |
| Exact-identity precision                |             23/75 (30.7%) |
| Exact-identity recall                   |             23/24 (95.8%) |
| False exact-identity decisions          | 52/72 non-identical pairs |
| Missed true identities                  |      1/24 identical pairs |
| Errors / truncated inputs               |                     0 / 0 |
| Binary Brier score                      |                    0.3134 |
| Binary confidence ECE, 10 bins          |                    0.2475 |

The always-not-identical baseline has no useful recall; its 75% accuracy shows why accuracy alone is insufficient. False identity combines partial overlap, related work and different work. These may still be useful candidate links, but do not justify treating the requirements as equivalent or closing an old task. No real DIP task status was changed by this model.

## Language breakdown

| Inputs | Relationship correct | Identity correct | False identities | Missed identities |
| ------ | -------------------: | ---------------: | ---------------: | ----------------: |
| en     |                11/32 |            18/32 |               14 |                 0 |
| he     |                11/32 |            14/32 |               17 |                 1 |
| cross  |                11/32 |            11/32 |               21 |                 0 |

Four-way confusion matrix, rows = expected relationship, columns = prediction:

| Expected  | same | overlap | related | different | error |
| --------- | ---: | ------: | ------: | --------: | ----: |
| same      |   17 |       4 |       1 |         2 |     0 |
| overlap   |   12 |       6 |       1 |         5 |     0 |
| related   |   13 |       6 |       3 |         2 |     0 |
| different |   12 |       1 |       4 |         7 |     0 |

The four-way and binary questions are separate heads/requests within one predict call and can disagree. Both outputs are retained; no more favorable question is substituted after observing results.

## Confidence and resource cost

At the predefined 0.8 top-answer-probability threshold, 18/96 pairs were covered and 12 were correct; 6 false identities remained. The cutoff was not fitted on these outcomes. Reported probability is not a guarantee of correctness on DIP data. The SDK's entropy confidence and act_probability are not used as truth gates.

| Resource measure                          |          Observed |
| ----------------------------------------- | ----------------: |
| Parameter count                           |       321,908,995 |
| CPU dtype / threads                       | torch.float32 / 4 |
| Process load, including cached Hub lookup |           10.70 s |
| Separate non-task warmup                  |           0.251 s |
| Median pair latency, two questions        |           0.774 s |
| p95 pair latency, two questions           |           0.896 s |
| Peak sampled process RSS                  |          2.14 GiB |

Measured on this Windows laptop, four CPU threads, eager FP32, single pair per call. Latency includes two questions; it is not comparable to upstream single-question GPU latency. Peak RSS was sampled every 100ms and can miss shorter peaks. Model downloads and Python installation are excluded from scored-pair timing. The weights/cache/venv are local ignored artifacts, not a new product dependency or always-running service.

## Fixed method

- Model: convaiinnovations/laya, multilingual subfolder, pinned revision 7b928d828b7b0e022f929d9bd2e44165aa270148. Runtime Laya 0.3.28, PyTorch 2.8.0+cpu, Transformers 4.57.6, Python 3.12.14.
- [Protocol v2](2026-10-07-laya-protocol.json) and source hashes were published in 786dc04 before any task-pair prediction. [Original protocol v1](2026-10-07-laya-protocol-v1.json) remains available. Model execution started 2026-10-07T06:11:44Z, ended 2026-10-07T06:13:11Z.
- 32 authored task families, each rendered in English, Hebrew and Hebrew-to-English: 96 cases, four balanced labels. Status alternates backlog/verified across families and is explicitly irrelevant to identity. Language variants cluster by family; they are not 96 independent projects. No independently blinded label adjudication has been done.
- Labels distinguish equivalent work, overlapping requirements, a related but separate capability, and unrelated/opposite/disjoint-target work. Changed constraints are overlap; opposite actions or disjoint API versions/tenants are different. This operational definition may differ from an organization's policy for updating an existing task.
- Neutral answer keys and balanced family rotations reduce fixed-option-position cues. The two schemas are fixed in the protocol. Only case.state is passed to inference; expected labels are never provided to the model. No prompt edits, scored retries, threshold fitting, calibration fitting, fine-tuning or distillation followed outcomes. Checkpoint-provided defaults remain active.
- Multilingual is forced for all languages to isolate one checkpoint. The English checkpoint and automatic Router were not compared. A different schema, trained checkpoint, reranker or deployment could perform differently.
- The first load attempt failed with Windows symlink privileges during concurrent Hub downloads. Its [setup outcome](2026-10-07-laya-setup-attempt1.json) is retained and excluded from accuracy. Sequential pinned downloads solved setup without administrator rights. [Successful infrastructure preflight](2026-10-07-laya-preflight.json) used a non-domain color question, excluded from all scores.
- No host-memory or process-RSS guard fired in the scored run. The published protocol records resource caps and safeguards. Inputs are synthetic; no user project source or chat credentials were sent to an inference service. Weights were downloaded from the public Hub.

## Interpretation and next work

The model runs without additional training and finds many relevant candidate identities, but it is too permissive for exact-equivalence decisions under this schema. A domain fine-tune or a different pretrained model is warranted for evaluation; this pilot does not prove training is necessary or sufficient. Current adoption should keep model output as candidate evidence reviewed by the existing agent, with real code checks deciding verified completion.

The open-source alternatives task is recorded in DIP as task_8b4318ef-b13d-4420-988f-5266db4cd215. Candidate selection must check weight/code licenses and compare identical held-out inputs plus false-merge rates and CPU/RAM cost. Future training needs independently reviewed labels, more domains, and project/time splits that keep paraphrases out of both training and test. Retrieval over large histories, real code completion and live Git-agent triggers were not evaluated here.

## Reproduce and audit

- [All inputs, schemas and pinned settings](2026-10-07-laya-protocol.json)
- [Every prediction, probability and score](2026-10-07-laya.json)
- [Dependency lock](2026-10-07-laya-requirements.txt)
- Offline score validation without installing/downloading a model: node scripts/laya-pilot-evidence.mjs.
- To rerun the model, create a separate Python 3.12 venv, install the CPU torch 2.8.0 build from the PyTorch CPU index and then the dependency lock. Run scripts/laya-pilot.py with --protocol docs/benchmarks/2026-10-07-laya-protocol.json --output a-new-results.json --cache a-local-model-cache. Do not overwrite the published outcome file.
- Official model/runtime references: [model card](https://huggingface.co/convaiinnovations/laya), [runtime release](https://pypi.org/project/laya/0.3.28/).
