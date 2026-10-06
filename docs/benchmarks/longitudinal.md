# Longitudinal controlled quality experiment

This experiment found no difference in final functional correctness or exact recovered intent between the arms.

The run used 72 scheduled fresh Codex conversations across eight repositories: four matched pairs with and without DIP. It added actual mid-development changes, cancelled and future ideas, abrupt process interruption, concurrent isolated Git worktree workers, real merges, a final revision and a fresh read-only audit. Both arms were instructed to preserve repository intent and handoffs; ordinary Markdown was available to the baseline. This measures DIP against an instructed durable-memory baseline, not an unassisted default chat. No evaluator feedback or result-dependent retries were provided.

| Quality measure                                       | Without DIP | With DIP |
| ----------------------------------------------------- | ----------: | -------: |
| Final projects passing every external functional case |         4/4 |      4/4 |
| Final external functional cases                       |     120/120 |  120/120 |
| Exact recovered policy/future/cancellation checks     |       52/52 |    52/52 |
| Of those: current policy fields                       |       40/40 |    40/40 |
| Of those: deferred feature identifiers                |         8/8 |      8/8 |
| Of those: cancelled feature identifiers               |         4/4 |      4/4 |
| False release-ready claims against external tests     |           0 |        0 |
| Claimed exports with failing component tests          |           0 |        0 |
| Fully correct code with a complete release report     |         4/4 |      4/4 |
| Product merge-conflict paths                          |           4 |        4 |
| All merge-conflict paths, including management notes  |           4 |        4 |
| Audit changed a provided product/test file            |           0 |        0 |

## Paired final results

| Pair | Without: functional | With: functional | Without: recovered intent | With: recovered intent | Merge paths without / with |
| ---- | ------------------: | ---------------: | ------------------------: | ---------------------: | -------------------------: |
| 1    |               30/30 |            30/30 |                     13/13 |                  13/13 |                      1 / 1 |
| 2    |               30/30 |            30/30 |                     13/13 |                  13/13 |                      1 / 1 |
| 3    |               30/30 |            30/30 |                     13/13 |                  13/13 |                      1 / 1 |
| 4    |               30/30 |            30/30 |                     13/13 |                  13/13 |                      1 / 1 |

## Intermediate functional snapshots

Each cell is passed cases out of 30, evaluated against the policy current at that stage. Partial implementations are expected in early stages; these cells are observations, not failures to complete a stage. The two parallel workers are scored independently in their worktrees, so each can lack the other worker's exports. Integration is evaluated before the final change request; finalRevision and audit use the final policy.

| Pair / arm | Seed | Revision | Detour | Interrupted | Worker A | Worker B | Integration | Final revision | Audit |
| ---------- | ---: | -------: | -----: | ----------: | -------: | -------: | ----------: | -------------: | ----: |
| 1 without  |    4 |        9 |     11 |          16 |       23 |       23 |          30 |             30 |    30 |
| 1 with     |    4 |        9 |     11 |          16 |       23 |       23 |          30 |             30 |    30 |
| 2 without  |    4 |        9 |     11 |          16 |       23 |       23 |          30 |             30 |    30 |
| 2 with     |    4 |        9 |     11 |          16 |       23 |       23 |          30 |             30 |    30 |
| 3 without  |    4 |        9 |     11 |          16 |       23 |       23 |          30 |             30 |    30 |
| 3 with     |    4 |        9 |     11 |          16 |       23 |       23 |          30 |             30 |    30 |
| 4 without  |    4 |        9 |     11 |          16 |       23 |       23 |          30 |             30 |    30 |
| 4 with     |    4 |        9 |     11 |          16 |       23 |       23 |          30 |             30 |    30 |

Exploratory diagnostic: loss of previously passing policy-invariant cases on the mainline snapshots:

No pass-to-fail transitions were observed for the selected invariant cases. This does not establish absence of all regressions.

## Operational outcomes and secondary cost

| Measure                                                                   | Without DIP | With DIP |
| ------------------------------------------------------------------------- | ----------: | -------: |
| Scheduled turns                                                           |          36 |       36 |
| Completed turns                                                           |          32 |       32 |
| Intentional interruption triggers                                         |           4 |        4 |
| Unexpected timeout turns                                                  |           0 |        0 |
| Turns reporting usage                                                     |          32 |       32 |
| Median sum of per-project turn durations, seconds                         |      1035.8 |   1859.8 |
| Reported input tokens                                                     |     5592412 |  9977526 |
| Reported cached input tokens                                              |     4563712 |  8642176 |
| Reported output tokens                                                    |      133438 |   204686 |
| Completed DIP MCP calls                                                   |           0 |      571 |
| Unique captured coordination-denial records                               |           0 |        7 |
| Claim replies denying an already-owned task/scope, exploratory diagnostic |           0 |       10 |

Intentional interruption can prevent turn.completed and its usage report. Reported token totals therefore exclude missing interrupted-turn usage, not zero-cost interrupted work. Summed turn duration includes simultaneous worker time twice and is work exposure, not elapsed project completion time. MCP calls and CLI item counts are not model-request counts. Captured coordination-denial records cover hook events; explicit MCP claim rejections can appear only in tool replies and are counted separately as an exploratory diagnostic. A denial is an observed event, not by itself proof of an avoided collision or better final code. File-scope ownership across isolated worktrees does not update the waiting worker's branch base or automatically resolve a later Git merge. Merge paths are Git conflict paths, not automatically lost work or duplicated effort.

## Exceptions and observed limitations

All non-interrupted turns completed successfully; no final functional/recovery miss or audit mutation was observed.

## Supplementary exploratory contract stress

