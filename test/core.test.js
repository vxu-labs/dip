import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { DatabaseSync } from "node:sqlite";
import { execFileSync } from "node:child_process";
import {
  ensure,
  Runtime,
  createTask,
  append,
  project,
  taskGet,
  updateTask,
  events,
} from "../src/core.js";
import { execute } from "../src/actions.js";
import { atomic, git, redact } from "../src/util.js";
import {
  handleHook,
  install,
  uninstall,
  scan,
  afterGit,
} from "../src/automation.js";
import { createServer } from "../src/server.js";

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "dip-test-"));
process.env.DIP_HOME = path.join(sandbox, "runtime");
process.env.DIP_USER_HOME = path.join(sandbox, "user");
process.env.DIP_GIT_CONFIG = path.join(sandbox, "global.gitconfig");
process.env.GIT_CONFIG_GLOBAL = process.env.DIP_GIT_CONFIG;
let serial = 0;
function fixture() {
  const root = path.join(sandbox, `repo-${++serial}`);
  fs.mkdirSync(root, { recursive: true });
  git(root, ["init", "-b", "main"]);
  git(root, ["config", "user.email", "test@example.invalid"]);
  git(root, ["config", "user.name", "Test"]);
  return ensure(root);
}
test.after(() => {
  assert.ok(sandbox.startsWith(path.join(os.tmpdir(), "dip-test-")));
  fs.rmSync(sandbox, { recursive: true, force: true });
});

test("initialization preserves existing agent instructions and is idempotent", () => {
  const repo = fixture();
  fs.writeFileSync(path.join(repo.root, "AGENTS.md"), "User rules\n");
  ensure(repo.root);
  const once = fs.readFileSync(path.join(repo.root, "AGENTS.md"), "utf8");
  ensure(repo.root);
  assert.equal(
    fs.readFileSync(path.join(repo.root, "AGENTS.md"), "utf8"),
    once,
  );
  assert.match(once, /User rules/);
  assert.equal(once.match(/dip:start/g).length, 1);
});
test("tasks survive runtime database deletion and are not dependent on context", () => {
  const repo = fixture(),
    id = createTask(repo, {
      title: "Remember future export",
      acceptance: ["CSV export"],
    });
  const rt = new Runtime(path.join(sandbox, "isolated-runtime"));
  rt.register(repo);
  rt.close();
  fs.rmSync(path.join(sandbox, "isolated-runtime"), {
    recursive: true,
    force: true,
  });
  assert.equal(taskGet(repo, id).title, "Remember future export");
});
test("divergent same-field updates are explicit conflicts until causal resolution", () => {
  const repo = fixture(),
    id = createTask(repo, { title: "Feature" }),
    parent = events(repo, id).events[0].eventId;
  append(
    repo,
    id,
    "task.update",
    { status: "implemented" },
    { parents: [parent], actor: "a" },
  );
  append(
    repo,
    id,
    "task.update",
    { status: "cancelled" },
    { parents: [parent], actor: "b" },
  );
  assert.equal(taskGet(repo, id).status, "conflict");
  assert.throws(() => updateTask(repo, id, { status: "ready" }), /Resolve/);
  updateTask(repo, id, { status: "ready" }, "human", true);
  assert.equal(taskGet(repo, id).status, "ready");
});
test("concurrent independent fields merge and malformed events are visible", () => {
  const repo = fixture(),
    id = createTask(repo, { title: "Feature" }),
    parent = events(repo, id).events[0].eventId;
  append(repo, id, "task.update", { scope: ["src"] }, { parents: [parent] });
  append(
    repo,
    id,
    "task.update",
    { description: "New requirement" },
    { parents: [parent] },
  );
  assert.equal(taskGet(repo, id).conflicts.length, 0);
  fs.writeFileSync(path.join(repo.dir, "events", id, "bad.json"), "oops");
  assert.equal(project(repo).errors.length, 1);
  assert.throws(() => updateTask(repo, id, { status: "ready" }), /corrupt/);
});
test("dependency cycles and unfinished dependencies are detected", () => {
  const repo = fixture(),
    a = createTask(repo, { title: "A" }),
    b = createTask(repo, { title: "B", dependencies: [a] });
  updateTask(repo, a, { dependencies: [b] });
  assert.ok(taskGet(repo, a).dependencyCycle);
  assert.deepEqual(taskGet(repo, b).blockedBy, [a]);
});
test("claim is exclusive, idempotent and fences expired ownership", () => {
  const repo = fixture(),
    id = createTask(repo, { title: "Shared" }),
    a = new Runtime(),
    b = new Runtime();
  try {
    const first = a.claim(repo, id, "a");
    assert.equal(a.claim(repo, id, "a").token, first.token);
    assert.throws(() => b.claim(repo, id, "b"), /owned/);
    a.db
      .prepare("UPDATE leases SET expires=0 WHERE repo=? AND task=?")
      .run(repo.key, id);
    const second = b.claim(repo, id, "b");
    assert.notEqual(first.token, second.token);
    assert.throws(() => a.assert(repo, id, first.token), /expired/);
  } finally {
    a.close();
    b.close();
  }
});
test("scope ownership is atomically checked across different tasks", () => {
  const repo = fixture(),
    a = createTask(repo, { title: "A", scope: ["src"] }),
    b = createTask(repo, { title: "B", scope: ["src/auth"] });
  const rt = new Runtime();
  try {
    rt.claim(repo, a, "a", 120000, ["src"]);
    assert.throws(
      () => rt.claim(repo, b, "b", 120000, ["src/auth"]),
      /Scope owned/,
    );
  } finally {
    rt.close();
  }
});

