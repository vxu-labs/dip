import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const workspace = fileURLToPath(new URL("../", import.meta.url));
const expected = JSON.parse(
  fs.readFileSync(
    path.join(workspace, "docs/benchmarks/2026-10-06-longitudinal-stress.json"),
    "utf8",
  ),
);
const original = JSON.parse(
  fs.readFileSync(
    path.join(
      workspace,
      "docs/benchmarks/2026-10-06-longitudinal-stress-v2.json",
    ),
    "utf8",
  ),
);
assert.equal(
  original.protocol.sourceHash,
  expected.protocol.originalVersion2SourceHash,
);
for (const key of [
  "seed",
  "iterationsPerProject",
  "checksPerIteration",
  "inputs",
])
  assert.deepEqual(expected.protocol[key], original.protocol[key]);
assert.deepEqual(expected.summary, original.summary);
for (let i = 0; i < 4; i++)
  for (const arm of ["without", "with"])
    for (const key of ["passed", "total", "groups", "flags"])
      assert.deepEqual(
        expected.pairs[i].arms[arm][key],
        original.pairs[i].arms[arm][key],
        "Infrastructure replay repairs must preserve original results",
      );
const sandbox = fs.mkdtempSync(
  path.join(os.tmpdir(), "dip-longitudinal-stress-evidence-"),
);
try {
  for (const relative of [
    "scripts/longitudinal-stress.mjs",
    "scripts/longitudinal-fixtures.mjs",
    "docs/benchmarks/2026-10-06-longitudinal-stress-protocol.json",
    "docs/benchmarks/2026-10-06-longitudinal.json",
  ]) {
    const target = path.join(sandbox, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(workspace, relative), target);
  }
  execFileSync(
    process.execPath,
    [path.join(sandbox, "scripts/longitudinal-stress.mjs")],
    {
      encoding: "utf8",
      windowsHide: true,
      timeout: 60000,
      maxBuffer: 1024 * 1024,
      // macOS aliases /var to /private/var. Keep the copied evaluator's
      // generated paths and its realpath containment guard in the same namespace.
      env: {
        ...process.env,
        TMPDIR: fs.realpathSync(os.tmpdir()),
        TMP: fs.realpathSync(os.tmpdir()),
        TEMP: fs.realpathSync(os.tmpdir()),
      },
    },
  );
  const actual = JSON.parse(
    fs.readFileSync(
      path.join(sandbox, "docs/benchmarks/2026-10-06-longitudinal-stress.json"),
      "utf8",
    ),
  );
  assert.deepEqual(actual.protocol, expected.protocol);
  assert.deepEqual(
    actual.primaryProtocolSources,
    expected.primaryProtocolSources,
  );
  assert.deepEqual(actual.summary, expected.summary);
  assert.equal(actual.pairs.length, 4);
  for (let i = 0; i < 4; i++)
    for (const arm of ["without", "with"]) {
      const a = actual.pairs[i].arms[arm],
        e = expected.pairs[i].arms[arm];
      for (const key of ["passed", "total", "groups", "flags"])
        assert.deepEqual(
          a[key],
          e[key],
          `${i}/${arm}/${key}: stress replay mismatch`,
        );
      assert.deepEqual(
        a.loadErrors.map((x) => x.file),
        e.loadErrors.map((x) => x.file),
      );
    }
  console.log(
    JSON.stringify({
      replayedProjects: 8,
      replayedChecks: 18432,
      summary: actual.summary,
      modelCalls: 0,
    }),
  );
} finally {
  const target = fs.realpathSync(sandbox),
    temp = fs.realpathSync(os.tmpdir());
  assert.ok(
    target.startsWith(temp + path.sep) &&
      path.basename(target).startsWith("dip-longitudinal-stress-evidence-"),
  );
  fs.rmSync(target, { recursive: true, force: true });
}
