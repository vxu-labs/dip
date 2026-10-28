# Automatic workflow: implementation and acceptance report

The candidate is **0.3.13-automatic.0**, branch `codex/automatic-workflow`, based on upstream `3f2aebc9611bf98ee76ecadb1f8697baca02bd77`. The code and isolated regression checks are complete. **Global rollout has not been authorized by the acceptance gate:** the native 12-turn model experiment and real-workflow pilot are pending human review of the isolated hook definitions. No model turns have started. The existing machine installation remains 0.3.12/reviewed.

## Exact baseline

The original local clone and globally installed package both report 0.3.12 but have different source fingerprints. The comparison uses a frozen copy of the **installed** package, not a version-number assumption. [File-level source manifest](2026-10-28-source-manifest.json), [frozen model protocol](2026-10-28-model-protocol.json), and [runtime samples](2026-10-28-automatic-runtime.json) record the exact inputs. Runtime and model candidate fingerprints match.

## Delivered behavior

Automatic requests enter a separate inbox. Supported writes acquire ownership and promote the request without model management calls; known reads do not. Development ends with one finish call, including an explicit paused outcome that keeps remaining work open. Native plans remain automatically captured. Startup context is bounded to 4 KB; routine mutation receipts to 1 KB. Edited instructions are preserved. Setup is removed from routine hooks, task reads are shared with claims, and exact current verification can be reused. The durable outbox and recorder supervision remain in place. No extra tracking model and no Dan accessibility changes.

## Validation

- Final full suite: **165 tests, 163 passed, 0 failed, 2 platform skips**, 51.66 seconds. Includes conflict/ownership fencing, automatic requests, native plans, pause/Stop, partial and failed checks, stale evidence, source preservation, runtime migration, recorder kill/restart and durable outbox recovery.
- Fifteen focused automatic tests pass, including CLI receipt serialization and explicit workflow rollback preserving strict ownership mode.
- JavaScript syntax check passes. Clean npm tarball install/discovery/configuration, portable documents, CLI and uninstall smoke passes.
- Dashboard browser smoke passes in an isolated Chrome profile, including the captured-request filter, cross-worktree navigation and mobile layout. Initial default-browser attempt could not launch because the Playwright browser download was absent; the existing Chrome binary was used. No product issue was hidden by that infrastructure retry.
- The frozen **old 0.3.12 reader** successfully reads candidate-generated paused history, including required remaining work after Stop. Its output does not expose the new inbox marker, as expected. [Compatibility receipt](2026-10-28-legacy-read.json).
- Early full-suite execution found a Get-Content regression; it was fixed and both focused and full suites rerun. A separate initial sandboxed dashboard test could not bind localhost; the complete suite ran with approved localhost access. Neither failure was counted as a passing run.

## Runtime measurements

Same disposable data in both arms: 106 tasks, one with 1,001 events. Warm timings use 30 samples; new-process timings 15; contention 5. Values are **median / p95 milliseconds**. Raw samples and ranges are in the JSON.

| Measurement | Installed reviewed | Candidate automatic |
|---|---:|---:|
| Post-tool hook, warm | 2.13 / 3.68 | 1.50 / 1.83 |
| Pre-write hook, 1,001-event task | 44.04 / 97.69 | 19.83 / 24.15 |
| Post-tool hook, new process | 51.29 / 67.29 | 37.80 / 38.62 |
| Runtime open + register | 0.73 / 1.06 | 0.61 / 0.72 |
| Read a task with deep history | 21.89 / 26.65 | 18.98 / 22.70 |
| Runtime open/register with a 100 ms competing lock | 81.32 / 112.18 | 102.94 / 110.84 |

The pre-write improvement comes primarily from eliminating a second reduction of the same task history. Reading the ledger itself still scales with history depth; it has not been replaced by a cache. Contention still waits on SQLite and is not eliminated. Cold-process results varied during engineering runs; do not interpret one favorable sample as a general model-speed improvement. Earlier corrected engineering measurements included approximately 39.63→42.24 ms and 50.73→53.45 ms cold-process medians. These are retained in the engineering log; the frozen comparison above was selected by final source state, not the best timing.

Real-project intent was copied once into isolated snapshots and read by both versions; automatic activity was excluded because startup context already excludes it. No active-worker information was supplied, matching the original diagnostic. DIP context falls **10,906→1,799 bytes (83.5%)**. PoCut falls **19,127→2,682 bytes (86.0%)**. Full completed summaries remain in the ledger. These exceed the 60% context-size target for the measured datasets; they do not establish the total injected-byte target across actual model runs.

## Model experiment and release gate

The approved budget is exactly 12 turns: three scenarios × two versions × seed/recovery, each at most 240 seconds. Both arms inherit the configured model and effort, use the same fixtures/scoring, and run in counterbalanced order. Sources and prompts are frozen. Every turn, timeout, native hook receipt, ledger snapshot, functional/memory score and tool count is retained. Scoring is separately bounded. No scored retry or extra tracking model is allowed.

The native preflight correctly refuses to start without reviewed hook trust. The pilot has its own CODEX_HOME, runtime and repositories. It references the existing login locally; credentials and private rollback snapshots are excluded from Git and package artifacts. Host approval/trust settings were not changed. Human review is required by [Codex's hook trust flow](https://learn.chatgpt.com/docs/hooks#review-and-trust-hooks) and the project's instruction not to bypass hook trust.

Run `/private/tmp/dip-automatic-pilot-20261028/review-hooks.sh` in Terminal, review the DIP hooks in `/hooks`, and exit using `/quit`. After that, the prepared experiment is run from this checkout with `node scripts/automatic-model-pilot.mjs --run`. Keep the prepared protocol and all results; do not overwrite a started experiment.

**Gate status:** correctness/regressions passed in local tests; >=60% smaller measured startup context passed. >=70% fewer routine management calls, total injected bytes, >=20% lower median model wall time, model requirement recovery, and one real native workflow remain **unmeasured**. Global deployment remains off until these are evaluated. A failure to preserve information or coordination blocks deployment. Report all calls as well as the routine/exceptional split; do not exclude failed turns. The small sample cannot support general performance claims.

## Rollback

The private `.dip-local/rollback-20261028` directory contains the complete prior installed package (including dependencies), six relevant host configuration snapshots and a SHA-256 manifest. It is intentionally ignored by Git and excluded from npm packaging. The quickest supported reversal is the same candidate in `reviewed` mode, per project or machine. Binary restoration must compare current host settings with the saved hashes so intervening user edits are preserved. Never delete `.dip` events or the durable queue. [Configuration, workflow contract and restoration commands](../automatic-workflow.md).
