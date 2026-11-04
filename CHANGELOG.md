# Changelog

## 0.4.3 — 2026-11-05

- Add project favorite stars, a Favorites-only directory filter and favorite-first project ordering. Favorites are shared by linked worktrees and persist locally across reloads and catalog/runtime-cache rebuilds.
- Store preferences separately from the generated catalog, serialize concurrent updates and protect preference changes with the local dashboard session token, origin checks and registered family IDs. Corrupt preferences are preserved and reported without blocking project registration.

## 0.4.2 — 2026-11-05

- Extend the private project catalog with folder, dashboard, local-workspace and live task-data links for each project and worktree.
- Add a separate `~/.dip/dashboard.html` launcher and `/local` workspace, reusing the main dashboard views, task actions and styling. Include project search, worktree switching, path copying and token-protected native folder opening.
- Add bounded `local_projects` MCP discovery and CLI catalog query/pagination. Inject directory knowledge into trusted prompts and session starts, including projectless sessions, without copying other projects' task bodies into every context.
- Upgrade owned agent instructions and portable guides with cross-project discovery guidance while preserving custom instructions and project-local ownership.
- Use the active catalog for HTTP root selection, preserve per-project task isolation, ignore obsolete refresh responses and avoid overlapping background refresh requests.

## 0.4.1 — 2026-11-05

- Add a single private local project index at `~/.dip/projects.json`, grouping linked worktrees and retaining independent repositories as separate projects.
- Refresh the index through initialization, agent/Git hooks, native Git and client discovery. Recorder filesystem signals handle removals and renames, with a five-second reconciliation fallback and startup rebuild.
- Add `dip projects` and project-index diagnostics to `dip doctor`. Serialize concurrent publishers through the runtime database and write atomically only when the index changes. Removing an active entry preserves historical registrations, semantic data and pending outbox records.
- Include available linked worktrees automatically and keep existing DIP projects discoverable when custom instruction files prevent integration repair.
- Fix fresh shared-storage initialization creating its `.dip` directory before writing configuration.

## 0.4.0 — 2026-11-02

### Changed

- Keep dynamic project intent once per Git worktree family, outside source checkouts. Synchronize semantic events through one orphan `dip/state` branch without changing the source HEAD or index during publication.
- Bound detailed local activity by age, per-project compressed bytes and a machine-wide budget. Keep source provenance, explicit file-list overflow, durable failure handoffs and hook-observation counters. Raw activity stays out of Git.
- Deduplicate evidence file maps into content-addressed compressed manifests while preserving historical evidence, causal parents and task conflicts.
- Add `dip storage` inventory, migration, retirement, retention, recovery and synchronization commands. Fleet migration preserves private compressed backups, reports unavailable roots and failures, and never force-pushes or publishes unrelated source commits.
- Complete the rollout's two initially missing remote destinations with authorized private GitHub repositories; verify metadata publication while preserving source worktrees.
- Update native Git hooks, CLI, doctor, navigation and the dependency-free portable helper for shared storage. Include the hosted dashboard metadata-branch adapter and compatibility tests.

### Compatibility

- Existing v1 data remains readable and explicitly migratable. Schema-2 configuration rejects legacy writers; use the updated runtime and portable helper after migration.
- Explicit migration cleanup creates metadata-only source commits and preserves staged/unstaged source changes. Detached/unborn checkouts preserve source identity; unresolved merges are reported.
- Historical Git objects, recovery archives and unsynchronized intent are preserved. Migration does not rewrite existing source history.

Validation and fleet rollout results are recorded in `docs/benchmarks/2026-11-02-storage-release.md`. Operational commands and recovery boundaries are in [the storage guide](docs/storage.md).
