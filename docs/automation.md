# Automatic integration and coverage

DIP observes development activity through multiple independent triggers. It does not ask a model to write routine logs.

| Trigger                            | Effect                                                                                                    | Boundary                                                                                                       |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Install discovery                  | Finds existing repositories under configured roots and initializes data/instructions                      | Accessible directories only; links and large dependency/system folders are skipped                             |
| Native Git Trace2                  | Initializes any worktree identified by compatible native Git, including status/diff outside watched roots | Running recorder, supported Git/global settings; independent libraries and environment overrides may bypass it |
| Terminal `git init` or `git clone` | Initializes the resulting project immediately                                                             | Newly opened integrated Bash, Zsh or PowerShell sessions; an existing user-defined `git` function is preserved |
| Agent SessionStart                 | Initializes a project on entry and supplies compact context                                               | Codex/Claude must load and trust the installed user hooks                                                      |
| UserPromptSubmit                   | Persists the full request and supplies its task ID, actor and session to the agent                        | Conservatively captures requests; semantic refinement belongs to the existing agent                            |
| Agent tool hooks                   | Records activity; successful update_plan/TodoWrite calls also update the task's displayed plan            | Supported local tool paths; bypassed/disabled hooks are not observable                                         |
| Stop, SessionEnd, PreCompact       | Saves a persistent checkpoint and flushes queued events                                                   | Automatic checkpoints record observable progress, not inferred semantic completion                             |
| Git hooks                          | Initializes on Git use, records lifecycle events, stages ledger data before commit                        | Existing repository hooksPath is wrapped on discovery and restored on uninstall                                |
| File watcher                       | Collects changed paths in batches                                                                         | Initialized repositories reachable by the running local service; file contents are not logged                  |
| Root watcher and periodic scan     | Finds repositories created/cloned by other apps                                                           | Configured roots, native watcher availability; polling remains available                                       |

The default discovery root is the user's home directory. Add additional roots once during installation. Agent entry and shell/Git triggers are not restricted to those roots. System-wide monitoring of every process or inaccessible filesystem is not claimed.

## Recording and latency

Hooks record compact events in a SQLite WAL queue. The background service flushes batches once per second. When the service is absent, hooks persist their queues directly. Operation IDs deduplicate retries; deleting a cache does not erase records already in Git. A kill before a hook reaches the recorder cannot be reconstructed as an exact tool invocation; the file watcher records its observable changes.

The normal hook path reads Git HEAD/ref files directly rather than spawning Git for every action. It reads the current task's events rather than unrelated activity history. No model call, remote API request or dependency resolution occurs on routine capture. Startup context is injected once; subsequent semantic tool calls are explicit.

## Requests, plans and future ideas

The user can ask normally: "Create a plan", "Develop CSV export", or "Remember export for later". A loaded, trusted prompt hook creates a durable request automatically and injects its `task_id`, `actor` and `session_id`. The agent refines that task through `task_update`; it should not create a second task for the same request. Codex turn IDs deduplicate prompt retries without merging identical requests submitted in later turns. Hosts without a turn identity cannot guarantee prompt retry deduplication.

Successful `update_plan` and Claude `TodoWrite` calls save the full structured plan on the task. The dashboard shows the latest revision, while prior revisions remain in history. Plan post-hooks run synchronously to preserve revision order; ordinary post-tool capture stays asynchronous. Write long prose plans once in Markdown: supported file-write hooks save versioned document references, and DIP reads sections on demand. A plan written only as conversational prose can still be saved with `task_plan` or `dip task plan --id ID --text "..."`. Do not mirror Markdown prose into that field. Routine capture makes zero additional model calls; intent tools still use normal tool round trips. See [document workflow and coverage](documents.md).

Claude `ExitPlanMode` can supply injected prose in `tool_input.plan`; DIP retains it as the task's plan text. The asynchronous catch-all post route skips recognized planning tools inside Node, while the synchronous route persists their ordered revisions. Host matchers use a regex subset compatible with Codex; JavaScript-only lookaround is not used. The known leading in-app-browser ambient transport wrapper is removed before generating prompt intent, while ordinary embedded user text remains intact.

Planning and known read tools (`Read`, `Glob`, `Grep`, `read_file`, `list_files`) do not claim development work or change a future idea from backlog to in_progress. Editing starts the captured task and infers file scope. Other executable/unknown tools conservatively retain coordination checks; DIP does not infer arbitrary shell-command intent. A future request stays backlog until the agent or an actual work tool starts it. Plan steps reported as completed never establish verified task completion.