test("scope paths normalize separators, root scopes and Windows case", () => {
  const repo = fixture(),
    rt = new Runtime();
  const a = createTask(repo, { title: "A" }),
    b = createTask(repo, { title: "B" });
  try {
    const first = rt.claim(repo, a, "a", 120000, ["src\\Auth/"]);
    assert.throws(
      () => rt.claim(repo, b, "b", 120000, ["./src/Auth/file.js"]),
      /Scope owned/,
    );
    if (process.platform === "win32")
      assert.throws(
        () => rt.claim(repo, b, "b", 120000, ["src/auth"]),
        /Scope owned/,
      );
    assert.throws(() => rt.claim(repo, b, "b", 120000, ["."]), /Scope owned/);
    rt.release(repo, a, first.token);
  } finally {
    rt.close();
  }
});

test("an existing runtime migrates without losing live ownership", () => {
  const directory = path.join(sandbox, "legacy-runtime");
  fs.mkdirSync(directory);
  const db = new DatabaseSync(path.join(directory, "runtime.sqlite"));
  db.exec(
    "CREATE TABLE leases (repo TEXT, task TEXT, actor TEXT, token TEXT, expires INTEGER, scope TEXT DEFAULT '[]', PRIMARY KEY(repo,task))",
  );
  const repo = fixture();
  db.prepare("INSERT INTO leases VALUES (?,?,?,?,?,?)").run(
    repo.key,
    "old-task",
    "existing",
    "secret",
    Date.now() + 120000,
    "[]",
  );
  db.close();
  const rt = new Runtime(directory);
  try {
    const lease = rt.leases(repo)[0];
    assert.equal(lease.actor, "existing");
    assert.equal(lease.active, true);
    assert.deepEqual(lease.descriptor, {});
    assert.ok(!("token" in lease));
  } finally {
    rt.close();
  }
});

