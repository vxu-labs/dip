# Tracking overhead benchmark

Measured on 6 October 2026 with Node.js 24.14.0, Windows x64 and an Intel Core i7-8750H. Each run uses 30 paired samples after three warm-up pairs, alternating the execution order. Both conditions launch the same Node file-write subprocess with identical content.

The baseline has no DIP hooks, instructions, recorder or Git integrations. Git configuration and runtime directories are isolated; Trace2 is disabled for both conditions. The DIP condition adds a fresh pre-hook process and a post-hook process. The recorder is absent, so hooks persist immediately through the durable fallback. Setup, prompt/plan capture and the final stop hook are excluded from the timed write iterations.

| Measurement, v0.3.2        | Without DIP |  With DIP |
| -------------------------- | ----------: | --------: |
| Blocking operation, median |    79.17 ms | 229.25 ms |
| Blocking operation, p95    |    85.43 ms | 251.20 ms |

The median paired added blocking cost was **150.88 ms**, with a p95 of **167.37 ms**. Including sequential post-capture, the DIP operation median was **369.57 ms**. The installed host normally runs ordinary post-hooks asynchronously, so that sequential figure is not its blocking latency. Normal installed recording also batches work through a daemon.

Capture invoked **zero additional model calls**. A separate feature check retained the task, plan and handoff after deleting the isolated runtime database. The baseline does not include another task tracker or manual persistence system.

This is a synthetic tracking-overhead benchmark. It does not measure model productivity, code quality, token savings or time to complete a feature. The live desktop trials in [the QA report](../desktop-qa.md) are observational and are not a controlled model A/B experiment.

## Raw samples and reproducibility

- [v0.3.2 samples](2026-10-06-windows-0.3.2.json)
- [Earlier v0.3.1 samples](2026-10-06-windows.json)

The earlier run measured 118.07 ms without DIP, 341.96 ms with DIP on the blocking path, and 224.19 ms paired added median cost. Background workload was not held constant between releases. Both runs are published; no release speedup is inferred from their difference. These single-machine samples are not a latency guarantee.

```sh
node scripts/benchmark-comparison.mjs results.json
```

Set `DIP_BENCH_SAMPLES` to an integer from 10 to 200 to change the sample count. Temporary fixtures and machine configuration are isolated; the script does not alter the user's installed integrations.
