import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import assert from "node:assert/strict";
import {
  fixture,
  files,
  score,
  instructions,
} from "./longitudinal-fixtures.mjs";
import {
  prepare,
  run,
  capture,
  snapshot,
  commit,
  git,
  worktree,
  cleanup,
  workspace,
  sha,
  model,
  effort,
  timeoutMs,
  codexVersion,
} from "./longitudinal-runtime.mjs";
import { summarize } from "./longitudinal-analysis.mjs";

const { values } = parseArgs({
  options: {
    protocol: { type: "boolean" },
    preflight: { type: "boolean" },
    output: { type: "string" },
  },
});
const protocol = {
  schemaVersion: 1,
  protocolVersion: 1,
  createdAt: new Date().toISOString(),
  model,
  effort,
  pairCount: 4,
  timeoutMs,
  design:
    "Four matched project pairs with varied policy constants; nine fresh conversations per arm. Arms start concurrently in alternating order, two concurrent isolated-worktree workers per arm. No session resume or evaluator feedback.",
  baseline:
    "Ordinary Markdown notes/plans/handoffs allowed. No DIP config, hooks, MCP, daemon, shell profile or native Git trace.",
  treatment:
    "Same instructions plus DIP 0.3.4 generated project instructions, trusted real hooks and approved MCP tools. Private shared runtime across worktrees; no resident daemon.",
  schedule: [
    "seed",
    "revision",
    "detour",
    "interrupted",
    "workerA+workerB concurrently",
    "integration",
    "finalRevision",
    "audit",
  ],
  interrupt:
    "Terminate the receipt worker process tree 2000ms after the first receipt.mjs content mutation (100ms polling). If no mutation occurs within 180000ms retain that timeout. No forced handoff; retain partial files and raw transcript.",
  integration:
    "Harness commits each stage in fixture-only Git. Parallel workers fork the same commit. Merge both worker branches in alternating order; stop if conflicted and leave actual Git merge state plus factual MERGE_HANDOFF.md for the fresh integrator. Integrator may resolve/commit/merge remaining branches. No scorer output is exposed.",
  primary:
    "Final held-out functional correctness: 30 deterministic cases per project. Project-level all-case success is primary; case totals are clustered descriptive results.",
  secondary:
    "Ten exact current-policy fields plus two deferred identifiers and one cancellation; release-ready false positives, unsupported component completion claims, final scope reporting, actual merge conflicts, read-only audit compliance, interruption recovery and intermediate stage snapshots. Tokens/time are secondary and interrupted turns can lack usage.",
  policy:
    "All four pairs and all scheduled stages retained, no result-dependent retries or prompt edits. Infrastructure-only preflight excluded and retained separately. No product optimization during experiment.",
  limits:
    "Synthetic repeated order-processing domain, n=4 project pairs, accelerated multi-session lifecycle rather than days of real development. Same model ID/effort, no fixed weights/random seed. Directory/config boundaries are instructions, not OS containment. Worktrees protect files in both arms; DIP coordination is local-machine shared-runtime coordination, not distributed locking. Hook-trust bypass applies only to generated reviewed test hooks.",
  instructions,
  files,
  sources: Object.fromEntries(
    ["fixtures", "runtime", "benchmark", "analysis"].map((name) => [
      name,
      sha(
        fs
          .readFileSync(
            path.join(
              workspace,
              "scripts",
              `longitudinal-${name === "benchmark" ? "benchmark" : name}.mjs`,
            ),
            "utf8",
          )
          .replaceAll("\r\n", "\n"),
      ),
    ]),
  ),
  pairs: Array.from({ length: 4 }, (_, i) => ({
    ...fixture(i),
    armStartOrder: i % 2 ? ["with", "without"] : ["without", "with"],
    mergeOrder: i % 2 ? ["worker-b", "worker-a"] : ["worker-a", "worker-b"],
  })),
};
const output = path.resolve(
  values.output ||
    (values.protocol
      ? "docs/benchmarks/2026-10-06-longitudinal-protocol.json"
      : values.preflight
        ? "docs/benchmarks/2026-10-06-longitudinal-preflight.json"
        : "docs/benchmarks/2026-10-06-longitudinal.json"),
);
fs.mkdirSync(path.dirname(output), { recursive: true });
const save = (data) =>
  fs.writeFileSync(output, JSON.stringify(data, null, 2) + "\n");
