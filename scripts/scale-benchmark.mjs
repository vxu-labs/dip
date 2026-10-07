import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { ensure, Runtime, compactContext, project } from "../src/core.js";
import { git, digest } from "../src/util.js";
import { eventCacheStats } from "../src/event-cache.js";
const script = fileURLToPath(import.meta.url);
const summary = (values) => ({
  samples: values.length,
  p50Ms: [...values].sort((a, b) => a - b)[Math.ceil(values.length * 0.5) - 1],
  p95Ms: [...values].sort((a, b) => a - b)[Math.ceil(values.length * 0.95) - 1],
  rawMs: values,
});
const timed = (fn) => {
  const start = performance.now();
  const value = fn();
  return { ms: performance.now() - start, value };
};
if (process.argv[2] === "--worker") {
  const start = performance.now(),
    repo = ensure(process.argv[3], { instructions: false }),
    rt = new Runtime();
  const context = compactContext(repo, rt);
  rt.close();
  assert.equal(context.errors.length, 0);
  assert.ok(context.ready.length <= 5);
  console.log(
    JSON.stringify({
      ms: performance.now() - start,
      bytes: Buffer.byteLength(JSON.stringify(context)),
      memory: process.memoryUsage().rss,
      peakRssBytes: process.resourceUsage().maxRSS * 1024,
    }),
  );
} else {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "dip-scale-"));
  Object.assign(process.env, {
    DIP_HOME: path.join(sandbox, "runtime"),
    DIP_USER_HOME: path.join(sandbox, "user"),
    DIP_GIT_CONFIG: path.join(sandbox, "gitconfig"),
    GIT_CONFIG_GLOBAL: path.join(sandbox, "gitconfig"),
    GIT_TRACE2_EVENT: "0",
  });
  const measurements = [];
  try {
    for (const size of [100, 1000, 10000]) {
      const root = path.join(sandbox, String(size));
      fs.mkdirSync(root);
      git(root, ["init", "-b", "main"]);
      const repo = ensure(root),
        setup = performance.now();
      let ledgerBytes = 0;
      for (let n = 0; n < size; n++) {
        const id = `task_scale_${String(n).padStart(5, "0")}`,
          dir = path.join(repo.dir, "events", id);
        fs.mkdirSync(dir);
        const body = JSON.stringify({
          schemaVersion: 1,
          eventId: `seed_${n}`,
          taskId: id,
          type: "task.create",
          actor: "fixture",
          createdAt: "2026-10-07T00:00:00.000Z",
          parents: [],
          branch: "main",
          payload: {
            title: `Task ${n} for catalog inventory`,
            description:
              "Implement the scoped contract and remember the acceptance requirement.",
            acceptance: ["Preserve contract"],
            scope: [`src/component-${n}.js`],
            status: "backlog",
            dependencies: [],
          },
        });
        fs.writeFileSync(path.join(dir, `seed_${n}.json`), body);
        ledgerBytes += Buffer.byteLength(body);
      }
      const setupMs = performance.now() - setup,
        rt = new Runtime(),
        warm = [];
      const first = timed(() => compactContext(repo, rt));
      for (let n = 0; n < 20; n++)
        warm.push(timed(() => compactContext(repo, rt)).ms);
      const fresh = [];
      for (let n = 0; n < 5; n++) {
        const start = performance.now();
        const result = JSON.parse(
          execFileSync(
            process.execPath,
            ["--disable-warning=ExperimentalWarning", script, "--worker", root],
            { env: process.env, encoding: "utf8", windowsHide: true },
          ),
        );
        fresh.push({ ...result, subprocessMs: performance.now() - start });
      }
      const batched = [],
        immediate = [];
      for (let n = 0; n < 20; n++)
        batched.push(
          timed(() =>
            rt.enqueue(
              repo,
              "batch",
              {
                at: new Date().toISOString(),
                kind: "fixture",
                taskId: "task_scale_00000",
              },
              `batch-${n}`,
            ),
          ).ms,
        );
      const flush = timed(() => rt.flush(repo.root));
      assert.equal(flush.value, 20);
      for (let n = 0; n < 20; n++)
        immediate.push(
          timed(() => {
            rt.enqueue(
              repo,
              "immediate",
              { at: new Date().toISOString(), kind: "fixture" },
              `immediate-${n}`,
            );
            assert.equal(rt.flush(repo.root), 1);
          }).ms,
        );
      assert.equal(
        project(repo, null, null, { includeActivity: false }).tasks.length,
        size,
      );
      const activity = project(repo).activity;
      assert.equal(activity.length, 40);
      assert.equal(rt.lastFlushErrors.length, 0);
      rt.close();
      measurements.push({
        tasks: size,
        taskEvents: size,
        activityRecords: 40,
        activityBatches: 21,
        ledgerBytes,
        setupMs,
        firstProjectionMs: first.ms,
        contextBytes: Buffer.byteLength(JSON.stringify(first.value)),
        warm: summary(warm),
        fresh: summary(fresh.map((r) => r.subprocessMs)),
        freshInternal: summary(fresh.map((r) => r.ms)),
        freshSamples: fresh,
        batchedEnqueue: summary(batched),
        batchFlushMs: flush.ms,
        immediateDurable: summary(immediate),
        eventCache: eventCacheStats(),
        rssBytes: process.memoryUsage().rss,
        peakRssBytes: process.resourceUsage().maxRSS * 1024,
      });
      process.stderr.write(
        `Measured ${size} tasks; warm p95 ${measurements.at(-1).warm.p95Ms.toFixed(1)}ms\n`,
      );
    }
    const budgets = {
      warm1000Ms: 2000,
      warm10000Ms: 10000,
      immediateMs: 500,
      batchedEnqueueMs: 100,
      rssBytes: 512 * 1024 * 1024,
    };
    const result = {
      schemaVersion: 1,
      measuredAt: new Date().toISOString(),
      label: process.argv[4] || "measurement",
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      cpu: os.cpus()[0]?.model,
      protocolHash: digest(
        fs.readFileSync(
          new URL("../docs/plans/low-friction-integration.md", import.meta.url),
        ),
      ),
      coreHash: digest(
        fs.readFileSync(new URL("../src/core.js", import.meta.url)),
      ),
      mode: "Synthetic causal task events; compact startup context; five fresh Node processes; 20 warm in-process calls; low-level immediate/batched recording, no daemon, models or remote APIs",
      budgets,
      measurements,
      withinBudgets: measurements.every(
        (m) =>
          m.warm.p95Ms <=
            (m.tasks === 10000 ? budgets.warm10000Ms : budgets.warm1000Ms) &&
          m.immediateDurable.p95Ms <= budgets.immediateMs &&
          m.batchedEnqueue.p95Ms <= budgets.batchedEnqueueMs &&
          m.peakRssBytes <= budgets.rssBytes,
      ),
      limitations: [
        "One machine, synthetic one-event-per-task histories; not a platform latency guarantee",
        "Low-level recording does not include host hook launch or filesystem-watcher CPU",
        "RSS is process-level, not cache-only memory; OS page cache is not reset",
        "No inference about coding quality, agent tokens or productivity",
      ],
    };
    if (process.argv[2])
      fs.writeFileSync(
        path.resolve(process.argv[2]),
        JSON.stringify(result, null, 2) + "\n",
      );
    console.log(
      JSON.stringify(
        {
          label: result.label,
          withinBudgets: result.withinBudgets,
          measurements: measurements.map((m) => ({
            tasks: m.tasks,
            warmP95: m.warm.p95Ms,
            coldP95: m.fresh.p95Ms,
            immediateP95: m.immediateDurable.p95Ms,
            peakRssBytes: m.peakRssBytes,
          })),
        },
        null,
        2,
      ),
    );
  } finally {
    assert.equal(path.dirname(sandbox), path.resolve(os.tmpdir()));
    assert.ok(path.basename(sandbox).startsWith("dip-scale-"));
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
}
