# Controlled model-backed Codex pilot

Run date: 6 October 2026. DIP 0.3.4, codex-cli 0.160.0, v24.14.0, Windows. Six matched pairs used the same gpt-6.1-sol model ID and High reasoning. Each arm had a partial-development session and a fresh recovery session: 24 scored Codex turns in total.

Both arms passed the same number of complete functional suites. No functional-success advantage for DIP was observed in this pilot. DIP's total-workflow median was 2.20 times the baseline median. This run demonstrates added time cost rather than a speedup for these tasks. Both arms were explicitly told to preserve a durable handoff, and the baseline could use ordinary Markdown notes. The result tests DIP against a capable note-taking baseline.

## Results

| Measure                                          | Without DIP |  With DIP |
| ------------------------------------------------ | ----------: | --------: |
| Complete functional suites                       |         6/6 |       6/6 |
| Held-out functional cases                        |       48/48 |     48/48 |
| Exact recovered contract fields                  |       24/24 |     24/24 |
| Deferred feature identifier retained             |         6/6 |       6/6 |
| Complete function list and empty unresolved list |         5/6 |       5/6 |
| Turns with reported completion                   |       12/12 |     12/12 |
| Seed plus recovery time, median                  |    164.19 s |  360.84 s |
| Recovery time, median                            |     89.06 s |  198.48 s |
| Reported input tokens, all completed turns       |   1,056,828 | 2,124,368 |
| Of those, cached input tokens                    |     826,624 | 1,782,784 |
| Input less cached input                          |     230,204 |   341,584 |
| Reported output tokens                           |      32,170 |    67,732 |
| MCP tool calls                                   |           0 |       134 |

The median within-pair added total time was 190.68 seconds. This differs from subtracting the two arm medians. Token usage was available for 12/12 baseline turns and 12/12 DIP turns. Missing usage is unknown, not zero. These are the CLI's reported usage fields, not invoice amounts or measured model-request counts. Cached input and output have different cost characteristics.

| Pair                 | Execution order   | Without DIP, total seconds | With DIP, total seconds | Without DIP code | With DIP code |
| -------------------- | ----------------- | -------------------------: | ----------------------: | ---------------: | ------------: |
| 1: queue, variant 1  | without then with |                     228.34 |                  464.71 |              8/8 |           8/8 |
| 2: csv, variant 1    | with then without |                     171.82 |                  379.69 |              8/8 |           8/8 |
| 3: search, variant 1 | without then with |                     156.56 |                  365.25 |              8/8 |           8/8 |
| 4: queue, variant 2  | with then without |                     213.86 |                  356.44 |              8/8 |           8/8 |
| 5: csv, variant 2    | without then with |                     149.54 |                  258.47 |              8/8 |           8/8 |
| 6: search, variant 2 | with then without |                     139.06 |                  312.56 |              8/8 |           8/8 |

## Exact recovery checks

Contract replay, future deferral and completion reporting are separate outcomes. A missing function name in the completion list is a reporting defect; it does not demonstrate that its requirements or code were lost. Literal JSON checks can also reject alternative representations of a correctly implemented rule.

- Pair 2, without: strict completion report check failed. Recovery artifact: `{"contract":{"separator":",","newline":"CRLF","nullValue":"","trailingNewline":false},"deferred":["CSV_IMPORT"],"completed":["encodeTable"],"unresolved":[]}`.
- Pair 6, with: strict completion report check failed. Recovery artifact: `{"contract":{"limit":2,"order":"input","query":"trim-lowercase","empty":"no-results"},"deferred":["FUZZY_SEARCH"],"completed":["normalizeQuery","findMatches"],"unresolved":["Repository records do not specify behavior for non-array items; no additional input-validation contract was introduced."]}`.

## Task-management observations

The DIP arm retained three task records in five fixtures and four in the first scheduling fixture. Each included two captured user turns and one separate deferred feature; the first fixture also had a normalization-verification subtask. At the final projection, the original handoff requests were superseded, the recovered v1 requests were verified and all six deferred features remained in backlog. These are observed task-state outcomes, not an independent semantic duplicate-task score.

DIP used 134 MCP calls across the 12 scored turns. The baseline and treatment each emitted 72 completed command items; their completed file-change items numbered 27 and 22 respectively. Together with MCP items, the counts were 99 without DIP and 228 with DIP. These item counts are not model-request counts. They provide starting points for reducing management friction; the experiment does not isolate the cause of every latency difference.

## Prespecified method

The [version 3 protocol](2026-10-06-model-protocol-v3.json) and source hashes were published before the valid scored run at commit 05ee687. The three scenarios were scheduling, delimited-table encoding and substring search; each repeated with a different capacity, separator or result limit. Within every pair the task prompts were identical. Arm order alternated, including within each scenario's two repetitions.

