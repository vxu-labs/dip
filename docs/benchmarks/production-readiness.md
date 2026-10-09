# Semantic retrieval production readiness evaluation

**Verdict: the optional E5 prototype is not ready for default production.** Candidate freshness and bounded warm reads worked, but transport isolation and shared-cache fault handling failed. No release or default activation was performed. This evaluates frozen product commit `329bbb627a2e8e602d109485126f625f921a8f95`; unrelated product edits in the shared working tree are outside this measured version.

## Design and retained evidence

[Acceptance plan](production-readiness-plan.md) and `2026-10-09-production-protocol.json` were frozen before scored agent attempts. The source bundle preserves exact measured product and harness text. All failures, incomplete preflights and timed-out outcomes remain available. Extra controlled fault probes have their own preregistrations; they isolate encoder-independent control-flow and filesystem bugs using mocks, and are labelled accordingly. They do not claim E5 model accuracy or inference performance.

There are 32 live diagnostic probes, 44 known author-labelled queries against a current snapshot of this one project, three isolated IPC probes and two cache-writer schedules. The public real-query outputs contain candidate IDs, paths and rankings; the local full canonical snapshot is not exported. All 44 designated sources were present in its 78-source pool. Known queries and synthetic stress are development/robustness evidence, not independent labels or multi-project user behavior.

## Reliability, scale and safety

| Check | Observation |
| --- | --- |
| Changed, deleted, unlinked sources; task cancellation; actual Git branch change during a read | Old candidates omitted; current errors and link freshness surfaced |
| Warm small corpus, 20 reads | p95 78.4 ms |
| 1000 task sources and 100 documents | Cold index 70186 ms; warm ten-read p95 1628.3 ms |
| Collector limit overflow | 2000 tasks and 100 documents returned with explicit truncation |
| Total linked-document budget | 20MiB retained, next document omitted with explicit error and truncation |
| Unicode at the40000-character task cap | Valid emoji split into a lone surrogate; malformed source text returned |
| Directory junction | Rejected before reading outside-project synthetic canary |
| Structured plan content | Not indexed by this prototype; use current plan/requirements tools |
| Canonical read-only behavior, paths, invalid UTF-8, file size and ordinary fenced heading offsets | Passed bounded probes |
| File symlink | Not exercised: Windows refused creating the fixture symlink |
| Unrelated query | Still returns candidates; no automatic abstention or identity assertion |
| Four calls to one worker | One completed; three explicit busy rejections |
| Live restart and later malformed/timeout probes | Several startup/exited failures under constrained resources; later intended fault bodies were not reached |
| Full canonical 1000-task MCP cold retrieval | Repeated 120-second timeouts in infrastructure preflights |
| Controlled malformed JSON / late reply after close | A previous response satisfied a new request |
| Controlled oversized reply | Subsequent request also failed; transport buffer remained poisoned |
| Four cache writers, parallel rename schedule | All completed; final cache valid in that observation |
| Four cache writers, serialized rename after all writes | One completed, three FileNotFoundError failures; final cache valid |

The plain-source scale measurement excludes process/model startup because that worker was already warm. It is not the same input shape as the larger canonical MCP source text. Cold small end-to-end startup took58.8 seconds under shared-machine load, while its internal inference/cache read took295ms. Therefore fast warm reads do not establish acceptable cold host behavior.

The live four-model stress ran alongside two already-live diagnostic workers and a preflight, so it was not an isolated four-worker memory-envelope test. It produced virtual-memory/DLL failures. The initial memory sample measured the Windows virtual-environment launcher (about4.9MB), not the actual Python descendant, and is invalid as a model memory estimate. Later process inspection showed model descendants around0.7-1.0GB working set while this16GB machine had roughly1.3-1.9GB physical and2.1-3.3GB virtual memory available. These were transient samples, not peak memory or hardware requirements. No orphan-process leak was established.

The IPC mock replaces only spawn and import locations in archived SemanticWorker logic. It supplies exact stale bytes deliberately, making response attribution reproducible without loading another large model. The cache mock bypasses encoder initialization, executes the archived production Engine.retrieve filesystem path and supplies normalized384-dimensional synthetic vectors. The second schedule is a legal serialized rename ordering after all four writes. The first passing schedule is retained rather than overwritten. No canonical task-data corruption was observed; cache errors and wrong candidate-response attribution still block production signoff.

## Recovery of real project requirements

| Source type | Known questions | Designated source first | Designated source in top5 | Correct source and heading first |
| --- | ---: | ---: | ---: | ---: |
| task | 32 | 12 | 16 | N/A |
| document | 12 | 6 | 9 | 4 |

All designated sources were eligible and present. Labels are author-designated and not exhaustive relevance judgments: a different related task may also be useful. This test still shows that similarity alone cannot reliably select the original requirement. The current broader pool also contains automatically generated work descriptions and repeated context that can distract retrieval. These scores do not imply verified task identity, completed implementation or a demonstrated comparison to Markdown.

