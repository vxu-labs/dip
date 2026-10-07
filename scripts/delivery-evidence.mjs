import { spawnSync } from "node:child_process";

// Replay retained evidence and run boundary regressions. This never invokes a model.
const checks = [
  ["syntax", ["scripts/check.mjs"]],
  [
    "boundaries",
    [
      "--test",
      "--test-concurrency=1",
      "test/outbox-recovery.test.js",
      "test/task-prepare.test.js",
      "test/completion.test.js",
      "test/structured-plan.test.js",
    ],
  ],
  ["original benchmark", ["scripts/model-benchmark-evidence.mjs"]],
  [
    "0.3.11 repeat",
    [
      "scripts/model-benchmark-evidence.mjs",
      "docs/benchmarks/2026-10-07-model-controlled-v4.json",
    ],
  ],
  [
    "0.3.12 repeat",
    [
      "scripts/model-benchmark-evidence.mjs",
      "docs/benchmarks/2026-10-07-model-controlled-v5.json",
    ],
  ],
  ["host recovery", ["scripts/host-qa-evidence.mjs"]],
  ["host lifecycle", ["scripts/codex-lifecycle-evidence.mjs"]],
  ["host structured fallback", ["scripts/codex-structured-evidence.mjs"]],
];
for (const [name, args] of checks) {
  const run = spawnSync(
    process.execPath,
    ["--disable-warning=ExperimentalWarning", ...args],
    {
      encoding: "utf8",
      windowsHide: true,
      timeout: 120000,
    },
  );
  if (run.error || run.status !== 0) {
    console.error(
      JSON.stringify({
        name,
        status: run.status,
        error: run.error?.message,
        stdout: run.stdout?.slice(-12000),
        stderr: run.stderr?.slice(-12000),
      }),
    );
    process.exit(1);
  }
  console.log(JSON.stringify({ name, passed: true }));
}
