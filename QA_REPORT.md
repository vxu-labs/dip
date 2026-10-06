# DIP release validation

## v0.3.4 trusted hook capture

The user approved DIP's Codex hooks and then the corrected PostToolUse definition. Real UserPromptSubmit capture supplied the current task identity to the agent. A read-only shell probe produced matching PreToolUse and PostToolUse records for one call, task and session, without manual hook invocation. Ordinary shell and MCP post records were also observed. The prior general matcher used negative lookahead, unsupported by Codex's Rust regex engine; a portable catch-all plus a Node-side plan filter fixes delivery while keeping plan writes synchronous and ordered.

Automatic browser transport text no longer becomes task intent. Ordinary request bytes and embedded text remain intact. Claude ExitPlanMode's injected prose is retained as a plan, alongside TodoWrite support. Three regression cases cover these changes. Local configured verification passed 68 cases: 66 Windows passes, two POSIX skips, zero failures, and no source or intent change during the check.

The actual installed v0.3.4 command routes passed six synthetic future/plan/development cases, with 44 invocations and a median 573 ms including PowerShell startup. These inputs are synthetic and do not prove host delivery. A separate model-backed follow-up saved a two-step QA plan and a distinct future idea through MCP; disk inspection confirmed both in backlog. Native update_plan was unavailable and no hook identity was supplied to that app-tool-created turn, so it proves explicit persistence rather than automatic native-plan capture. Trusted Claude Code operation, native planning-tool delivery and multi-day reliability remain open in DIP-L01. See [the updated desktop report](docs/desktop-qa.md#trusted-hook-follow-up-v034).

## v0.3.2 desktop QA and benchmark

Windows Computer Use inspected the actual Codex app, entered/sent prompts and checked outcomes in two project workflows. Four model-backed trials covered creation, future ideas, fresh-session recovery and acceptance refinement. Disk state confirmed preserved plans, stable task counts and backlog status. Hooks remained untrusted and no automatic prompt events were observed, so the trials establish explicit CLI/MCP fallback behavior. See [the desktop QA report](docs/desktop-qa.md).

Demonstrated friction led to CLI help support, compact/paginated default status, conditional capture instructions, coverage advisories, browser no-store responses, project dashboard links and generated-folder filtering. Standalone intent CLI actions preserve backlog while compound shell commands retain coordination. Four added regression cases bring the suite to 65 cases. Browser QA passed after these changes.

The paired benchmark publishes raw data and both measured runs. v0.3.2's added blocking median was 150.88 ms over 30 alternating pairs, with no additional capture model calls. This is a synthetic overhead benchmark, not a model-productivity A/B claim. [Method and raw samples](docs/benchmarks/README.md).

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
