# First project walkthrough

Install Node.js 24+, then run `npm install -g github:itayzrihan/dip` and `dip install`. Restart your terminal and coding tools and approve the installed hooks in your agent when prompted.

Open any existing Git project with Codex or Claude Code. The session hook initializes the ledger and injects a compact context. Ask the agent to remember a future feature, then begin a separate implementation task. Open http://127.0.0.1:4317 and select the project to see both requests and automatic activity.

Ask the agent to save a handoff and stop midway. Start another session, read the injected handoff and claim the unfinished task using its new actor identity. Ordinary edits do not need manual logging.

Add a named command-array check in `.dip/config.json`. Ask the agent to run `task_verify` for that check, then use `project_reconcile` to inspect verification against current code. Commit the work with ledger data. Editing relevant code afterwards makes evidence stale.

Run `dip doctor` when a hook is disabled, untrusted or absent. Add project roots once with `dip install --roots PATH` for repositories created by external tools outside your home directory. The terminal and agent-entry triggers also initialize projects outside monitored roots.
