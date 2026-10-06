# Adapter and platform compatibility

Node.js 24+ is required. The implementation uses built-in SQLite, which Node currently labels experimental. Runtime data is disposable for task projection but includes the durable local outbox and active leases; stop and flush the recorder before deleting it.

| Integration        | Implementation                                                                     | Verification                                                                               |
| ------------------ | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| MCP stdio          | Standard SDK server with concise intent/context tools and paginated reconciliation | Real client-to-server process tests                                                        |
| Codex              | User hooks.json, hooks feature, MCP config; current documented hook schema         | Fixture inputs and installed configuration tests; host trust remains required              |
| Claude Code        | User settings.json hooks and user MCP registration                                 | Fixture inputs and installed configuration tests; workspace trust remains required         |
| Git                | Global hooks plus preservation of repo-local overrides                             | Live init, clone, commit, merge and worktree tests                                         |
| Native Git Trace2  | Global event target with a local background consumer; no executable replacement    | Raw-executable minor-command tests on unmonitored repos; actual Windows installation smoke |
| Windows PowerShell | Managed profile block and hidden startup entry                                     | Live isolated profile and git-init test                                                    |
| Bash and Zsh       | Managed shell functions and startup entry                                          | CI platform tests; see CI for current results                                              |
| Browser            | Local HTTP dashboard with responsive layout                                        | Headless Chromium desktop/mobile smoke and access-control tests                            |

An already-running agent must reload configuration. User hooks are subject to the agent's policies. Installing on a desktop does not deploy scripts to a remote/cloud execution host. Run installation on each execution host.

After user approval, a real Codex UI prompt was observed in `.dip` and its task identity was injected into the agent. A live test exposed the old general PostToolUse matcher: negative lookahead is unsupported by Codex's Rust regex engine. v0.3.4 uses `.*` and a Node-side `--skip-plan-tools` filter, retaining synchronous ordered plans. After the user separately approved the updated definition, a real shell probe produced both PreToolUse and PostToolUse records with the same tool-call ID, task and session. Ordinary shell and MCP post records were also observed. This proves those delivered paths in this trusted session; it does not establish native plan-tool delivery, every lifecycle event or long-running reliability. Changed definitions require fresh host review.

Claude Code uses the same lifecycle concept but reads `~/.claude/settings.json` and applies its own workspace trust. Codex approval does not approve Claude. DIP captures Claude `TodoWrite` and injected `ExitPlanMode` prose through its adapter. This adapter has command/fixture coverage; a trusted model-backed Claude Code run is still required. See the official [Claude hooks reference](https://code.claude.com/docs/en/hooks#workspace-trust).

Machine discovery uses native recursive watchers with a periodic scan fallback. Independent clones and machines synchronize event history via Git but do not share live local leases. Supported in-flight tool IDs allow bounded recorder renewal; configured verification renews ownership itself. External workers can use `dip task heartbeat --id ID --token TOKEN`. `dip doctor` reports configuration and observed sources without asserting agent trust or reload.
