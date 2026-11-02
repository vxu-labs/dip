# Changelog

## 0.4.0 — 2026-11-02

### Changed

- Keep dynamic project intent once per Git worktree family, outside source checkouts. Synchronize semantic events through one orphan `dip/state` branch without changing the source HEAD or index during publication.
- Bound detailed local activity by age, per-project compressed bytes and a machine-wide budget. Keep source provenance, explicit file-list overflow, durable failure handoffs and hook-observation counters. Raw activity stays out of Git.
- Deduplicate evidence file maps into content-addressed compressed manifests while preserving historical evidence, causal parents and task conflicts.
- Add `dip storage` inventory, migration, retirement, retention, recovery and synchronization commands. Fleet migration preserves private compressed backups, reports unavailable roots and failures, and never force-pushes or publishes unrelated source commits.
- Update native Git hooks, CLI, doctor, navigation and the dependency-free portable helper for shared storage. Include the hosted dashboard metadata-branch adapter and compatibility tests.

### Compatibility

- Existing v1 data remains readable and explicitly migratable. Schema-2 configuration rejects legacy writers; use the updated runtime and portable helper after migration.
- Explicit migration cleanup creates metadata-only source commits and preserves staged/unstaged source changes. Detached/unborn checkouts preserve source identity; unresolved merges are reported.
- Historical Git objects, recovery archives and unsynchronized intent are preserved. Migration does not rewrite existing source history.

Validation and fleet rollout results are recorded in `docs/benchmarks/2026-11-02-storage-release.md`. Operational commands and recovery boundaries are in [the storage guide](docs/storage.md).
