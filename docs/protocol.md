# Project data protocol

Version 1 stores portable data under `.dip/`. The local runtime is separate under the user's DIP home directory. Set `DIP_HOME` to isolate the runtime for tests or a separate installation.

## Events

Each `.dip/events/<taskId>/<eventId>.json` file contains:

```json
{
  "schemaVersion": 1,
  "eventId": "unique-identifier",
  "taskId": "task_identifier",
  "type": "task.update",
  "payload": { "status": "implemented" },
  "actor": "codex:session-identifier",
  "createdAt": "2026-10-06T12:00:00.000Z",
  "parents": ["previous-event-identifier"],
  "branch": "feature/export"
}
```

The supported event types are `task.create`, `task.update`, `task.resolve`, `task.plan`, `task.document`, `task.checkpoint`, `task.decision`, `task.evidence` and `activity.batch`. Parent IDs encode causality; clock timestamps are only for display. Missing parents, malformed JSON and event cycles are visible data errors. Do not delete historical events to resolve a conflict.

`task.document` stores `{path, role, hash, bytes, source}` for a repository-relative Markdown file. `hash` is SHA-256 of raw file bytes. Removal stores `{path, role, removed: true}`; source files are never deleted by unlinking. References are keyed by normalized path and role within a task, so a file can serve several tasks or roles. Concurrent incompatible versions or removal appear as an explicit document conflict; a reviewed link/unlink event causally resolves current heads. Prose remains in the source document. Existing consumers that do not understand document events need upgrading before verifying document-backed intent. See [document retrieval](documents.md).

Different fields can have concurrent writers. Incompatible concurrent values of the same field cause an explicit conflict. A resolution event refers to all current heads and sets the disputed values. The reducer rebuilds state without a database or external service.

Activity batches use `_activity` as their record folder. Each record contains a stable `recordId` for deduplication. Batches are atomic files; the local outbox is deleted only after the file has been persisted. It can safely replay a batch after a crash.

## Tasks and evidence

Task intent includes title, description, acceptance criteria, scope, dependencies, priority and optional due date. Status can be backlog, ready, in_progress, blocked, implemented, verified, cancelled or superseded. Runtime activity and lease expiry are separate from that status.

`kind` distinguishes work (the default for legacy records) from discussion. Explicit finishing writes `resolution: {outcome, summary, replacedBy}` in a causal `task.update`. Outcomes are answered, implemented, superseded or cancelled. Answered records are implemented discussions, not verified code. Superseded receipts identify replacement requirements without declaring them complete. Reopening a task clears the receipt. Consumers predating these optional fields must upgrade to honor discussion filtering and finish metadata. See [explicit outcomes](completion.md).

Verification snapshots hash source paths and contents while excluding the ledger and common sensitive-file names. Evidence records a named check, process result and snapshot. Linked document references and their actual readable content versions also contribute to the intent hash, including documents outside the declared code scope or ignored by Git. Verification requires current reviewed document versions. Reconciliation compares the current snapshot and the evidence's code commit with the selected Git history. A code-changing or document-changing check is unsuccessful for this purpose even when its process exits zero.

## Local coordination

The [portable helper](portable.md) writes the same causal schema for intent without a global runtime. It cannot emit verification evidence or acquire leases. [Task adoption](intent-transitions.md) links a captured duplicate to an existing requirement through a superseded receipt and rebinds the local session; target refinement and receipt are independently durable steps.

SQLite stores claims, session-to-task association, repository registration and the durable recording outbox. Atomic claim transactions check both task identity and overlapping declared scopes. A refreshed claim for the same actor keeps its fencing token; reassignment after expiry produces a new token. Tokens must be supplied for token-protected updates and strict-mode operations.

Agent integration uses the session identity injected by the startup hook. A task claim with that identity selects the task used by automatic activity capture. The task identity is stable across context compaction.
