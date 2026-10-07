# Repeated matched agent experiment

The first trusted-hook repeat did not show an efficiency or quality advantage for DIP. This report retains that result and the subsequent product iteration rather than selecting favorable trials. The capable baseline could write Markdown plans and handoffs. No semantic model or additional model call was used for capture.

## Fixed design and product versions

Each collection schedules six matched project pairs: queue, CSV and search tasks, repeated with revised constants. Each arm receives an initial partial-work turn and a fresh recovery turn, for 24 turns per collection. Model GPT-6.1 Sol, high effort, task prompts, counterbalanced arm order, held-out scoring and the 240-second turn limit remain unchanged. Eight functional cases and six recovery fields are scored per pair. The six fields include four contract values, one deferred feature identifier and a completion-report field.

Protocol v4 measured installed DIP 0.3.11 from source commit `4abf0a8`; v5 measures installed 0.3.12 from `65e8991`. Both use existing authenticated Codex 0.160.0, already trusted hooks and reviewed per-process fixture MCP tool approvals. The baseline disables those hooks and DIP MCP. Both disable shell profiles, inherited native Git trace and unrelated MCP servers per process. Fixtures are separated; no operating-system isolation or exclusive machine access is claimed. A resident recorder stays on its unchanged 0.3.11 outbox code; fresh hooks and MCP load the installed treatment version.

Version 5 follows a defect found in v4: a passing partial check could declare a whole task verified before its remaining feature was implemented. Version 0.3.12 separates check evidence from explicit completion, prevents finishing outstanding structured steps and supports explicit typed plan steps. This is exploratory iteration after inspecting v4, not an independent confirmatory study. All prior failures remain public.

## Protocol v4, DIP 0.3.11

| Observation                                                    |  Markdown |       DIP |
| -------------------------------------------------------------- | --------: | --------: |
| Held-out functional cases                                      |     48/48 |     43/48 |
| Recovery fields                                                |     36/36 |     30/36 |
| Both turns complete within the limit and functional cases pass | 6/6 pairs | 1/6 pairs |
| Completed turns                                                |     12/12 |      7/12 |
| Timed-out turns                                                |         0 |         5 |
| Median observed pair wall time                                 |  215.67 s |  359.05 s |
| Observed DIP MCP calls                                         |         0 |        99 |
| Serialized MCP result bytes                                    |         0 |   131,577 |

One DIP pair retained only three of eight functional successes and none of its six recovery fields. The other five retained all functional cases and fields, including four pairs with a timed-out turn. One seed turn and four recovery turns timed out. All scheduled attempts and their resulting code are retained. The success-count row requires both turns to finish and functional checks to pass; recovery-field correctness is reported separately.

The original v3 pilot observed 134 MCP calls and 91,967 result bytes. Version 4 observed 99 calls and 131,577 bytes, while five turns did not finish. Those observed counts cannot establish end-to-end savings for equivalent completed work. There were no identical adjacent `task_get` arguments in either collection; repeated reads are not automatically redundant. Per-tool profiling found 40,261 bytes for 13 `task_prepare` calls and 28,234 for six `task_adopt` calls, about 52% of v4 MCP result bytes. Returning current intent has a measurable cost even when it combines several management steps.

Token usage was reported for all 12 Markdown turns but only seven DIP turns. Known totals are 1,134,784 versus 1,170,609 input tokens and 32,492 versus 28,404 output tokens. These are incomplete DIP totals, not a token-saving result. Cached input is included in the retained dataset; serialized result bytes are transport observations, not token counts.

## Protocol v5, DIP 0.3.12

All 24 scheduled turns were collected. The protocol was saved before model execution and the installed package fingerprint was checked before each fixture and model turn. There was no scored retry, prompt adaptation or omitted failure.

| Observation                                                    |  Markdown |       DIP |
| -------------------------------------------------------------- | --------: | --------: |
| Held-out functional cases                                      |     48/48 |     48/48 |
| Recovery fields including strict completion report             |     36/36 |     35/36 |
| Contract fields and deferred identifiers                       |     30/30 |     30/30 |
| Both turns complete within the limit and functional cases pass | 5/6 pairs | 4/6 pairs |
| Completed turns                                                |     11/12 |     10/12 |
| Timed-out turns                                                |         1 |         3 |
| Median observed pair wall time                                 |  193.98 s |  274.04 s |
| Observed DIP MCP calls                                         |         0 |        98 |
| Serialized MCP result bytes                                    |         0 |   125,640 |

