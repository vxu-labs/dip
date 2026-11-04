# Local project index

DIP maintains one private, human-readable JSON catalog for the machine: `~/.dip/projects.json`. A custom `DIP_HOME` moves it to `$DIP_HOME/projects.json`. It lists available Git projects with valid DIP configuration, grouping linked worktrees by their Git common directory. Independent clones and unrelated repositories with the same folder name remain separate entries. Version 0.4.2 adds project links, a dedicated local dashboard and agent discovery.

```sh
dip projects       # Reconcile now and print the index, including its full path
dip projects --query my-app --limit 10
dip doctor         # Inspect index location, counts, update time and errors
```

Each entry contains a stable local family ID, name, primary checkout path, Git common directory, shared project UUID when available, and available worktree paths with their storage versions. Every project and worktree has `links.folder` (a file URL), `links.dashboard`, `links.localDashboard` and `links.tasks` (live task data). The top level contains `schemaVersion`, `projectCount`, `worktreeCount`, `dashboard`, `projects`, `errors` and `updatedAt`. The file contains no prompts, task bodies or activity logs and is not synchronized to Git. Tasks remain in each project's durable DIP storage; their links and explicit root-based reads return current data instead of a duplicated global task snapshot.

## Dedicated local dashboard

The separate `~/.dip/dashboard.html` file opens the local workspace at the running recorder's `/local` route, normally `http://127.0.0.1:4317/local`. The launcher follows the recorder's actual local endpoint, including a fallback port. Its contents are separate from the JSON catalog. The application HTML is `public/local.html`, sharing JavaScript, styling and task actions with the main dashboard.

The local directory lists project locations, dashboards and worktrees. Search projects by name or path, copy a path, open its folder in the native file manager, or select a project to use Overview, Work board, Activity and Schedule. Task actions always target that selected project. Each project also links to the ordinary dashboard scoped to its own root. Folder opening requires the same local session token and origin checks as other dashboard mutations, and accepts only catalogued project roots.

Browser restrictions can prevent direct `file:` navigation from a web page; the Open folder action and Copy path control provide explicit local access. The JSON file URLs remain useful to native clients and agents. The HTML launcher requires a running recorder; `dip start` starts it.

## Agent discovery across sessions

Trusted SessionStart and UserPromptSubmit hooks include a compact `localProjects` descriptor with the actual catalog path, local dashboard and supported discovery commands. Projectless sessions receive this descriptor without a fabricated project or task ID. Existing owned AGENTS.md/CLAUDE.md blocks, generated skills and portable guides also explain the catalog. Custom blocks and linked instruction files remain user-owned.

Use the `local_projects` MCP tool with an optional query, limit and offset, or `dip projects --query TEXT`. It works without a current Git project and returns absolute roots and links. Use a returned root with `project_context`, `project_reconcile`, `task_get` or other existing DIP tools; CLI equivalents include `dip status --root PATH` and `dip task requirements --root PATH --id ID`. Read project files using ordinary authorized filesystem tools. Discovery is read-only and does not adopt a task or grant ownership in another project.

The hook descriptor stays within the existing context budget and does not enumerate every project/task in every chat. Already-running MCP clients need to reconnect to see newly added tools; the injected file path and installed CLI are immediately usable by trusted hooks. Clients without a supported/trusted DIP hook must discover the tool or read the generated project instructions explicitly.

## Automatic updates and preservation

Registration updates it immediately: `dip init`, trusted agent/Git hooks, executable Git discovery and explicit library-client discovery all use the same runtime registration path. Available DIP worktrees are also discovered through Git's local worktree metadata. An existing DIP project can appear even if custom instructions prevent automatic integration repair; the repair error remains visible.

The running recorder reconciles at startup, on relevant filesystem notifications, and at least every five seconds as a fallback. Creating a new Git project under watched roots triggers normal discovery and DIP initialization. Removing or renaming a registered project updates the index; returning a previously unavailable project makes it visible again. Paths outside watched roots require an existing registration, native Git signal or client callback for first discovery, then receive the same reconciliation.

Missing project folders, removed Git worktrees and missing DIP configurations disappear from the active index. Invalid configurations appear in `errors` instead of being silently accepted. Disconnecting an external drive temporarily removes its entries until it returns. None of these operations deletes semantic history, queued writes or historical runtime registrations.

The file is a rebuildable projection of the local runtime registry and current filesystem, not a second source of project history. Do not edit it to add/remove projects. `dip projects` rebuilds a missing or damaged file; the running recorder also rebuilds it automatically. Without a running recorder, initialization/hooks still update it, while external folder deletion is reflected on the next hook or explicit refresh. Publishers are serialized through SQLite and use atomic replacement, so concurrent hooks cannot overwrite a newer registration with an older snapshot. Unchanged content does not rewrite the file or advance `updatedAt`. Newly written files have private permissions.
