# Live Codex intent workflow, 7 October 2026

The subsequent [app-server lifecycle trial](lifecycle.md) verified real `PreCompact`, post-compaction recovery and `Interrupt` against durable state with DIP 0.3.11. Native `update_plan` remained unavailable and Claude remained absent. The earlier observations below retain their original version and scope.

This is bounded integration QA with Codex CLI 0.160.0 and GPT-6.1 Sol on Windows, not an agent-quality benchmark or performance comparison. Claude Code was not installed or authenticated; live Claude coverage remains open.

## Protocol and results

The initial trial used DIP 0.3.9, `workspace-write` and approval policy `never`. Trusted hooks injected the captured task identity and delivered SessionStart, UserPromptSubmit, PreToolUse, Stop and SessionEnd. Shell provisioning failed before execution. Six different MCP calls were approval-blocked. No plan or distinct future idea became durable. Process exit zero did not establish workflow success.

Follow-up trials used DIP 0.3.10 and `danger-full-access`, matching the authorized local QA environment, while retaining approval policy `never`. Hook definitions and their existing user trust were preserved. No hook-trust bypass, global policy change, other agent, installation by the tested agent or product implementation was authorized. Changing sandbox mode is a confound: improvements cannot be attributed to DIP alone, and the original sandbox is not proven working.

| Trial                                    | Durable result                                                                                                                                             | Limit                                                                                                          |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Initial planning                         | Captured request refined into CSV export; three pending prose steps saved; distinct Hebrew-header backlog with UTF-8 and order criteria                    | Native update_plan unavailable; MCP worked in this environment                                                 |
| Same-session resume                      | Existing idea gained empty-export header-order criterion; captured follow-up superseded through reviewed adoption; both future requirements stayed backlog | Agent read a QA snapshot as well as DIP; not an independent memory test                                        |
| New session, MCP disabled per invocation | Installed CLI recovered the same IDs, plan, updated criteria and handoff; no duplicate feature requirements; QA discussion answered                        | Earlier transcripts/snapshots moved outside the project; prompt forbade reading them; not a long-duration test |

Actual positive sessions delivered SessionStart, UserPromptSubmit, PreToolUse, PostToolUse, Stop and SessionEnd. These came from the real host and durable ledger, without manual hook invocation. The new-session run made zero MCP calls. Neither future feature has verification evidence or was declared implemented.

## Improvements and evidence

Standalone literal `Get-Content` and `cat` reads preserve future backlog without taking a development lease. Compounds, expressions, redirections, wrappers and unknown options retain coordination. This is status classification, not a shell security boundary.

Generated and packaged instructions stop retrying an unavailable or approval-blocked MCP route and use installed CLI only when shell execution is authorized. They preserve host approval and hook trust. CLI-only recovery was tested; a blocked-MCP-to-CLI transition was not separately proven in one successful turn.

[Sanitized evidence](2026-10-07-codex.json) contains the original failure, CLI event projections, final responses, hook receipts, task snapshots and causal histories. Full private logs remain local; their hashes identify them. Public evidence omits ordinary command output and private paths. Replay reconstructs task state from these histories and checks plan/criteria/status, session identity, hook receipts, and MCP versus CLI paths:

```sh
node scripts/host-qa-evidence.mjs
node --test test/host-qa.test.js
```

Replay does not rerun the model or prove delivery on another machine. Native structured planning, forced compaction, Interrupt, trusted Claude and multi-day reliability remain open under DIP-L01. Use DIP at your own responsibility and review permissions and captured data before publication.
