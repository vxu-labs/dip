import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { ensure, Runtime, project } from "../src/core.js";
import { automationHealth } from "../src/health.js";
import { git } from "../src/util.js";

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "dip-outbox-recovery-"));
const runtimes = [];
function runtime() {
  const rt = new Runtime();
  runtimes.push(rt);
  return rt;
}
Object.assign(process.env, {
  DIP_HOME: path.join(sandbox, "runtime"),
  DIP_USER_HOME: path.join(sandbox, "user"),
  DIP_GIT_CONFIG: path.join(sandbox, "gitconfig"),
  GIT_CONFIG_GLOBAL: path.join(sandbox, "gitconfig"),
  GIT_TRACE2_EVENT: "0",
});
test.after(() => {
  for (const rt of runtimes) {
    try {
      rt.close();
    } catch {}
  }
  assert.equal(path.dirname(sandbox), path.resolve(os.tmpdir()));
  assert.ok(path.basename(sandbox).startsWith("dip-outbox-recovery-"));
  fs.rmSync(sandbox, { recursive: true, force: true });
});
let serial = 0;
function fixture() {
  const root = path.join(sandbox, `project-${++serial}`);
  fs.mkdirSync(root);
  git(root, ["init", "-b", "main"]);
  return ensure(root);
}
function move(from, to) {
  assert.equal(path.dirname(from), sandbox);
  assert.equal(path.dirname(to), sandbox);
  assert.ok(!fs.existsSync(to));
  fs.renameSync(from, to);
}

test("missing-root records survive restart, back off and immediately recover on return without duplicate activity", () => {
  const repo = fixture(),
    away = repo.root + "-away",
    good = fixture(),
    now = Date.now();
  let rt = runtime();
  for (let i = 0; i < 510; i++)
    rt.enqueue(
      repo,
      `session-${i}`,
      { agent: "test", kind: "retained", number: i },
      `record-${i}`,
    );
  const original = rt.db
    .prepare("SELECT id,data FROM queue WHERE root=? ORDER BY id")
    .all(repo.root);
  // Old installed versions retain this historical error. New versions migrate without dropping it.
  rt.db
    .prepare("INSERT INTO queue_errors VALUES (?,?,?)")
    .run(repo.root, "ENOENT historical diagnostic", now);
  move(repo.root, away);
  assert.equal(rt.flush(null, { now }), 0);
  assert.equal(rt.lastFlushErrors.length, 0);
  assert.equal(
    rt.db
      .prepare("SELECT attempts FROM queue_deferred WHERE root=?")
      .get(repo.root).attempts,
    1,
  );
  rt.close();
  rt = runtime();
  for (let i = 1; i < 30; i++) rt.flush(null, { now: now + i * 100 });
  assert.deepEqual(
    rt.db
      .prepare("SELECT id,data FROM queue WHERE root=? ORDER BY id")
      .all(repo.root),
    original,
  );
  assert.equal(
    rt.db
      .prepare("SELECT attempts FROM queue_deferred WHERE root=?")
      .get(repo.root).attempts,
    1,
  );
  rt.enqueue(good, "healthy", { agent: "test", kind: "healthy" });
  assert.equal(rt.flush(null, { now: now + 3000 }), 1);
  assert.ok(project(good).activity.some((a) => a.kind === "healthy"));
  const health = automationHealth(good.root);
  assert.equal(health.deferredOutbox.records, 510);
  assert.equal(health.failures.length, 0);
  assert.ok(!health.issues.some((s) => /outbox records/.test(s)));
  assert.equal(rt.flush(null, { now: now + 30000 }), 0);
  assert.equal(
    rt.db
      .prepare("SELECT attempts FROM queue_deferred WHERE root=?")
      .get(repo.root).attempts,
    2,
  );
  move(away, repo.root);
  assert.equal(rt.flush(null, { now: now + 30001 }), 500);
  assert.equal(rt.flush(null, { now: now + 30002 }), 10);
  assert.equal(rt.flush(), 0);
  assert.equal(
    project(repo).activity.filter((a) => a.kind === "retained").length,
    510,
  );
  assert.equal(
    rt.db.prepare("SELECT count(*) AS n FROM queue_deferred").get().n,
    0,
  );
  assert.equal(
    rt.db.prepare("SELECT count(*) AS n FROM queue_errors").get().n,
    0,
  );
  rt.close();
});

test("explicit CLI flush retries a deferred root without erasing records and normal retries cap at five minutes", () => {
  const repo = fixture(),
    away = repo.root + "-away",
    rt = runtime();
  rt.enqueue(repo, "s", { agent: "test", kind: "retained" });
  move(repo.root, away);
  let now = Date.now();
  for (let i = 0; i < 8; i++) {
    rt.flush(null, { now });
    const d = rt.db
      .prepare("SELECT * FROM queue_deferred WHERE root=?")
      .get(repo.root);
    assert.equal(d.attempts, i + 1);
    assert.ok(d.next_at - now <= 300000);
    now = d.next_at;
  }
  const output = JSON.parse(
    execFileSync(process.execPath, [path.resolve("bin/dip.js"), "flush"], {
      cwd: sandbox,
      encoding: "utf8",
      env: process.env,
    }),
  );
  assert.equal(output.flushed, 0);
  assert.equal(output.errors.length, 0);
  assert.equal(output.deferred[0].attempts, 9);
  assert.equal(
    rt.db.prepare("SELECT count(*) AS n FROM queue WHERE root=?").get(repo.root)
      .n,
    1,
  );
  rt.close();
  move(away, repo.root);
  const recovered = runtime();
  assert.equal(recovered.flush(), 1);
  recovered.close();
});

test("malformed live project remains an actual failure while an unrelated healthy project drains", () => {
  const bad = fixture(),
    good = fixture(),
    rt = runtime();
  fs.writeFileSync(path.join(bad.dir, "config.json"), "{broken");
  rt.enqueue(bad, "bad", { agent: "test", kind: "retained" });
  rt.enqueue(good, "good", { agent: "test", kind: "healthy" });
  assert.equal(rt.flush(), 1);
  assert.equal(rt.lastFlushErrors.length, 1);
  assert.equal(
    rt.db
      .prepare("SELECT count(*) AS n FROM queue_deferred WHERE root=?")
      .get(bad.root).n,
    0,
  );
  assert.equal(
    rt.db.prepare("SELECT count(*) AS n FROM queue WHERE root=?").get(bad.root)
      .n,
    1,
  );
  rt.close();
});
