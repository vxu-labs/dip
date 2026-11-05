import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  ensure,
  Runtime,
  taskRead,
  createTask,
  append,
  compactContext,
} from "../src/core.js";
import { handleHook } from "../src/automation.js";
import { taskView, reconcileView } from "../src/views.js";
import { execute } from "../src/actions.js";
import { git, atomic } from "../src/util.js";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dip-lifecycle-"));
Object.assign(process.env, {
  DIP_HOME: path.join(dir, "runtime"),
  DIP_USER_HOME: path.join(dir, "user"),
  DIP_GIT_CONFIG: path.join(dir, "gitconfig"),
  GIT_CONFIG_GLOBAL: path.join(dir, "gitconfig"),
  GIT_TRACE2_EVENT: "0",
});
let serial = 0;
function fixture() {
  const root = path.join(dir, String(++serial));
  fs.mkdirSync(root);
  git(root, ["init", "-b", "main"]);
  const repo = ensure(root);
  repo.config.workflow = "automatic";
  atomic(path.join(repo.dir, "config.json"), repo.config);
  const hook = (extra) =>
    handleHook(
      { cwd: root, session_id: "s", turn_id: "turn", ...extra },
      "codex",
    );
  const c = JSON.parse(
    hook({
      hook_event_name: "UserPromptSubmit",
      prompt: "Open the project board in the browser",
    }).hookSpecificOutput.additionalContext,
  );
  const tool = (
    name = "mcp__cua_repl.js",
    input = {
      code: 'await cua.createBrowserTab("iab","http://127.0.0.1:4317/")',
    },
  ) => {
    hook({ hook_event_name: "PreToolUse", tool_name: name, tool_input: input });
    hook({
      hook_event_name: "PostToolUse",
      tool_name: name,
      tool_input: input,
      tool_response: { ok: true },
    });
  };
  return {
    root,
    repo,
    hook,
    c,
    tool,
    read: () => {
      const rt = new Runtime();
      try {
        return taskRead(repo, c.task_id, rt);
      } finally {
        rt.close();
      }
    },
  };
}
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