Session one implemented only the first function, preserved the latest contract and left the second function and a separate future feature pending. Session two was a new ephemeral Codex process with no previous chat history. It recovered requirements from repository state, completed v1 and wrote recovery.json. No evaluator feedback was given to participants. Both arms could create Markdown notes and their own tests.

Eight fixed external functional cases per task evaluated the resulting module. Four exact contract fields, a deferred identifier and a completion report supplied six secondary checks. Evaluator calibration accepted all six reference variants and rejected broken pending-function implementations. [Replay validation](../../scripts/model-benchmark-evidence.mjs) reconstructs the saved code and scores both stages without another model call. The 48 cases per arm are clustered within six tasks, not 48 independent experiments.

The strict seed diagnostic flagged one baseline export because scheduleJobs existed as a callable function. Inspection confirmed it was a throwing unimplemented stub, so the intended partial-work condition was honored. The diagnostic flag and original scoring were retained; it is not evidence of premature implementation or a functional outcome difference.

Each arm used separate repositories, Codex configuration, Git configuration and runtime directories. Native Git trace and shell profiles were disabled; the baseline had no DIP hooks, MCP registration or .dip directory. The treatment added DIP instructions, actual Codex lifecycle hooks and the DIP MCP server. The isolated runtime used immediate durable fallback with no resident recorder. Setup was excluded from timed turns; model requests, tool use, checks, hook delivery, MCP startup and process completion were included.

All reviewed fixture-local MCP tools were explicitly authorized for unattended execution. Both arms used ordinary local-user execution with danger-full-access to avoid interactive Windows sandbox setup. Directory boundaries were instructions, not OS containment. Only generated DIP hooks were enabled; the vetted automation used --dangerously-bypass-hook-trust. This is separate from the normal installation's user review flow. The successful preflight checked real shell writes in both arms and actual MCP plan persistence/readback in the treatment.

## Retained infrastructure attempts

Two earlier attempts were stopped for failed infrastructure conditions, and all available outcomes remain public. They are not pooled with the valid comparison and are not evidence of a product success-rate difference.

- [Attempt 1](2026-10-06-model-attempt1.json): noninteractive MCP approvals blocked DIP intent calls. One matched pair completed and another partial arm was retained. Hook delivery worked. The original capture helper also checked the wrong checkpoint property; its checkpointPresent field must not be interpreted.
- [Attempt 2](2026-10-06-model-attempt2.json): fresh elevated Windows sandbox initialization failed with helper cancellation 1223. Shell access failed in the baseline. Available partial results and the stop reason were retained.

Task prompts and functional scoring remained fixed through the infrastructure corrections. All arms restarted from fresh repositories for version 3. Known CLI hook-trust banner items were classified as warnings, with their text retained. Preflight calls and terminated incomplete calls are outside the scored usage totals; usage for forcibly stopped active turns was unavailable. Local synthetic transcripts were retained and authentication copies were removed.

## Interpretation and limits

This small pilot covers solo microtasks and repository-based recovery after an explicit durable-handoff request. It does not measure implicit reminders, actual mid-development plan revisions, parallel-agent collisions, long-running development, distributed clones, Git merging, Claude Code or operation without DIP installed. The earlier proposal and final revision were both stated in the initial seed prompt. Runtime retention stayed on one machine.

Network/server load, model sampling and prompt caching were not fixed. The model ID and reasoning setting were the same; server weights and random seeds were not pinned. Both stages started new CLI processes, and the treatment used durable fallback rather than a running daemon. These conditions limit latency generalization. There are no statistical-significance, code-quality-beyond-these-tests or monetary-saving claims.

DIP supplied structured requests, plans, task status, ownership and lifecycle history. The measured workflow cost includes the agent's semantic management calls. Routine capture invokes no model by itself; that does not imply zero agent-loop, token or time overhead. Coordination and history benefits need separate controlled evaluation. The evidence supports optimizing management friction before claiming a productivity gain.

## Raw evidence and reproduction

- [All valid outcomes, artifacts, usage and timings](2026-10-06-model-controlled-v3.json)
- [Successful infrastructure preflight](2026-10-06-model-preflight.json)
- [Initial protocol](2026-10-06-model-protocol.json) and [version 2](2026-10-06-model-protocol-v2.json)
- [Task prompts and evaluator](../../scripts/model-benchmark-fixtures.mjs)
- [Model runner](../../scripts/model-benchmark.mjs)

Public artifacts replace personal path prefixes with placeholders; artifact hashes refer to original text before path redaction. No credentials, authentication files or unrelated project content are included.

```sh
node scripts/model-benchmark.mjs --preflight --output preflight.json
node scripts/model-benchmark.mjs --output results.json
node scripts/model-benchmark-evidence.mjs
```

The runner consumes the existing Codex login and model quota. It creates synthetic repositories and private configuration, leaves synthetic fixtures for audit, and removes its authentication copies. It does not modify installed global integrations. Reproducing a new run should save a fresh protocol before data collection; new model outcomes are not expected to match these values exactly.
