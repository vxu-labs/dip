import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { ensure, project, Runtime } from "../src/core.js";
import { handleHook } from "../src/automation.js";
import { execute } from "../src/actions.js";
import { automationHealth } from "../src/health.js";
import { git, atomic } from "../src/util.js";
import { briefPlan } from "../src/workflow.js";

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "dip-workflow-"));
process.env.DIP_HOME = path.join(sandbox, "runtime");
process.env.DIP_USER_HOME = path.join(sandbox, "user");
process.env.DIP_GIT_CONFIG = path.join(sandbox, "gitconfig");
process.env.GIT_CONFIG_GLOBAL = process.env.DIP_GIT_CONFIG;
let serial = 0;
const fixture = () => {
  const root = path.join(sandbox, String(++serial));
  fs.mkdirSync(root);
  git(root, ["init", "-b", "main"]);
  const repo = ensure(root);
  const base = { cwd: root, session_id: "workflow" };
  const hook = (input) => handleHook({ ...base, ...input }, "codex");
  return { repo, hook };
};
test("changed plan intent invalidates evidence while a progress-only update preserves it", async () => {
  const { repo, hook } = fixture();
  repo.config.verification.pass = {
    command: [process.execPath, "-e", "process.exit(0)"],
  };
  atomic(path.join(repo.dir, "config.json"), repo.config);
  const output = hook({
    hook_event_name: "UserPromptSubmit",
    prompt: "Implement export",
  });
  const { task_id: id, actor } = JSON.parse(
    output.hookSpecificOutput.additionalContext,
  );
  const plan = (tool_use_id, step, status) =>
    hook({
      hook_event_name: "PostToolUse",
      tool_name: "update_plan",
      tool_use_id,
      tool_input: { plan: [{ step, status }] },
    });
  plan("before", "UTF-8 export", "pending");
  assert.equal(
    (await execute("verify", { id, actor, check: "pass" }, repo.root)).passed,
    true,
  );
  plan("progress", "UTF-8 export", "completed");
  assert.equal(
    (await execute("reconcile", {}, repo.root)).tasks[0].verification,
    "current",
  );
  plan("requirement", "Also export JSON", "pending");
  assert.equal(
    (await execute("reconcile", {}, repo.root)).tasks[0].verification,
    "stale",
  );
});
test.after(() => {
  assert.ok(sandbox.startsWith(path.join(os.tmpdir(), "dip-workflow-")));
  fs.rmSync(sandbox, { recursive: true, force: true });
});

test("context and dashboard reads preserve managed agent instructions from another installation", async () => {
  const { repo, hook } = fixture();
  const context = JSON.parse(
    hook({ hook_event_name: "UserPromptSubmit", prompt: "Inspect the project" })
      .hookSpecificOutput.additionalContext,
  );
  const file = path.join(repo.root, "AGENTS.md");
  const futureInstructions =
    "User instructions\n<!-- dip:start -->\nInstructions managed by another installed version.\n<!-- dip:end -->\n";
  fs.writeFileSync(file, futureInstructions);
  for (const action of ["context", "status", "get", "next", "reconcile"])
    await execute(action, { id: context.task_id }, repo.root);
  assert.equal(fs.readFileSync(file, "utf8"), futureInstructions);
});

test("identical hook IDs in two projects sharing a runtime never drop either request", () => {
  const { repo: first } = fixture(),
    { repo: second } = fixture();
  const rt = new Runtime();
  try {
    for (const repo of [first, second])
      rt.enqueue(
        repo,
        "shared-session",
        { kind: "UserPromptSubmit", agent: "codex" },
        "shared-event",
      );
    assert.equal(
      rt.db
        .prepare("SELECT count(*) AS n FROM queue WHERE session=?")
        .get("shared-session").n,
      2,
    );
    rt.flush();
    for (const repo of [first, second])
      assert.equal(
        project(repo).activity.filter((a) => a.kind === "UserPromptSubmit")
          .length,
        1,
      );
    rt.enqueue(
      first,
      "shared-session",
      { kind: "UserPromptSubmit", agent: "codex" },
      "shared-event",
    );
    rt.flush();
    assert.equal(
      project(first).activity.filter((a) => a.kind === "UserPromptSubmit")
        .length,
      1,
    );
  } finally {
    rt.close();
  }
});

test("future request supplies its task identity and remains backlog through reading and planning", () => {
  const { repo, hook } = fixture();
  const output = hook({
    hook_event_name: "UserPromptSubmit",
    prompt: "תזכור להוסיף ייצוא CSV בעתיד",
  });
  const context = JSON.parse(output.hookSpecificOutput.additionalContext);
  assert.equal(context.actor, "codex:workflow");
  assert.equal(context.session_id, "workflow");
  for (const tool_name of ["Read", "Grep", "update_plan"])
    hook({
      hook_event_name: "PreToolUse",
      tool_name,
      tool_input: {},
      tool_use_id: tool_name,
    });
  hook({
    hook_event_name: "PostToolUse",
    tool_name: "update_plan",
    tool_use_id: "p1",
    tool_input: { plan: [{ step: "Add CSV export later", status: "pending" }] },
  });
  const rt = new Runtime();
  try {
    const state = project(repo, rt);
    assert.equal(state.tasks.length, 1);
    assert.equal(state.tasks[0].id, context.task_id);
    assert.equal(state.tasks[0].status, "backlog");
    assert.equal(state.tasks[0].active, false);
    assert.equal(
      state.tasks[0].plan.input.plan[0].step,
      "Add CSV export later",
    );
  } finally {
    rt.close();
  }
});

