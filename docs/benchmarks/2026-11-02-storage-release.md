# Shared storage 0.4.0: validation and local rollout

Date: 2026-11-02. Protocol: 2. Runtime: Node 24.5.0 on macOS.

Dynamic intent now lives once per Git worktree family in `<git-common-dir>/dip/`. The single orphan `dip/state` branch synchronizes semantic events and compressed snapshot manifests. Publication uses a temporary index and expected-old-OID updates; it never checks out the metadata branch. Raw activity remains local, with seven-day/32-MiB family limits and a 256-MiB machine budget. The [storage guide](../storage.md) describes accounting, recovery and compatibility.

## Current checks

- Full serial Node suite: 190 tests, 188 passed, two platform skips, zero failures (59.99 seconds). This includes 20 shared-storage regressions covering migration fidelity, staged-only events, idempotence, archive restore, stale-lock recovery, portable spooling, bounded activity, source/index preservation, detached checkouts, branch provenance, concurrent clone synchronization and genuine semantic conflicts.
- Partial-clone regression: metadata blobs materialize in batches; source/media blobs remain missing and the existing `blob:none` filter stays unchanged.
- All JavaScript syntax checks passed. A clean 0.4.0 package passed archive/install/version/discovery/task/context/document-link/uninstall smoke checks.
- Browser smoke passed using installed Google Chrome, including task creation, handoff, cross-worktree navigation, mobile layout and 14 draft-response regressions; no browser JavaScript errors.
- Hosted dashboard: 26 Node tests passed, TypeScript check and production build passed. The updated source was published and deployment reached `succeeded`, version 11, at [the existing DIP site](https://dip.itayzen.chatgpt.site). Its selected source branch remains separate from `dip/state`; legacy fallback occurs only on a genuine 404. The companion source adapter and patch are in `integrations/hosted-dashboard/`.

## Reproducible storage measurement

Run `node scripts/storage-benchmark.mjs docs/benchmarks/2026-11-02-storage.json`. The [machine-readable result](2026-11-02-storage.json) uses three worktrees, 101 semantic events, 100 repeated evidence snapshots containing 7,000 paths, and 500 file notifications containing 7,000 paths each.

| Measure                                         |       Result |
| ----------------------------------------------- | -----------: |
| Allocated bytes before                          |  659,685,376 |
| Allocated bytes after                           |   82,157,568 |
| Reduction                                       |       87.55% |
| Migration                                       | 9.68 seconds |
| Semantic events preserved                       |    101 / 101 |
| Repeated snapshot manifests after deduplication |            1 |
| Evidence maps readable                          |          All |
| Read latency p50 / p95                          | 816 / 956 ms |

Both sides include historical Git objects; the result after migration additionally includes the private recovery archive and shared SQLite/WAL. This is a synthetic storage experiment, not a real recorder/checkout latency trial. Allocated blocks are not exclusive APFS physical usage. Existing Git history was neither rewritten nor garbage-collected.

## Existing-project rollout

The private inventory found 58 available Git families containing 79 worktrees. All 58 migrated successfully, with zero final migration failures. The audited snapshot contained 11,303 semantic events. Another 64 registered roots were absent historical/temporary worktrees; their registrations and pending outbox records were preserved, and no missing checkout was recreated.

Ten families with semantic data and configured GitHub targets published their metadata. Two existing Sites source repositories published metadata through their native source credentials; the DIP dashboard also received the application compatibility deployment above. Empty vendor/system repositories did not publish branches to unrelated upstreams. Two families with semantic data had no configured or known source target: `derech` and `VIDITOR`. Their migration and private backups completed locally; remote publication requires an actual destination.

The final inventory and recovery details remain local in `$DIP_HOME/storage-migration-latest.json` (normally `~/.dip/`), rather than publishing private project paths. Machine installation now defaults newly discovered projects to shared storage. Owned portable helpers and Git hook wrappers were upgraded across available worktrees. Restart long-lived pre-upgrade MCP clients to load the new runtime.

Illustrative checkout measurements after migration:

| Checkout                           | Local `.dip` allocated bytes | Shared family store, including private backups |
| ---------------------------------- | ---------------------------: | ---------------------------------------------: |
| DIP main                           |                       40,960 |                                      8,855,552 |
| PoCut earshot-deepseek-integration |                      282,624 |                                    116,187,136 |
| Visu external-drive checkout       |                    1,179,648 |                                     94,765,056 |

The corresponding baseline checkout ledgers alone occupied approximately 27.4 MB, 445.9 MB and 7.14 GB respectively. Shared bytes belong to the whole family and must not be counted once per worktree. These live measurements exclude historical source Git objects on both sides and are not an atomic fleet snapshot; the synthetic measurement above accounts for retained Git objects explicitly.

Rollout recovered one abandoned zero-byte source index lock after checking that no process owned it; the original file was moved to the private backup directory. Four verified AppleDouble `._pack-*.idx` sidecars on the external drive were moved to private backup to stop Git treating them as indexes. Actual Git pack/index files were preserved. Migration also recovered an interrupted metadata retirement and a filtered clone whose original lazy fetching stalled; its final explicit metadata-only fetch succeeded.

## Preserved boundaries

Migration archives retain the original event data, including raw diagnostics, for deliberate recovery. Semantic history and unsynchronized intent are not retention targets. Source cleanup commits contain only DIP metadata/configuration and owned helper upgrades; staged and unstaged source edits stay intact. Older source branches are retired lazily when entered through the updated hook. Ordinary metadata publication leaves source HEAD and index unchanged.

Static instructions and code-dependent verification configuration still belong to source branches and can have real merge conflicts. The protocol preserves concurrent semantic disagreements rather than choosing an arbitrary winner. Git synchronization supplies no live cross-machine lease. No force push, source-history rewrite, npm publication or automatic deletion of recovery archives was performed.
