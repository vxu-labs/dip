# Follow-up intent without duplicate work

The current agent makes the relationship decision. DIP does not call an extra classifier or automatically infer semantic identity.

1. Read the current hook task. For a possible repeat, use `project_search`, `task_related` and `task_requirements` to inspect existing candidates and their current criteria/evidence.
2. If it is the same requirement, call `task_adopt` with the captured `id`, reviewed `targetId`, hook `actor` and `session`, a short relationship `summary` and any changed intent `patch`. The source must be an undeveloped captured prompt. DIP refines the target, supersedes the duplicate with a replacement reference and selects the target for subsequent hooks/planning. Claim the target separately before development.
3. A distinct future idea uses `task_create`, stays in backlog and does not take ownership. An informational question uses `kind: discussion` and finishes with `answered`. A discussion that becomes development must be explicitly reclassified as work.
4. Long Markdown plans are written once and linked. `task_plan` saves a plan that exists only in chat or when native planning capture is unconfirmed. Hook-captured structured plans follow the selected task.
5. Finish implemented work using a reviewed configured check. A plan marked completed, a successful shell command or an ended turn does not establish task verification. Interrupted work stays open with a checkpoint.

CLI example:

```text
dip task adopt --id CAPTURED_ID --targetId EXISTING_ID --actor codex:SESSION --session SESSION --summary "Same export requirement with revised headers"
dip task update --id EXISTING_ID --kind discussion
```

Adoption accepts intent fields, not status/proof assertions. Both histories and owners are checked before writes; foreign owners, unrelated sessions, conflicts and cancelled/superseded targets are rejected. A source that already has development scope, criteria, documents or evidence must be preserved as work and reconciled explicitly, rather than consumed as a duplicate prompt.

The target refinement, source receipt and local session binding are separate durable steps. Retrying the same operation after interruption completes missing steps without repeating unchanged intent. They are not a cross-file transaction; inspect records if an external failure interrupts adoption. Other concurrent agents still require atomic claims.

Without confirmed hooks, explicitly read/select/refine an existing task or create a distinct request, and save the plan/checkpoint through CLI/MCP. Without installed DIP, use the reviewed [portable helper](portable.md) for durable intent. No skill can guarantee that every agent follows this protocol; automatic semantic routing remains separate research.
