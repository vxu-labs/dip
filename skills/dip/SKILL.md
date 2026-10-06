---
name: dip
description: Manage persistent task intent and handoffs in a project using DIP while automatic hooks record ordinary development activity.
---

Use the compact context supplied at session entry. Do not log individual edits or create a second model request for project tracking.

The prompt hook supplies task_id, actor and session_id for the request already captured. Refine that task with task_update; use task_create only for distinct future ideas or requirements. Keep future ideas in backlog. Structured update_plan/TodoWrite calls are saved automatically; use task_plan for a prose-only plan. Claim development work with task_claim using the hook actor and session_id, and declare project-relative scope. Automatic hooks associate activity with that claim.

Use task_update when intent, dependencies or scope change. Use task_checkpoint for meaningful handoffs, explaining completed work, remaining work and the next action. Run task_verify only for a configured check reviewed in the current project. Use project_reconcile to answer whether a task is implemented and currently verified in the selected branch.

An ended turn is not completion. A plan entry is not evidence. Use separate worktrees for parallel agents. Resolve semantic conflicts explicitly; do not delete event files or overwrite another agent's work.
