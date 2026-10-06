# Adapter and platform compatibility

Node.js 24+ is required. The implementation uses built-in SQLite, which Node currently labels experimental. Runtime data is disposable for task projection but includes the durable local outbox and active leases; stop and flush the recorder before deleting it.

| Integration        | Implementation                                                                     | Verification                                                                       |
| ------------------ | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| MCP stdio          | Standard SDK server with concise intent/context tools and paginated reconciliation | Real client-to-server process tests                                                |
| Codex              | User hooks.json, hooks feature, MCP config; current documented hook schema         | Fixture inputs and installed configuration tests; host trust remains required      |
| Claude Code        | User settings.json hooks and user MCP registration                                 | Fixture inputs and installed configuration tests; workspace trust remains required |
| Git                | Global hooks plus preservation of repo-local overrides                             | Live init, clone, commit, merge and worktree tests                                 |
| Windows PowerShell | Managed profile block and hidden startup entry                                     | Live isolated profile and git-init test                                            |
| Bash and Zsh       | Managed shell functions and startup entry                                          | CI platform tests; see CI for current results                                      |
| Browser            | Local HTTP dashboard with responsive layout                                        | Headless Chromium desktop/mobile smoke and access-control tests                    |

An already-running agent must reload configuration. User hooks are subject to the agent's policies. Installing on a desktop does not deploy scripts to a remote/cloud execution host. Run installation on each execution host.

Machine discovery uses native recursive watchers with a periodic scan fallback. Independent clones and machines synchronize event history via Git but do not share live local leases. Supported in-flight tool IDs allow bounded recorder renewal; configured verification renews ownership itself. External workers can use `dip task heartbeat --id ID --token TOKEN`. `dip doctor` reports configuration and observed sources without asserting agent trust or reload.
