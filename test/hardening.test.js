import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  ensure,
  createTask,
  Runtime,
  project,
  updateTask,
} from "../src/core.js";
import { execute } from "../src/actions.js";
import {
  install,
  uninstall,
  recordablePath,
  stopDaemon,
} from "../src/automation.js";
import { installTransaction } from "../src/install-transaction.js";
import { automationHealth } from "../src/health.js";
import { atomic, json, git } from "../src/util.js";

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "dip-hardening-"));
process.env.DIP_HOME = path.join(sandbox, "runtime");
process.env.DIP_USER_HOME = path.join(sandbox, "user");
process.env.DIP_GIT_CONFIG = path.join(sandbox, "gitconfig");
process.env.GIT_CONFIG_GLOBAL = process.env.DIP_GIT_CONFIG;
const cli = fileURLToPath(new URL("../bin/dip.js", import.meta.url));
let serial = 0;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(predicate, ms = 10000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    if (predicate()) return;
    await wait(70);
  }
  throw new Error("Timed out waiting for recorder");
}
function fixture() {
  const root = path.join(sandbox, `project-${++serial}`);
  fs.mkdirSync(root);
  git(root, ["init", "-b", "main"]);
  return ensure(root);
}
test.after(() => {
  stopDaemon();
  assert.ok(sandbox.startsWith(path.join(os.tmpdir(), "dip-hardening-")));
  fs.rmSync(sandbox, { recursive: true, force: true });
});

test("new acceptance criteria invalidate evidence even when source is unchanged", async () => {
  const repo = fixture();
  repo.config.verification = {
    pass: { command: [process.execPath, "-e", "process.exit(0)"] },
  };
  atomic(path.join(repo.dir, "config.json"), repo.config);
  fs.writeFileSync(path.join(repo.root, "code.js"), "42");
  const id = createTask(repo, {
    title: "Intent",
    acceptance: ["First"],
    scope: ["."],
  });
  await execute("verify", { id, check: "pass" }, repo.root);
  assert.equal(
    (await execute("reconcile", {}, repo.root)).tasks[0].verification,
    "current",
  );
  updateTask(repo, id, { acceptance: ["First", "Second"] });
  assert.equal(
    (await execute("reconcile", {}, repo.root)).tasks[0].verification,
    "stale",
  );
  await execute("verify", { id, check: "pass" }, repo.root);
  fs.writeFileSync(path.join(repo.root, "code.js"), "43");
  assert.equal(
    (await execute("reconcile", {}, repo.root)).tasks[0].verification,
    "stale",
  );
});

test("coordinate mode protects semantic state and atomic scope expansion", async () => {
  const repo = fixture(),
    rt = new Runtime();
  const a = createTask(repo, { title: "A", scope: ["src/a"] }),
    b = createTask(repo, { title: "B", scope: ["src/b"] });
  const lease = rt.claim(repo, a, "owner-a", 120000, ["src/a"]);
  rt.claim(repo, b, "owner-b", 120000, ["src/b"]);
  try {
    await assert.rejects(
      execute(
        "update",
        { id: a, actor: "other", patch: { status: "implemented" } },
        repo.root,
      ),
      /owned/,
    );
    await assert.rejects(
      execute(
        "update",
        { id: a, token: lease.token, patch: { scope: ["src/b"] } },
        repo.root,
      ),
      /Scope owned/,
    );
    await assert.rejects(
      execute(
        "update",
        { id: a, token: lease.token, patch: { title: "", scope: ["src/new"] } },
        repo.root,
      ),
      /title/,
    );
    assert.deepEqual(rt.leases(repo).find((l) => l.task === a).scope, [
      "src/a",
    ]);
    await execute(
      "checkpoint",
      { id: a, actor: "owner-a", token: lease.token, summary: "Handoff" },
      repo.root,
    );
  } finally {
    rt.close();
  }
});

