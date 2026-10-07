# Bounded ledger and capture measurements

Measured on 7 October 2026, Windows x64, Node 24.14.0, Intel Core i7-8750H. The [plan](../plans/low-friction-integration.md) declared ledger sizes, sample counts and investigation budgets before measurements. These are synthetic persistence measurements, not model quality or productivity results.

| Tasks  | Warm context p95 before | Warm context p95 after | Fresh-process p95 after | Peak process RSS after |
| ------ | ----------------------: | ---------------------: | ----------------------: | ---------------------: |
| 100    |                97.37 ms |               23.70 ms |               238.81 ms |              67.80 MiB |
| 1,000  |             1,028.28 ms |              182.40 ms |             1,055.30 ms |             135.72 MiB |
| 10,000 |            10,109.38 ms |            1,584.73 ms |            10,027.29 ms |             387.19 MiB |

The measured warm 10,000-task path was 6.38 times faster after caching JSON event reads, removing duplicate directory metadata calls and limiting summary mapping to returned tasks. Warm context returned 1,296 bytes at every size. No records were deleted, statuses inferred or model calls added.

Fresh-process 10,000-task projection remains about 10 seconds and is slightly above the plan's 10-second context investigation budget. The raw report's `withinBudgets` field checks the explicitly named **warm** thresholds plus low-level capture and memory; it does not assert that cold context meets that target. Warm reads, capture and memory were within those thresholds. Further cold/rich-history profiling is still useful; there is no latency guarantee.

At 10,000 tasks, immediate durable enqueue plus flush p95 was 7.87 ms; batched enqueue p95 was 1.98 ms, followed by a 20-record flush of 5.78 ms. These exclude host process startup, tool execution, watcher CPU and agent tool-loop overhead. Each size persisted exactly 40 activity records in 21 batches. Setup was measured separately: 100.73 ms / 793.11 ms / 8,848.20 ms for writing 100 / 1,000 / 10,000 seed event files.

## Method and reproduction

Each condition uses one creation event per task with scoped criteria, 20 warm calls in a single process and five fresh Node subprocess calls. The fresh report includes internal projection and full subprocess duration separately. Peak RSS is process-level and cumulative across sizes. OS page cache is not reset. Before and after runs are sequential, on one working development machine with no claim of exclusive CPU or controlled OS cache; regard the timing change as observed performance, not an independently replicated causal estimate.

```text
node scripts/scale-benchmark.mjs OUTPUT.json --label current
node scripts/scale-evidence.mjs
```

[Before samples](2026-10-07-scale-before.json) and [after samples](2026-10-07-scale-after.json) retain every observation, setup timing, event counts, module/protocol hashes and memory. No observations were trimmed. The script now measures the current implementation; before and after artifacts describe the historical development points identified by their core hashes. They do not imply every later text-only/source formatting change was timed again.

The process-local JSON cache is disposable, bounded to 20,000 entries and a 32 MiB **estimated** content budget (not a hard RSS limit). Every access checks file size, modification/change times, inode and mode. Symlinks/non-files remain rejected, changed/corrupt histories remain diagnosed, and callers receive independent objects. Cache removal does not touch ownership or the durable outbox. Metadata signatures are a normal local-cache assumption, not a security boundary against a filesystem that can hide changes. Cache misses still read and validate the authoritative event files.

The configured evidence replay checks raw summaries, counts, protocol agreement and published performance calculations without rerunning timing during unrelated QA. Unit cases additionally exercise external changes, corruption, causal branch merges, cache loss and live ownership independence. Independent clones, dense dependency graphs, many events per task, every platform's resource use and semantic retrieval quality are outside this fixture.
