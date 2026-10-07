# Real Codex compaction and interruption

On 7 October 2026, a bounded Windows trial used Codex 0.160.0, GPT-6.1 Sol with high effort, DIP 0.3.11 and the supported app-server stdio transport. Existing user-approved hooks remained unchanged. The client confirmed their trust through `hooks/list`; it never bypassed hook trust. Fixture intent tools were authorized per process, and unrelated MCP servers were disabled for that process. No global approval settings changed.

| Check | Observed result |
| --- | --- |
| Native structured planning | `update_plan` was unavailable to the tested model. No native plan event or durable plan was recorded. The agent reported the limitation, saved criteria and kept both feature requirements in backlog. |
| Forced context compaction | `thread/compact/start` produced a completed host `contextCompaction` item and a completed `PreCompact` hook. DIP persisted the corresponding activity and an additional checkpoint. |
| Recovery after compaction | A subsequent turn delivered `SessionStart` and recovered the same CSV and Hebrew-header task IDs and criteria. Both remained backlog without verification. |
| Mid-command interruption | The agent wrote `probe.txt` with `PARTIAL` and entered a bounded timer command. `turn/interrupt` produced an interrupted turn and a completed `Interrupt` hook. The durable task remained `in_progress`, gained an automatic checkpoint, had no verification evidence and held no live lease. |

These are actual host observations, not manually invoked hooks. [Sanitized events and causal histories](2026-10-07-lifecycle.json) are replayed by `node scripts/codex-lifecycle-evidence.mjs`. An explicitly invoked live runner is available at `scripts/codex-live-lifecycle.mjs`; it requires an existing authenticated Codex host with already trusted DIP hooks and leaves its synthetic fixture and private transport log for audit.

The inventory-only initial client check incorrectly compared PascalCase names with the API's camelCase event names and stopped before a model turn. Correcting the comparison confirmed existing trust. The original local receipt was retained.

This was one synthetic session, manual compaction and cancellation through app-server, not a UI-click trial, independent memory comparison or multi-day reliability result. The post-compaction model also receives a host-generated summary. Native structured-plan delivery and live Claude remain unproven; the user confirmed Claude is not installed or authenticated. Installed-command fixtures do not establish live Claude coverage.

Official protocol references: [Codex app-server](https://learn.chatgpt.com/docs/app-server) and [Codex hooks](https://learn.chatgpt.com/docs/hooks). Use the product and execute cloned QA scripts at your own responsibility.
