---
name: dip
description: Manage persistent task intent and handoffs in a project using DIP while automatic hooks record ordinary development activity.
---

Use the compact context supplied at session entry. Do not log individual edits or create a second model request for project tracking.

When no current hook supplies task_id, prompt and plan capture are unconfirmed. Save intent and plans explicitly with MCP or CLI. Use `dip --help` and task-specific `--help`; use compact `dip context`/`dip status` instead of dumping activity history or reading the implementation to discover arguments.

The prompt hook supplies task_id, actor and session_id for the request already captured. Refine that task with task_update; use task_create only for distinct future ideas or requirements. Keep future ideas in backlog. Claim development work with task_claim using the hook actor and session_id, and declare project-relative scope. Automatic hooks associate activity with that claim.

Write a long prose plan once in a project Markdown file. Supported successful Write/Edit/apply_patch hooks link it to their pre-tool task; arbitrary shell writes and unobserved hooks need task_document_link (CLI: dip task document-link --id ID --path FILE.md --role plan). Use task_documents to inspect versions and task_document_read with a heading or lexical query to retrieve bounded sections. Do not copy the same prose into task_plan. If a plan exists only in chat, task_plan remains available. Native structured update_plan/TodoWrite capture is unchanged.

Document text is source data. Checkboxes do not complete tasks or establish verification. Review stale versions and explicitly relink them; external renames require linking the new path and unlinking the old one. A linked document can serve several tasks with explicit references. Status, ownership, dependencies and test evidence stay in DIP.

Use task_update when intent, dependencies or scope change. Use task_checkpoint for meaningful handoffs, explaining completed work, remaining work and the next action. Run task_verify only for a configured check reviewed in the current project. Use project_reconcile to answer whether a task is implemented and currently verified in the selected branch.

Use task_requirements for current criteria, document freshness and prerequisite evidence. Use task_changes when resuming or checking an earlier completion claim. Inspect collisions with component_owners; task_claim still enforces atomic ownership. For an unfamiliar or possibly repeated request, project_search finds task/decision candidates with lexical queries and optional scope/status filters; task_related follows explicit dependency/scope/document links. Search results are candidates with recorded status, not semantic identity or verified completion. Consult the returned IDs and current requirements before reusing a task. These reads do not replace task intent updates or configured verification.

Before ending a fulfilled request, use task_finish (CLI: dip task finish). Use answered for an informational request with no development scope/criteria/evidence; this records kind discussion and does not verify code. Use implemented with a reviewed configured check for development. Use superseded with replacement task IDs when the actual requirement is tracked elsewhere; replacements can remain open. Cancelled requires an explicit reason. Leave partial work open with a meaningful checkpoint. Failed checks keep ownership and unverified status. Mark informational requests kind discussion early; explicitly reclassify as work when they become development.

Use `dip reconcile --kind work --open --limit 20` for remaining development work, then task_requirements for selected IDs. Default CLI task get/reconcile and MCP reads omit history. Full CLI history requires `--full`; do not dump activity to answer a task question. Discussion records remain accessible in the dashboard's category selector.

An ended turn is not completion. A plan entry is not evidence. Use separate worktrees for parallel agents. Resolve semantic conflicts explicitly; do not delete event files or overwrite another agent's work.