Both arms retained all required code behavior and recovered all contract fields and deferred identifiers. One DIP completion report listed uncertainty about unspecified invalid-item containers and null entries in `unresolved`. All required functions were present and passed. The fixed scorer expects no remaining v1 work, so this failed its strict completion-report field. The score is retained; it is not a lost requirement or failed required code case.

One Markdown recovery and three DIP turns timed out. One of those DIP turns had emitted `turn.completed` before its process was killed at the limit; completed-turn counts and timeouts therefore are separate observations. Correct artifacts after a timeout do not make that workflow time-bound successful. Median observed DIP pair time was about 1.41 times Markdown. These censored observations establish no complete-workflow speedup.

All six DIP partial seed requirements remained `in_progress`, with distinct future ideas in backlog. The v4 first seed had ended falsely `verified` after a partial passing check. The 0.3.12 boundary was also covered by meaningful CLI/MCP regression fixtures. This is bounded state-management evidence, not proof that every agent reviews every requirement or that a configured check covers all behavior. Prose and linked Markdown plans still require review.

Known token totals are 934,879 versus 2,095,044 input and 26,428 versus 45,327 output, reported for 11 Markdown turns and ten DIP turns. Missing usage prevents a complete cost comparison. Observed MCP calls changed from 134 in v3 to 99 in v4 and 98 in v5; result bytes were 91,967, 131,577 and 125,640 respectively. Different completion rates and changed infrastructure prevent an equivalent-work saving claim. `task_prepare` combines reviewed refinement, claim and criteria retrieval, but these trials do not prove lower end-to-end management cost. Follow-up task DIP-B03 tracks bounded mutation receipts and host/schema profiling in the repository's `.dip`.

## Limits and reproduction

Timed-out wall times are censored at the turn bound. Their pair medians measure observed bounded runs, not full workflow completion latency. A timeout can occur after correct code was written; conversely, a clean process exit does not prove correctness or durable memory. Native structured-plan delivery is unavailable to this tested configuration; the explicit DIP fallback is separately verified in [live host QA](../host-qa/structured-plan.md).

This is a small Windows solo-agent experiment. Cases are clustered within six pairs and three task families; they are not 48 independent projects. It does not establish general maintainability, long-project navigation or parallel coordination. Product and infrastructure changed from v3 to v4, so those differences cannot isolate `task_prepare`. Early v4 collection overlapped local regression and lifecycle QA. No new model-backed QA or unit suite was scheduled alongside v5 collection, but the desktop and resident service remained active. These observations establish no general productivity or quality advantage.

Public datasets normalize machine paths and retain every scheduled trial, scores, outputs, usage observations, timeout and error. Full private reports, synthetic repositories and transport logs remain locally available; public hashes identify private reports and management transcripts. Causal replay reconstructs each retained seed/recovery code artifact and repeats external scoring. It does not rerun the model or prove that a transcript is independently authenticated.

- [v4 preregistered protocol](2026-10-07-model-protocol-v4.json), [all v4 outcomes](2026-10-07-model-controlled-v4.json), [v4 summary](2026-10-07-model-summary-v4.json), [v4 management profile](2026-10-07-management-v4.json).
- [v5 preregistered protocol](2026-10-07-model-protocol-v5.json), [all v5 outcomes](2026-10-07-model-controlled-v5.json), [v5 summary](2026-10-07-model-summary-v5.json), [v5 management profile](2026-10-07-management-v5.json).
- [Original v3 pilot](model-controlled.md) and [original management profile](2026-10-07-management-before.json).

```sh
node scripts/model-benchmark-evidence.mjs docs/benchmarks/2026-10-07-model-controlled-v4.json
node scripts/model-benchmark-evidence.mjs docs/benchmarks/2026-10-07-model-controlled-v5.json
node scripts/model-benchmark-summary.mjs --input docs/benchmarks/2026-10-07-model-controlled-v4.json
```

The archived harnesses are provenance files, not automatic model invocations. The active live harness requires an existing authenticated host, reviewed hooks and explicit authorization for model usage. Use DIP and execute cloned scripts at your own responsibility.
