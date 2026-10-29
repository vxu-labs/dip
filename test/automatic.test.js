import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  ensure,
  openProject,
  Runtime,
  project,
  taskRead,
  createTask,
  append,
  compactContext,
} from "../src/core.js";
import { handleHook } from "../src/automation.js";
import { execute } from "../src/actions.js";
import { git, atomic } from "../src/util.js";
import { readingCommand } from "../src/workflow.js";
import { mutationReceipt, boundedContext } from "../src/automatic.js";
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dip-auto-test-"));
Object.assign(process.env, {
  DIP_HOME: path.join(dir, "runtime"),
  DIP_USER_HOME: path.join(dir, "user"),
  DIP_GIT_CONFIG: path.join(dir, "gitconfig"),
  GIT_CONFIG_GLOBAL: path.join(dir, "gitconfig"),
  GIT_TRACE2_EVENT: "0",
});
let serial = 0;
function fixture(mode = "coordinate") {
  const root = path.join(dir, String(++serial));
  fs.mkdirSync(root);
  git(root, ["init", "-b", "main"]);
  let repo = ensure(root);
  repo.config = {
    ...repo.config,
    workflow: "automatic",
    mode,
    verification: {
      unit: { command: [process.execPath, "-e", "process.exit(0)"] },
    },
  };
  atomic(path.join(repo.dir, "config.json"), repo.config);
  repo = ensure(root);
  const hook = (e) => handleHook({ cwd: root, session_id: "s", ...e }, "codex");
  const prompt = () =>
    JSON.parse(
      hook({
        hook_event_name: "UserPromptSubmit",
        turn_id: "turn",
        prompt: "Implement synthetic export",
      }).hookSpecificOutput.additionalContext,
    );
  return { repo, root, hook, prompt };
}
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));
test("questions remain durable requests without work backlog or completion calls", async () => {
  const f = fixture();
  const c = f.prompt();
  f.hook({
    hook_event_name: "PreToolUse",
    tool_name: "exec_command",
    tool_input: { cmd: "rg -n TODO src" },
  });
  f.hook({ hook_event_name: "Stop" });
  const t = taskRead(f.repo, c.task_id);
  assert.equal(t.requestState, "captured");
  assert.equal(t.kind, "discussion");
  assert.equal(t.resolution, null);
  assert.equal(compactContext(f.repo, null).ready.length, 0);
  const inbox = await execute("requests", {}, f.root);
  assert.equal(inbox.requests[0].id, c.task_id);
});
test("write automatically promotes and claims; same-session strict finish needs only one call", async () => {
  const f = fixture("strict"),
    c = f.prompt();
  f.hook({
    hook_event_name: "PreToolUse",
    tool_name: "Write",
    tool_input: { file_path: path.join(f.root, "file.js"), content: "ok" },
  });
  const t = taskRead(f.repo, c.task_id);
  assert.equal(t.kind, "work");
  assert.equal(t.status, "in_progress");
  assert.deepEqual(t.scope, ["file.js"]);
  const r = await execute(
    "finish",
    {
      id: c.task_id,
      actor: c.actor,
      session: c.session_id,
      outcome: "implemented",
      summary: "Done",
      remaining: [],
      check: "unit",
    },
    f.root,
  );
  assert.equal(r.verifiedComplete, true);
  assert.equal(r.released, true);
});
test("paused finish keeps remaining work and never asserts completion", async () => {
  const f = fixture(),
    c = f.prompt();
  const r = await execute(
    "finish",
    {
      id: c.task_id,
      actor: c.actor,
      outcome: "paused",
      summary: "Parser only",
      remaining: [{ disposition: "required", summary: "UI remains" }],
    },
    f.root,
  );
  assert.equal(r.verifiedComplete, false);
  const t = taskRead(f.repo, c.task_id);
  assert.equal(t.status, "in_progress");
  assert.equal(t.resolution, null);
  assert.equal(t.checkpoints.at(-1).remaining[0].summary, "UI remains");
});
test("invalid pause arguments do not alter evidence, checkpoint or ownership", async () => {
  const f = fixture("strict"), c = f.prompt();
  f.hook({ hook_event_name: "PreToolUse", tool_name: "Write", tool_input: { file_path: path.join(f.root, "parser.js") } });
  const args = { id: c.task_id, actor: c.actor, session: c.session_id, outcome: "paused", summary: "Parser only", remaining: [{ disposition: "required", summary: "Exporter remains" }] };
  const before = taskRead(f.repo, c.task_id);
  await assert.rejects(execute("finish", { ...args, check: "unit" }, f.root), /omit check and replacedBy/);
  await assert.rejects(execute("finish", { ...args, remaining: [{ disposition: "out_of_scope", summary: "Future work", taskId: "task_other" }] }, f.root), /omit taskId/);
  assert.deepEqual(taskRead(f.repo, c.task_id), before);
  const done = await execute("finish", args, f.root);
  assert.equal(done.released, true);
  assert.equal(done.verifiedComplete, false);
});
test("explicit automatic continuation finishes the original requirement and supersedes the captured duplicate", async () => {
  const f = fixture("strict"), first = f.prompt();
  f.hook({ hook_event_name: "PreToolUse", tool_name: "Write", tool_input: { file_path: path.join(f.root, "lib.js") } });
  await execute("finish", { id: first.task_id, actor: first.actor, session: first.session_id, outcome: "paused", summary: "Part one", remaining: [{ disposition: "required", summary: "Part two" }] }, f.root);
  const next = JSON.parse(f.hook({ hook_event_name: "UserPromptSubmit", session_id: "continuation", turn_id: "turn-two", prompt: "Continue part two" }).hookSpecificOutput.additionalContext);
  // Strict ownership still requires explicit tokens for the exceptional adoption.
  const sourceLease = await execute("claim", { id: next.task_id, actor: next.actor }, f.root);
  const targetLease = await execute("claim", { id: first.task_id, actor: next.actor }, f.root);
  await execute("adopt", { id: next.task_id, targetId: first.task_id, actor: next.actor, session: next.session_id, token: sourceLease.token, targetToken: targetLease.token, summary: "Reviewed continuation of the original requirement" }, f.root);
  f.hook({ hook_event_name: "PreToolUse", session_id: "continuation", tool_name: "Write", tool_input: { file_path: path.join(f.root, "lib.js") } });
  await execute("finish", { id: first.task_id, actor: next.actor, session: next.session_id, outcome: "implemented", summary: "Both parts done", remaining: [], check: "unit" }, f.root);
  assert.equal(taskRead(f.repo, first.task_id).status, "verified");
  assert.equal(taskRead(f.repo, next.task_id).status, "superseded");
});
test("Stop preserves unfinished work, native plan and durable outbox without a recorder", () => {
  const f = fixture(),
    c = f.prompt();
  f.hook({
    hook_event_name: "PostToolUse",
    tool_name: "update_plan",
    tool_use_id: "plan",
    tool_input: { plan: [{ step: "Implement", status: "pending" }] },
  });
  f.hook({
    hook_event_name: "PreToolUse",
    tool_name: "Write",
    tool_input: { file_path: path.join(f.root, "a.js") },
  });
  f.hook({ hook_event_name: "Stop" });
  const t = taskRead(f.repo, c.task_id);
  assert.equal(t.status, "in_progress");
  assert.equal(t.plan.input.plan[0].status, "pending");
  assert.equal(t.resolution, null);
  assert.ok(project(f.repo).activity.length > 0);
});
test("foreign session and overlapping scope cannot finish or write owned work", async () => {
  const f = fixture("strict"),
    c = f.prompt();
  f.hook({
    hook_event_name: "PreToolUse",
    tool_name: "Write",
    tool_input: { file_path: path.join(f.root, "same.js") },
  });
  await assert.rejects(
    execute(
      "finish",
      {
        id: c.task_id,
        actor: "codex:other",
        session: "s",
        outcome: "implemented",
        summary: "No",
        remaining: [],
        check: "unit",
      },
      f.root,
    ),
    /session/,
  );
  const other = (e) =>
    handleHook({ cwd: f.root, session_id: "other", ...e }, "codex");
  other({ hook_event_name: "UserPromptSubmit", prompt: "Other task" });
  const denied = other({
    hook_event_name: "PreToolUse",
    tool_name: "Write",
    tool_input: { file_path: path.join(f.root, "same.js") },
  });
  assert.equal(denied.hookSpecificOutput.permissionDecision, "deny");
});
test("ordinary reads recognized while executors, shell expansion and unknown flags remain conservative", () => {
  for (const cmd of [
    "rg -n TODO src",
    "rg --files",
    "git status --short",
    "git ls-files --cached",
    "cat README.md",
    "head -20 README.md",
  ])
    assert.equal(readingCommand({ cmd }), true, cmd);
  for (const cmd of [
    "rg --pre ./script pattern",
    "git -c alias.x=bad x",
    "git diff",
    "cat x; rm y",
    "rg foo | sh",
    "cat $(touch bad)",
    "rg --hostname-bin=bad x",
    "node -e 1",
    "cat >x",
    'rg "a\\nb"',
  ])
    assert.equal(readingCommand({ cmd }), false, cmd);
});
test("hot path never repairs integration files; explicit setup preserves edited managed text", () => {
  const f = fixture(),
    file = path.join(f.root, "AGENTS.md");
  fs.appendFileSync(file, "\nUser notes\n");
  const before = fs.readFileSync(file, "utf8");
  fs.rmSync(path.join(f.root, ".agents"), { recursive: true, force: true });
  f.prompt();
  assert.equal(fs.readFileSync(file, "utf8"), before);
  assert.equal(fs.existsSync(path.join(f.root, ".agents")), false);
  fs.writeFileSync(
    file,
    before.replace("DIP automatic workflow:", "Custom workflow:"),
  );
  const edited = fs.readFileSync(file, "utf8");
  const r = ensure(f.root);
  assert.equal(fs.readFileSync(file, "utf8"), edited);
  assert.ok(r.preservedInstructions.includes("AGENTS.md"));
});
test("UTF-8 context and mutation receipts bound large histories without losing fencing token", () => {
  const tasks = Array.from({ length: 20 }, (_, i) => ({
    id: "task_" + i,
    title: "תיאור".repeat(200),
    status: "in_progress",
    scope: ["a".repeat(10000)],
  }));
  const c = boundedContext(
    {
      branch: "main",
      active: tasks,
      resume: tasks,
      ready: tasks,
      workers: tasks,
      errors: [],
    },
    { task_id: "task_0" },
  );
  assert.ok(Buffer.byteLength(JSON.stringify(c)) <= 4096);
  assert.equal(c.truncated, true);
  assert.equal(c.current.id, "task_0");
  const r = mutationReceipt("prepare", {
    lease: { task: "a", actor: "b", token: "must-survive", expires: 1 },
    task: { id: "a", description: "x".repeat(10000) },
  });
  assert.ok(Buffer.byteLength(JSON.stringify(r)) <= 1024);
  assert.equal(r.lease.token, "must-survive");
});
test("current exact evidence is reused; changed code or command forces recheck", async () => {
  const f = fixture(),
    c = f.prompt();
  await execute(
    "update",
    { id: c.task_id, patch: { kind: "work" }, actor: c.actor },
    f.root,
  );
  await execute(
    "verify",
    { id: c.task_id, check: "unit", actor: c.actor },
    f.root,
  );
  let r = await execute(
    "finish",
    {
      id: c.task_id,
      actor: c.actor,
      outcome: "implemented",
      summary: "Done",
      remaining: [],
      check: "unit",
    },
    f.root,
  );
  assert.equal(r.check.reused, true);
  fs.writeFileSync(path.join(f.root, "changed.js"), "export const n=1;");
  r = await execute(
    "finish",
    {
      id: c.task_id,
      actor: c.actor,
      outcome: "implemented",
      summary: "Done",
      remaining: [],
      check: "unit",
    },
    f.root,
  );
  assert.notEqual(r.check.reused, true);
  f.repo.config.verification.unit.command = [
    process.execPath,
    "-e",
    "process.exit(1)",
  ];
  atomic(path.join(f.repo.dir, "config.json"), f.repo.config);
  r = await execute(
    "finish",
    {
      id: c.task_id,
      actor: c.actor,
      outcome: "implemented",
      summary: "Done",
      remaining: [],
      check: "unit",
    },
    f.root,
  );
  assert.equal(r.check.passed, false);
  assert.equal(r.verifiedComplete, false);
});
test("explicit future ideas and reviewed projects preserve their existing semantics", async () => {
  const f = fixture();
  const id = createTask(f.repo, { title: "Future", kind: "work" });
  assert.equal(taskRead(f.repo, id).status, "backlog");
  assert.ok(compactContext(f.repo, null).ready.some((t) => t.id === id));
  f.repo.config.workflow = "reviewed";
  atomic(path.join(f.repo.dir, "config.json"), f.repo.config);
  const c = f.prompt();
  assert.equal(taskRead(f.repo, c.task_id).kind, "work");
  assert.match(c.instructions, /task_prepare/);
});