test("browser navigation and observed normal response never become Interrupted or Verified", () => {
  const f = fixture();
  f.tool();
  f.tool("mcp__cua_repl.js", {
    code: "await tab.getAXState(); await tab.markDeliverable()",
  });
  f.hook({
    hook_event_name: "Stop",
    last_assistant_message:
      "Opened the requested board; the backlog is visible.",
  });
  const t = f.read();
  assert.equal(t.activityState, "responded");
  assert.equal(t.interrupted, false);
  assert.equal(t.inactive, true);
  assert.equal(t.status, "in_progress");
  assert.equal(t.resolution, null);
  assert.equal(t.evidence.length, 0);
  assert.notEqual(t.verifiedComplete, true);
  assert.equal(taskView(t).lifecycle.event, "Stop");
  assert.equal(taskView(t).activityState, "responded");
  assert.equal(
    reconcileView({ repo: {}, tasks: [t], activeWorkers: [], errors: [] })
      .tasks[0].interrupted,
    false,
  );
  assert.ok(!JSON.stringify(t.history).includes("the backlog is visible."));
  f.hook({ hook_event_name: "SessionEnd" });
  assert.equal(f.read().activityState, "responded");
});
test("Stop alone is inactivity; expired or missing workers never establish an interruption", () => {
  const f = fixture();
  f.tool("Write", { file_path: path.join(f.root, "code.js") });
  f.hook({ hook_event_name: "Stop" });
  const t = f.read();
  assert.equal(t.activityState, "inactive");
  assert.equal(t.interrupted, false);
  assert.equal(t.resolution, null);
  assert.ok(compactContext(f.repo).resume.some((t) => t.id === f.c.task_id));
  const id = createTask(f.repo, {
    title: "Legacy unclosed work",
    status: "in_progress",
  });
  append(f.repo, id, "task.checkpoint", {
    automatic: true,
    summary:
      "Automatic checkpoint: agent paused; see activity and working tree. Completion has not been asserted.",
  });
  const count = taskRead(f.repo, id).history.length;
  const legacy = taskRead(f.repo, id);
  assert.equal(legacy.activityState, "inactive");
  assert.equal(legacy.interrupted, false);
  assert.notEqual(legacy.verifiedComplete, true);
  assert.equal(legacy.history.length, count);
});
test("an abrupt process exit without a terminal hook remains inactive, with no fabricated crash evidence", () => {
  const f = fixture();
  f.tool();
  const rt = new Runtime();
  rt.db.prepare("UPDATE leases SET expires=0 WHERE task=?").run(f.c.task_id);
  rt.close();
  const t = f.read();
  assert.equal(t.activityState, "inactive");
  assert.equal(t.interrupted, false);
  assert.equal(t.lifecycle, null);
  assert.equal(t.status, "in_progress");
});
test("explicit interruption and host failure remain distinct from an ordinary response", () => {
  for (const event of ["Interrupt", "StopFailure"]) {
    const f = fixture();
    f.tool();
    f.hook({
      hook_event_name: event,
      last_assistant_message: "A previous message",
    });
    assert.equal(f.read().activityState, "interrupted");
    assert.equal(f.read().interrupted, true);
    assert.equal(
      f.read().lifecycle.state,
      event === "Interrupt" ? "interrupted" : "failed",
    );
    assert.equal(f.read().resolution, null);
    f.hook({ hook_event_name: "SessionEnd" });
    assert.equal(f.read().interrupted, true);
  }
});
test("tool output cannot assert completion and unfinished code remains open after a response", () => {
  const f = fixture();
  f.tool("Write", { file_path: path.join(f.root, "code.js") });
  f.hook({
    hook_event_name: "PostToolUse",
    tool_name: "exec_command",
    tool_response: { last_assistant_message: "all done", exit_code: 0 },
  });
  f.hook({
    hook_event_name: "PostToolUse",
    tool_name: "update_plan",
    tool_input: {
      plan: [{ step: "Finish implementation", status: "pending" }],
    },
  });
  f.hook({
    hook_event_name: "Stop",
    last_assistant_message: "Implementation is still incomplete.",
  });
  const t = f.read();
  assert.equal(t.activityState, "responded");
  assert.equal(t.status, "in_progress");
  assert.equal(t.plan.input.plan[0].status, "pending");
  assert.equal(t.evidence.length, 0);
  assert.equal(t.resolution, null);
});
test("a delayed Stop from an older turn cannot stop or relabel a newer active request", () => {
  const f = fixture();
  f.tool();
  const next = JSON.parse(
    f.hook({
      hook_event_name: "UserPromptSubmit",
      turn_id: "new",
      prompt: "Implement another task",
    }).hookSpecificOutput.additionalContext,
  );
  f.hook({
    hook_event_name: "PreToolUse",
    turn_id: "new",
    tool_name: "Write",
    tool_input: { file_path: path.join(f.root, "next.js") },
  });
  f.hook({
    hook_event_name: "Stop",
    turn_id: "turn",
    last_assistant_message: "old final",
  });
  const rt = new Runtime();
  const t = taskRead(f.repo, next.task_id, rt);
  rt.close();
  assert.equal(t.active, true);
  assert.equal(t.activityState, "running");
  assert.equal(t.lifecycle, null);
});
test("resuming actual work clears a previous response or interruption", () => {
  const f = fixture();
  f.tool();
  f.hook({ hook_event_name: "Interrupt" });
  assert.equal(f.read().interrupted, true);
  f.tool("Write", { file_path: path.join(f.root, "next.js") });
  assert.equal(f.read().activityState, "running");
  f.hook({ hook_event_name: "Stop" });
  assert.equal(f.read().activityState, "inactive");
  assert.equal(f.read().interrupted, false);
});
test("explicit answered and paused outcomes survive ordinary terminal hooks", async () => {
  const f = fixture();
  await execute(
    "finish",
    {
      id: f.c.task_id,
      actor: f.c.actor,
      session: f.c.session_id,
      outcome: "answered",
      summary: "Explained the project",
    },
    f.root,
  );
  f.hook({ hook_event_name: "Stop", last_assistant_message: "Answer" });
  assert.equal(f.read().resolution.outcome, "answered");
  assert.equal(f.read().interrupted, false);
  const p = fixture();
  p.tool();
  await execute(
    "finish",
    {
      id: p.c.task_id,
      actor: p.c.actor,
      session: p.c.session_id,
      outcome: "paused",
      summary: "Work remains",
      remaining: [
        { disposition: "required", summary: "Finish implementation" },
      ],
    },
    p.root,
  );
  p.hook({ hook_event_name: "Stop", last_assistant_message: "Paused" });
  assert.equal(p.read().activityState, "paused");
  assert.equal(p.read().resolution, null);
});
test("concurrent conflicting lifecycle observations remain unknown; later causal work can resume", () => {
  const f = fixture();
  f.tool();
  const parent = f.read().heads;
  append(
    f.repo,
    f.c.task_id,
    "task.lifecycle",
    { state: "interrupted", source: "hook" },
    { parents: parent },
  );
  append(
    f.repo,
    f.c.task_id,
    "task.lifecycle",
    { state: "response_recorded", source: "hook" },
    { parents: parent },
  );
  const rt = new Runtime();
  rt.db.prepare("UPDATE leases SET expires=0 WHERE task=?").run(f.c.task_id);
  rt.close();
  assert.equal(f.read().lifecycle.conflict, true);
  assert.equal(f.read().interrupted, false);
  assert.equal(f.read().activityState, "inactive");
});

