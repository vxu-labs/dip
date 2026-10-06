# DIP release validation

## v0.3.1 workflow audit

The audit found that plan metadata was durable but not displayed on its task, planning/read tools could start a future idea, and the agent did not receive the current captured request ID. The fixes store full successful structured plans on the task, show the latest revision in the dashboard/MCP, keep known planning/read tools from claiming work, provide prompt task identity, deduplicate Codex turn retries and expose observed prompt delivery. Prose plans use a dedicated intent tool. Plans do not change verification evidence.

The suite contains 61 cases. Added scenarios cover Hebrew future requests, plan revisions/retries, edit-triggered work, request identity, Claude TodoWrite, failed plans, prose persistence, bounded context, real MCP refinement without duplicate tasks, observed capture health, plan-aware verification, identical IDs queued in separate projects and preservation of managed instructions during reads. Chromium checked the captured plan in task details, existing board/handoff flows and mobile layout. A Windows Node.js 24 sample measured routine hook medians of 20.8 ms in process and 174.7 ms including a fresh Node process, with zero capture model calls. These are local measurements, not a latency guarantee.

The actual local installation passed six future/plan/development cases through installed Codex/Claude hook commands, with 38 hook invocations and a median 431 ms including PowerShell startup. Both adapters kept future/planning requests in backlog and started development on the same captured task. No model was invoked. These installed command checks use synthetic lifecycle inputs, not actual model-backed host delivery.

A repeated installed test exposed queue IDs shared between projects: retained records from a removed test project could suppress reused IDs in a new project. Queue keys are now namespaced by project root while durable record IDs preserve replay deduplication. A legacy preview also rewrote agent instructions while tests were running; it was stopped, and context/dashboard read paths now preserve managed instruction blocks. Tests passing while files change are correctly rejected as verification evidence until rerun against a stable snapshot.

The current long-lived desktop conversation had no recorded UserPromptSubmit events in this project during the audit, despite configured hooks and an active Git/file recorder. Automatic capture in that conversation therefore remains unproven. Installed command tests use synthetic payloads and do not substitute for a fresh model-backed host session with hooks loaded and trusted. `scripts/live-workflow-smoke.mjs` reproduces future/plan/development scenarios through the actual installed Codex and Claude hook commands without launching another model.

## v0.3 native Git discovery

The suite now contains 51 cases. Additional native Git tests initialize unmonitored worktrees on status, diff, branch, ls-files, rev-parse, local config and an unsuccessful log command, without profiles or lifecycle hooks. They also verify absolute executable invocation, credential exclusion from durable discovery records, trace-target preservation/restoration, disappearing temporary worktrees, isolated capability probing, and service-driven adoption outside configured roots. Clean `npm ci` and cross-platform CI passed for this release.

The actual Windows installation was upgraded with native discovery enabled. A newly constructed existing repository without `.dip` received it after a raw `git.exe -C PATH status` invocation; no shell profile participated and Git output was preserved. This validates compatible native Git execution, not independent Git libraries or overridden global/environment settings. See [native discovery](docs/git-discovery.md).

## v0.2 workflow hardening

The supported target is a local development workflow on Node.js 24, with Git, trusted agent hooks and a shared runtime for one worktree family. This is a hardened release; this report does not claim exhaustive QA or multi-day model-backed operation.

The 46-case suite validates durable state and merges, semantic conflicts, scope ownership and fencing, requirements-aware verification, dependency drift, installation preservation/rollback/crash recovery, owned MCP upgrades, per-project outbox failures, long-operation renewal, actual stdio MCP, native discovery and graceful shutdown. Windows runs 44 cases and skips two POSIX shell cases; platform-specific checks run in their applicable CI jobs.

Chromium validates task creation and editing, acceptance/handoff display, scheduling, work boards, cross-worktree visibility and navigation, truthful recorder status, responsive layout and absence of JavaScript errors. Clean package installation and uninstall preserve project records. Runtime dependency audit reported zero known vulnerabilities during release checks.

Real machine installation enabled global configuration, Git hooks, profiles and a recorder monitoring accessible repositories under the user's home directory. Live checks demonstrated immediate `.dip` creation through the actual integrated PowerShell `git init`, execution of installed native Codex hook commands, filesystem recording after watcher attachment, recorded handoffs and observed Git/Codex/filesystem sources. Windows file replacement contention discovered during this installation was addressed with bounded retries; repeated installation completed without discovery errors.

Native hook command tests use explicit synthetic payloads. They do not prove that an already-running Codex/Claude host reloaded or trusted its configuration. Restart and confirm trust in each host. There has not been a multi-day model-backed session test. Filesystem watchers attach asynchronously; `dip doctor` exposes attachment and observed sources rather than promising historical capture before attachment.

Independent machines and clones do not share live leases. Distributed coordination, capacity/resource planning and GitHub Issues synchronization remain separate product extensions. Missing hooks and events outside monitored coverage cannot establish complete observation of every process.

Reproduce automated validation with `npm ci`, `npm test`, `npm run check`, `npm run test:browser`, `npm pack`, and `npm run test:package`. `scripts/live-machine-smoke.mjs` deliberately targets an already installed real Windows machine; it is not part of unattended CI and does not modify a contributor's setup automatically.
