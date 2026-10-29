# Automatic workflow: implementation and acceptance report

**2026-10-29 integration update:** the owner authorized merging the validated progress and deferring the remaining payload target. Candidate `0.3.13-automatic.2` combines this work with dashboard PR #5. The measurements below remain historical evidence for .1; the failed 60% target is not reclassified, and no new model runs were started. See [merge decision](2026-10-29-merge-decision.json).

The latest measured candidate is **0.3.13-automatic.1**. The separately authorized second round completed **12/12 turns** with no infrastructure failures or retries. Routine calls fell **81.0%** and median wall time fell **20.5%**; all functional, recovery-memory and original-task tracking checks passed. Measured administrative payload fell only **33.9%**, below the required 60%. **Global rollout remains blocked and the machine stays on 0.3.12/reviewed.** The real native workflow pilot remains pending. See the [round-two report](2026-10-28-round2-report.md), [results](2026-10-28-round2-summary.json) and [current acceptance decision](2026-10-28-acceptance.json).

The .1 full suite passes **170 tests: 168 passed, 2 platform skips**. Both authorized twelve-turn budgets are exhausted (24 starts total). The historical .0 measurements below are retained separately and must not be attributed to .1. Product sources stayed frozen throughout each round.

## Exact baseline

The original local clone and globally installed package both report 0.3.12 but have different source fingerprints. The comparison uses a frozen copy of the **installed** package, not a version-number assumption. [File-level source manifest](2026-10-28-source-manifest.json), [frozen model protocol](2026-10-28-model-protocol.json), and [runtime samples](2026-10-28-automatic-runtime.json) record the exact inputs. Runtime and model candidate fingerprints match.

## Delivered behavior

Automatic requests enter a separate inbox. Supported writes acquire ownership and promote the request without model management calls; known reads do not. Development ends with one finish call, including an explicit paused outcome that keeps remaining work open. Native plans remain automatically captured. Startup context is bounded to 4 KB; routine mutation receipts to 1 KB. Edited instructions are preserved. Setup is removed from routine hooks, task reads are shared with claims, and exact current verification can be reused. The durable outbox and recorder supervision remain in place. No extra tracking model and no Dan accessibility changes.

## Validation

- Measured .0 full suite: **166 tests, 164 passed, 0 failed, 2 platform skips**, 51.00 seconds. Includes conflict/ownership fencing, automatic requests, native plans, pause/Stop, partial and failed checks, stale evidence, source preservation, runtime migration, recorder kill/restart and durable outbox recovery.
- Post-pilot .1 full suite: **170 tests, 168 passed, 0 failed, 2 platform skips**, 53.40 seconds; focused suite 29/29. Syntax and clean-package install/configuration/discovery/uninstall smoke pass. Added environment/CLI routing, atomic invalid-pause and explicit continuation tests. The new strict continuation test initially omitted required adoption ownership tokens; it was corrected to exercise the existing strict contract and rerun. [Measured .1 source fingerprint](2026-10-28-post-pilot-candidate.json).
- Sixteen focused automatic tests pass, including CLI receipt serialization and explicit workflow rollback preserving strict ownership mode.
- JavaScript syntax check passes. Clean npm tarball install/discovery/configuration, portable documents, CLI and uninstall smoke passes.
- Dashboard browser smoke passes in an isolated Chrome profile, including the captured-request filter, cross-worktree navigation and mobile layout. Initial default-browser attempt could not launch because the Playwright browser download was absent; the existing Chrome binary was used. No product issue was hidden by that infrastructure retry. A subsequent boundary check added explicit coverage for a single large multilingual task and oversized actor metadata; both budgets hold without trimming fencing tokens.
- The frozen **old 0.3.12 reader** successfully reads candidate-generated paused history, including required remaining work after Stop. Its output does not expose the new inbox marker, as expected. [Compatibility receipt](2026-10-28-legacy-read.json).
- Early full-suite execution found a Get-Content regression; it was fixed and both focused and full suites rerun. A separate initial sandboxed dashboard test could not bind localhost; the complete suite ran with approved localhost access. Neither failure was counted as a passing run.

## Historical .0 runtime measurements

Same disposable data in both arms: 106 tasks, one with 1,001 events. Warm timings use 30 samples; new-process timings 15; contention 5. Values are **median / p95 milliseconds**. Raw samples and ranges are in the JSON.

| Measurement | Installed reviewed | Candidate automatic |
|---|---:|---:|
| Post-tool hook, warm | 1.80 / 2.27 | 1.49 / 2.75 |
| Pre-write hook, 1,001-event task | 37.59 / 44.12 | 19.38 / 31.93 |
| Post-tool hook, new process | 39.87 / 41.31 | 38.47 / 41.57 |
| Runtime open + register | 0.64 / 0.77 | 0.61 / 0.74 |
| Read a task with deep history | 18.80 / 21.99 | 18.79 / 29.36 |
| Runtime open/register with a 100 ms competing lock | 80.89 / 111.21 | 109.96 / 111.10 |

The pre-write improvement comes primarily from eliminating a second reduction of the same task history. Reading the ledger itself still scales with history depth; it has not been replaced by a cache. Contention still waits on SQLite and is not eliminated. Cold-process results varied during engineering runs; do not interpret one favorable sample as a general model-speed improvement. Earlier corrected engineering measurements included approximately 39.63→42.24 ms and 50.73→53.45 ms cold-process medians. These are retained in the engineering log; the frozen comparison above was selected by final source state, not the best timing.