test("waiting claims acquire released ownership and time out without extra model calls", async () => {
  const repo = fixture(),
    rt = new Runtime();
  const task = createTask(repo, { title: "Waitable" });
  const lease = rt.claim(repo, task, "first");
  const release = setTimeout(() => rt.release(repo, task, lease.token), 80);
  try {
    const next = await execute(
      "claim",
      { id: task, actor: "second", waitMs: 2000 },
      repo.root,
    );
    assert.notEqual(next.token, lease.token);
    await assert.rejects(
      execute("claim", { id: task, actor: "third", waitMs: 30 }, repo.root),
      /Task owned/,
    );
    rt.release(repo, task, next.token);
  } finally {
    clearTimeout(release);
    rt.close();
  }
});
test("global discovery bootstraps existing repos and agent entry bootstraps outside roots", () => {
  const repo = fixture();
  fs.rmSync(repo.dir, { recursive: true, force: true });
  const result = scan([repo.root]);
  assert.deepEqual(result.initialized, [repo.root]);
  assert.ok(fs.existsSync(path.join(repo.dir, "config.json")));
  const outside = fixture();
  fs.rmSync(outside.dir, { recursive: true, force: true });
  const output = handleHook(
    { cwd: outside.root, session_id: "new", hook_event_name: "SessionStart" },
    "codex",
  );
  assert.ok(output.hookSpecificOutput.additionalContext);
  assert.ok(fs.existsSync(path.join(outside.dir, "config.json")));
});
test("prompts, plan tools and commands persist automatically with no model invocation", () => {
  const repo = fixture(),
    base = { cwd: repo.root, session_id: "s1" };
  handleHook(
    {
      ...base,
      hook_event_name: "UserPromptSubmit",
      prompt: "בעתיד נוסיף export",
    },
    "claude",
  );
  handleHook(
    {
      ...base,
      hook_event_name: "PreToolUse",
      tool_name: "update_plan",
      tool_input: {
        plan: [{ step: "Implement export", status: "in_progress" }],
      },
      tool_use_id: "tool1",
    },
    "claude",
  );
  handleHook(
    {
      ...base,
      hook_event_name: "PostToolUse",
      tool_name: "Bash",
      tool_input: { command: "npm test TOKEN=supersecret" },
      tool_use_id: "tool2",
    },
    "claude",
  );
  handleHook({ ...base, hook_event_name: "Stop" }, "claude");
  const state = project(repo);
  assert.equal(state.tasks.length, 1);
  assert.match(state.tasks[0].title, /בעתיד/);
  assert.ok(state.tasks[0].checkpoints.length);
  assert.ok(state.activity.some((a) => a.plan?.includes("Implement export")));
  assert.ok(!JSON.stringify(state).includes("supersecret"));
  assert.notEqual(state.tasks[0].status, "verified");
});
test("duplicate delivery of a hook activity is deduplicated", () => {
  const repo = fixture(),
    input = {
      cwd: repo.root,
      session_id: "s",
      hook_event_name: "PostToolUse",
      tool_name: "Bash",
      tool_use_id: "same",
    };
  handleHook(input, "codex");
  handleHook(input, "codex");
  assert.equal(
    project(repo).activity.filter((a) => a.kind === "PostToolUse").length,
    1,
  );
});
test("configured checks provide evidence; code drift invalidates previous success", async () => {
  const repo = fixture();
  fs.writeFileSync(path.join(repo.root, "app.js"), "export const answer = 42;");
  repo.config.verification = {
    pass: { command: [process.execPath, "-e", "process.exit(0)"] },
    fail: { command: [process.execPath, "-e", "process.exit(1)"] },
  };
  atomic(path.join(repo.dir, "config.json"), repo.config);
  const id = createTask(repo, { title: "Answer", scope: ["app.js"] });
  assert.equal(
    (await execute("verify", { id, check: "fail" }, repo.root)).passed,
    false,
  );
  assert.notEqual(taskGet(repo, id).status, "verified");
  assert.equal(
    (await execute("verify", { id, check: "pass" }, repo.root)).passed,
    true,
  );
  assert.equal(
    (await execute("reconcile", {}, repo.root)).tasks[0].verification,
    "current",
  );
  fs.writeFileSync(path.join(repo.root, "app.js"), "export const answer = 43;");
  assert.equal(
    (await execute("reconcile", {}, repo.root)).tasks[0].verification,
    "stale",
  );
  await assert.rejects(
    execute("update", { id, patch: { status: "done" } }, repo.root),
    /verification/,
  );
});
test("Git merge preserves two parallel histories and surfaces semantic disagreement", () => {
  const repo = fixture(),
    id = createTask(repo, { title: "Across branches" });
  git(repo.root, ["add", "."]);
  git(repo.root, ["commit", "-m", "Initial"]);
  git(repo.root, ["checkout", "-b", "left"]);
  append(ensure(repo.root), id, "task.update", { status: "implemented" });
  git(repo.root, ["add", "."]);
  git(repo.root, ["commit", "-m", "Left"]);
  git(repo.root, ["checkout", "main"]);
  git(repo.root, ["checkout", "-b", "right"]);
  append(ensure(repo.root), id, "task.update", { status: "cancelled" });
  git(repo.root, ["add", "."]);
  git(repo.root, ["commit", "-m", "Right"]);
  git(repo.root, ["merge", "left", "--no-edit"]);
  assert.equal(taskGet(ensure(repo.root), id).status, "conflict");
});
test("Git init and clone post-command trigger handles paths with spaces", () => {
  const root = path.join(sandbox, "fresh repo");
  fs.mkdirSync(root);
  git(root, ["init"]);
  afterGit(["init", "fresh repo"], sandbox);
  assert.ok(fs.existsSync(path.join(root, ".dip", "config.json")));
  const source = fixture();
  git(source.root, ["add", "."]);
  git(source.root, ["commit", "-m", "source"]);
  const clone = path.join(sandbox, "clone space");
  git(sandbox, ["clone", source.root, clone]);
  afterGit(["clone", source.root, "clone space"], sandbox);
  assert.ok(fs.existsSync(path.join(clone, ".dip", "config.json")));
});
test("installation and removal preserve unrelated agent settings and Git hook configuration", () => {
  const user = process.env.DIP_USER_HOME;
  fs.mkdirSync(path.join(user, ".claude"), { recursive: true });
  atomic(path.join(user, ".claude", "settings.json"), {
    theme: "dark",
    hooks: {
      Stop: [{ hooks: [{ type: "command", command: "echo existing" }] }],
    },
  });
  fs.mkdirSync(path.join(user, ".codex"), { recursive: true });
  atomic(
    path.join(user, ".codex", "config.toml"),
    'model = "custom"\n[features]\nhooks = false\n',
  );
  execFileSync("git", [
    "config",
    "--file",
    process.env.DIP_GIT_CONFIG,
    "core.hooksPath",
    "old/hooks",
  ]);
  install({ roots: [], start: false, startup: false });
  install({ roots: [], start: false, startup: false });
  const settings = JSON.parse(
    fs.readFileSync(path.join(user, ".claude", "settings.json")),
  );
  assert.equal(settings.theme, "dark");
  assert.equal(settings.hooks.Stop.length, 2);
  uninstall();
  const removed = JSON.parse(
    fs.readFileSync(path.join(user, ".claude", "settings.json")),
  );
  assert.equal(removed.hooks.Stop.length, 1);
  assert.match(
    fs.readFileSync(path.join(user, ".codex", "config.toml"), "utf8"),
    /hooks = false/,
  );
  assert.equal(
    execFileSync(
      "git",
      [
        "config",
        "--file",
        process.env.DIP_GIT_CONFIG,
        "--get",
        "core.hooksPath",
      ],
      { encoding: "utf8" },
    ).trim(),
    "old/hooks",
  );
});
test("installer rejects MCP name collisions before modifying agent files", () => {
  const user = process.env.DIP_USER_HOME;
  const hookFile = path.join(user, ".codex", "hooks.json");
  const codexFile = path.join(user, ".codex", "config.toml");
  const claudeFile = path.join(user, ".claude.json");
  const beforeHook = fs.readFileSync(hookFile, "utf8");
  const beforeCodex = fs.readFileSync(codexFile, "utf8");
  const beforeClaude = fs.readFileSync(claudeFile, "utf8");
  try {
    atomic(claudeFile, {
      mcpServers: { dip: { command: "unrelated", args: [] } },
    });
    assert.throws(
      () => install({ roots: [], start: false, startup: false }),
      /unrelated MCP/,
    );
    assert.equal(fs.readFileSync(hookFile, "utf8"), beforeHook);
    assert.equal(fs.readFileSync(codexFile, "utf8"), beforeCodex);
    assert.equal(
      JSON.parse(fs.readFileSync(claudeFile)).mcpServers.dip.command,
      "unrelated",
    );
  } finally {
    atomic(claudeFile, beforeClaude);
  }
});

