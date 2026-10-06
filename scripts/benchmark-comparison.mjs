import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { ensure, project, Runtime } from "../src/core.js";
import { git } from "../src/util.js";

const workspace = fileURLToPath(new URL("../", import.meta.url));
const cli = path.join(workspace, "bin/dip.js");
const samples = Number(process.env.DIP_BENCH_SAMPLES || 30);
if (!Number.isInteger(samples) || samples < 10 || samples > 200)
  throw new Error("DIP_BENCH_SAMPLES must be an integer from 10 to 200");
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "dip-comparison-"));
process.env.DIP_HOME = path.join(sandbox, "runtime");
process.env.DIP_USER_HOME = path.join(sandbox, "user");
process.env.DIP_GIT_CONFIG = path.join(sandbox, "gitconfig");
process.env.GIT_CONFIG_GLOBAL = process.env.DIP_GIT_CONFIG;
process.env.GIT_TRACE2_EVENT = "0";
const roots = {
  without: path.join(sandbox, "without"),
  with: path.join(sandbox, "with"),
};
const env = { ...process.env };
const run = (args, input) =>
  execFileSync(process.execPath, args, {
    env,
    input,
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
    encoding: "utf8",
  });
const pairs = [];
const hook = (input) =>
  run(
    [
      "--disable-warning=ExperimentalWarning",
      cli,
      "hook",
      "--agent",
      "benchmark",
    ],
    JSON.stringify({ cwd: roots.with, session_id: "benchmark", ...input }),
  );
const operation = (mode, n) => {
  const input = {
    tool_name: "Write",
    tool_use_id: "edit-" + n,
    tool_input: { file_path: path.join(roots[mode], "answer.js") },
  };
  const start = performance.now();
  if (mode === "with") hook({ ...input, hook_event_name: "PreToolUse" });
  run([
    "-e",
    "require('node:fs').writeFileSync(process.argv[1], process.argv[2])",
    input.tool_input.file_path,
    `export const answer = ${n};\n`,
  ]);
  const blockingMs = performance.now() - start;
  if (mode === "with") hook({ ...input, hook_event_name: "PostToolUse" });
  return { blockingMs, completeMs: performance.now() - start };
};
const quantile = (numbers, p) =>
  [...numbers].sort((a, b) => a - b)[
    Math.max(0, Math.ceil(numbers.length * p) - 1)
  ];
const summarize = (numbers) => ({
  medianMs: +quantile(numbers, 0.5).toFixed(2),
  p95Ms: +quantile(numbers, 0.95).toFixed(2),
});
try {
  for (const root of Object.values(roots)) {
    fs.mkdirSync(root);
    git(root, ["init", "-b", "main"]);
  }
  ensure(roots.with);
  hook({
    hook_event_name: "UserPromptSubmit",
    turn_id: "intent",
    prompt:
      "Benchmark fixture: implement answer.js; remember CSV export later.",
  });
  hook({
    hook_event_name: "PostToolUse",
    tool_name: "update_plan",
    tool_use_id: "plan",
    tool_input: {
      plan: [
        { step: "Implement answer.js", status: "in_progress" },
        { step: "CSV export later", status: "pending" },
      ],
    },
  });
  for (let n = -3; n < samples; n++) {
    const pair = {
      index: n,
      order: n % 2 ? ["with", "without"] : ["without", "with"],
    };
    for (const mode of pair.order) pair[mode] = operation(mode, n);
    if (n >= 0) pairs.push(pair);
  }
  hook({ hook_event_name: "Stop" });
  const repo = ensure(roots.with);
  const rt = new Runtime();
  rt.flush(repo.root);
  rt.close();
  const before = project(repo);
  assert.equal(before.tasks.length, 1);
  assert.ok(before.tasks[0].plan && before.tasks[0].checkpoints.length);
  const runtime = path.resolve(process.env.DIP_HOME);
  assert.equal(path.dirname(runtime), sandbox);
  fs.rmSync(runtime, { recursive: true, force: true });
  const recovered = project(repo);
  assert.equal(recovered.tasks[0].id, before.tasks[0].id);
  assert.ok(!fs.existsSync(path.join(roots.without, ".dip")));
  const result = {
    schemaVersion: 1,
    measuredAt: new Date().toISOString(),
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    cpu: os.cpus()[0]?.model,
    logicalCpus: os.cpus().length,
    packageVersion: JSON.parse(
      fs.readFileSync(path.join(workspace, "package.json"), "utf8"),
    ).version,
    samples,
    warmupPairs: 3,
    order: "Alternating paired order",
    mode: "Fresh Node subprocess hooks, recorder absent, immediate durable fallback; no model calls",
    baseline:
      "Identical file-write subprocess without DIP hooks, instructions, Git integrations or recorder",
    withoutDIP: summarize(pairs.map((p) => p.without.blockingMs)),
    withDIPBlocking: summarize(pairs.map((p) => p.with.blockingMs)),
    withDIPIncludingPostCapture: summarize(pairs.map((p) => p.with.completeMs)),
    pairedAddedBlocking: summarize(
      pairs.map((p) => p.with.blockingMs - p.without.blockingMs),
    ),
    recoveryFeatureCheck: {
      taskRetained: true,
      planRetained: true,
      handoffRetained: true,
      afterRuntimeDeletion: true,
    },
    captureModelCalls: 0,
    limitations: [
      "Synthetic tool payloads, not a model-backed productivity comparison",
      "Sequential post-hook timing is not the host's asynchronous blocking time",
      "No daemon; normal installed mode batches capture",
      "No inference about coding speed, correctness, token savings or all agent surfaces",
    ],
    pairs,
  };
  const output = process.argv[2];
  if (output)
    fs.writeFileSync(
      path.resolve(output),
      JSON.stringify(result, null, 2) + "\n",
    );
  console.log(JSON.stringify({ ...result, pairs: undefined }, null, 2));
} finally {
  const target = path.resolve(sandbox);
  assert.equal(path.dirname(target), path.resolve(os.tmpdir()));
  assert.ok(path.basename(target).startsWith("dip-comparison-"));
  fs.rmSync(target, { recursive: true, force: true });
}
