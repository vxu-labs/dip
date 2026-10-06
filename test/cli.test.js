import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { ensure, createTask, Runtime } from "../src/core.js";
import { git } from "../src/util.js";
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "dip-cli-"));
process.env.DIP_HOME = path.join(sandbox, "runtime");
process.env.DIP_USER_HOME = path.join(sandbox, "user");
process.env.DIP_GIT_CONFIG = path.join(sandbox, "gitconfig");
process.env.GIT_CONFIG_GLOBAL = process.env.DIP_GIT_CONFIG;
const cli = fileURLToPath(new URL("../bin/dip.js", import.meta.url));
const run = (args, cwd = sandbox) =>
  execFileSync(
    process.execPath,
    ["--disable-warning=ExperimentalWarning", cli, ...args],
    { cwd, env: process.env, windowsHide: true, encoding: "utf8" },
  );
test.after(() => {
  assert.equal(path.dirname(path.resolve(sandbox)), path.resolve(os.tmpdir()));
  assert.ok(path.basename(sandbox).startsWith("dip-cli-"));
  fs.rmSync(sandbox, { recursive: true, force: true });
});
test("CLI help works outside Git and task help describes the real arguments without initializing anything", () => {
  for (const args of [
    ["--help"],
    ["-h"],
    ["task", "create", "--help"],
    ["task", "plan", "--help"],
  ])
    assert.match(run(args), /dip task/);
  assert.match(run(["task", "plan", "--help"]), /--text/);
  assert.ok(!fs.existsSync(path.join(sandbox, ".dip")));
});
test("CLI argument mistakes return concise recovery guidance instead of a stack trace", () => {
  try {
    run(["task", "create", "--unknown-option"]);
    assert.fail("Expected invalid-option failure");
  } catch (e) {
    assert.equal(e.status, 1);
    assert.match(e.stderr.toString(), /Run dip --help/);
    assert.ok(!e.stderr.toString().includes("at ModuleJob"));
  }
});
test("default CLI status stays compact with large activity history; full history remains explicit", () => {
  const root = path.join(sandbox, "project");
  fs.mkdirSync(root);
  git(root, ["init", "-b", "main"]);
  const repo = ensure(root);
  for (let n = 0; n < 4; n++) createTask(repo, { title: "Requirement " + n });
  const rt = new Runtime();
  try {
    for (let n = 0; n < 1200; n++)
      rt.enqueue(repo, "cli-test", {
        kind: "files.changed",
        files: ["src/" + n + ".js"],
        at: new Date().toISOString(),
      });
    while (rt.flush(repo.root)) {}
  } finally {
    rt.close();
  }
  const compact = run(["status", "--limit", "2"], root),
    full = run(["status", "--full"], root);
  const status = JSON.parse(compact);
  assert.equal(status.totalTasks, 4);
  assert.equal(status.tasks.length, 2);
  assert.equal(status.nextOffset, 2);
  assert.equal(status.activityRecords, 1200);
  assert.ok(compact.length < 5000);
  assert.ok(full.length > 100000);
  assert.ok(!Object.hasOwn(status, "activity"));
  assert.equal(JSON.parse(full).activity.length, 1200);
});
