# Shared storage and migration (protocol 2)

DIP 0.4 stores dynamic history once per local Git worktree family. Source branches retain their code, check configuration, instructions and portable helper. The durable shared store is under `git rev-parse --git-common-dir`, in `dip/`. Do not delete that directory as a cache: it contains the local journal, unsynchronized intent and private recovery archives.

`dip/state` is the single reserved metadata branch. It has an independent root and contains compact semantic events plus content-addressed, gzip-compressed snapshot manifests. DIP updates it without checking it out or changing the source index. Never merge it into a source branch. Normal metadata publication does not move the source HEAD. Explicit migration cleanup creates a metadata-only source commit; entry into an old source branch can perform that same one-time cleanup through the updated Git hook.

## Commands

```sh
dip storage status
dip storage branches
dip storage migrate --dry-run
dip storage migrate --cleanup
dip storage migrate --all --dry-run
dip storage migrate --all --cleanup --push
dip storage sync --push --remote origin
dip storage maintain
dip storage restore --path /private/backup/migration.ndjson.gz
```

`--all` inventories registered existing DIP projects and groups their linked worktrees by Git common directory. Missing/archived temporary roots are reported separately, not recreated. Independent repositories with identical names remain separate. A project without a remote can migrate locally. Errors are recorded per family and the command exits unsuccessfully if any family failed. The private machine report is `$DIP_HOME/storage-migration-latest.json` (normally `~/.dip/`). Successful fleet migration sets the machine default for future discovered projects to shared storage. Explicit `dip init` defaults to shared; `--storage legacy` retains compatibility for an isolated v1 project.

`--push` publishes metadata only, to the selected existing remote. It never pushes unrelated local source commits or force-pushes. Publishing implementation source is a separate ordinary Git push. A normal source pre-push hook also synchronizes the metadata branch to that same remote. Runtime maintenance checkpoints metadata locally; it does not initiate network publication.

## Migration and recovery

The importer reads every linked working tree, including untracked events, and semantic histories at available local/remote-tracking branch tips. It deduplicates event IDs, checks payload compatibility, validates parents and cycles, and stores snapshot file maps once per content hash. Real concurrent intent conflicts remain conflicts. A conflicting reused event ID stops that family rather than silently selecting content.

Before activation or cleanup, migration finishes and fsyncs a private compressed NDJSON archive under `<common>/dip/backups/`. The archive includes a project identity, original events and configuration checksums. Raw diagnostic activity can expire in the new store while remaining available in this recovery archive. Backups are intentionally excluded from the metadata branch. Fleet reports contain local paths and stay private too.

With `--cleanup`, the importer removes the imported branch-local event files, changes the code configuration marker to schema 2 and creates a commit containing only metadata removal/configuration. Staged and unstaged source content remains intact. Detached checkouts keep their source HEAD and hide migrated metadata entries locally; unborn checkouts remove only staged metadata entries. Unresolved merges are reported rather than rewritten. Re-running import preserves event identity. A fresh clone can recover shared history from its fetched `dip/state` ref without a global runtime database. Fetch that branch explicitly when using a single-branch clone.

`storage restore` restores semantic events and manifests into the selected repository from the verified archive. It refuses a different existing project identity or conflicting event content. It does not overwrite source/configuration, replay expired raw activity, or assert that historical checks are current. Prefer a separate checkout for a recovery rehearsal. Use an updated DIP binary; old binaries reject schema-2 project configuration. Older portable helpers must be upgraded before writes. Arbitrary legacy binaries intentionally run against old checkouts are outside the v2 writer contract.

Do not downgrade a migrated installation to a legacy writer. Workflow rollback to `reviewed` is supported with the new binary; storage-format downgrade requires restoring a matching legacy checkout and archived metadata explicitly.

Migration does not rewrite Git history. Old event blobs reachable through source commits, tags or reflogs continue consuming Git storage. Historical cleanup is a separate coordinated operation; automatic migration never rewrites or force-pushes it.

