# Operating DIP

If a DIP MCP call is unavailable or approval-blocked, avoid repeating other methods through the same blocked route. Use installed local CLI only when the host permits shell execution. Report unsaved intent if no authorized route remains; do not change approval policies or bypass hook trust. Native planning tools are host-dependent: save a prose-only plan explicitly when unavailable. [Live-host failure and recovery evidence](host-qa/README.md).

Use Node.js 24 or newer. Install globally and run `dip install`; restart your terminal and coding tools, and enable/trust the installed agent hooks. `dip doctor` reports actual configuration, recorder heartbeat, watcher attachment, observed recording sources and outbox failures. Configuration does not prove that an already-running agent loaded or trusted it.

## Updates and recovery

Install the new package, then run `dip install` again. Owned MCP registrations are updated when the package path changes. Existing settings are preserved. The installer journals machine configuration and restores earlier writes if a later integration fails; a subsequent install recovers an interrupted journal. Concurrent installers are rejected. The journal and runtime are private local files, not project data.

`dip start` starts a local supervisor and the recorder. The supervisor checks every second and retries a missing recorder with bounded backoff, at most five launches in 60 seconds. A blocked supervisor needs inspection and an explicit `dip start` to retry. The supervisor itself is not an OS-supervised service; if it exits, automatic startup or an explicit start is required. A live recorder with a stale heartbeat is preserved rather than killed automatically.

`dip stop` records a persistent stop preference and requests a graceful flush. Login and terminal startup use `dip start --automatic`, which respects that preference; `dip start` resumes explicitly. Uninstall also stops supervision. A non-responsive owned recorder may require forced termination; its SQLite outbox remains available. An unconfirmed PID is never terminated. `dip flush` retries queued records explicitly and reports failures. A broken or removed project keeps its queued records without blocking healthy projects; restore/repair that project and retry. Do not delete the runtime while records remain queued.

Doctor distinguishes current recorder errors (`daemon.lastError`) from the latest historical failure (`daemon.lastFailure`). `daemon.supervision` reports restart count, current state and the latest 20 recovered observation gaps. A gap starts at the last observed heartbeat and ends when a healthy recorder is observed, so its bounds are approximate. Queued records can be recovered; filesystem changes and exact tool invocations during downtime cannot be reconstructed. Expired or replaced ownership tokens are not revived.

The dashboard prefers port 4317 and selects an available port if it is occupied. The actual address is reported by `dip doctor`. You can choose a port with `dip install --port 4318`. `dip serve --port 0` starts a separate viewer on an available port; a viewer alone does not activate recording.

Use doctor's `projectDashboard` URL to open the current project directly. The unqualified dashboard URL remains a machine-wide project picker. Default `dip status` is compact and paginated (`--limit`, `--offset`); use `dip status --full` for raw history. CLI and task-specific `--help` work outside Git. Unobserved prompt capture produces a coverage advisory until the current agent hook is confirmed.

## Work and verification

Tasks support requirements, acceptance criteria, dependencies, priorities (1 highest, 5 lowest) and target dates. Edit these in the dashboard or through MCP. The Schedule view separates overdue, upcoming and undated work. `task_next` respects priority, dependencies and busy scopes. No automatic completion is inferred from a closed conversation.

Coordinate mode protects semantic updates owned by another worker and checks live scope expansion atomically. Strict mode additionally requires a current fencing token for semantic changes. `task_release`, `task_heartbeat` and `task_decision` are available through MCP as well as CLI.

Supported tool IDs allow the running recorder to renew ownership while a tool is in flight. The default maximum is 30 minutes, or a declared tool timeout up to one hour. Post-tool, failure and session boundaries clear the tracking. Missing hooks cannot prove worker liveness; a crashed tool without a closing event is bounded by this deadline. Renewal never revives an expired or replaced token. Configured verification jobs renew their own ownership during execution and recheck it before writing evidence.

Evidence is tied to both the code snapshot and the task's requirements, acceptance, scope and dependencies. Changing either makes earlier evidence stale. Evidence from releases predating this intent hash requires reverification. Keep checks meaningful: a passing command proves only what it checks.

## Data and host boundaries

### Project capture controls

`dip capture` reports the current policy. Use `dip capture --patch '{"promptText":false,"commands":false}'` in a POSIX shell, or equivalent JSON quoting in your shell. The same settings live in `.dip/config.json` under `capture`. Only known boolean keys are accepted; invalid configuration is reported rather than silently ignored. Defaults preserve existing recording:

```json
{
  "capture": {
    "enabled": true,
    "promptText": true,
    "planText": true,
    "commands": true,
    "files": true
  }
}
```

`promptText:false` creates a generic captured request without retaining its text in the new task/session. `planText:false` omits automatically captured plan bodies. `commands:false` omits automatic command text and change hashes. `files:false` omits file activity, automatic document linking and inferred file scopes. These are field controls, not content classification: a manually supplied plan or another enabled field can still mention a path or command.

`enabled:false` disables automatic hook recording and hook coordination for this project. The prompt hook explicitly reports intentional disablement and supplies no captured task ID. Explicit task creation, plans, leases and configured verification remain available. Doctor distinguishes this choice from unobserved or broken hooks. Other projects remain enabled.

The policy is applied before activity enters the outbox and checked again at flush. Queued activity is minimized under the current policy; records intentionally dropped by the policy are removed from the queue. Existing ledger events, older runtime session text, Markdown documents, trace files and Git history are not scrubbed or deleted. Review those separately before publishing.

### Redaction and retention

Recognized secret-valued object keys, token patterns, Bearer credentials, credential-bearing URLs and private-key blocks are sanitized before new event payloads are persisted. Structural JSON redaction preserves valid JSON, including escaped quotes and nested objects. Explicit intent and the portable helper share these recognized-secret rules; there is no extra model call or implicit telemetry.

This is heuristic protection. Ordinary email addresses and other PII can remain, and novel credentials may be missed. Linked Markdown content is not rewritten. Global Git Trace2 discovery may still create temporary files containing raw command arguments even when a particular project's capture is disabled; per-project controls do not change global Git configuration. Completed trace files are normally drained, while abandoned files follow the documented native discovery retention rules. Review captured data, runtime files and document content yourself. Use at your own responsibility.

Commit `.dip` with the work. Runtime files, dependencies, nested ledgers and sensitive paths are excluded from file capture. The dashboard uses bounded activity/history previews; the immutable ledger retains complete stored requests and plans. CLI status and Git provide the full durable records.

Live coordination applies to one local Git worktree family. Independent clones/machines require a future shared coordinator. Hooks are workflow controls, not a sandbox. Cloud or remote hosts need their own installation. The compatibility table distinguishes adapter fixtures and native command tests from actual model-backed host sessions.