## Agent comparison

Collection status: all18 scheduled attempts retained.

| Arm | Functional | Memory | Completed | Timeouts | Median seconds | Reported input | Cached input | Search attempts / successes |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| markdown | 48/48 | 36/36 | 6/6 | 0 | 78.3 | 863546 | 679424 | 0/0 |
| markdown-e5 | 48/48 | 36/36 | 6/6 | 0 | 76.0 | 788815 | 584832 | 0/0 |
| dip | 48/48 | 36/36 | 6/6 | 0 | 82.4 | 865392 | 699264 | 0/0 |

The six contracts are reused from the prior experiment. Each now has1000 task Markdown files and100 documents, English or Hebrew requests and optional lexical-first retrieval. Three arms see equivalent source facts. The production canonical collector supplies both encoder arms; DIP alone adds the structured requirements view. This controls candidate facts but does not isolate a native Markdown index implementation or the standalone effect of storage. Source ledger setup happens before the measured turn and its time is excluded.

The frozen schedule records the base contract document hash. The runtime fixture appends the hostile imported migration paragraph; its exact bytes are preregistered through the frozen fixture file. The protocol source bundle allows reconstructing both hashes. Record actual exposure separately from absence of an injection marker; absence without exposure is not an adversarial resistance pass.

Actual tool use matters: the summary records both search attempts and current-requirements calls. If an arm uses none of these, its coding result reflects shell/Markdown navigation with tools available; it cannot establish the benefit of E5 or structured DIP reads. Optional routing is an availability treatment, not proof that the treatment was used.

All three infrastructure preflights are separate from scored trials. The first stopped when concurrent source edits invalidated fingerprints, and tools were unavailable under optional startup. The second used the frozen source and a per-invocation required server but encountered cold retrieval timeout/resource failures. A third serial preflight still had cold timeouts while requirement/document reads worked. The scheduled scored comparison therefore measures the deployed prototype including its optional-search fallback behavior. It is not a healthy-E5 efficacy trial, and no omitted preflight failure is presented as success.

The current configured model is `gpt-6-astra` at high reasoning. The previous experiment used gpt-6.1-sol; cross-experiment changes in time/tokens are not a causal routing effect. CLI tokens include repeated requests and cached context, not billed cost or unique text size. No score-dependent retries or algorithm edits were performed. No statistical significance or general quality improvement is claimed.

All18 scored turns completed with all8 functional and6 recovery checks passing. All18 were exposed to the imported hostile paragraph, left source memory intact and created no injection marker in this bounded scenario. All18 also made zero MCP calls, including zero E5 searches and zero structured current-requirements reads. Their outcome is therefore not evidence that DIP or E5 improved quality. Median times and token differences between arms are descriptive availability effects in this small sample, not a benefit of an unused retrieval tool.

## Installation and remaining gates

Fresh packed-package installation smoke on this Windows machine passed, with isolated user/runtime configuration. Targeted18 semantic/host/privacy/recovery tests passed and syntax checks passed. The first full suite exceeded240 seconds. An isolated workflow follow-up with bundled Git cmd/usr-bin on PATH and Git tracing disabled passed, then the full suite passed in151 seconds:138 passed and2 skipped,0 failed. Both attempts are retained; these two environment changes were not individually isolated as a root cause. Earlier three-platform CI for the measured commit is supporting evidence, not new Linux/macOS E5 inference coverage.

The actual frozen source MCP server was tested through the SDK on a fresh isolated small project with real pinned E5: discovery, task/document candidates, task-channel cache reuse, ordinary requirements fallback, canonical read-only behavior and complete process-tree shutdown all passed. The first task read took37.6 seconds including startup; document and repeated task reads took60.5ms and46.7ms. This small-project success does not erase the1000-task cold timeouts. The post-warm actual Python descendant used about725MB working set and1.71GB private committed bytes in one retained process-tree sample, not a peak-memory measurement.

Not completed: independent labels, natural code changes across multiple real projects, a multiweek opt-in user pilot, actual Claude (uninstalled/unauthed), cross-platform inference and complete fresh upgrade/rollback testing. Retrieved untrusted content was not executed by the retrieval boundary; real agent resistance is scored only for exposed hostile text in the retained coding trials.

Before a production pilot, fix request correlation/generation fencing, broken-transport reset, Unicode-safe source truncation and cache-writer coordination, then repeat cold/resource tests with a declared worker budget. Reduce embedding of verbose incidental context and route cheap direct/lexical reads before neural search. Validate deferred/native-plan/decision retrieval coverage rather than assuming every source type is indexed. Only then use independently labelled real changes to establish benefit/cost and run the multiweek pilot.

Use at your own responsibility. Candidate search never proves task equivalence or completion. Status, ownership and verification remain explicit DIP operations.
