---
name: dip
description: Manage persistent task intent and handoffs in a project using DIP while automatic hooks record ordinary development activity.
---

Use the compact context supplied at session entry. Do not log individual edits or create a second model request for project tracking.

Save future ideas and substantial requirements with task_create. Claim work with task_claim using the actor and session_id from the hook, and declare project-relative scope. Automatic hooks associate activity with that claim.

Use task_update when intent, dependencies or scope change. Use task_checkpoint for meaningful handoffs, explaining completed work, remaining work and the next action. Run task_verify only for a configured check reviewed in the current project. Use project_reconcile to answer whether a task is implemented and currently verified in the selected branch.

An ended turn is not completion. A plan entry is not evidence. Use separate worktrees for parallel agents. Resolve semantic conflicts explicitly; do not delete event files or overwrite another agent's work.