Changing plan step text or a prose plan invalidates previous verification even when code is unchanged. Updating only structured step progress preserves its requirements hash. Explicit acceptance criteria and scope still belong in the task's intent fields.

Standalone DIP intent CLI actions through known shell tools also leave future requests in backlog. Compound shell commands retain coordination. Common generated folders such as Rust `target`, `dist`, `build`, `coverage`, `.next`, `.nuxt`, `.turbo` and Python `__pycache__` are excluded from future file capture.

`dip doctor` exposes `agentCapture` with delivered prompt count, tasks with captured plans and the last observed prompt time. The dashboard explicitly reports when no agent prompt has been observed in the selected project. This measures durable hook records, including manually supplied test payloads; it cannot prove that a particular live host loaded/trusted its integration. Git/file capture does not reconstruct an unobserved chat request. Restart or reload the host and review its hook trust when configuration changes. Codex documents its [hook review and trust requirements](https://learn.chatgpt.com/docs/hooks#review-and-trust-hooks).

## Ownership

Claims are transactions scoped to the repository's common Git directory. Worktrees share the same coordinator. Conflicting declared file/directory scopes are rejected atomically. Different computers and independent clones can still work offline; merging their histories detects competing intent but does not prevent concurrent execution.

Compact context and the dashboard show active workers across the local Git family, including tasks that exist only in another branch. The dashboard can switch directly to the owning worktree. `task_claim` accepts `waitMs` up to 30000 to wait locally for release in one MCP call. CLI workers can use `dip task claim --id ID --actor ACTOR --waitMs 30000`. Expired ownership remains subject to a fresh fencing token.

Root watchers discover new repository candidates directly; ordinary source renames and commits in known repositories do not trigger a full discovery scan. A periodic scan provides fallback coverage. File activity is batched locally without model calls.

Lease refresh occurs at agent tool boundaries. With a running recorder and supported tool IDs, in-flight operations also renew ownership up to a bounded deadline; closing tool/session events stop renewal. Configured verification renews its own ownership. Unobserved operations and disabled hooks cannot prove liveness. See [operations](operations.md) for deadlines and recovery. External unattended workers can use the heartbeat CLI/API. This release does not provide distributed leases.

Coordinate mode is the default. It records activity, creates task associations automatically and rejects conflicting claims on supported tool paths. Direct file writes infer project-relative scope automatically. Observe mode records without blocking. Strict mode additionally requires tokens on semantic task mutations. Hooks are workflow controls, not an operating-system security boundary. Arbitrary shell commands, nested processes or an agent editing the integration can bypass them.

## Preservation and privacy

Repository setup also generates owned [project skills and a portable intent helper](portable.md). [Reviewed follow-up adoption](intent-transitions.md) selects an existing task without a duplicate actionable prompt. Independent Git-library clients can integrate the [explicit local discovery callback](client-discovery.md); clients without the callback remain unobserved.

Agent configuration is merged, not replaced. Installation records its previous Git hooksPath and chains original hooks with their arguments. Backups end in `.dip-backup`. Uninstall removes managed settings while retaining unrelated values and all project data.

Command metadata and short prompt descriptions can contain project information. Common credential formats are redacted; this is not a guarantee of detecting every possible secret. Full transcripts, patch contents, sensitive-file contents and model responses are not intended as durable logs. Review ledger data before publishing a private project. The product has no telemetry or external network client for activity recording.

## Sources for adapter behavior

[Codex hooks](https://learn.chatgpt.com/docs/hooks), [Codex plugin packaging and trust](https://developers.openai.com/plugins/build/plugins), [Claude Code hooks](https://code.claude.com/docs/en/hooks), [Git core.hooksPath](https://git-scm.com/docs/git-config#Documentation/git-config.txt-corehooksPath).
# Starting development with fewer intent calls

With current hook identity, `task_prepare` combines a small requirement patch, a scope claim and a compact task receipt. It supports title, description, acceptance criteria and project-relative scope. An ownership conflict or invalid patch leaves intent unchanged. Repeating the same request renews the existing claim without duplicate intent events. Git intent and local leases are separate stores; a persistence failure after acquisition retains ownership for retry.

Use `task_update` for planning and future ideas, and `task_adopt` for a reviewed follow-up to a different existing requirement. Preparation deliberately rejects discussion and completed work. Do not repeat an unchanged task read when the hook or preparation receipt already supplied the information. Use bounded requirements or document sections when more detail is needed. Completion still requires configured checks.

