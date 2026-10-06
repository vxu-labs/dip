# Native Git discovery

Installing DIP enables Git's native `trace2.eventTarget` in the user's global Git configuration, when it is available and no unrelated active event target exists. A capability probe checks that the installed Git executable actually emits Trace2 files.

This works without a terminal function or shell profile. When Git identifies a local worktree, the running DIP recorder consumes its completed native signal, initializes `.dip` if needed and registers the project for file capture. This includes small commands such as `git status`, `git diff`, `git branch`, `git ls-files`, `git rev-parse`, and repository-local `git config`, including commands invoked with `git -C` or an absolute executable path. A project need not be under a watched discovery root. Adoption normally happens on the next recorder tick after the Git process completes.

Git has no universal hook for every subcommand. Native discovery complements lifecycle hooks, agent entry and filesystem discovery. It does not replace the Git executable, change its stdout/exit status, or make network/model calls. Routine reads in an already adopted project do not add a new ledger entry for every poll; a `git.discovered` event records adoption. Regular development activity continues through the existing recorder integrations.

## Privacy and preservation

Git writes private per-process files under the machine runtime's `git-trace` directory. These temporary files can contain raw command arguments and configured trace metadata. DIP copies only worktree identity and a short command name into its durable discovery record; argv, config values and environment data are not copied. Successfully consumed completed files are deleted. Failed project adoption retains its signal for retry; interrupted files may remain until their process finishes or abandoned-file cleanup runs. Keep the recorder running and protect the private runtime directory.

DIP disables Trace2 for its own internal Git calls to avoid recursive discovery. It preserves an unrelated active event target and reports the conflict rather than silently replacing it. Uninstall restores the prior owned setting. Use `dip install --no-git-discovery` to avoid enabling this integration on a fresh installation. `dip doctor` reports whether native discovery is configured and running, pending native files, and detected configuration conflicts.

## Boundaries

The recorder must be running. Completed native files remain queued while it is stopped and are processed when it starts again. A command that does not open/identify a local worktree, such as `git --version`, cannot identify a project to initialize. Bare repositories are not project working trees.

Programs using an independent Git library rather than the configured Git executable may not emit Trace2. Another execution host, a separate user/global configuration, or an overriding `GIT_TRACE2_EVENT` environment variable also needs separate integration. This mechanism therefore covers compatible native Git execution, rather than every possible Git implementation.

See Git's official [Trace2 API](https://git-scm.com/docs/api-trace2) and [Trace2 configuration](https://git-scm.com/docs/git-config#Documentation/git-config.txt-trace2eventTarget).