test("request pagination and explicit triage do not leave answered duplicates in the inbox", async () => {
  const f = fixture();
  let first;
  for (let i = 0; i < 13; i++) {
    const r = JSON.parse(
      f.hook({
        hook_event_name: "UserPromptSubmit",
        turn_id: "request-" + i,
        prompt: "Question " + i,
      }).hookSpecificOutput.additionalContext,
    );
    first ||= r;
  }
  let page = await execute("requests", { limit: 10 }, f.root);
  assert.equal(page.total, 13);
  assert.equal(page.nextOffset, 10);
  assert.equal(
    (await execute("requests", { limit: 10, offset: 10 }, f.root)).requests
      .length,
    3,
  );
  await execute(
    "finish",
    {
      id: first.task_id,
      actor: first.actor,
      outcome: "answered",
      summary: "Explicit answer",
    },
    f.root,
  );
  page = await execute("requests", {}, f.root);
  assert.equal(page.total, 12);
  assert.ok(!page.requests.some((r) => r.id === first.task_id));
});
test("a pause keeps its remaining review visible after automatic Stop and in the current context", async () => {
  const f = fixture(),
    c = f.prompt();
  await execute(
    "finish",
    {
      id: c.task_id,
      actor: c.actor,
      outcome: "paused",
      summary: "Parser implemented",
      remaining: [{ disposition: "required", summary: "Implement exporter" }],
    },
    f.root,
  );
  f.hook({ hook_event_name: "Stop" });
  const view = await execute("get", { id: c.task_id }, f.root);
  assert.equal(view.checkpoint.remaining[0].summary, "Implement exporter");
  const context = compactContext(f.repo, null, c);
  assert.equal(context.current.remaining[0].summary, "Implement exporter");
  assert.ok(Buffer.byteLength(JSON.stringify(context)) <= 4096);
});
test("changed requirements invalidate reusable evidence, and failed finish retains ownership", async () => {
  const f = fixture("strict"),
    c = f.prompt();
  f.hook({
    hook_event_name: "PreToolUse",
    tool_name: "Write",
    tool_input: { file_path: path.join(f.root, "same.js") },
  });
  const rt = new Runtime();
  const lease = rt.db
    .prepare("SELECT * FROM leases WHERE repo=? AND task=?")
    .get(f.repo.key, c.task_id);
  rt.close();
  await execute(
    "verify",
    { id: c.task_id, actor: c.actor, token: lease.token, check: "unit" },
    f.root,
  );
  await execute(
    "update",
    {
      id: c.task_id,
      actor: c.actor,
      token: lease.token,
      patch: { acceptance: ["New requirement"] },
    },
    f.root,
  );
  const result = await execute(
    "finish",
    {
      id: c.task_id,
      actor: c.actor,
      session: c.session_id,
      outcome: "implemented",
      summary: "New criteria fulfilled",
      remaining: [],
      check: "unit",
    },
    f.root,
  );
  assert.notEqual(result.check.reused, true);
  f.repo.config.verification.unit.command = [
    process.execPath,
    "-e",
    "process.exit(1)",
  ];
  atomic(path.join(f.repo.dir, "config.json"), f.repo.config);
  f.hook({
    hook_event_name: "PreToolUse",
    tool_name: "Write",
    tool_input: { file_path: path.join(f.root, "same.js") },
  });
  const failed = await execute(
    "finish",
    {
      id: c.task_id,
      actor: c.actor,
      session: c.session_id,
      outcome: "implemented",
      summary: "Check fails",
      remaining: [],
      check: "unit",
    },
    f.root,
  );
  assert.equal(failed.released, false);
  assert.equal(failed.verifiedComplete, false);
  const runtime = new Runtime();
  assert.ok(
    runtime.db
      .prepare("SELECT * FROM leases WHERE repo=? AND task=? AND expires>?")
      .get(f.repo.key, c.task_id, Date.now()),
  );
  runtime.close();
});