test("known read-only requests record responses without promotion, fabricated fulfillment or retained prose", () => {
  const f = fixture();
  f.tool("Read", { file_path: "README.md" });
  f.hook({
    hook_event_name: "Stop",
    last_assistant_message: "A plain explanation",
  });
  const t = f.read();
  assert.equal(t.kind, "discussion");
  assert.equal(t.requestState, "captured");
  assert.equal(t.activityState, "responded");
  assert.equal(t.status, "backlog");
  assert.equal(t.resolution, null);
  assert.equal(t.interrupted, false);
  assert.ok(!JSON.stringify(t.history).includes("A plain explanation"));
});

test("host-generated suggestion templates remain discussions in reviewed capture; quoted text is ordinary intent", async () => {
  const { capturedKind } = await import("../src/workflow.js");
  const generated =
    "This is an app-generated request for a suggested next user message. The user did not write this message.\n\nSuggest a follow-up.";
  assert.equal(capturedKind(generated), "discussion");
  assert.equal(capturedKind("Please review this quote:\n" + generated), "work");
  assert.equal(
    capturedKind(
      "# Overview\n\nGenerate 0 to 3 hyperpersonalized suggestions for what this user can do with Codex in this local project: /synthetic\n",
    ),
    "discussion",
  );
});

test("generated suggestions retain coordination without entering work backlog on opaque read tools; actual file writes still promote", () => {
  const f = fixture();
  const c = JSON.parse(
    f.hook({
      hook_event_name: "UserPromptSubmit",
      turn_id: "suggestion",
      prompt:
        "This is an app-generated request for a suggested next user message. The user did not write this message.\nSuggest next work.",
    }).hookSpecificOutput.additionalContext,
  );
  f.hook({
    hook_event_name: "PreToolUse",
    turn_id: "suggestion",
    tool_name: "some_read_connector",
    tool_input: {},
  });
  let t = taskRead(f.repo, c.task_id);
  assert.equal(t.kind, "discussion");
  assert.equal(t.requestState, "captured");
  const rt = new Runtime();
  assert.ok(rt.db.prepare("SELECT * FROM leases WHERE task=?").get(c.task_id));
  rt.close();
  f.hook({
    hook_event_name: "PreToolUse",
    turn_id: "suggestion",
    tool_name: "Write",
    tool_input: { file_path: path.join(f.root, "new.js") },
  });
  t = taskRead(f.repo, c.task_id);
  assert.equal(t.kind, "work");
  assert.equal(t.requestState, "promoted");
  assert.deepEqual(t.scope, ["new.js"]);
});

test("compact task reads report actual worker activity, then inactivity after Stop", async () => {
  const f = fixture();
  f.tool();
  let t = await execute("get", { id: f.c.task_id }, f.root);
  assert.equal(t.active, true);
  assert.equal(t.activityState, "running");
  f.hook({ hook_event_name: "Stop" });
  t = await execute("get", { id: f.c.task_id }, f.root);
  assert.equal(t.active, false);
  assert.equal(t.activityState, "inactive");
  assert.equal(t.interrupted, false);
});
