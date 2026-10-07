# DIP benchmarks

## Semantic retrieval candidates and proposed comparison

The [source-linked alternatives shortlist and experiment design](semantic-alternatives.md) includes compact static/contextual models, a custom 10M/100M relation-encoder arm, vocabulary-budget analysis and user-request/assistant-response query ablations against capable large-Markdown and DIP baselines. This is research/planning, with no model quality ranking or training outcome yet.

## Laya task-matching zero-shot pilot

The pinned multilingual Laya checkpoint ran locally without additional training on 96 synthetic request/task pairs: 32 authored families rendered in English, Hebrew and across languages. Four-way relationship accuracy was 33/96 (34.4%). Exact-identity precision was 23/75 (30.7%): it found 23/24 true matches but called 52/72 non-identical pairs identical. The current checkpoint/schema is not ready for automatic task merging. This is a small clustered pilot, not a verdict on every Laya variant or proof that training will solve the problem. [Method, every probability, setup failure, resources and replay](laya-pilot.md).

## Longitudinal controlled quality experiment

Four matched project pairs used 72 scheduled fresh conversations with real revisions, interruption, concurrent workers and final audits. Final primary code cases: 120/120 without DIP and 120/120 with DIP. Exact intent checks: 52/52 and 52/52. No primary quality advantage was observed against the Markdown baseline. Supplementary exploratory contract stress is reported separately. [Every result, fixed method, supplement, costs and replay](longitudinal.md).

## Controlled model-backed pilot

Six matched pairs used GPT-6.1 Sol with High reasoning, identical task prompts, alternating arm order and two fresh sessions per arm. Ordinary Markdown handoffs were allowed in the baseline. Both arms passed 48/48 functional cases, recovered 24/24 contract fields and retained 6/6 deferred feature identifiers. Median total workflow time was 164.19 seconds without DIP and 360.84 seconds with DIP. Reported input/output token usage was higher with DIP. No productivity advantage was observed in these solo microtasks.

[Full controlled report](model-controlled.md) includes all valid outcomes, source artifacts, reported usage, preregistered protocols, two retained infrastructure attempts, replay validation and limitations. This is a small pilot against an explicitly instructed note-taking baseline; it does not measure parallel coordination or implicit reminders.

## Synthetic tracking overhead

Measured on 6 October 2026 with Node.js 24.14.0, Windows x64 and an Intel Core i7-8750H. Each run uses 30 paired samples after three warm-up pairs, alternating the execution order. Both conditions launch the same Node file-write subprocess with identical content.

The baseline has no DIP hooks, instructions, recorder or Git integrations. Git configuration and runtime directories are isolated; Trace2 is disabled for both conditions. The DIP condition adds a fresh pre-hook process and a post-hook process. The recorder is absent, so hooks persist immediately through the durable fallback. Setup, prompt/plan capture and the final stop hook are excluded from the timed write iterations.

| Measurement, v0.3.2        | Without DIP |  With DIP |
| -------------------------- | ----------: | --------: |
| Blocking operation, median |    79.17 ms | 229.25 ms |
| Blocking operation, p95    |    85.43 ms | 251.20 ms |

The median paired added blocking cost was **150.88 ms**, with a p95 of **167.37 ms**. Including sequential post-capture, the DIP operation median was **369.57 ms**. The installed host normally runs ordinary post-hooks asynchronously, so that sequential figure is not its blocking latency. Normal installed recording also batches work through a daemon.

Capture invoked **zero additional model calls**. A separate feature check retained the task, plan and handoff after deleting the isolated runtime database. The baseline does not include another task tracker or manual persistence system.

This is a synthetic tracking-overhead benchmark. It does not measure model productivity, code quality, token savings or time to complete a feature. The live desktop trials in [the QA report](../desktop-qa.md) are observational and are not a controlled model A/B experiment.

## Raw samples and reproducibility

- [v0.3.2 samples](2026-10-06-windows-0.3.2.json)
- [Earlier v0.3.1 samples](2026-10-06-windows.json)

The earlier run measured 118.07 ms without DIP, 341.96 ms with DIP on the blocking path, and 224.19 ms paired added median cost. Background workload was not held constant between releases. Both runs are published; no release speedup is inferred from their difference. These single-machine samples are not a latency guarantee.

```sh
node scripts/benchmark-comparison.mjs results.json
```

Set `DIP_BENCH_SAMPLES` to an integer from 10 to 200 to change the sample count. Temporary fixtures and machine configuration are isolated; the script does not alter the user's installed integrations.
