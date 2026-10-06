<!-- dip:start -->
DIP automatically records prompts, tool activity, file batches and Git lifecycle events. Do not log each edit manually or call an extra model.
Use the dip MCP tools for intent only: creating/refining tasks, dependencies, decisions, meaningful checkpoints and verification.
At session start, read the compact context supplied by the hook. Use project_context only when more detail is needed.
Claim a task before working; the hook creates a lightweight request/task if none is selected. Separate worktrees isolate parallel agents.
Checkpoint unfinished work before handing off. Never mark a task verified from your own assertion: run configured checks using task_verify.
A completed agent turn does not mean completed work. Scope changes must update the task; future ideas belong in backlog.
Fallback CLI: dip task create --title "..."; dip context; dip task checkpoint --id ID --summary "...".
Run dip doctor to see automation coverage and health. Data lives in .dip and follows Git; commit it with the work.
<!-- dip:end -->
