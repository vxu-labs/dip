# Task activity and completion

DIP keeps task intent, host activity and configured verification separate. A worker becoming inactive does not establish interruption. A response does not establish fulfillment. A configured check proves only that check against its recorded snapshot.

| Display | Recorded basis | Completion meaning |
| --- | --- | --- |
| Running | Current local worker lease | Work is active, not complete |
| Response recorded | A Stop hook supplied a nonempty assistant message | A response was observed; fulfillment and verification remain unasserted |
| Inactive | Open in-progress work without a current worker or explicit terminal evidence | Outcome is unknown; inspect intent, history and files |
| Interrupted | Explicit Interrupt or StopFailure observation | Interruption/failure was reported; it is not inferred from inactivity |
| Paused | Explicit paused finish with remaining work | Work remains open |
| Answered | Explicit answered finish for a non-development request | The agent asserted that the request was fulfilled; no code verification is implied |
| Implemented / Verified | Explicit implementation finish and applicable configured evidence | Existing verification/currentness rules apply |

The response-only observation remains in the task's existing status and queue. It is not an automatic Answered or completed-unverified task: DIP cannot determine from response text whether an action succeeded, a question was fully answered, or work remains. A failed process with no terminal hook is Inactive rather than a fabricated crash claim. Concurrent incompatible lifecycle records are unknown until causally superseded.

## Hook behavior

Stop, SessionEnd and PreCompact do not complete tasks. Boundary metadata is stored in the existing automatic checkpoint; assistant response prose is not copied into the ledger. SessionEnd retains a preceding response/interruption observation. Resumed writes clear earlier terminal observations. A known stale terminal turn ID is ignored so an old Stop cannot release a newer request's ownership. The runtime turn binding is disposable and contains no verification evidence.

The Codex Stop contract supplies an optional `last_assistant_message`, described as the latest assistant text, rather than a proof of successful task completion. See the [official hook contract](https://learn.chatgpt.com/docs/hooks#stop). Missing message data stays unknown. Text in tool results cannot act as a host completion signal.

Known reads and read-only shell forms remain captured requests in the automatic workflow. Unknown tools, including arbitrary browser JavaScript, retain conservative ownership coordination. They are not treated as proof of a project write or of successful navigation. Native file writes and unknown shell commands still promote development. Recognized host suggestion templates remain discussions through opaque connector activity; real file writes still promote them and acquire scope. Ordinary user intent and quoted templates are not reclassified.

Routine questions/reads need no management call. If an agent explicitly closes a fulfilled non-development request, it can use `task_finish answered`. Development requires `task_finish implemented` with a configured check, or `paused` with remaining work. Instructions installed by DIP explain the distinction; custom instructions remain preserved.

## Conservative historical audit

On 2026-11-05, a read-only scan of the machine's 71 registered project roots inspected 1,959 tasks. It found 518 inactive in-progress tasks, including 504 without lifecycle evidence, and 469 work records matching recognized host-generated suggestion templates. These are candidates for review, not evidence that every request succeeded or failed. No historical status, resolution, evidence or task event was rewritten by the audit. No task was mass marked Verified or Answered, and generated historical records were not removed.

The new projection corrects misleading inactivity labels immediately when the updated dashboard reads existing history. Old Stop records that did not retain response metadata cannot be upgraded to Response recorded from those records alone.

Repeat the read-only audit from the repository:

```sh
node scripts/lifecycle-audit.mjs --root /absolute/project
node scripts/lifecycle-audit.mjs --catalog /absolute/path/to/projects.json
```

Regression coverage includes successful browser/navigation observations, ordinary Stop with and without a response, explicit interruption/failure, absence of terminal hooks, unfinished code and plans, stale turn events, resumed work, explicit answers/pauses, concurrent lifecycle observations and generated suggestion classification. UI checks use synthetic records rather than changing real task statuses.
