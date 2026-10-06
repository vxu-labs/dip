# Codex desktop workflow QA

Test date: 6 October 2026. The visible Codex selector was GPT-6.1 Sol with High reasoning. Two existing local projects were used with tightly limited prompts: a duplicate-file application and a teleprompter. Product code and user settings were outside the permitted scope. Public evidence below omits personal paths, unrelated chat content and screenshots of the user's sidebar.

## Method and observations

The first two chats were created through Codex app tools. They tested semantic intent persistence through the existing project instructions. Two subsequent prompts were entered and sent through the actual desktop interface using Windows Computer Use. The duplicate-file follow-up used a new chat to test recovery across sessions. The teleprompter follow-up refined the existing future idea.

| Trial | Entry path            | Request                                                 | Result verified on disk                                                          |
| ----- | --------------------- | ------------------------------------------------------- | -------------------------------------------------------------------------------- |
| A     | App tool              | Four-step CSV plan plus future Hebrew-file-name support | Two backlog tasks; one saved plan; separate future idea                          |
| B     | App tool              | Remember a distraction-free teleprompter mode           | One backlog task; no development started                                         |
| C     | Desktop UI, new chat  | Recover the CSV plan and Hebrew idea without duplicates | Existing four-step plan and idea recovered; task count stayed two                |
| D     | Desktop UI, follow-up | Add two acceptance criteria to the remembered idea      | Existing task gained both criteria; task count stayed one; status stayed backlog |

The observed turn durations were 137.724, 61.871, 27.378 and 32.489 seconds respectively. Requests, histories and warm-up conditions differ, and there is no matched model baseline. These times are descriptive QA observations and support no productivity-speedup claim.

## Friction found and addressed

- `dip --help` and task-specific `--help` failed, causing agents to inspect implementation source. Help now works outside Git and lists real argument names.
- Default `dip status` dumped the entire activity stream. On the same local ledger, v0.3.1 emitted 338,526 bytes and v0.3.2 emitted a 757-byte summary. The summary deliberately omits raw history; `--full` retains access. A regression fixture validates compact status against 1,200 synthetic activity records.
- Rust `target` build output and other generated folders appeared in activity. Common build/cache paths are now excluded from future watcher capture.
- Instructions assumed that hook capture was active. They now require the current hook's task ID before making that assumption and direct agents to explicitly save intent/plans when it is absent.
- An unobserved prompt channel looked similar to healthy automatic capture. Doctor now reports an advisory, and the dashboard uses a warning state. Responses disable browser caching so reloading picks up the current UI.
- The machine dashboard initially showed another registered project. Doctor now supplies a project-specific dashboard URL and the UI honors its root parameter, avoiding a manual project-picker step.
- Standalone DIP intent commands invoked through known shell tools preserve future backlog status. Compound shell commands retain work coordination. This prevents CLI-based tracking itself from being mistaken for starting development.

## Trust boundary and remaining coverage

The desktop hook review showed DIP handlers as **New**, awaiting user trust. Computer Use did not approve permission requests. Neither project had recorded UserPromptSubmit events during these trials. Agents saved and recovered intent through explicit CLI/MCP calls, so these results prove the fallback workflow; they do not prove automatic prompt or plan capture in a trusted desktop session.

App-tool-created initial turns must not be treated as equivalent to a UI-submitted user prompt for hook coverage. The automatic channel limitation above was also checked after the UI submissions. A trusted-host automatic-capture trial remains necessary. Claude model-backed desktop operation was not tested; its installed command adapters have separate synthetic coverage.

The controlled [with/without benchmark](benchmarks/README.md) measures local tracking cost, separately from these model-backed observations.

## Trusted hook follow-up, v0.3.4

Later on the same test date, the user approved the hook definitions in the DIP project conversation. Actual UserPromptSubmit capture supplied a task ID and actor/session context. PreToolUse delivery worked, but ordinary PostToolUse did not: the installed matcher contained negative lookahead, which Codex's Rust regex engine does not support. The corrected definition uses `.*` and filters plan tools inside Node, leaving a separate synchronous route for ordered plan updates.

The user approved this changed definition separately. A read-only shell call then produced these actual durable records, with no manual hook invocation:

| Field        | Before                                    | After                                     |
| ------------ | ----------------------------------------- | ----------------------------------------- |
| Kind         | PreToolUse                                | PostToolUse                               |
| UTC time     | 11:31:55.423                              | 11:31:59.500                              |
| Tool         | Bash                                      | Bash                                      |
| Tool-call ID | exec-16d8dcd0-eb19-4657-88f6-dbb83c934622 | exec-16d8dcd0-eb19-4657-88f6-dbb83c934622 |
| Task         | Same captured request                     | Same captured request                     |
| Session      | Same Codex conversation                   | Same Codex conversation                   |

Ordinary shell and MCP post records were also observed. This evidence establishes the tested prompt and ordinary-tool paths after trust. Native planning-tool delivery and the full lifecycle still require separate live evidence.

A model-backed app-tool follow-up in the duplicate-file project took 53.237 seconds. It saved a two-step management-only QA plan and a distinct future Hebrew-search test idea. Both were read back and independently confirmed in backlog on disk. The native update_plan tool was unavailable, and the turn supplied no hook task identity; the agent correctly used explicit DIP task_plan. Recovery in another session remains a future test. No product code or user settings were changed. Claude Code has installed command/fixture coverage, including TodoWrite and injected ExitPlanMode prose, but no trusted model-backed run on this machine.
