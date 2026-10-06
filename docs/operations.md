# Operating DIP

Use Node.js 24 or newer. Install globally and run `dip install`; restart your terminal and coding tools, and enable/trust the installed agent hooks. `dip doctor` reports actual configuration, recorder heartbeat, watcher attachment, observed recording sources and outbox failures. Configuration does not prove that an already-running agent loaded or trusted it.

## Updates and recovery

Install the new package, then run `dip install` again. Owned MCP registrations are updated when the package path changes. Existing settings are preserved. The installer journals machine configuration and restores earlier writes if a later integration fails; a subsequent install recovers an interrupted journal. Concurrent installers are rejected. The journal and runtime are private local files, not project data.

`dip stop` requests a graceful flush before shutting down the service. A non-responsive or older recorder may require forced termination; its SQLite outbox remains available. `dip start` recovers queued records. `dip flush` retries them explicitly and reports failures. A broken or removed project keeps its queued records without blocking healthy projects; restore/repair that project and retry. Do not delete the runtime while records remain queued.

The dashboard prefers port 4317 and selects an available port if it is occupied. The actual address is reported by `dip doctor`. You can choose a port with `dip install --port 4318`. `dip serve --port 0` starts a separate viewer on an available port; a viewer alone does not activate recording.

## Work and verification

Tasks support requirements, acceptance criteria, dependencies, priorities (1 highest, 5 lowest) and target dates. Edit these in the dashboard or through MCP. The Schedule view separates overdue, upcoming and undated work. `task_next` respects priority, dependencies and busy scopes. No automatic completion is inferred from a closed conversation.

Coordinate mode protects semantic updates owned by another worker and checks live scope expansion atomically. Strict mode additionally requires a current fencing token for semantic changes. `task_release`, `task_heartbeat` and `task_decision` are available through MCP as well as CLI.

Supported tool IDs allow the running recorder to renew ownership while a tool is in flight. The default maximum is 30 minutes, or a declared tool timeout up to one hour. Post-tool, failure and session boundaries clear the tracking. Missing hooks cannot prove worker liveness; a crashed tool without a closing event is bounded by this deadline. Renewal never revives an expired or replaced token. Configured verification jobs renew their own ownership during execution and recheck it before writing evidence.

Evidence is tied to both the code snapshot and the task's requirements, acceptance, scope and dependencies. Changing either makes earlier evidence stale. Evidence from releases predating this intent hash requires reverification. Keep checks meaningful: a passing command proves only what it checks.

## Data and host boundaries

Commit `.dip` with the work. Runtime files, dependencies, nested ledgers and sensitive paths are excluded from file capture. The dashboard uses bounded activity/history previews; the immutable ledger retains complete stored requests and plans. CLI status and Git provide the full durable records.

Live coordination applies to one local Git worktree family. Independent clones/machines require a future shared coordinator. Hooks are workflow controls, not a sandbox. Cloud or remote hosts need their own installation. The compatibility table distinguishes adapter fixtures and native command tests from actual model-backed host sessions.
