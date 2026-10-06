# Automatic integration and coverage

DIP observes development activity through multiple independent triggers. It does not ask a model to write routine logs.

| Trigger                            | Effect                                                                               | Boundary                                                                                                       |
| ---------------------------------- | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| Install discovery                  | Finds existing repositories under configured roots and initializes data/instructions | Accessible directories only; links and large dependency/system folders are skipped                             |
| Terminal `git init` or `git clone` | Initializes the resulting project immediately                                        | Newly opened integrated Bash, Zsh or PowerShell sessions; an existing user-defined `git` function is preserved |
| Agent SessionStart                 | Initializes a project on entry and supplies compact context                          | Codex/Claude must load and trust the installed user hooks                                                      |
| UserPromptSubmit                   | Persists the request, source identity and short description                          | A request is captured conservatively; intent refinement belongs to the existing agent                          |
| Agent tool hooks                   | Records command/plan metadata; associates activity with a task                       | Supported local tool paths; bypassed/disabled hooks are not observable                                         |
| Stop, SessionEnd, PreCompact       | Saves a persistent checkpoint and flushes queued events                              | Automatic checkpoints record observable progress, not inferred semantic completion                             |
| Git hooks                          | Initializes on Git use, records lifecycle events, stages ledger data before commit   | Existing repository hooksPath is wrapped on discovery and restored on uninstall                                |
| File watcher                       | Collects changed paths in batches                                                    | Initialized repositories reachable by the running local service; file contents are not logged                  |
| Root watcher and periodic scan     | Finds repositories created/cloned by other apps                                      | Configured roots, native watcher availability; polling remains available                                       |

The default discovery root is the user's home directory. Add additional roots once during installation. Agent entry and shell/Git triggers are not restricted to those roots. System-wide monitoring of every process or inaccessible filesystem is not claimed.

## Recording and latency

Hooks record compact events in a SQLite WAL queue. The background service flushes batches once per second. When the service is absent, hooks persist their queues directly. Operation IDs deduplicate retries; deleting a cache does not erase records already in Git. A kill before a hook reaches the recorder cannot be reconstructed as an exact tool invocation; the file watcher records its observable changes.

The normal hook path reads Git HEAD/ref files directly rather than spawning Git for every action. It reads the current task's events rather than unrelated activity history. No model call, remote API request or dependency resolution occurs on routine capture. Startup context is injected once; subsequent semantic tool calls are explicit.

## Ownership

Claims are transactions scoped to the repository's common Git directory. Worktrees share the same coordinator. Conflicting declared file/directory scopes are rejected atomically. Different computers and independent clones can still work offline; merging their histories detects competing intent but does not prevent concurrent execution.

Lease refresh occurs at agent tool boundaries. Long-running operations with no observed boundary may exceed the lease period; isolated worktrees protect source files, and the next observed operation must acquire current ownership. Use the heartbeat CLI/API for workers that run long unattended operations. This release does not yet provide distributed leases.

Coordinate mode is the default. It records activity, creates task associations automatically and rejects conflicting claims on supported tool paths. Direct file writes infer project-relative scope automatically. Observe mode records without blocking. Strict mode additionally requires tokens on semantic task mutations. Hooks are workflow controls, not an operating-system security boundary. Arbitrary shell commands, nested processes or an agent editing the integration can bypass them.

## Preservation and privacy

Agent configuration is merged, not replaced. Installation records its previous Git hooksPath and chains original hooks with their arguments. Backups end in `.dip-backup`. Uninstall removes managed settings while retaining unrelated values and all project data.

Command metadata and short prompt descriptions can contain project information. Common credential formats are redacted; this is not a guarantee of detecting every possible secret. Full transcripts, patch contents, sensitive-file contents and model responses are not intended as durable logs. Review ledger data before publishing a private project. The product has no telemetry or external network client for activity recording.

## Sources for adapter behavior

[Codex hooks](https://learn.chatgpt.com/docs/hooks), [Codex plugin packaging and trust](https://developers.openai.com/plugins/build/plugins), [Claude Code hooks](https://code.claude.com/docs/en/hooks), [Git core.hooksPath](https://git-scm.com/docs/git-config#Documentation/git-config.txt-corehooksPath).