test("dashboard rejects cross-origin writes and serves task data", async () => {
  const repo = fixture(),
    server = createServer({ root: repo.root, port: 0 });
  await new Promise((resolve) => server.on("listening", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal((await fetch(origin + "/api/state")).status, 200);
    assert.equal(
      (await fetch(origin + "/api/action", { method: "POST", body: "{}" }))
        .status,
      403,
    );
    assert.equal(
      (
        await fetch(origin + "/api/state", {
          headers: { origin: "https://attacker.example" },
        })
      ).status,
      403,
    );
    const { token } = await (await fetch(origin + "/api/session")).json();
    const response = await fetch(origin + "/api/action", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-dip-token": token },
      body: JSON.stringify({
        action: "create",
        args: { title: "From dashboard" },
      }),
    });
    assert.equal(response.status, 200);
    assert.equal(
      (await (await fetch(origin + "/api/state")).json()).tasks.length,
      1,
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
test("common token and credential formats are redacted", () => {
  assert.equal(
    redact('TOKEN=abc password="xyz" Authorization=BearerSecret'),
    "TOKEN=[REDACTED] password=[REDACTED] Authorization=[REDACTED]",
  );
});
test("uncommitted verified code is not presented as integrated; commit establishes integration", async () => {
  const repo = fixture();
  repo.config.verification = {
    pass: { command: [process.execPath, "-e", "process.exit(0)"] },
  };
  atomic(path.join(repo.dir, "config.json"), repo.config);
  fs.writeFileSync(path.join(repo.root, "code.js"), "42");
  const id = createTask(repo, { title: "Code", scope: ["code.js"] });
  await execute(
    "finish",
    {
      id,
      outcome: "implemented",
      summary: "All requirements fulfilled",
      check: "pass",
    },
    repo.root,
  );
  assert.equal(
    (await execute("reconcile", {}, repo.root)).tasks[0].integrated,
    false,
  );
  git(repo.root, ["add", "."]);
  git(repo.root, ["commit", "-m", "Verified source"]);
  assert.equal(
    (await execute("reconcile", {}, repo.root)).tasks[0].integrated,
    true,
  );
});
test("stale verified prerequisite continues to block dependent work", async () => {
  const repo = fixture();
  repo.config.verification = {
    pass: { command: [process.execPath, "-e", "process.exit(0)"] },
  };
  atomic(path.join(repo.dir, "config.json"), repo.config);
  fs.writeFileSync(path.join(repo.root, "dependency.js"), "before");
  const prerequisite = createTask(repo, {
    title: "Prerequisite",
    scope: ["dependency.js"],
  });
  await execute(
    "finish",
    {
      id: prerequisite,
      outcome: "implemented",
      summary: "Prerequisite fulfilled",
      check: "pass",
    },
    repo.root,
  );
  const dependent = createTask(repo, {
    title: "Dependent",
    dependencies: [prerequisite],
  });
  assert.ok(
    (await execute("next", {}, repo.root)).some((t) => t.id === dependent),
  );
  fs.writeFileSync(path.join(repo.root, "dependency.js"), "after");
  assert.ok(
    !(await execute("next", {}, repo.root)).some((t) => t.id === dependent),
  );
});
test("patch content is not copied into automatic activity records", () => {
  const repo = fixture();
  handleHook(
    {
      cwd: repo.root,
      session_id: "patch",
      hook_event_name: "PostToolUse",
      tool_name: "apply_patch",
      tool_input: {
        command:
          "*** Begin Patch\n*** Update File: src/app.js\n+ private source content\n*** End Patch",
      },
      tool_use_id: "patch",
    },
    "codex",
  );
  const state = project(repo);
  assert.ok(!JSON.stringify(state).includes("private source content"));
  assert.deepEqual(state.activity[0].files, ["src/app.js"]);
});
test("automatic file scope denies a second worker writing the same component", () => {
  const repo = fixture(),
    base = {
      cwd: repo.root,
      hook_event_name: "PreToolUse",
      tool_name: "Write",
      tool_input: { file_path: path.join(repo.root, "src", "shared.js") },
    };
  assert.deepEqual(handleHook({ ...base, session_id: "first" }, "claude"), {});
  const denied = handleHook({ ...base, session_id: "second" }, "claude");
  assert.equal(denied.hookSpecificOutput.permissionDecision, "deny");
  assert.ok(
    project(repo).activity.some((a) => a.kind === "coordination.denied"),
  );
});
test("large requests and emitted plans are retained without silent truncation", () => {
  const repo = fixture(),
    prompt = "Detailed requirement ".repeat(500),
    plan = {
      steps: Array.from({ length: 1000 }, (_, n) => ({
        step: "Step " + n,
        requirement: "preserve this detail",
      })),
    },
    base = { cwd: repo.root, session_id: "large" };
  handleHook({ ...base, hook_event_name: "UserPromptSubmit", prompt }, "codex");
  handleHook(
    {
      ...base,
      hook_event_name: "PostToolUse",
      tool_name: "update_plan",
      tool_input: plan,
      tool_use_id: "large-plan",
    },
    "codex",
  );
  const state = project(repo);
  assert.equal(state.tasks[0].description, prompt);
  assert.deepEqual(JSON.parse(state.activity.find((a) => a.plan).plan), plan);
});