test("a broken project cannot block other projects or silently discard its outbox", () => {
  const bad = fixture(),
    good = fixture(),
    rt = new Runtime();
  for (let i = 0; i < 510; i++)
    rt.enqueue(bad, "broken", { agent: "test", kind: "tool", number: i });
  fs.writeFileSync(path.join(bad.dir, "config.json"), "{broken");
  rt.flush();
  rt.enqueue(good, "healthy", { agent: "test", kind: "healthy" });
  assert.equal(rt.flush(), 1);
  assert.ok(project(good).activity.some((a) => a.kind === "healthy"));
  assert.equal(
    rt.db.prepare("SELECT count(*) AS n FROM queue WHERE root=?").get(bad.root)
      .n,
    510,
  );
  assert.ok(rt.lastFlushErrors.length);
  atomic(path.join(bad.dir, "config.json"), bad.config);
  rt.flush();
  rt.flush();
  assert.equal(
    rt.db.prepare("SELECT count(*) AS n FROM queue WHERE root=?").get(bad.root)
      .n,
    0,
  );
  assert.equal(project(bad).activity.length, 510);
  rt.close();
});

test("installation restores earlier writes when a later adapter configuration fails", () => {
  const user = process.env.DIP_USER_HOME;
  const hookFile = path.join(user, ".codex", "hooks.json"),
    claude = path.join(user, ".claude", "settings.json");
  atomic(hookFile, { custom: "preserved" });
  atomic(claude, "{invalid");
  assert.throws(
    () => install({ roots: [], start: false, startup: false }),
    /Invalid JSON/,
  );
  assert.deepEqual(json(hookFile), { custom: "preserved" });
  assert.equal(fs.readFileSync(claude, "utf8"), "{invalid");
  assert.ok(!fs.existsSync(hookFile + ".dip-backup"));
  atomic(claude, {});
});

test("installation journal recovers a crashed write and preserves bytes", () => {
  const dir = path.join(sandbox, "journal"),
    file = path.join(dir, "config");
  fs.mkdirSync(dir);
  const bytes = Buffer.from([0, 1, 255, 125]);
  atomic(file, "partial");
  atomic(path.join(dir, "install-journal.json"), {
    entries: [{ file, bytes: bytes.toString("base64"), mode: 0o600 }],
  });
  installTransaction(dir, [file], () => {
    assert.deepEqual(fs.readFileSync(file), bytes);
  });
  assert.throws(
    () =>
      installTransaction(dir, [file], () => {
        atomic(file, "another partial");
        throw new Error("failure");
      }),
    /failure/,
  );
  assert.deepEqual(fs.readFileSync(file), bytes);
});

test("upgrading an owned MCP integration preserves the original hooks feature", () => {
  const opts = { roots: [], start: false, startup: false, gitHooks: false };
  install(opts);
  install(opts);
  const manifest = path.join(process.env.DIP_HOME, "install.json"),
    state = json(manifest);
  assert.equal(state.previousCodexHooks, null);
  const old = path.join(sandbox, "old-version", "dip.js");
  state.cli = old;
  atomic(manifest, state);
  const codex = path.join(process.env.DIP_USER_HOME, ".codex", "config.toml");
  let text = fs.readFileSync(codex, "utf8");
  const current = json(path.join(process.env.DIP_USER_HOME, ".claude.json"));
  // TOML stores escaped Windows paths.
  const escapedCli = cli.replaceAll("\\", "\\\\"),
    escapedOld = old.replaceAll("\\", "\\\\");
  text = text.replaceAll(escapedCli, escapedOld);
  atomic(codex, text);
  current.mcpServers.dip.args = [old, "mcp"];
  atomic(path.join(process.env.DIP_USER_HOME, ".claude.json"), current);
  install(opts);
  uninstall();
  assert.ok(!/hooks = true/.test(fs.readFileSync(codex, "utf8")));
});

