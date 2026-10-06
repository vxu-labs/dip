import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { fixture, score } from "./model-benchmark-fixtures.mjs";

const workspace = fileURLToPath(new URL("../", import.meta.url));
const input =
  process.argv[2] || "docs/benchmarks/2026-10-06-model-controlled-v3.json";
const data = JSON.parse(fs.readFileSync(input, "utf8"));
const protocol = JSON.parse(
  fs.readFileSync(
    path.join(workspace, "docs/benchmarks/2026-10-06-model-protocol-v3.json"),
    "utf8",
  ),
);
assert.equal(data.protocol.protocolVersion, 3);
assert.ok(data.completedAt, "Data collection must have completed");
assert.equal(data.pairs.length, 6);
assert.deepEqual(data.protocol.pairs, protocol.pairs);
assert.deepEqual(data.protocol.sources, protocol.sources);
const hash = (file) =>
  createHash("sha256")
    .update(fs.readFileSync(file, "utf8").replaceAll("\r\n", "\n"))
    .digest("hex");
assert.equal(
  hash(path.join(workspace, "scripts/model-benchmark-fixtures.mjs")),
  protocol.sources.fixtures,
);
assert.equal(
  hash(path.join(workspace, "scripts/model-benchmark.mjs")),
  protocol.sources.harness,
);
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "dip-score-replay-"));
const flags = (result) => ({
  checks: result.checks.map((x) => ({ name: x.name, passed: x.passed })),
  memory: result.memory,
  passed: result.passed,
  total: result.total,
  memoryPassed: result.memoryPassed,
  memoryTotal: result.memoryTotal,
  allPassed: result.allPassed,
});
const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  return n % 2
    ? sorted[Math.floor(n / 2)]
    : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
};
let replayed = 0;
try {
  for (let index = 0; index < 6; index++) {
    const pair = data.pairs[index];
    const f = fixture(index);
    assert.equal(pair.index, index);
    assert.equal(pair.scenario, f.kind);
    assert.deepEqual(
      pair.order,
      index % 2 ? ["with", "without"] : ["without", "with"],
    );
    assert.deepEqual(Object.keys(pair.arms).sort(), ["with", "without"]);
    for (const arm of ["without", "with"]) {
      const row = pair.arms[arm];
      if (arm === "without") {
        assert.equal(row.setup.hooks, false);
        assert.equal(row.setup.mcp, false);
        assert.equal(row.capture.present, false);
        assert.equal(row.contamination, false);
        assert.equal(row.seed.itemCounts.mcp_tool_call || 0, 0);
        assert.equal(row.recovery.itemCounts.mcp_tool_call || 0, 0);
      } else {
        assert.equal(row.setup.hooks, true);
        assert.equal(row.setup.mcp, true);
        assert.ok(row.capture.kinds.UserPromptSubmit >= 2);
        assert.ok(row.setup.reviewedMcpToolsApproved.includes("task_plan"));
      }
      for (const [label, artifacts, original] of [
        ["seed", row.seedArtifacts, row.seedScore],
        ["recovery", row.artifacts, row.score],
      ]) {
        const root = path.join(sandbox, String(index), arm, label);
        fs.mkdirSync(root, { recursive: true });
        for (const [name, file] of Object.entries(artifacts)) {
          assert.equal(
            path.basename(name),
            name,
            "Artifacts cannot escape the replay root",
          );
          fs.writeFileSync(path.join(root, name), file.text);
        }
        const actual = await score(root, index, { seedOnly: label === "seed" });
        assert.deepEqual(
          flags(actual),
          flags(original),
          `${index}/${arm}/${label}: external score mismatch`,
        );
        replayed++;
      }
      assert.equal(row.score.total, 8);
      assert.equal(row.score.memoryTotal, 6);
      for (const turn of [row.seed, row.recovery]) {
        assert.ok(turn.wallMs >= 0);
        if (turn.usage) {
          assert.ok(turn.usage.input_tokens >= 0);
          assert.ok(turn.usage.output_tokens >= 0);
          assert.ok(
            turn.usage.cached_input_tokens >= 0 &&
              turn.usage.cached_input_tokens <= turn.usage.input_tokens,
          );
        }
      }
      assert.equal(
        row.success,
        row.seed.completed &&
          row.recovery.completed &&
          row.seed.exitCode === 0 &&
          row.recovery.exitCode === 0 &&
          !row.seed.timedOut &&
          !row.recovery.timedOut &&
          row.score.allPassed &&
          !row.contamination,
      );
    }
  }
  for (const arm of ["without", "with"]) {
    const rows = data.pairs.map((p) => p.arms[arm]);
    const turns = rows.flatMap((x) => [x.seed, x.recovery]);
    const summary = data.summary[arm];
    assert.equal(summary.success, rows.filter((x) => x.success).length);
    assert.equal(
      summary.functionalPassed,
      rows.reduce((n, x) => n + x.score.passed, 0),
    );
    assert.equal(summary.functionalTotal, 48);
    assert.equal(
      summary.memoryPassed,
      rows.reduce((n, x) => n + x.score.memoryPassed, 0),
    );
    assert.equal(summary.memoryTotal, 36);
    assert.equal(
      summary.medianTotalWallMs,
      median(rows.map((x) => x.seed.wallMs + x.recovery.wallMs)),
    );
    assert.equal(
      summary.medianRecoveryWallMs,
      median(rows.map((x) => x.recovery.wallMs)),
    );
    for (const [key, usageKey] of [
      ["inputTokens", "input_tokens"],
      ["cachedInputTokens", "cached_input_tokens"],
      ["outputTokens", "output_tokens"],
    ])
      assert.equal(
        summary[key],
        turns.reduce((n, x) => n + (x.usage?.[usageKey] || 0), 0),
      );
    assert.equal(
      summary.usageReportedTurns,
      turns.filter((x) => x.usage).length,
    );
  }
  console.log(
    JSON.stringify({
      verified: true,
      replayedStages: replayed,
      matchedPairs: 6,
      checksPerArm: 48,
      memoryChecksPerArm: 36,
    }),
  );
} finally {
  const resolved = path.resolve(sandbox);
  if (
    !resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) ||
    !path.basename(resolved).startsWith("dip-score-replay-")
  )
    throw new Error("Unsafe replay cleanup path");
  fs.rmSync(resolved, { recursive: true, force: true });
}
