# Explicit Git-library client discovery

Native Git Trace2 cannot observe an independent Git library. DIP now exposes a local callback adapter:

```text
dip discover-project --client isomorphic-git --root WORKTREE
dip discover-project --client isomorphic-git --root WORKTREE --probe
dip discover-project --client isomorphic-git --root WORKTREE --disabled
```

A client invokes it from its workspace-open or Git-operation callback, passing real local worktree context. Library integration can call `discoverClientProject(cwd, { client })` from `src/client-discovery.js` or spawn the installed CLI with an argument array. No executable shim or Trace2 event is required. The adapter initializes repository policy/skills, registers the worktree and durably captures a minimal `client.discovered` event without copying argv or source contents.

The new test uses pinned `isomorphic-git` 1.43.1 to [initialize](https://isomorphic-git.org/docs/en/init) and inspect a real repository through [statusMatrix](https://isomorphic-git.org/docs/en/statusMatrix), invokes the adapter in a nested directory, and verifies unchanged client status and Git configuration. Native tracing is disabled and the project is outside discovery roots. This proves the callback, not universal interception of all library calls.

| Surface                                                | Coverage                                                                |
| ------------------------------------------------------ | ----------------------------------------------------------------------- |
| Compatible native Git worktree command                 | Existing Trace2 consumer, while enabled/running                         |
| Independent Git library with explicit callback         | New local client adapter; verified with isomorphic-git                  |
| Independent library without callback                   | Unobserved                                                              |
| Trusted local coding-host startup/prompt               | Existing hook adoption, subject to host delivery/trust                  |
| Native linked worktree                                 | Supported local worktree identity; shares the local Git-family runtime  |
| Environment override disables/redirects native tracing | Native path can be bypassed; explicit client callback remains available |
| Remote host                                            | Requires an adapter/runtime on that host and actual host-local context  |
| Bare repo, no local worktree or missing path           | `no_local_worktree_context`, no initialization                          |
| Explicit disabled callback                             | `adapter_disabled`, no initialization                                   |
| Read-only probe                                        | Reports supported context and ledger presence, no initialization        |

The adapter does not wrap the client's Git command and therefore cannot change its stdout or exit status. Existing Git hook preservation rules still apply during repository setup. It makes no network/model calls and does not configure third-party clients automatically. Report support honestly rather than promising every Git operation is intercepted.
