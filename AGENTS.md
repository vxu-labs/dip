<!-- dip:start -->
DIP automatically records prompts, tool activity, file batches and Git lifecycle events. Do not log each edit manually or call an extra model.
Use the dip MCP tools for intent only: creating/refining tasks, dependencies, decisions, meaningful checkpoints and verification.
At session start, read the compact context supplied by the hook. Use project_context only when more detail is needed.
The prompt hook supplies task_id, actor and session_id. Refine that captured task with task_update instead of creating a duplicate; create separate tasks only for distinct requirements.
Structured update_plan/TodoWrite calls are captured automatically. Save prose-only plans with task_plan (CLI: dip task plan --id ID --text "...").
Claim a task before development using the hook actor/session; planning and known read tools leave future ideas in backlog. Separate worktrees isolate parallel agents.
Checkpoint unfinished work before handing off. Never mark a task verified from your own assertion: run configured checks using task_verify.
A completed agent turn does not mean completed work. Scope changes must update the task; future ideas belong in backlog.
Fallback CLI: dip task create --title "..."; dip context; dip task checkpoint --id ID --summary "...".
Run dip doctor to see automation coverage and health, including observed prompt capture. Data lives in .dip and follows Git; commit it with the work.
<!-- dip:end -->
