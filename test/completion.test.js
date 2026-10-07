import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import {
  ensure,
  createTask,
  append,
  taskRead,
  project,
  Runtime,
  compactContext,
  updateTask,
} from "../src/core.js";
import { execute } from "../src/actions.js";
import { handleHook } from "../src/automation.js";
import { atomic, git } from "../src/util.js";
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "dip-completion-"));
process.env.DIP_HOME = path.join(sandbox, "runtime");
process.env.DIP_USER_HOME = path.join(sandbox, "user");
process.env.DIP_GIT_CONFIG = path.join(sandbox, "gitconfig");
process.env.GIT_CONFIG_GLOBAL = process.env.DIP_GIT_CONFIG;
const cli = fileURLToPath(new URL("../bin/dip.js", import.meta.url));
let serial = 0;
function fixture(payload = {}) {
  const root = path.join(sandbox, String(++serial));
  fs.mkdirSync(root);
  git(root, ["init", "-b", "main"]);
  const repo = ensure(root);
  repo.config.verification.pass = {
    command: [process.execPath, "-e", "process.exit(0)"],
  };
  repo.config.verification.fail = {
    command: [process.execPath, "-e", "process.exit(1)"],
  };
  atomic(path.join(repo.dir, "config.json"), repo.config);
  const id = createTask(repo, { title: "Requested work", ...payload });
  const run = (action, args = {}) =>
    execute(action, { id, actor: "qa", ...args }, root);
  return { root, repo, id, run };
}
test.after(() => {
  assert.equal(path.dirname(sandbox), path.resolve(os.tmpdir()));
  assert.ok(path.basename(sandbox).startsWith("dip-completion-"));
  fs.rmSync(sandbox, { recursive: true, force: true });
});

test("answered requests leave development queues without pretending to verify code; unfinished work survives Stop", async () => {
  const f = fixture();
  const rt = new Runtime();
  try {
    rt.setSession(f.repo, "s", f.id, "codex:s");
    rt.claim(f.repo, f.id, "codex:s", 120000, []);
    const finished = await f.run("finish", {
      actor: "codex:s",
      outcome: "answered",
      summary: "Explained local behavior",
    });
    assert.equal(finished.status, "implemented");
    assert.equal(finished.kind, "discussion");
    assert.equal(finished.verifiedComplete, false);
    assert.equal(finished.released, true);
    handleHook(
      { cwd: f.root, session_id: "s", hook_event_name: "Stop" },
      "codex",
    );
    const current = taskRead(f.repo, f.id);
    assert.equal(current.checkpoints.length, 0);
    assert.equal(current.resolution.summary, "Explained local behavior");
    updateTask(f.repo, f.id, { status: "cancelled" });
    assert.equal(taskRead(f.repo, f.id).resolution, null);
    assert.equal(compactContext(f.repo, rt).recent.length, 0);
    assert.equal((await f.run("next")).length, 0);
    const waiting = createTask(f.repo, {
      title: "Unfinished",
      status: "in_progress",
    });
    rt.setSession(f.repo, "s", waiting, "codex:s");
    handleHook(
      { cwd: f.root, session_id: "s", hook_event_name: "Stop" },
      "codex",
    );
    assert.equal(taskRead(f.repo, waiting).status, "in_progress");
    assert.equal(taskRead(f.repo, waiting).checkpoints.at(-1).automatic, true);
  } finally {
    rt.close();
  }
});

test("implemented finish verifies configured snapshots and retains ownership after failure", async () => {
  const f = fixture({ scope: ["src"], acceptance: ["Behavior works"] });
  const rt = new Runtime();
  try {
    const lease = rt.claim(f.repo, f.id, "qa", 120000, ["src"]);
    const bad = await f.run("finish", {
      outcome: "implemented",
      summary: "Attempted behavior",
      check: "fail",
      token: lease.token,
    });
    assert.equal(bad.check.passed, false);
    assert.equal(bad.verifiedComplete, false);
    assert.equal(bad.released, false);
    assert.equal(rt.leases(f.repo).length, 1);
    const good = await f.run("finish", {
      outcome: "implemented",
      summary: "Behavior passes",
      check: "pass",
      token: lease.token,
    });
    assert.equal(good.status, "verified");
    assert.equal(good.verification, "current");
    assert.equal(good.released, true);
    assert.equal(rt.leases(f.repo).length, 0);
    const repeated = await f.run("finish", {
      outcome: "implemented",
      summary: "Behavior passes",
    });
    assert.equal(repeated.status, "verified");
    updateTask(f.repo, f.id, { status: "in_progress" });
    assert.equal(taskRead(f.repo, f.id).resolution, null);
  } finally {
    rt.close();
  }
});

test("invalid or unauthorized finishes cannot discard development requirements", async () => {
  const f = fixture({ scope: ["src"], acceptance: ["Preserve API"] });
  const before = taskRead(f.repo, f.id).history.length;
  await assert.rejects(
    f.run("finish", { outcome: "answered", summary: "Done" }),
    /informational/,
  );
  await assert.rejects(
    f.run("finish", {
      outcome: "implemented",
      summary: "Done",
      check: "missing",
    }),
    /configured/,
  );
  await assert.rejects(
    f.run("finish", { outcome: "superseded", summary: "Moved" }),
    /replacement/,
  );
  await assert.rejects(
    f.run("finish", {
      outcome: "superseded",
      summary: "Moved",
      replacedBy: [f.id],
    }),
    /itself/,
  );
  await assert.rejects(
    f.run("finish", {
      outcome: "superseded",
      summary: "Moved",
      replacedBy: ["task_missing"],
    }),
    /not found/,
  );
  assert.equal(taskRead(f.repo, f.id).history.length, before);
  const rt = new Runtime();
  try {
    rt.claim(f.repo, f.id, "other", 120000, ["src"]);
    await assert.rejects(
      f.run("finish", { outcome: "cancelled", summary: "Abandon" }),
      /owned|Ownership|token/i,
    );
  } finally {
    rt.close();
  }
});

