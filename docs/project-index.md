# Local project index

DIP 0.4.1 maintains one private, human-readable JSON file for the machine: `~/.dip/projects.json`. A custom `DIP_HOME` moves it to `$DIP_HOME/projects.json`. It lists available Git projects with valid DIP configuration, grouping linked worktrees by their Git common directory. Independent clones and unrelated repositories with the same folder name remain separate entries.

```sh
dip projects       # Reconcile now and print the index, including its full path
dip doctor         # Inspect index location, counts, update time and errors
```

Each entry contains a stable local family ID, name, primary checkout path, Git common directory, shared project UUID when available, and available worktree paths with their storage versions. The top level contains `schemaVersion`, `projectCount`, `worktreeCount`, `projects`, `errors` and `updatedAt`. The file contains no prompts, task bodies or activity logs and is not synchronized to Git.

Registration updates it immediately: `dip init`, trusted agent/Git hooks, executable Git discovery and explicit library-client discovery all use the same runtime registration path. Available DIP worktrees are also discovered through Git's local worktree metadata. An existing DIP project can appear even if custom instructions prevent automatic integration repair; the repair error remains visible.

The running recorder reconciles at startup, on relevant filesystem notifications, and at least every five seconds as a fallback. Creating a new Git project under watched roots triggers normal discovery and DIP initialization. Removing or renaming a registered project updates the index; returning a previously unavailable project makes it visible again. Paths outside watched roots require an existing registration, native Git signal or client callback for first discovery, then receive the same reconciliation.

Missing project folders, removed Git worktrees and missing DIP configurations disappear from the active index. Invalid configurations appear in `errors` instead of being silently accepted. Disconnecting an external drive temporarily removes its entries until it returns. None of these operations deletes semantic history, queued writes or historical runtime registrations.

The file is a rebuildable projection of the local runtime registry and current filesystem, not a second source of project history. Do not edit it to add/remove projects. `dip projects` rebuilds a missing or damaged file; the running recorder also rebuilds it automatically. Without a running recorder, initialization/hooks still update it, while external folder deletion is reflected on the next hook or explicit refresh. Publishers are serialized through SQLite and use atomic replacement, so concurrent hooks cannot overwrite a newer registration with an older snapshot. Unchanged content does not rewrite the file or advance `updatedAt`. Newly written files have private permissions.