This supplement was specified after the primary run began and pair 1 primary outcomes were known, before inspecting participant implementation source or evaluating any stress outcome. It is outside the original preregistered primary endpoint. Version 2 added separate Node.js subprocesses before participant stress evaluation, preventing global/prototype state contamination between projects; the original version 1 protocol is retained. No participant received feedback or code repair.

Each final project received 256 identical seeded input scenarios, checking nine exports and input immutability. Inputs include bounded monetary values, fractional coupons, invalid/duplicate lines, Unicode and punctuation, own stock keys named `constructor` and `__proto__`, absent inventory keys, CSV escaping and return-date boundaries. The oracle passed 132 independent primary/dictionary checks; 9216 oracle-equivalence checks and 36 deliberately broken-module checks exercised the evaluator.

| Supplementary check                 | Without DIP |  With DIP |
| ----------------------------------- | ----------: | --------: |
| normalizeCart                       |   1024/1024 | 1024/1024 |
| priceOrder                          |   1024/1024 | 1024/1024 |
| buildReceipt                        |   1024/1024 | 1024/1024 |
| renderCSV                           |   1024/1024 | 1024/1024 |
| formatSummary                       |   1024/1024 | 1024/1024 |
| reserveInventory                    |   1024/1024 | 1024/1024 |
| canReturn                           |   1024/1024 | 1024/1024 |
| fulfillOrder                        |   1024/1024 | 1024/1024 |
| returnOrder                         |   1024/1024 | 1024/1024 |
| All stress checks                   |   9216/9216 | 9216/9216 |
| Projects passing every stress check |         4/4 |       4/4 |

Every supplementary check passed in both arms.

These cases are clustered within four project pairs and reuse one domain and oracle, not thousands of independent trials or a general code-quality score. [Supplement protocol](2026-10-06-longitudinal-stress-protocol.json), [all flags and failure examples](2026-10-06-longitudinal-stress.json). Replay without model calls: node scripts/longitudinal-stress-evidence.mjs.

## Fixed method and reproducibility

- Model: gpt-6.1-sol; reasoning effort: high; CLI: codex-cli 0.160.0; DIP: 0.3.4; platform: win32.
- The [protocol, prompts, fixture files and source hashes](2026-10-06-longitudinal-protocol.json) were published in commit f1bd593 before scored execution. Collection started 2026-10-06T15:11:34.037Z and completed 2026-10-06T16:59:47.464Z.
- Four policy variants of one order-processing project were paired. Arm launch order and merge order alternated by pair. Arms ran concurrently on the same host; each arm's two workers ran concurrently in separate standard Git worktrees forked from the same checkpoint.
- The baseline was allowed ordinary Markdown plans, decisions and handoffs. Both arms received the same task prompts and repository-memory rules. No resumed chat context was available.
- Treatment used generated DIP instructions, real Codex hooks and reviewed approved MCP tools in private per-arm config/runtime. No resident DIP recorder was running. Local shared-runtime coordination spans worktrees; distributed clones were not tested.
- Only generated reviewed fixture hooks used hook-trust bypass. Ordinary-user shell execution was identical in both arms. Directory/config boundaries were instructions, not an OS security sandbox. Authentication copies were private and removed; no credentials are in public evidence.
- The receipt worker was forcibly terminated 2000ms after its first observed receipt.mjs content mutation, polled every 100ms, with a 180-second no-mutation cap. Other turns had a fixed 360-second cap. Partial files were retained. The same event-based interruption rule can leave different amounts of work in different arms.
- The harness made fixture-only Git checkpoints. Both workers forked the same checkpoint; their commits were made after both turns ended, and the harness then attempted actual merges. Workers were not offered continuous integration of the other branch while working. The integrator saw factual branch/conflict state, not evaluator feedback, and could resolve/commit/merge remaining work. Both workers deliberately modify pipeline.mjs, so this is an induced overlap test, not an estimate of normal conflict frequency.
- Thirty fixed external cases cover normalization, monetary calculation, CSV, stock atomicity, return boundaries and cross-module integration. Thirteen exact report checks cover the current ten policy fields, two future features and one cancellation. All-case project success is the primary unit; 120 final cases per arm are clustered, not 120 independent experiments.
- A false release-ready claim means releaseReady=true with at least one failed external case. Unsupported export claims use component test groups: one failed receipt/pipeline component case can flag both exports in that component. This is a conservative diagnostic, not a semantic proof about each individual export.
- Fixture calibration passed 360 reference checks and caught 60 deliberate mutations. [Infrastructure preflight](2026-10-06-longitudinal-preflight.json) confirmed shell writes, DIP plan persistence and actual worktree merge conflicts. Preflight turns are excluded.
- Replay public snapshots without model calls: node scripts/longitudinal-evidence.mjs. Calibrate the scorer: node scripts/longitudinal-calibrate.mjs. The complete [raw data](2026-10-06-longitudinal.json) retain every scheduled stage, artifact, score, answer, usage report and captured task metadata. Full raw CLI transcripts remain local.

## Interpretation boundaries

This is a longer and harsher accelerated synthetic lifecycle than the [earlier two-session pilot](model-controlled.md), but it is not a multi-day real-project field trial. It repeats one domain four times. Backend model weights, network load and random seeds were not pinned; concurrent arms share host/API capacity. Functional checks do not measure readability, architecture, security, maintainability or arbitrary requirements. We did not independently score all duplicate tasks, duplicated effort, future-feature implementation or stale task semantics. Missing fields in the fixed JSON report are exact-recovery misses, not proof that the information was absent everywhere in the repository. No statistical significance or general quality/productivity improvement is claimed.