test("supersession preserves open replacement work and competing finishes remain conflicts", async () => {
  const f = fixture();
  const replacement = createTask(f.repo, { title: "Remaining behavior" });
  await f.run("finish", {
    outcome: "superseded",
    summary: "Follow current requirement",
    replacedBy: [replacement],
  });
  assert.equal(taskRead(f.repo, replacement).status, "backlog");
  assert.deepEqual(taskRead(f.repo, f.id).resolution.replacedBy, [replacement]);
  assert.deepEqual(
    (await f.run("related")).tasks.find((t) => t.id === replacement).relations,
    ["superseded_by"],
  );
  await assert.rejects(f.run("verify", { check: "pass" }), /applicable/);
  const parents = taskRead(f.repo, f.id).heads;
  append(
    f.repo,
    f.id,
    "task.update",
    {
      status: "cancelled",
      resolution: {
        outcome: "cancelled",
        summary: "No longer wanted",
        replacedBy: [],
      },
    },
    { parents },
  );
  append(
    f.repo,
    f.id,
    "task.update",
    {
      status: "superseded",
      resolution: {
        outcome: "superseded",
        summary: "Current request",
        replacedBy: [replacement],
      },
    },
    { parents },
  );
  assert.equal(taskRead(f.repo, f.id).status, "conflict");
  assert.ok(
    taskRead(f.repo, f.id).conflicts.some((c) => c.field === "resolution"),
  );
});

test("compact CLI get/reconcile exclude raw history and honor ID, kind, open and pagination filters", async () => {
  const f = fixture({
    description: "x".repeat(15000),
    acceptance: Array.from({ length: 40 }, () => "c".repeat(1200)),
  });
  for (let i = 0; i < 8; i++) createTask(f.repo, { title: "Other " + i });
  const discussion = createTask(f.repo, {
    title: "Question",
    kind: "discussion",
  });
  const rt = new Runtime();
  try {
    for (let i = 0; i < 1200; i++)
      rt.enqueue(f.repo, "read", {
        kind: "files.changed",
        files: ["src/" + i],
        at: new Date().toISOString(),
      });
    while (rt.flush(f.root)) {}
  } finally {
    rt.close();
  }
  const read = (args) =>
    JSON.parse(
      execFileSync(
        process.execPath,
        ["--disable-warning=ExperimentalWarning", cli, ...args],
        { cwd: f.root, encoding: "utf8", windowsHide: true },
      ),
    );
  const compact = read([
    "reconcile",
    "--kind",
    "work",
    "--open",
    "--limit",
    "2",
  ]);
  assert.equal(compact.total, 9);
  assert.equal(compact.tasks.length, 2);
  assert.equal(compact.nextOffset, 2);
  assert.equal(compact.activity, undefined);
  assert.equal(compact.tasks[0].history, undefined);
  assert.ok(JSON.stringify(compact).length < 5000);
  const get = read(["task", "get", "--id", f.id]);
  assert.equal(get.history, undefined);
  assert.equal(get.descriptionTruncated, true);
  assert.equal(get.acceptanceTruncated, true);
  assert.ok(JSON.stringify(get).length < 42000);
  assert.equal(
    read(["reconcile", "--id", discussion]).tasks[0].kind,
    "discussion",
  );
  assert.equal(
    read(["task", "get", "--id", f.id, "--full"]).description.length,
    15000,
  );
  assert.equal(read(["reconcile", "--full"]).activity.length, 1200);
  fs.writeFileSync(
    path.join(f.repo.dir, "events", "_activity", "broken.json"),
    "{",
  );
  assert.equal((await f.run("get")).id, f.id); // irrelevant activity is not read
  fs.writeFileSync(path.join(f.repo.dir, "events", f.id, "broken.json"), "{");
  await assert.rejects(f.run("get"), /history is invalid/); // relevant corruption cannot be silently omitted
});

test("actual MCP finish is discoverable and compact reads use the same filters", async () => {
  const f = fixture();
  const client = new Client({ name: "qa", version: "1" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["--disable-warning=ExperimentalWarning", cli, "mcp"],
    cwd: f.root,
    env: process.env,
    stderr: "pipe",
  });
  try {
    await client.connect(transport);
    assert.ok(
      (await client.listTools()).tools.some((t) => t.name === "task_finish"),
    );
    const finish = await client.callTool({
      name: "task_finish",
      arguments: {
        root: f.root,
        id: f.id,
        outcome: "answered",
        summary: "Explained",
        actor: "qa",
      },
    });
    assert.equal(finish.isError, undefined);
    const result = await client.callTool({
      name: "project_reconcile",
      arguments: { root: f.root, kind: "work", open: true },
    });
    assert.equal(JSON.parse(result.content[0].text).total, 0);
    const get = await client.callTool({
      name: "task_get",
      arguments: { root: f.root, id: f.id },
    });
    const data = JSON.parse(get.content[0].text);
    assert.equal(data.resolution.outcome, "answered");
    assert.equal(data.history, undefined);
  } finally {
    await client.close();
  }
});
