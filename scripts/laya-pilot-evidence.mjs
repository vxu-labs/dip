import fs from "node:fs";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  corpus,
  relationQuestion,
  identityQuestion,
} from "./laya-pilot-corpus.mjs";
import { scorePilot } from "./laya-pilot-analysis.mjs";
const file = process.argv[2] || "docs/benchmarks/2026-10-07-laya.json";
const data = JSON.parse(fs.readFileSync(file, "utf8"));
const protocol = JSON.parse(
  fs.readFileSync("docs/benchmarks/2026-10-07-laya-protocol.json", "utf8"),
);
assert.ok(
  data.completedAt &&
    !data.preflight &&
    !data.infrastructureError &&
    !data.resourceAbort,
  "Complete scored pilot required",
);
assert.deepEqual(data.protocol, protocol);
assert.deepEqual(protocol.cases, corpus());
assert.deepEqual(protocol.relationQuestion, relationQuestion);
assert.deepEqual(protocol.identityQuestion, identityQuestion);
const sha = (file) =>
  createHash("sha256")
    .update(fs.readFileSync(file, "utf8").replaceAll("\r\n", "\n"))
    .digest("hex");
assert.equal(protocol.sources.corpus, sha("scripts/laya-pilot-corpus.mjs"));
assert.equal(protocol.sources.runner, sha("scripts/laya-pilot.py"));
assert.equal(data.rows.length, 96);
assert.equal(data.loadedRevision, protocol.modelRevision);
assert.equal(data.device, "cpu");
assert.equal(data.threads, 4);
for (const [name, version] of Object.entries(protocol.packages))
  assert.equal(data.packages[name], version);
for (let i = 0; i < data.rows.length; i++) {
  const row = data.rows[i],
    item = protocol.cases[i];
  assert.equal(row.id, item.id);
  assert.equal(row.family, item.family);
  assert.equal(row.language, item.language);
  assert.ok(!row.error);
  assert.ok(row.wallSeconds >= 0);
  for (const [name, map] of [
    ["relation", row.optionMap],
    ["identity", row.identityMap],
  ]) {
    const answer = row.prediction.answers[name];
    assert.equal(answer.type, "choice");
    assert.ok(answer.choice in map);
    const probabilities = Object.values(answer.probabilities);
    assert.ok(
      probabilities.every((p) => Number.isFinite(p) && p >= 0 && p <= 1),
    );
    assert.ok(Math.abs(probabilities.reduce((n, p) => n + p, 0) - 1) < 0.002);
    assert.equal(
      name === "relation" ? row.relation : row.identity,
      name === "relation" ? map[answer.choice] : map[answer.choice] === "yes",
    );
  }
}
const summary = scorePilot(data);
if (data.summary) assert.deepEqual(data.summary, summary);
console.log(
  JSON.stringify({
    verified: true,
    rows: data.rows.length,
    summary,
    modelCalls: 0,
  }),
);