test("plan revisions replace the displayed plan, deduplicate retry and never assert verification", () => {
  const { repo, hook } = fixture();
  hook({ hook_event_name: "UserPromptSubmit", prompt: "Create a plan" });
  for (const [id, step, status] of [
    ["p1", "Original step", "pending"],
    ["p2", "Revised step", "completed"],
    ["p2", "Revised step", "completed"],
  ])
    hook({
      hook_event_name: "PostToolUse",
      tool_name: "update_plan",
      tool_use_id: id,
      tool_input: { plan: [{ step, status }] },
    });
  const task = project(repo).tasks[0];
  assert.equal(task.history.filter((e) => e.type === "task.plan").length, 2);
  assert.equal(task.plan.input.plan[0].step, "Revised step");
  assert.equal(task.status, "backlog");
  assert.equal(task.evidence.length, 0);
});

test("edit starts the captured task without needing another task or manual tracking call", () => {
  const { repo, hook } = fixture();
  hook({ hook_event_name: "UserPromptSubmit", prompt: "Develop CSV export" });
  const result = hook({
    hook_event_name: "PreToolUse",
    tool_name: "Write",
    tool_input: { file_path: path.join(repo.root, "export.js") },
  });
  assert.deepEqual(result, {});
  const rt = new Runtime();
  try {
    const state = project(repo, rt);
    assert.equal(state.tasks.length, 1);
    assert.equal(state.tasks[0].status, "in_progress");
    assert.equal(state.tasks[0].active, true);
    assert.deepEqual(state.tasks[0].scope, ["export.js"]);
  } finally {
    rt.close();
  }
});

test("Codex turn identity deduplicates prompt retries while an identical later request remains distinct", () => {
  const { repo, hook } = fixture();
  const input = {
    hook_event_name: "UserPromptSubmit",
    turn_id: "turn-1",
    prompt: "Remember export",
  };
  const a = hook(input),
    b = hook(input);
  assert.equal(
    a.hookSpecificOutput.additionalContext,
    b.hookSpecificOutput.additionalContext,
  );
  assert.equal(project(repo).tasks.length, 1);
  assert.equal(
    project(repo).activity.filter((a) => a.kind === "UserPromptSubmit").length,
    1,
  );
  hook({
    hook_event_name: "PreToolUse",
    tool_name: "Write",
    tool_input: { path: "export.js" },
  });
  const rt = new Runtime();
  const originalToken = rt.db
    .prepare("SELECT token FROM leases WHERE repo=?")
    .get(repo.key).token;
  hook(input);
  assert.equal(
    rt.db.prepare("SELECT token FROM leases WHERE repo=?").get(repo.key).token,
    originalToken,
  );
  assert.equal(rt.leases(repo)[0].active, true);
  rt.close();
  hook({ ...input, turn_id: "turn-2" });
  assert.equal(project(repo).tasks.length, 2);
});

test("Claude TodoWrite captures full plans; failed plans do not overwrite and concise reads are bounded", () => {
  const { repo } = fixture();
  const base = {
    cwd: repo.root,
    session_id: "claude-plan",
    hook_event_name: "PostToolUse",
    tool_name: "TodoWrite",
  };
  handleHook(
    {
      ...base,
      tool_use_id: "ok",
      tool_input: {
        todos: Array.from({ length: 100 }, (_, n) => ({
          content: "Step " + n,
          status: "pending",
        })),
      },
    },
    "claude",
  );
  handleHook(
    {
      ...base,
      tool_use_id: "fail",
      tool_response: { is_error: true },
      tool_input: { todos: [] },
    },
    "claude",
  );
  const task = project(repo).tasks[0];
  assert.equal(task.plan.input.todos.length, 100);
  assert.equal(briefPlan(task.plan).steps.length, 20);
  assert.equal(briefPlan(task.plan).truncated, true);
});

test("prose plan persists on existing request and doctor distinguishes configuration from delivered prompts", async () => {
  const { repo, hook } = fixture();
  assert.equal(automationHealth(repo.root).agentCapture.status, "unobserved");
  const output = hook({
    hook_event_name: "UserPromptSubmit",
    prompt: "Make a plan",
  });
  const { task_id: id, actor } = JSON.parse(
    output.hookSpecificOutput.additionalContext,
  );
  await execute(
    "plan",
    {
      id,
      actor,
      text: "First inspect the CSV writer. Then add Unicode coverage.",
    },
    repo.root,
  );
  const task = project(repo).tasks[0];
  assert.match(task.plan.input.text, /Unicode/);
  assert.equal(task.status, "backlog");
  assert.equal(automationHealth(repo.root).agentCapture.promptCount, 1);
  assert.equal(automationHealth(repo.root).agentCapture.planCount, 1);
});