test("health distinguishes a working dashboard from installed recording", () => {
  const repo = fixture(),
    health = automationHealth(repo.root);
  assert.equal(health.installed, false);
  assert.equal(health.daemon.running, false);
  assert.equal(health.watcherAttached, false);
  assert.ok(health.issues.some((s) => s.includes("not installed")));
});

test("watcher filters runtime, nested ledgers and dependencies", () => {
  const root = sandbox;
  assert.equal(recordablePath(root, "runtime/runtime.sqlite"), false);
  assert.equal(recordablePath(root, "nested/.dip/events/record.json"), false);
  assert.equal(recordablePath(root, "nested/node_modules/module.js"), false);
  assert.equal(recordablePath(root, "src/code.js"), true);
});

test("in-flight renewal preserves only current tokens and finishes at a tool boundary", () => {
  const repo = fixture(),
    rt = new Runtime();
  const task = createTask(repo, { title: "Long operation" });
  try {
    const lease = rt.claim(repo, task, "long-worker");
    rt.beginTool(repo, "long-session", "use-1", task, lease.token);
    rt.db
      .prepare("UPDATE leases SET expires=? WHERE repo=? AND task=?")
      .run(Date.now() + 1000, repo.key, task);
    rt.renewRunningTools();
    assert.ok(
      rt.leases(repo).find((l) => l.task === task).expires >
        Date.now() + 100000,
    );
    rt.endTool(repo, "long-session", "use-1");
    assert.equal(
      rt.db
        .prepare("SELECT count(*) AS n FROM operations WHERE repo=?")
        .get(repo.key).n,
      0,
    );
    rt.beginTool(repo, "long-session", "use-2", task, lease.token);
    rt.db
      .prepare("UPDATE leases SET expires=0 WHERE repo=? AND task=?")
      .run(repo.key, task);
    rt.renewRunningTools();
    assert.throws(() => rt.assert(repo, task, lease.token), /expired/);
    const replacement = rt.claim(repo, task, "replacement");
    rt.renewRunningTools();
    assert.notEqual(replacement.token, lease.token);
  } finally {
    rt.close();
  }
});

test("task selection respects priority and busy scopes; invalid schedules are rejected", async () => {
  const repo = fixture(),
    rt = new Runtime();
  const high = createTask(repo, {
    title: "High",
    priority: 1,
    scope: ["src/a"],
  });
  createTask(repo, { title: "Low", priority: 5 });
  const busy = createTask(repo, { title: "Busy" });
  rt.claim(repo, busy, "worker", 120000, ["src/a"]);
  assert.ok(!(await execute("next", {}, repo.root)).some((t) => t.id === high));
  rt.close();
  assert.throws(
    () => createTask(repo, { title: "Invalid", due: "2026-02-30" }),
    /valid/,
  );
  assert.throws(
    () => createTask(repo, { title: "Invalid", priority: 0 }),
    /Priority/,
  );
});

test("native recorder reports watched projects and stops gracefully with pending file data", async () => {
  const repo = fixture();
  install({
    roots: [repo.root],
    agents: false,
    gitHooks: false,
    startup: false,
    start: false,
    port: 0,
  });
  const child = spawn(process.execPath, [cli, "daemon"], {
    env: process.env,
    windowsHide: true,
    stdio: "ignore",
  });
  const exited = new Promise((resolve) => child.on("exit", resolve));
  try {
    await until(() => automationHealth(repo.root).watcherAttached);
    assert.ok(automationHealth(repo.root).daemon.dashboard);
    fs.writeFileSync(path.join(repo.root, "last.js"), "last observed write");
    await wait(120);
    const result = JSON.parse(
      execFileSync(process.execPath, [cli, "stop"], {
        env: process.env,
        encoding: "utf8",
        windowsHide: true,
      }),
    );
    assert.equal(result.graceful, true);
    await exited;
    assert.ok(project(repo).activity.some((a) => a.files?.includes("last.js")));
    assert.equal(automationHealth(repo.root).daemon.running, false);
  } finally {
    if (child.exitCode === null) {
      child.kill();
      await exited;
    }
  }
});
