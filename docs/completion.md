# Explicit outcomes and compact reads

DIP records a request when the prompt arrives. The agent must review that intent and record an outcome before handing it off. An ended turn, a Markdown checkbox and a similarity score do not complete development work.

`task_finish` saves a small, causal `task.update` receipt with an outcome, summary and replacement IDs. It uses the same ownership guard as intent updates.

| Outcome     | Recorded state               | Meaning                                                                                       |
| ----------- | ---------------------------- | --------------------------------------------------------------------------------------------- |
| answered    | implemented, kind discussion | An informational request was answered. It has no code-verification claim.                     |
| implemented | implemented                  | Implementation is declared; current configured evidence is still required.                    |
| superseded  | superseded                   | The requirement is tracked under explicit replacement task IDs. Replacements may remain open. |
| cancelled   | cancelled                    | Explicitly abandoned intent, with a reason.                                                   |

Use `kind: discussion` for informational requests. Existing records default to work until reviewed. Answered outcomes reject development scope, acceptance criteria or code evidence. Reopening work clears its receipt; explicitly change kind to work when a discussion becomes development.

```sh
dip task finish --id ID --outcome answered --summary "Explained the local MCP connection"
dip task finish --id ID --outcome implemented --summary "Implemented and tested" --check unit
dip task finish --id OLD_ID --outcome superseded --replacedBy CURRENT_ID --summary "Implemented under the replacement"
dip reconcile --kind work --open --limit 20
dip reconcile --id ID
dip task get --id ID
```

Pass the supplied hook actor and token when required. `implemented --check NAME` runs the project's configured command against a stable source/intent snapshot. Failed checks keep the task unverified and retain the caller's lease. Successful finishing releases the caller's lease. Other agents' ownership cannot be released by this action. Only use checks reviewed in the current project.

Stop hooks preserve recorded outcomes rather than appending a misleading automatic unfinished checkpoint. Without an explicit outcome, unfinished work remains open. Causal competing finishes remain conflicts requiring review. This is a protocol for the existing working agent, not an automatic semantic classifier or a guarantee that every host agent follows instructions.

Development queues and default dashboard views omit explicitly classified discussions. Select Discussions or All records to inspect them. Records and source events remain in Git. Superseded task details retain replacement IDs.

CLI `task get` and `reconcile` return compact summaries by default; reconciliation supports ID, kind, status, open-work and pagination filters. MCP uses the same summaries. Oversized intent is labelled truncated; use requirements/document section tools for focused details. `dip task get --id ID --full` and `dip reconcile --full` explicitly request raw history. No new model calls are used.

Verification freshness is separate from recorded implementation. Later scoped code, requirement or check changes can invalidate an older proof without implying that its feature was never implemented. Partial work belongs in a checkpoint and the remaining requirement stays open.
