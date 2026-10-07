import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { DatabaseSync } from "node:sqlite";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { ensure, createTask, append, taskRead, Runtime } from "../src/core.js";
import { execute } from "../src/actions.js";
import { atomic, git, digest } from "../src/util.js";

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "dip-navigation-"));
process.env.DIP_HOME = path.join(sandbox, "runtime");
process.env.DIP_USER_HOME = path.join(sandbox, "user");
process.env.DIP_GIT_CONFIG = path.join(sandbox, "gitconfig");
process.env.GIT_CONFIG_GLOBAL = process.env.DIP_GIT_CONFIG;
const cli = fileURLToPath(new URL("../bin/dip.js", import.meta.url));
let serial = 0;
function fixture() {
  const root = path.join(sandbox, String(++serial));
  fs.mkdirSync(root);
  git(root, ["init", "-b", "main"]);
  git(root, ["config", "user.name", "QA"]);
  git(root, ["config", "user.email", "qa@example.invalid"]);
  const repo = ensure(root),
    id = createTask(repo, {
      title: "Export CSV",
      scope: ["src"],
      acceptance: ["Preserve Unicode"],
    });
  const run = (action, args = {}) =>
    execute(action, { id, actor: "qa", ...args }, root);
  const write = (name, text) => {
    fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    fs.writeFileSync(path.join(root, name), text);
  };
  repo.config.verification.pass = {
    command: [process.execPath, "-e", "process.exit(0)"],
  };
  atomic(path.join(repo.dir, "config.json"), repo.config);
  return { root, repo, id, run, write };
}
test.after(() => {
  assert.ok(sandbox.startsWith(path.join(os.tmpdir(), "dip-navigation-")));
  fs.rmSync(sandbox, { recursive: true, force: true });
});

test("requirements expose current intent, stale sources and conflicts without accepting status as proof", async () => {
  const f = fixture(),
    dep = createTask(f.repo, { title: "Prerequisite" });
  append(f.repo, dep, "task.update", { status: "verified" });
  await f.run("update", {
    patch: {
      dependencies: [dep],
      description: "x".repeat(10000),
      acceptance: Array.from({ length: 30 }, (_, i) => "Criterion " + i),
    },
  });
  f.write("PLAN.md", "# Plan\n- [x] Done");
  await f.run("document-link", { path: "PLAN.md", role: "plan" });
  const view = await f.run("requirements", { limit: 3, maxChars: 500 });
  assert.equal(view.dependencies[0].verifiedComplete, false);
  assert.equal(view.descriptionTruncated, true);
  assert.equal(view.acceptance.length, 3);
  assert.equal(view.nextOffset, 3);
  assert.equal(view.requiresReview, false);
  f.write("PLAN.md", "# Changed requirement");
  assert.equal((await f.run("requirements")).requiresReview, true);
  const parents = taskRead(f.repo, f.id).heads;
  append(f.repo, f.id, "task.update", { description: "First" }, { parents });
  append(f.repo, f.id, "task.update", { description: "Second" }, { parents });
  assert.equal((await f.run("requirements")).requiresReview, true);
  assert.equal((await f.run("requirements")).conflicts[0].field, "description");
});

test("ownership includes another worktree, overlapping parents and excludes expired leases", async () => {
  const f = fixture();
  git(f.root, ["add", ".dip", "AGENTS.md", "CLAUDE.md"]);
  git(f.root, ["commit", "-m", "Fixture"]);
  const otherRoot = f.root + "-worker";
  git(f.root, ["worktree", "add", otherRoot, "-b", "worker"]);
  const other = ensure(otherRoot),
    task = createTask(other, { title: "Worker auth", scope: ["src/auth"] });
  const rt = new Runtime();
  try {
    rt.claim(other, task, "worker", 120000, ["src/auth"]);
    const owners = await f.run("owners", { path: "src" });
    assert.equal(owners.owners[0].task, task);
    assert.equal(owners.owners[0].root, other.root);
    assert.equal((await f.run("owners", { path: "unrelated" })).total, 0);
    rt.db
      .prepare("UPDATE leases SET expires=0 WHERE repo=? AND task=?")
      .run(other.key, task);
    assert.equal((await f.run("owners", { path: "src" })).total, 0);
    await assert.rejects(
      f.run("owners", { path: "../outside" }),
      /relative scopes/,
    );
  } finally {
    rt.close();
  }
});

