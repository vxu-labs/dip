# Automatic workflow (pilot)

Automatic keeps persistent intent and coordination while removing routine model bookkeeping. It is opt-in; `reviewed` remains the default until the acceptance gate passes. No additional model runs for logging or classification.

The first native model comparison did not pass the rollout gate. Candidate .1 contains guidance fixes following the .0 experiment; its model behavior is not yet remeasured. See the [acceptance report](benchmarks/automatic-workflow-report.md). The machine remains on reviewed 0.3.12.

## Contract

- Trusted prompt hooks save every request verbatim under the existing capture/redaction policy. Initially it is a `discussion` with additive `requestState: captured`, displayed in the captured-request inbox rather than the development backlog. No heuristic decides semantic task identity or completion.
- Before a supported write (or unknown command on the conservative path), the hook reads the current task once, atomically claims its scope, and promotes the request to `work`. Known reads and native planning do not promote or claim it. A failure to claim denies the write in coordinate/strict mode; observe retains its existing semantics.
- A development turn ends with one `task_finish`: `implemented`, summary, `remaining: []` or explicit exceptions, and a configured check. The hook's exact actor/session resolves its existing unexpired ownership token. It cannot borrow another actor's task or revive an expired lease.
- Unfinished work uses `task_finish` with `outcome: paused`, summary and nonempty remaining items. It stays `in_progress`; the explicit checkpoint preserves the remaining review even after automatic Stop checkpoints. Paused cannot verify or supersede work.
- For `paused`, omit `check` and `replacedBy`. For `implemented`, finish runs the configured check itself; a preliminary `task_verify` is not required. In remaining items, only `follow_up` accepts/requires `taskId`; other dispositions omit it.
- Stop saves a checkpoint and releases ownership. Neither final-answer text, plan progress nor a partial passing check proves completion. Failed finish verification retains ownership. Outstanding plan steps and required remaining work block completion.
- Adoption of an existing requirement, material scope changes, distinct future work and conflicts remain explicit. No automatic duplicate merging. Future ideas are work in backlog, never a claim merely because a model read a file.
- A continuation must explicitly `task_adopt` the captured request into the reviewed original requirement before development, then finish that original requirement. Finishing the new request alone leaves the original open. Strict-mode exceptional adoption requires explicit ownership tokens for both tasks.

## Context and hot path

Automatic startup JSON has a 4,096-byte UTF-8 budget: current work, remaining work, blockers and relevant owners take priority. Completed summaries are excluded. Routine mutation receipts have a 1,024-byte budget; identifiers, verification result and fencing tokens survive compaction. `truncated` and detail-tool hints indicate omitted information. Full ledger data is unchanged.

`openProject` validates metadata without rewriting integrations on routine hooks/actions. Explicit init/install/repository operations perform setup; missing project metadata bootstraps once. Runtime schema migration is versioned. One pre-write task read supplies the lease descriptor and promotion update. Single known shell reads (`rg`, selected `git status`/`ls-files`/`rev-parse`, literal `Get-Content`, `cat`, `head`, `tail`, `ls`, `pwd`) bypass claims only for conservative syntax and options. Expansion, compounds, executors and unknown flags remain on the coordinated path. This is classification, not a shell security boundary.

Post-tool recording retains the existing durable SQLite outbox and recorder recovery. Native plan updates and pre-write coordination stay synchronous. Exact verification can be reused only when the named command, scoped code snapshot and requirement/document fingerprint are current. Empty remaining reviews normalize absent versus empty lists; older evidence with a different hash is conservatively rechecked.

## Use and rollback

```sh
# Isolated project pilot
node /path/to/candidate/bin/dip.js init --root /path/to/pilot --workflow automatic
# Explicit project rollback (history remains)
node /path/to/candidate/bin/dip.js init --root /path/to/pilot --workflow reviewed
# Only after the gate: install/upgrade managed machine integrations
node /path/to/candidate/bin/dip.js install --workflow automatic --roots /path/to/projects
# Roll back workflow using the same installed version
node /path/to/candidate/bin/dip.js install --workflow reviewed --roots /path/to/projects
```

Project config overrides machine workflow; `DIP_WORKFLOW` is an explicit process override for isolated experiments. Clear an automatic process override when rolling back. Ownership mode is independent and unchanged.

Before a machine upgrade, retain the exact prior package, install state and agent/Git configurations in a private local backup, with file modes preserved. Restore the prior package and its original integrations if binary rollback is necessary. Never publish backups containing host settings or credentials. Keep `.dip` history and the durable queue. Old readers understand discussion/work, checkpoints and all existing event kinds; requestState is additive. The paused outcome is recorded as an ordinary checkpoint, not a new resolution enum. Reviewed remains readable after rollback.

User-edited managed instructions and skills are preserved. Installation reports preserved instruction files; review these manually if they still request old routine bookkeeping. Unknown legacy blocks are preserved conservatively. Installation never establishes hook trust: review changed definitions through the host's normal UI.

## Acceptance and bounded model pilot

Run `npm test`, `npm run check`, `npm run test:package`, and the automatic benchmark. New tests cover questions, automatic promotion, future work, pauses, failing/stale verification, conflicts, native plans, receipt limits, hot-path setup and instruction preservation. Existing regression tests cover recorder crash/outbox recovery, concurrency and portable history.

`scripts/automatic-benchmark.mjs` measures the installed frozen baseline and candidate on identical fixture copies, including a task with 1,001 events. It snapshots real project intent for context comparisons, omitting activity files because startup excludes activity. It reports all samples as distributions; context reductions do not imply equal reductions in wall time.

`scripts/automatic-model-pilot.mjs --prepare` prepares three scenarios, two arms and two fresh conversations per scenario (12 turns, 240 seconds per turn). It inherits the configured model and effort, fixes arm order and source/fixture fingerprints, and retains every failure. Each scenario includes changed requirements, partial work and a later recovery turn. The existing Codex login is referenced locally, never placed in results. Native hooks must be reviewed by the human in the isolated profile's `/hooks` UI. `--run` refuses to start until review exists; no hook-trust bypass or host approval change is used. It refuses scored retries.

Global rollout requires correctness and requirement recovery without regression, >=70% fewer routine management calls, >=60% less injected management data, and the target >=20% lower median comparison time, plus an isolated pilot and one real workflow. Report exceptional intent operations separately from routine calls, and report all calls too. Missing native-hook evidence or a failed gate prevents global rollout. A small 12-turn sample is exploratory, not a general performance guarantee. Dan's proposed accessibility changes are outside this work.