if (values.protocol) {
  save(protocol);
  cleanup();
  process.exit(0);
}
if (!values.preflight) {
  const registered = JSON.parse(
    fs.readFileSync(
      path.join(
        workspace,
        "docs/benchmarks/2026-10-06-longitudinal-protocol.json",
      ),
      "utf8",
    ),
  );
  protocol.createdAt = registered.createdAt;
  assert.deepEqual(
    protocol,
    registered,
    "Protocol/source changed after registration; do not silently replace a scored experiment",
  );
}
const result = {
  protocol,
  startedAt: new Date().toISOString(),
  platform: process.platform,
  node: process.version,
  codexVersion: codexVersion(),
  dipVersion: JSON.parse(fs.readFileSync(path.join(workspace, "package.json")))
    .version,
  preflight: !!values.preflight,
  pairs: [],
};
const stageScore = (name) =>
  name === "seed"
    ? "seed"
    : ["finalRevision", "audit"].includes(name)
      ? "final"
      : "revised";
async function stage(trial, row, name, prompt, options = {}) {
  const outcome = await run(trial, name, prompt, options);
  const snap = snapshot(trial, name);
  const entry = {
    run: outcome,
    artifacts: snap.artifacts,
    score: await score(snap.root, trial.index, {
      stage: stageScore(name),
      reportFile: name === "integration" ? "handoff.json" : "quality.json",
    }),
    capture: capture(trial),
  };
  row.stages[name] = entry;
  save(result);
  console.log(
    JSON.stringify({
      pair: trial.index,
      arm: trial.arm,
      stage: name,
      functional: `${entry.score.passed}/${entry.score.total}`,
      memory: `${entry.score.memoryPassed}/${entry.score.memoryTotal}`,
      interrupted: !!outcome.interruption,
    }),
  );
  return entry;
}
async function arm(trial, row, f, mergeOrder) {
  for (const name of ["seed", "revision", "detour", "interrupted"]) {
    await stage(
      trial,
      row,
      name,
      f.prompts[name],
      name === "interrupted" ? { interruptFile: "receipt.mjs" } : {},
    );
    commit(trial, `Fixture checkpoint ${name}`);
  }
  const a = worktree(trial, "worker-a"),
    b = worktree(trial, "worker-b");
  const parallelStartedAt = new Date().toISOString();
  const parallel = await Promise.allSettled([
    stage(a, row, "workerA", f.prompts.workerA),
    stage(b, row, "workerB", f.prompts.workerB),
  ]);
  for (const outcome of parallel)
    if (outcome.status === "rejected") throw outcome.reason;
  commit(a, "Fixture worker A");
  commit(b, "Fixture worker B");
  commit(trial, "Fixture pre-merge ledger checkpoint");
  row.parallel = {
    startedAt: parallelStartedAt,
    endedAt: new Date().toISOString(),
    overlapMs: Math.max(
      0,
      Math.min(
        ...["workerA", "workerB"].map(
          (n) =>
            Date.parse(row.stages[n].run.startedAt) + row.stages[n].run.wallMs,
        ),
      ) -
        Math.max(
          ...["workerA", "workerB"].map((n) =>
            Date.parse(row.stages[n].run.startedAt),
          ),
        ),
    ),
  };
  const attempts = [];
  for (const branch of mergeOrder) {
    try {
      attempts.push({
        branch,
        success: true,
        output: git(trial, ["merge", "--no-edit", branch]),
      });
    } catch (e) {
      attempts.push({
        branch,
        success: false,
        output: String(e.stdout || "") + String(e.stderr || ""),
      });
      break;
    }
  }
  const conflictPaths = git(trial, ["diff", "--name-only", "--diff-filter=U"])
    .trim()
    .split(/\r?\n/)
    .filter(Boolean);
  row.merge = { order: mergeOrder, attempts, conflictPaths };
  fs.writeFileSync(
    path.join(trial.root, "MERGE_HANDOFF.md"),
    `# Factual harness merge handoff\n\nWorker branches: worker-a and worker-b.\nAttempted order: ${mergeOrder.join(", ")}.\nAttempts: ${attempts.map((a) => a.branch + ": " + (a.success ? "merged" : "conflicted")).join("; ")}.\nUnresolved paths: ${conflictPaths.join(", ") || "none"}.\nFinish any existing merge, then merge a still-unmerged worker branch if needed. No evaluator result is supplied.\n`,
  );
  save(result);
  await stage(trial, row, "integration", f.prompts.integration);
  try {
    commit(trial, "Fixture integration");
  } catch (e) {
    row.integrationCommitFailure = String(e.stdout || e.message);
    save(result);
  }
  await stage(trial, row, "finalRevision", f.prompts.finalRevision);
  try {
    commit(trial, "Fixture final revision");
  } catch (e) {
    row.finalCommitFailure = String(e.stdout || e.message);
    save(result);
  }
  await stage(trial, row, "audit", f.prompts.audit);
  const productNames = Object.keys(files).filter((n) => n.endsWith(".mjs"));
  row.auditProductMutated = productNames.some(
    (n) =>
      row.stages.finalRevision.artifacts[n]?.sha256 !==
      row.stages.audit.artifacts[n]?.sha256,
  );
  row.contamination =
    trial.arm === "without" &&
    (trial.setup.hooks ||
      trial.setup.mcp ||
      Object.values(row.stages).some(
        (s) => s.capture.present || (s.run.itemCounts.mcp_tool_call || 0) > 0,
      ));
  save(result);
}
try {
  save(result);
  if (values.preflight) {
    for (const which of ["without", "with"]) {
      const trial = prepare(-1, which);
      const outcome = await run(
        trial,
        "preflight",
        which === "with"
          ? "Infrastructure preflight only. Use exec_command to write preflight.txt with exactly LONGITUDINAL-SHELL-OK and read it back. Use DIP MCP task_plan on this captured task to save LONGITUDINAL-MCP-OK, then task_get to confirm it. Do not change code or settings."
          : "Infrastructure preflight only. Use exec_command to write preflight.txt with exactly LONGITUDINAL-SHELL-OK and read it back. Do not change code or settings.",
      );
      const captured = capture(trial);
      const shell =
        fs.existsSync(path.join(trial.root, "preflight.txt")) &&
        fs.readFileSync(path.join(trial.root, "preflight.txt"), "utf8") ===
          "LONGITUDINAL-SHELL-OK";
      commit(trial, "Preflight seed");
      const a = worktree(trial, "worker-a"),
        b = worktree(trial, "worker-b");
      fs.writeFileSync(path.join(a.root, "overlap.mjs"), "export const a=1;\n");
      fs.writeFileSync(path.join(b.root, "overlap.mjs"), "export const b=2;\n");
      commit(a, "Preflight A");
      commit(b, "Preflight B");
      git(trial, ["merge", "--no-edit", "worker-a"]);
      let conflict = false;
      try {
        git(trial, ["merge", "--no-edit", "worker-b"]);
      } catch {
        conflict = git(trial, [
          "diff",
          "--name-only",
          "--diff-filter=U",
        ]).includes("overlap.mjs");
      }
      result.pairs.push({
        arm: which,
        setup: trial.setup,
        run: outcome,
        capture: captured,
        shellWriteObserved: shell,
        worktreeMergeConflictObserved: conflict,
      });
      save(result);
    }
    result.preflightPassed = result.pairs.every(
      (p) =>
        p.run.completed &&
        p.run.exitCode === 0 &&
        p.shellWriteObserved &&
        p.worktreeMergeConflictObserved &&
        (p.arm === "without"
          ? !p.capture.present && !p.setup.hooks && !p.setup.mcp
          : p.capture.tasks.some((t) => t.planPresent) &&
            (p.run.itemCounts.mcp_tool_call || 0) >= 2 &&
            p.run.mcpErrors.length === 0),
    );
    if (!result.preflightPassed) process.exitCode = 1;
  } else {
    for (const pair of protocol.pairs) {
      const row = {
        index: pair.index,
        armStartOrder: pair.armStartOrder,
        mergeOrder: pair.mergeOrder,
        arms: {},
      };
      result.pairs.push(row);
      const trials = pair.armStartOrder.map((which) => {
        const trial = prepare(pair.index, which);
        for (const [name, text] of Object.entries(files))
          fs.writeFileSync(path.join(trial.root, name), text);
        commit(trial, "Initial fixture");
        row.arms[which] = { setup: trial.setup, stages: {} };
        return trial;
      });
      save(result);
      const outcomes = await Promise.allSettled(
        trials.map((trial) =>
          arm(trial, row.arms[trial.arm], pair, pair.mergeOrder),
        ),
      );
      const failed = outcomes.filter((x) => x.status === "rejected");
      if (failed.length) {
        result.infrastructureFailures = failed.map((x) => String(x.reason));
        save(result);
        throw new Error(
          "Experiment infrastructure failed; all available outcomes retained.",
        );
      }
    }
    result.summary = summarize(result);
  }
  result.completedAt = new Date().toISOString();
  save(result);
  console.log(
    JSON.stringify({
      output,
      summary: result.summary,
      preflightPassed: result.preflightPassed,
    }),
  );
} catch (e) {
  result.abortedAt = new Date().toISOString();
  result.abortReason = String(e);
  save(result);
  throw e;
} finally {
  cleanup();
}