## Retention and storage accounting

Default detailed activity retention is seven days and 32 MiB of compressed payload per family, whichever limit is reached first. The machine-wide compressed activity budget is 256 MiB. Intake enforces the family budget and evicts old diagnostic records when the global budget is exceeded; maintenance also checkpoints WAL and reclaims free pages. The global limit can have transient in-flight overhead during concurrent intake. Recorder and supervisor diagnostic logs keep a rolling tail after crossing 4 MiB, preserving open append handles. Native Git traces retain their existing completed/abandoned-file drain policy. Database indexes, SQLite pages, WAL, backup archives and historical Git objects have separate overhead and are shown separately; the activity budget is not a promise about the size of the whole repository.

```sh
dip storage configure --patch '{"activityDays":7,"activityBytes":33554432,"globalActivityBytes":268435456,"maxFiles":128}'
```

The global setting applies to all shared stores registered on the machine. Explicit detailed auditing can increase these values for a declared period; it still has a finite size limit. Requests, requirements, plans, decisions, handoffs, necessary evidence and unsynchronized semantic writes are never evicted by the diagnostic retention policy. A bounded task handoff retains tool failures after their raw detail expires. Cumulative hook-observation counters remain available to doctor after raw activity expiry.

Large file notifications retain a count, hash, bounded path sample and `filesTruncated: true`. They are not represented as a complete file diff. Commands are retained at the operation start rather than duplicated at both boundaries. Original worktree, branch, HEAD and operation identity are captured before queue flush. No additional model is called for filtering or tracking.

`dip storage status` reports compressed semantic and artifact bytes, database/WAL file sizes and allocated blocks, backup archives, retention and publication state. Shared runtime queues and navigation indexes remain separate machine resources; missing-root outbox entries are retained for recovery, never treated as disposable raw logs. Durable semantic history can grow with the amount of work: preserving it indefinitely cannot have a fixed total size ceiling.

## Branches and consumers

Task requirements are project-wide. Verification remains bound to the selected worktree's source snapshot, check command and requirement/document fingerprints. A recorded verified status from a feature branch is historical when the selected source does not match. Neither metadata synchronization nor a successful check in another branch establishes current implementation on `main`. Detached HEAD is identified by commit rather than an invented branch name. Remote-tracking refs represent the most recent local fetch, not live knowledge of the server.

Filtered clones materialize only required metadata blobs in batches, without downloading source/media blobs. This uses Git’s [explicit missing-object controls](https://git-scm.com/docs/git#Documentation/git.txt---no-lazy-fetch). Concurrent metadata synchronization imports immutable events and manifests, preserves their original causal parents and publishes a commit containing both histories. `update-ref` checks the expected old OID. Remote updates use ordinary fast-forward pushes. A remote race or network failure is visible; local semantic data and the durable outbox remain intact for retry. Git synchronization does not provide cross-machine live leases.

The portable helper supports v1 with Node 20+ and v2 local SQLite with Node 24+. It can read a fetched metadata branch without a global package and persist intent through a private spool; normal v2 reads drain that spool atomically. It cannot establish leases or current verification, and strict-mode writes still require the installed runtime.

Hosted GitHub consumers must read/write `dip/state` when available while retaining the selected code branch separately. The companion adapter/patch under `integrations/hosted-dashboard/` updates the existing hosted dashboard with genuine-404 legacy fallback and non-forced writes. Deploy an updated hosted consumer before relying on it for newly synchronized v2 work. Snapshot file manifests stay in the metadata artifact store; a remote dashboard does not infer local code verification from their existence.

See [the design and original inventory](plans/storage-and-branch-isolation.md) and [the reproducible synthetic storage measurement](benchmarks/2026-11-02-storage.json). The benchmark includes retained historical Git objects, three worktree copies, the private archive and shared database; it is not a real-host speed or model-quality claim.
