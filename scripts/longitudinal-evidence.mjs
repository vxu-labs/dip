import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { fixture, score } from "./longitudinal-fixtures.mjs";
import { summarize } from "./longitudinal-analysis.mjs";
const workspace = fileURLToPath(new URL("../", import.meta.url));
const data = JSON.parse(
  fs.readFileSync(
    process.argv[2] ||
      path.join(workspace, "docs/benchmarks/2026-10-06-longitudinal.json"),
    "utf8",
  ),
);
const protocol = JSON.parse(
  fs.readFileSync(
    path.join(
      workspace,
      "docs/benchmarks/2026-10-06-longitudinal-protocol.json",
    ),
    "utf8",
  ),
);
assert.ok(
  data.completedAt && !data.preflight,
  "Completed scored experiment required",
);
assert.deepEqual(data.protocol, protocol);
assert.equal(data.pairs.length, 4);
for (const [name, hash] of Object.entries(protocol.sources))
  assert.equal(
    createHash("sha256")
      .update(
        fs
          .readFileSync(
            path.join(workspace, `scripts/longitudinal-${name}.mjs`),
            "utf8",
          )
          .replaceAll("\r\n", "\n"),
      )
      .digest("hex"),
    hash,
    `Preregistered ${name} source changed`,
  );
const stages = [
  "seed",
  "revision",
  "detour",
  "interrupted",
  "workerA",
  "workerB",
  "integration",
  "finalRevision",
  "audit",
];
const sandbox = fs.mkdtempSync(
  path.join(os.tmpdir(), "dip-longitudinal-replay-"),
);
const flags = (s) => ({
  ...s,
  loadErrors: undefined,
  checks: s.checks.map(({ name, group, passed }) => ({ name, group, passed })),
});
let replayed = 0;
try {
  for (let index = 0; index < 4; index++) {
    const pair = data.pairs[index],
      f = fixture(index);
    assert.equal(pair.index, index);
    assert.deepEqual(pair.armStartOrder, protocol.pairs[index].armStartOrder);
    assert.deepEqual(pair.mergeOrder, protocol.pairs[index].mergeOrder);
    assert.deepEqual(protocol.pairs[index].prompts, f.prompts);
    assert.deepEqual(Object.keys(pair.arms).sort(), ["with", "without"]);
    for (const arm of ["without", "with"]) {
      const row = pair.arms[arm];
      assert.deepEqual(Object.keys(row.stages).sort(), [...stages].sort());
      assert.equal(row.setup.hooks, arm === "with");
      assert.equal(row.setup.mcp, arm === "with");
      assert.equal(row.contamination, false);
      for (const name of stages) {
        const entry = row.stages[name];
        assert.equal(entry.run.phase, name);
        if (arm === "without") {
          assert.equal(entry.capture.present, false);
          assert.equal(entry.run.itemCounts.mcp_tool_call || 0, 0);
        } else assert.equal(entry.capture.present, true);
        const root = path.join(sandbox, String(index), arm, name);
        fs.mkdirSync(root, { recursive: true });
        for (const [relative, file] of Object.entries(entry.artifacts)) {
          assert.ok(
            !path.isAbsolute(relative) &&
              !relative.split(/[\\/]/).includes(".."),
            "Artifact path must stay within replay root",
          );
          assert.equal(
            createHash("sha256").update(file.text).digest("hex"),
            file.sha256,
            "Published artifact hash mismatch",
          );
          const target = path.resolve(root, relative);
          assert.ok(target.startsWith(path.resolve(root) + path.sep));
          fs.mkdirSync(path.dirname(target), { recursive: true });
          fs.writeFileSync(target, file.text);
        }
        const actual = await score(root, index, {
          stage:
            name === "seed"
              ? "seed"
              : ["finalRevision", "audit"].includes(name)
                ? "final"
                : "revised",
          reportFile: name === "integration" ? "handoff.json" : "quality.json",
        });
        assert.deepEqual(
          flags(actual),
          flags(entry.score),
          `${index}/${arm}/${name}: independent replay mismatch`,
        );
        replayed++;
      }
      const product = Object.keys(protocol.files).filter((n) =>
        n.endsWith(".mjs"),
      );
      assert.equal(
        row.auditProductMutated,
        product.some(
          (n) =>
            row.stages.finalRevision.artifacts[n]?.sha256 !==
            row.stages.audit.artifacts[n]?.sha256,
        ),
      );
      const overlap = Math.max(
        0,
        Math.min(
          ...["workerA", "workerB"].map(
            (n) =>
              Date.parse(row.stages[n].run.startedAt) +
              row.stages[n].run.wallMs,
          ),
        ) -
          Math.max(
            ...["workerA", "workerB"].map((n) =>
              Date.parse(row.stages[n].run.startedAt),
            ),
          ),
      );
      assert.equal(row.parallel.overlapMs, overlap);
    }
  }
  assert.deepEqual(data.summary, summarize(data));
  console.log(
    JSON.stringify({
      replayedStages: replayed,
      projects: 8,
      summary: data.summary,
      modelCalls: 0,
    }),
  );
} finally {
  const target = fs.realpathSync(sandbox),
    temp = fs.realpathSync(os.tmpdir());
  assert.ok(
    target.startsWith(temp + path.sep) &&
      path.basename(target).startsWith("dip-longitudinal-replay-"),
    "Recursive cleanup target must be the verified replay directory",
  );
  fs.rmSync(target, { recursive: true, force: true });
}