test("project workflow changes are explicit, preserve ownership mode and roll back managed instructions", () => {
  const f = fixture("strict");
  ensure(f.root, { workflow: "reviewed" });
  let repo = openProject(f.root);
  assert.equal(repo.config.workflow, "reviewed");
  assert.equal(repo.config.mode, "strict");
  assert.match(
    fs.readFileSync(path.join(f.root, "AGENTS.md"), "utf8"),
    /Classify informational requests/,
  );
  ensure(f.root, { workflow: "automatic" });
  assert.match(
    fs.readFileSync(path.join(f.root, "AGENTS.md"), "utf8"),
    /Questions and read-only investigation require no DIP calls/,
  );
  assert.throws(
    () => ensure(f.root, { workflow: "invalid" }),
    /Unknown workflow/,
  );
  assert.equal(openProject(f.root).config.workflow, "automatic");
});
test("CLI update preserves the bounded automatic receipt instead of re-expanding a task view", async () => {
  const { execFileSync } = await import("node:child_process");
  const { fileURLToPath } = await import("node:url");
  const f = fixture(),
    c = f.prompt();
  const result = JSON.parse(
    execFileSync(
      process.execPath,
      [
        fileURLToPath(new URL("../bin/dip.js", import.meta.url)),
        "task",
        "update",
        "--root",
        f.root,
        "--id",
        c.task_id,
        "--actor",
        c.actor,
        "--patch",
        JSON.stringify({ description: "Large requirement ".repeat(1000) }),
      ],
      { encoding: "utf8", env: process.env, stdio: ["ignore", "pipe", "pipe"] },
    ),
  );
  assert.equal(result.id, c.task_id);
  assert.equal(result.truncated, true);
  assert.ok(Buffer.byteLength(JSON.stringify(result)) <= 1024);
});

test("a single large multilingual current task respects budget and labels nested omissions", () => {
  const current = {
    id: "current",
    title: "漢".repeat(500),
    kind: "work",
    status: "in_progress",
    acceptance: Array(20).fill("漢".repeat(500)),
    checkpoint: "漢".repeat(1000),
    remaining: Array.from({ length: 10 }, () => ({
      disposition: "required",
      summary: "漢".repeat(500),
    })),
  };
  const result = boundedContext(
    { branch: "main", current },
    { task_id: "current", actor: "codex:session", session_id: "session" },
  );
  assert.ok(Buffer.byteLength(JSON.stringify(result)) <= 4096);
  assert.equal(result.current.id, "current");
  assert.equal(result.truncated, true);
  const receipt = mutationReceipt("prepare", {
    task: { id: "current" },
    lease: {
      task: "current",
      actor: "漢".repeat(2000),
      token: "full-token",
      expires: 123,
    },
  });
  assert.ok(Buffer.byteLength(JSON.stringify(receipt)) <= 1024);
  assert.equal(receipt.lease.token, "full-token");
});