Real-project intent was copied once into isolated snapshots and read by both versions; automatic activity was excluded because startup context already excludes it. No active-worker information was supplied, matching the original diagnostic. DIP context falls **10,906→1,798 bytes (83.5%)**. PoCut falls **17,265→2,681 bytes (84.5%)**. Full completed summaries remain in the ledger. These exceed the 60% context-size target for the measured datasets; they do not establish the total injected-byte target across actual model runs.

## Historical first model experiment and release gate

The first approved budget was exactly 12 turns: three scenarios × two versions × seed/recovery, each at most 240 seconds. Both arms inherit the configured model and effort, use the same fixtures/scoring, and run in counterbalanced order. Sources and prompts are frozen. Every turn, timeout, native hook receipt, ledger snapshot, functional/memory score and tool count is retained. Scoring is separately bounded. No scored retry or extra tracking model is allowed.

The human approved all eight hook definitions in the isolated profile. The pilot has its own CODEX_HOME, runtime and repositories. It references the existing login locally; credentials and private rollback snapshots are excluded from Git and package artifacts. Host approval/trust settings were not changed. Review follows [Codex's hook trust flow](https://learn.chatgpt.com/docs/hooks#review-and-trust-hooks).

The initial MCP router omitted explicit environment forwarding; the first reviewed turn used the global CLI and the second was interrupted when this was discovered. Both are retained as infrastructure-affected failures. A documented amendment repaired MCP routing and frozen CLI fallback before running only the ten unstarted turns. No turn was retried and product sources/prompts/model/order stayed frozen. See the [incident record](2026-10-28-native-pilot-incident.md), [per-turn analysis](2026-10-28-native-model-summary.json) and [retained raw records](2026-10-28-native-model-raw.tar.gz). The raw archive contains only synthetic trial outputs, ledgers and protocols; no login or private configuration snapshots.

| Recorded metric, including failed attempts | Reviewed | Automatic .0 |
|---|---:|---:|
| Started / completed turns | 6 / 5 | 6 / 6 |
| All DIP calls, including CLI help | 55 | 21 |
| Routine mutation calls | 30 | 14 |
| Explicit intent calls (create/adopt) | 5 | 3 |
| Read calls / CLI help calls | 8 / 12 | 4 / 0 |
| Failed management calls | 4 | 5 |
| Measured management payload bytes | 121,764 | 62,691 |
| Hook context bytes | 10,409 | 12,110 |
| Median recorded wall time | 65.912 s (5 durations) | 61.647 s (6 durations) |
| Recorded wall-time range | 62.609–79.317 s | 36.499–86.567 s |

All-call reduction is 61.8%; routine-mutation reduction is **53.3%, below 70%**. The payload proxy falls **48.5%, below 60%**. It includes hook context, MCP replies, CLI output and whole instruction-read command output, including any mixed non-management output. It excludes initial host framing and tool schemas, so total injected model bytes remain unestablished. Startup savings on deep real-project histories above do not predict hook savings in these small fixtures. CLI counts are audited lexical invocations; help is separated from mutations. Explicit intent means create/adopt, and reads are reported separately. Initial intent preparation, plan/checkpoint/verification and finish attempts count as routine mutations.

The overall recorded medians differ by 6.5%, but one reviewed duration is missing and another is infrastructure-affected: this is not a valid complete paired timing estimate. For transparency, the two fully run pairs (CSV/search) have four durations per arm: medians 70.470→53.324 s (24.3% lower), routine mutations 24→9 (62.5% fewer), and payload 63,246→38,855 bytes (38.6% fewer). This subset does not repair the failed full protocol or establish a general speedup. Wall time includes bounded post-turn scoring and ledger reads; the machine also performed ordinary inspection and brief focused tests during collection, without dedicated CPU isolation.

All 66 functional checks on the eleven completed turns passed. All 30 evaluated recovery-memory checks passed; the interrupted reviewed recovery is unscored. No completed seed incorrectly marked partial work verified, and future ideas stayed deferred. However, **all three automatic recoveries finished the new captured request without explicit adoption**, leaving the original development task in progress. The completed reviewed recoveries correctly adopted the original requirement. This is a tracking regression and blocks rollout despite correct code and retained requirements.

Automatic .0 also made three preliminary `task_verify` calls and five rejected finish attempts: paused work passed `check`, or a non-follow_up remaining item passed `taskId`. .1 now explicitly says implemented finish runs its own check, paused omits check/replacedBy, taskId belongs only to follow_up, and existing work must be explicitly adopted before development. Deterministic tests verify invalid pauses preserve evidence/ownership and an explicitly adopted continuation completes the original task; they do not prove model adherence to the revised guidance. Strict-mode exceptional adoption still requires its explicit ownership tokens.

**First-round gate status: failed; no global deployment.** Code tests and observed requirement recovery pass, but routine-call and payload targets are unmet, original-task tracking regresses, and the full paired timing protocol is incomplete. The subsequently authorized .1 comparison is reported above; it fixes tracking and passes the routine-call target, but payload still prevents rollout. One real native workflow also remains required. The original experiment cannot be rerun or resumed: all twelve starts are retained and consumed.

## Rollback

The private `.dip-local/rollback-20261028` directory contains the complete prior installed package (including dependencies), six relevant host configuration snapshots and a SHA-256 manifest. It is intentionally ignored by Git and excluded from npm packaging. The quickest supported reversal is the same candidate in `reviewed` mode, per project or machine. Binary restoration must compare current host settings with the saved hashes so intervening user edits are preserved. Never delete `.dip` events or the durable queue. [Configuration, workflow contract and restoration commands](../automatic-workflow.md).
