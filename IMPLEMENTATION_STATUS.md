# Implementation and release evidence

DIP v0.3.1 implements the persistent local workflow described in MVP_PLAN.md. The runtime uses JavaScript ESM on Node.js 24, Zod schemas, SQLite and a browser dashboard without a build step. This replaces the proposed TypeScript/React stack to keep source installation and local hooks simple.

The public repository is maintained under [VXU Labs](https://github.com/vxu-labs/dip), with package identity `@vxu-labs/dip`. Cross-worktree worker visibility and locally waiting claims extend the original coordination workflow. Node 24 CI runs on Windows, Linux and macOS; Linux also runs the browser smoke test.

| Requirement                              | Current implementation                                                                               | Evidence                                                   |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Apache-2.0 open source                   | Canonical LICENSE, NOTICE, package metadata, contributor policy                                      | License file and package packing                           |
| Persistent tasks, plans and future ideas | Captured prompt identity, latest structured/prose plans, immutable events, dependencies and handoffs | Core/workflow tests, real MCP and installed command checks |
| Low-token automatic activity             | Lifecycle hooks, a durable batched outbox, Git hooks and file watchers; no model client              | Hook tests and benchmark script                            |
| Existing/new repo adoption               | Install scan, root watcher, periodic scan, agent entry, shell init/clone integration                 | Discovery test, PowerShell test, Git trigger tests         |
| Parallel local agents                    | Atomic task/scope claims, lease tokens, isolated worktree support                                    | Independent-process race and worktree tests                |
| Truthful completion                      | Command evidence, code snapshots, stale verification and branch integration checks                   | Verification, dependency drift and uncommitted-code tests  |
| Visual dashboard                         | Project picker, work board, activity, details, handoffs and verification controls                    | Browser smoke and desktop/mobile images                    |
| Preserve user integrations               | Additive agent config, original Git hook chaining and uninstall restoration                          | Installation and Git hook tests                            |

The global recorder requires installation on each execution host and trusted/enabled agent hooks. Supported native Git Trace2 execution also discovers worktrees outside configured roots, including status/diff calls. The dashboard and doctor expose actual prompt delivery rather than inferring it from installed settings. No product can observe an operation through a hook that the host bypasses or disables.

Live coordination between separate machines, advanced schedule/capacity planning and GitHub Issues synchronization remain future extensions. Adapter payload/configuration tests do not substitute for a live test on every Codex/Claude product surface; the compatibility table states that distinction.