test("changes distinguish scoped additions/deletions, linked sources, intent and check configuration", async () => {
  const f = fixture();
  f.write("src/modify.js", "before");
  f.write("src/remove.js", "remove");
  f.write("other.js", "unscoped");
  f.write("PLAN.md", "# Plan");
  await f.run("document-link", { path: "PLAN.md", role: "plan" });
  assert.equal((await f.run("verify", { check: "pass" })).passed, true);
  assert.equal((await f.run("changes")).verification, "current");
  f.write("src/modify.js", "after");
  fs.unlinkSync(path.join(f.root, "src/remove.js"));
  f.write("src/add.js", "added");
  f.write("other.js", "changed outside scope");
  f.write("PLAN.md", "# New plan");
  await f.run("update", { patch: { acceptance: ["New criterion"] } });
  f.repo.config.verification.pass.command = [
    process.execPath,
    "-e",
    "process.exit(1)",
  ];
  atomic(path.join(f.repo.dir, "config.json"), f.repo.config);
  const view = await f.run("changes");
  assert.deepEqual(
    view.changes.map((r) => [r.path, r.change]),
    [
      ["src/add.js", "added"],
      ["src/modify.js", "modified"],
      ["src/remove.js", "deleted"],
    ],
  );
  assert.ok(view.changedIntentFields.includes("acceptance"));
  assert.ok(view.changedIntentFields.includes("documents"));
  assert.equal(view.documents[0].currentness, "stale");
  assert.equal(view.checkConfigurationChanged, true);
  assert.equal(view.verification, "stale");
});

test("legacy evidence reports intent change without inventing unavailable historical fields", async () => {
  const f = fixture();
  await f.run("verify", { check: "pass" });
  const e = taskRead(f.repo, f.id).history.find(
    (e) => e.type === "task.evidence",
  );
  delete e.payload.intentFields;
  atomic(path.join(f.repo.dir, "events", f.id, e.eventId + ".json"), e);
  await f.run("update", { patch: { acceptance: ["Updated"] } });
  const view = await f.run("changes");
  assert.equal(view.intentChanged, true);
  assert.equal(view.changedIntentFields, null);
  assert.equal(view.intentDetailsAvailable, false);
});

test("Unicode task/decision search retains negation, filters cancellation and cannot cross checkout indexes", async () => {
  const f = fixture(),
    related = createTask(f.repo, {
      title: "תמיכה בייצוא עברית",
      scope: ["src/export"],
      description: "Do not enable encryption",
    });
  append(f.repo, related, "task.decision", {
    summary: "Use streaming CSV; do not use buffering",
  });
  const cancelled = createTask(f.repo, {
    title: "CSV cancelled",
    status: "cancelled",
  });
  const first = await f.run("search", { query: "CSV עברית", limit: 50 });
  assert.ok(first.hits.some((t) => t.id === related));
  assert.ok(!first.hits.some((t) => t.id === cancelled));
  const decisions = await f.run("search", {
    query: "buffering",
    kind: "decision",
  });
  assert.equal(decisions.hits[0].id, related);
  assert.ok(decisions.hits[0].excerpt.includes("do not"));
  assert.equal(
    (await f.run("search", { query: "CSV", statuses: ["cancelled"] })).hits[0]
      .id,
    cancelled,
  );
  assert.equal(
    (await f.run("search", { query: "CSV", scope: ["not-matching"] })).total,
    0,
  );
  const other = fixture();
  assert.equal((await other.run("search", { query: "עברית" })).total, 0);
  await assert.rejects(f.run("search", { query: "***" }), /contain words/);
});

test("explicit relationships preserve dependency, shared-document and overlapping-scope provenance", async () => {
  const f = fixture(),
    other = createTask(f.repo, { title: "Dependency", scope: ["unrelated"] });
  await f.run("update", { patch: { dependencies: [other] } });
  f.write("shared.md", "# Design");
  await f.run("document-link", { path: "shared.md", role: "design" });
  await f.run("document-link", { id: other, path: "shared.md", role: "spec" });
  const related = await f.run("related");
  assert.ok(related.tasks[0].relations.includes("dependency"));
  assert.ok(related.tasks[0].relations.includes("shared_document"));
  assert.equal(related.identityEstablished, false);
  assert.equal(taskRead(f.repo, other).status, "backlog");
});

