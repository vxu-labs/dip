import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { execFileSync } from "node:child_process";
import { ensure, project, Runtime } from "../src/core.js";
import { automationHealth } from "../src/health.js";
import { planningTool } from "../src/workflow.js";

if (process.platform !== "win32")
  throw new Error("Installed Windows hook check");
if (
  process.env.DIP_HOME ||
  process.env.DIP_USER_HOME ||
  process.env.DIP_GIT_CONFIG
)
  throw new Error("Run against the real installation without test overrides");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "dip-live-workflow-"));
const repoRoot = path.join(root, "project");
fs.mkdirSync(repoRoot);
execFileSync("git", ["init", "-b", "main", repoRoot], {
  env: { ...process.env, GIT_TRACE2_EVENT: "0" },
  windowsHide: true,
});
const times = [],
  results = [];
let repo = ensure(repoRoot);
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
try {
  for (const agent of ["codex", "claude"]) {
    const config = JSON.parse(
      fs.readFileSync(
        path.join(
          os.homedir(),
          agent === "codex" ? ".codex/hooks.json" : ".claude/settings.json",
        ),
        "utf8",
      ),
    );
    const hook = (input) => {
      const groups = config.hooks[input.hook_event_name].filter(
        (g) => !g.matcher || new RegExp(g.matcher).test(input.tool_name || ""),
      );
      const handlers = groups
        .flatMap((g) => g.hooks)
        .filter((h) => h.command?.includes("--dip-hook"));
      const effective = handlers.filter(
        (h) =>
          !(
            planningTool(input.tool_name || "") &&
            input.hook_event_name === "PostToolUse" &&
            h.command.includes("--skip-plan-tools")
          ),
      );
      assert.equal(
        effective.length,
        1,
        "Expected exactly one effective installed DIP handler",
      );
      const handler = effective[0];
      if (
        input.tool_name === "update_plan" &&
        input.hook_event_name === "PostToolUse"
      )
        assert.ok(!handler.async, "Plan updates must remain ordered");
      let result = {};
      for (const selected of handlers) {
        const start = performance.now();
        const output = execFileSync(
          "powershell",
          [
            "-NoProfile",
            "-Command",
            selected.commandWindows || selected.command,
          ],
          {
            input: JSON.stringify({ cwd: repoRoot, ...input }),
            encoding: "utf8",
            windowsHide: true,
          },
        );
        times.push(performance.now() - start);
        if (output.trim()) result = JSON.parse(output);
      }
      return result;
    };
    for (const kind of ["future", "plan", "development"]) {
      const session_id = `live-flow-${agent}-${kind}`;
      hook({ session_id, hook_event_name: "SessionStart" });
      const response = hook({
        session_id,
        hook_event_name: "UserPromptSubmit",
        turn_id: session_id,
        prompt:
          kind === "future"
            ? "תזכור להוסיף ייצוא CSV בעתיד"
            : kind === "plan"
              ? "תיצור תכנית לפיתוח CSV"
              : "תפתח ייצוא CSV",
      });
      const context = JSON.parse(response.hookSpecificOutput.additionalContext);
      assert.ok(context.task_id);
      hook({
        session_id,
        hook_event_name: "PreToolUse",
        tool_name: "Read",
        tool_use_id: session_id + "-read",
        tool_input: { file_path: "README.md" },
      });
      const tool_name = agent === "codex" ? "update_plan" : "TodoWrite";
      const tool_input =
        agent === "codex"
          ? { plan: [{ step: "Build CSV export", status: "pending" }] }
          : { todos: [{ content: "Build CSV export", status: "pending" }] };
      hook({
        session_id,
        hook_event_name: "PreToolUse",
        tool_name,
        tool_use_id: session_id + "-plan",
        tool_input,
      });
      hook({
        session_id,
        hook_event_name: "PostToolUse",
        tool_name,
        tool_use_id: session_id + "-plan",
        tool_input,
      });
      if (kind === "development")
        hook({
          session_id,
          hook_event_name: "PreToolUse",
          tool_name: "Write",
          tool_use_id: session_id + "-write",
          tool_input: { file_path: path.join(repoRoot, agent + "-export.js") },
        });
      hook({ session_id, hook_event_name: "Stop" });
      repo = ensure(repoRoot);
      const task = project(repo).tasks.find((t) => t.id === context.task_id);
      assert.ok(task.plan);
      assert.equal(
        task.status,
        kind === "development" ? "in_progress" : "backlog",
      );
      assert.equal(task.evidence.length, 0);
      results.push({
        agent,
        kind,
        taskCaptured: true,
        planCaptured: true,
        status: task.status,
      });
    }
  }
  assert.equal(project(repo).tasks.length, 6);
  const captureDeadline = Date.now() + 10000;
  while (
    Date.now() < captureDeadline &&
    automationHealth(repoRoot).agentCapture.promptCount < 6
  )
    await wait(150);
  assert.equal(automationHealth(repoRoot).agentCapture.promptCount, 6);
  const median = [...times].sort((a, b) => a - b)[Math.floor(times.length / 2)];
  console.log(
    JSON.stringify(
      {
        passed: true,
        installedHookCommands: true,
        syntheticInputs: true,
        modelBackedSession: false,
        cases: results,
        medianHookIncludingPowerShellMs: Math.round(median),
        hookInvocations: times.length,
        captureModelCalls: 0,
        health: automationHealth(repoRoot).agentCapture,
      },
      null,
      2,
    ),
  );
} finally {
  if (repo) {
    const rt = new Runtime();
    rt.flush(repoRoot);
    rt.db.prepare("DELETE FROM repositories WHERE root=?").run(repo.root);
    rt.close();
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline && automationHealth(repoRoot).watcherAttached)
      await wait(150);
  }
  const absolute = path.resolve(root);
  assert.equal(path.dirname(absolute), path.resolve(os.tmpdir()));
  assert.ok(path.basename(absolute).startsWith("dip-live-workflow-"));
  fs.rmSync(absolute, { recursive: true, force: true });
}
