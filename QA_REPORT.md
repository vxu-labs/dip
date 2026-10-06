# DIP v0.2 release validation

The supported target is a local development workflow on Node.js 24, with Git, trusted agent hooks and a shared runtime for one worktree family. This is a hardened release; this report does not claim exhaustive QA or multi-day model-backed operation.

The 46-case suite validates durable state and merges, semantic conflicts, scope ownership and fencing, requirements-aware verification, dependency drift, installation preservation/rollback/crash recovery, owned MCP upgrades, per-project outbox failures, long-operation renewal, actual stdio MCP, native discovery and graceful shutdown. Windows runs 44 cases and skips two POSIX shell cases; platform-specific checks run in their applicable CI jobs.

Chromium validates task creation and editing, acceptance/handoff display, scheduling, work boards, cross-worktree visibility and navigation, truthful recorder status, responsive layout and absence of JavaScript errors. Clean package installation and uninstall preserve project records. Runtime dependency audit reported zero known vulnerabilities during release checks.

Real machine installation enabled global configuration, Git hooks, profiles and a recorder monitoring accessible repositories under the user's home directory. Live checks demonstrated immediate `.dip` creation through the actual integrated PowerShell `git init`, execution of installed native Codex hook commands, filesystem recording after watcher attachment, recorded handoffs and observed Git/Codex/filesystem sources. Windows file replacement contention discovered during this installation was addressed with bounded retries; repeated installation completed without discovery errors.

Native hook command tests use explicit synthetic payloads. They do not prove that an already-running Codex/Claude host reloaded or trusted its configuration. Restart and confirm trust in each host. There has not been a multi-day model-backed session test. Filesystem watchers attach asynchronously; `dip doctor` exposes attachment and observed sources rather than promising historical capture before attachment.

Independent machines and clones do not share live leases. Distributed coordination, capacity/resource planning and GitHub Issues synchronization remain separate product extensions. Missing hooks and events outside monitored coverage cannot establish complete observation of every process.

Reproduce automated validation with `npm ci`, `npm test`, `npm run check`, `npm run test:browser`, `npm pack`, and `npm run test:package`. `scripts/live-machine-smoke.mjs` deliberately targets an already installed real Windows machine; it is not part of unattended CI and does not modify a contributor's setup automatically.
