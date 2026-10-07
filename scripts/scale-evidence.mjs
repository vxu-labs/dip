import fs from "node:fs";
import assert from "node:assert/strict";
const load = (name) =>
  JSON.parse(
    fs.readFileSync(new URL(`../docs/benchmarks/${name}`, import.meta.url)),
  );
const before = load("2026-10-07-scale-before.json"),
  after = load("2026-10-07-scale-after.json");
assert.equal(before.protocolHash, after.protocolHash);
assert.notEqual(before.coreHash, after.coreHash);
for (const report of [before, after]) {
  assert.equal(report.schemaVersion, 1);
  assert.deepEqual(
    report.measurements.map((m) => m.tasks),
    [100, 1000, 10000],
  );
  for (const m of report.measurements) {
    assert.equal(m.taskEvents, m.tasks);
    assert.equal(m.activityRecords, 40);
    assert.equal(m.activityBatches, 21);
    assert.ok(m.ledgerBytes > 0 && m.setupMs > 0 && m.contextBytes < 5000);
    for (const [key, n] of [
      ["warm", 20],
      ["fresh", 5],
      ["freshInternal", 5],
      ["batchedEnqueue", 20],
      ["immediateDurable", 20],
    ]) {
      const s = m[key];
      assert.equal(s.samples, n);
      assert.equal(s.rawMs.length, n);
      assert.ok(s.rawMs.every((v) => Number.isFinite(v) && v >= 0));
      const sorted = [...s.rawMs].sort((a, b) => a - b);
      assert.equal(s.p50Ms, sorted[Math.ceil(n * 0.5) - 1]);
      assert.equal(s.p95Ms, sorted[Math.ceil(n * 0.95) - 1]);
    }
    assert.equal(m.freshSamples.length, 5);
    assert.ok(
      m.freshSamples.every(
        (s, i) =>
          s.ms === m.freshInternal.rawMs[i] &&
          s.subprocessMs === m.fresh.rawMs[i] &&
          s.subprocessMs >= s.ms,
      ),
    );
  }
  const b = report.budgets;
  assert.equal(
    report.withinBudgets,
    report.measurements.every(
      (m) =>
        m.warm.p95Ms <= (m.tasks === 10000 ? b.warm10000Ms : b.warm1000Ms) &&
        m.immediateDurable.p95Ms <= b.immediateMs &&
        m.batchedEnqueue.p95Ms <= b.batchedEnqueueMs &&
        m.peakRssBytes <= b.rssBytes,
    ),
  );
}
assert.equal(before.withinBudgets, false);
assert.equal(after.withinBudgets, true);
const a = after.measurements.at(-1),
  b = before.measurements.at(-1);
assert.equal((b.warm.p95Ms / a.warm.p95Ms).toFixed(2), "6.38");
assert.ok(
  a.eventCache.hits > 0 &&
    a.eventCache.estimatedBytes <= a.eventCache.budgetBytes,
);
console.log(
  "Scale evidence replay passed: all raw samples, causal/event counts, warm/cold distinction and 6.38x observed warm comparison.",
);
