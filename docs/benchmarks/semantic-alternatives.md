# Task retrieval alternatives and proposed experiment

Research snapshot: 7 October 2026. These are candidates, not measured winners. No candidate in this shortlist was downloaded, trained or evaluated during this research turn. The [Laya pilot](laya-pilot.md) tested pair classification, not retrieval across a large history.

The proposed small model learns text-to-task relationships through dense or static embeddings. It does not need to generate language. It still needs representations that distinguish paraphrases from negation, changed constraints, unrelated components and different versions/tenants. A large tokenizer vocabulary by itself does not supply those representations.

## Shortlist

Approximate sizes are the Hub's reported tensor totals, checked with model configs where available. Actual deployment/training memory and tokenization must be measured. Model cards list the weight licenses below; selected revisions, implementation licenses and training-data rights need review before distribution.

| Candidate                                                                                                                   | Approximate size | Role to test                                                    | Language scope and practical limit                                                                         | Listed weight license |
| --------------------------------------------------------------------------------------------------------------------------- | ---------------: | --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | --------------------- |
| [Potion-base-8M / Model2Vec](https://huggingface.co/minishlab/potion-base-8M)                                               |             7.6M | Static embeddings; close to the proposed 10M budget             | English model; useful small-model sanity baseline, not a validated Hebrew option                           | MIT                   |
| [Potion-retrieval-32M](https://huggingface.co/minishlab/potion-retrieval-32M)                                               |            32.3M | Static retrieval embeddings                                     | English retrieval candidate; no assumed multilingual equivalence                                           | MIT                   |
| [Potion-multilingual-128M](https://huggingface.co/minishlab/potion-multilingual-128M)                                       |           128.1M | Static multilingual embeddings, possible distillation reference | Hebrew is listed as iw; above 100M, but inference uses lookup/pooling rather than a contextual transformer | MIT                   |
| [multilingual-e5-small](https://huggingface.co/intfloat/multilingual-e5-small)                                              |           117.7M | Contextual query/passage retrieval                              | Hebrew listed; 512 encoder positions; use its documented query/passage prefixes                            | MIT                   |
| [paraphrase-multilingual-MiniLM-L12-v2](https://huggingface.co/sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2) |           117.7M | Paraphrase similarity / candidate retrieval                     | Hebrew listed; Sentence Transformers defaults to 128 input tokens despite 512 encoder positions            | Apache-2.0            |
| [BGE-small-en-v1.5](https://huggingface.co/BAAI/bge-small-en-v1.5)                                                          |            33.4M | Small contextual retrieval baseline                             | English; no assumed Hebrew support; not an exact-identity classifier                                       | MIT                   |
| [all-MiniLM-L6-v2](https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2)                                           |            22.7M | Small sentence-embedding baseline                               | English; a possible architecture/distillation starting point                                               | Apache-2.0            |
| [GTE-multilingual-base](https://huggingface.co/Alibaba-NLP/gte-multilingual-base)                                           |           305.4M | Larger multilingual dense/sparse reference                      | Hebrew listed, 8,192 positions; custom model code must be pinned/reviewed                                  | Apache-2.0            |
| [BGE-reranker-v2-m3](https://huggingface.co/BAAI/bge-reranker-v2-m3)                                                        |           567.8M | Cross-encoder reranking of a shortlist                          | Multilingual reference; larger than the proposed budget and relevance is not identity                      | Apache-2.0            |
| [Qwen3-Embedding-0.6B](https://huggingface.co/Qwen/Qwen3-Embedding-0.6B)                                                    |           595.8M | Larger retrieval reference                                      | Model card claims multilingual support; local Hebrew validation required; outside the micro budget         | Apache-2.0            |

[Model2Vec](https://github.com/MinishLab/model2vec) and [Tokenlearn](https://github.com/MinishLab/tokenlearn) provide an existing route to distill/train static embeddings. [Sentence Transformers](https://github.com/huggingface/sentence-transformers) supports contextual encoders, contrastive training and reranking. These are implementation routes to evaluate, not predictions of DIP accuracy or training time.

Additional candidates: [static-similarity-mrl-multilingual-v1](https://huggingface.co/sentence-transformers/static-similarity-mrl-multilingual-v1) offers static multilingual/Matryoshka embeddings, but storage size must be verified for the dimensions retained; reducing output dimensions is not automatically reducing every weight tensor. [fastText](https://github.com/facebookresearch/fastText) is an MIT-licensed lexical/subword training baseline; its upstream repository is archived, pretrained asset licenses are separate, and separate language vectors are not automatically aligned for cross-language retrieval.

Jina embeddings v3 was excluded from the permissive default shortlist: its [model card](https://huggingface.co/jinaai/jina-embeddings-v3) lists CC-BY-NC-4.0 for weights. Publicly downloadable weights are not sufficient to classify a model as a permissive open-source dependency for DIP.

Candidate metadata with pinned revisions/config dimensions: [contextual/reference models](2026-10-07-semantic-alternatives-contextual.json), [static/small models](2026-10-07-semantic-alternatives-static.json). Language tags are publisher claims, not measured Hebrew performance. Missing explicit he/iw tags do not prove that a multilingual model cannot process Hebrew.

## Vocabulary and parameter budget

For an ordinary learned token-embedding table, parameter count is V * d. Tokens are typically subword pieces, not necessarily whole words. These examples exclude the encoder, projection, positional embeddings and any hash/subword buckets:

| Vocabulary | Embedding width | Table parameters alone |
| ---------: | --------------: | ---------------------: |
|    100,000 |              64 |                   6.4M |
|    200,000 |              64 |                  12.8M |
|    100,000 |             128 |                  12.8M |
|    200,000 |             256 |                  51.2M |
|    200,000 |             512 |                 102.4M |

Thus a conventional 10M total-parameter model cannot contain a 200k-by-64 table. A 100M model cannot contain a 200k-by-512 table before adding any encoder. Smaller/factorized dimensions, constrained hash buckets, a smaller tokenizer or static distillation are possible design candidates with quality tradeoffs. Quantization reduces bits/storage, not parameter count. The E5-small and multilingual MiniLM configs already have 250,037 vocabulary entries and width 384; their embedding table alone accounts for about 96M parameters.

The custom-model arm should compare pretrained adaptation, static/contextual distillation and from-scratch training explicitly. A narrow task does not establish that cross-language training from scratch will be cheap or successful. Measure label/data acquisition, compute and accuracy before committing to a design.

## User request and assistant response

Let Q be the current human request and A the assistant's response or plan. Evaluate four independent query modes with the same task store and labels:

1. Q only.
2. A only, as a diagnostic.
3. Q+A concatenation, with explicit roles.
4. Separate query representations and a fusion/weighting rule selected on calibration data, then frozen for test.

A can add component names and operational wording, but can also expand, misunderstand or contradict Q. The human request remains authoritative. Generate A before any retrieval of the answer task; task IDs, source excerpts and other answer-bearing retrieval context must be excluded from that query channel. Otherwise the test can leak the correct task rather than measure semantic matching. Completion prose is not proof that code was implemented.

Test mistaken responses and long responses that overwhelm a short request. Include new requests with no matching historical task, partial expansions, opposite actions, code/path renames, version changes and old tasks whose implementation or verification is now stale. Compare request+plan at work start separately from request+completion-summary at work end; they have different information available.

## Fair large-history comparison

This is an evaluation design, not a preregistered run or measured result. Publish a fixed corpus, labels, splits and thresholds before the actual experiment.

| Arm | Store                                 | Retrieval                                                  |
| --- | ------------------------------------- | ---------------------------------------------------------- |
| A   | Markdown only, no DIP or neural model | Capable rg/BM25/indexed keyword search                     |
| B   | Same Markdown                         | Same neural/hybrid retriever used by DIP                   |
| C   | Structured DIP                        | Lexical search plus explicit status/scope/version metadata |
| D   | Structured DIP                        | Neural/hybrid search plus the same metadata                |

Arm B separates the value of the model from the value of DIP structure. Do not make the Markdown baseline read every document or disable its search tools. Use identical information and comparable indexing setup in both stores; record setup/index-maintenance cost.

Scale histories to 100, 1,000 and 10,000 task/document items, then include real reviewed project histories. Preserve current, superseded, cancelled, open and completed entries. Completed tasks remain searchable; whether their code/evidence remains valid is a separate check. Include old plans with misleadingly similar phrasing and temporal/scope constraints. Repeated generated distractors do not become thousands of independent projects.

Measure Recall@1/5/10, MRR and candidate relevance separately from exact identity/partial coverage. Also measure false merges, stale-rule errors, no-match abstention, downstream implementation correctness, tokens, cold/warm CPU latency, RAM, model download size and incremental index updates. Generic cosine/reranking scores are not calibrated equivalence probabilities or completion evidence.

Split reviewed training, calibration and test data by project, chronology and semantic task family. Keep paraphrase variants and assistant-generated equivalents out of both train and test. Preserve the existing public Laya pilot as an exploratory reference, not a hidden final test for a model tuned on those known outcomes.

## Recorded follow-up

The existing DIP alternatives task task_8b4318ef-b13d-4420-988f-5266db4cd215 now includes the custom 10M/100M model, tokenizer ablations, Q/A queries and these factorial baselines. It remains backlog. The current research task completed a shortlist and design only; no training or candidate performance comparison is claimed.