test("large history index refresh is incremental, ignores corrupt activity and rebuilds after cache loss", async () => {
  const f = fixture();
  for (let i = 0; i < 1000; i++)
    createTask(f.repo, {
      title: "CSV history " + i,
      description: "Historical requirement",
      scope: ["history/" + i],
    });
  fs.mkdirSync(path.join(f.repo.dir, "events", "_activity"));
  fs.writeFileSync(
    path.join(f.repo.dir, "events", "_activity", "bad.json"),
    "invalid",
  );
  const a = await f.run("search", { query: "CSV", limit: 3 });
  assert.equal(a.total, 1001);
  assert.equal(a.index.refreshedTasks, 1001);
  assert.equal(a.index.errorCount, 0);
  const b = await f.run("search", { query: "CSV", limit: 3, offset: 3 });
  assert.equal(b.index.refreshedTasks, 0);
  assert.ok(!a.hits.some((x) => b.hits.some((y) => y.id === x.id)));
  await f.run("update", { patch: { title: "Changed export target" } });
  assert.equal(
    (await f.run("search", { query: "CSV" })).index.refreshedTasks,
    1,
  );
  assert.equal((await f.run("search", { query: "Changed" })).hits[0].id, f.id);
  const cache = new DatabaseSync(
    path.join(process.env.DIP_HOME, "navigation.sqlite"),
  );
  try {
    cache.exec(
      "DROP TABLE navigation_text_" + digest(f.repo.root).slice(0, 24),
    );
  } finally {
    cache.close();
  }
  const rebuilt = await f.run("search", { query: "Changed" });
  assert.equal(rebuilt.hits[0].id, f.id);
  assert.equal(rebuilt.index.refreshedTasks, 1001);
});

test("new MCP tools and CLI commands read bounded views without mutating intent", async () => {
  const f = fixture(),
    client = new Client({ name: "navigation-test", version: "1" });
  const before = taskRead(f.repo, f.id).heads;
  try {
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: [cli, "mcp"],
        cwd: f.root,
        env: { ...process.env },
      }),
    );
    const tools = await client.listTools();
    for (const name of [
      "task_requirements",
      "component_owners",
      "task_changes",
      "project_search",
      "task_related",
    ])
      assert.ok(tools.tools.some((t) => t.name === name));
    const read = await client.callTool({
      name: "task_requirements",
      arguments: { id: f.id, root: f.root },
    });
    assert.equal(
      JSON.parse(read.content[0].text).acceptance[0].text,
      "Preserve Unicode",
    );
    const search = await client.callTool({
      name: "project_search",
      arguments: { query: "CSV", root: f.root },
    });
    assert.equal(JSON.parse(search.content[0].text).hits[0].id, f.id);
    const result = JSON.parse(
      execFileSync(
        process.execPath,
        [cli, "task", "changes", "--id", f.id, "--root", f.root],
        { encoding: "utf8", windowsHide: true },
      ),
    );
    assert.equal(result.baseline, null);
    assert.deepEqual(taskRead(f.repo, f.id).heads, before);
  } finally {
    await client.close();
  }
});

test("a search-cache write lock cannot block task ownership", async () => {
  const f = fixture();
  await f.run("search", { query: "CSV" });
  const cache = new DatabaseSync(
    path.join(process.env.DIP_HOME, "navigation.sqlite"),
  );
  cache.exec("BEGIN IMMEDIATE");
  try {
    assert.ok(
      (await f.run("claim", { actor: "independent", scope: ["src"] })).token,
    );
  } finally {
    cache.exec("ROLLBACK");
    cache.close();
  }
});

test("search excerpts are centered on matching content deep inside a long requirement", async () => {
  const f = fixture();
  const id = createTask(f.repo, {
    title: "A long design",
    description:
      "background ".repeat(700) + "needlecomponent must preserve Unicode",
  });
  const hit = (await f.run("search", { query: "needlecomponent" })).hits[0];
  assert.equal(hit.id, id);
  assert.ok(hit.excerpt.includes("needlecomponent"));
  assert.ok(hit.excerpt.length <= 800);
  assert.equal(hit.textTruncated, true);
});
