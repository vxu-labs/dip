import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { ensure, Runtime, taskRead } from "../src/core.js";
import { handleHook } from "../src/automation.js";
import { readingCommand } from "../src/workflow.js";
import { git } from "../src/util.js";

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "dip-host-qa-"));
Object.assign(process.env, {
  DIP_HOME: path.join(sandbox, "runtime"),
  DIP_USER_HOME: path.join(sandbox, "user"),
  DIP_GIT_CONFIG: path.join(sandbox, "gitconfig"),
  GIT_CONFIG_GLOBAL: path.join(sandbox, "gitconfig"),
  GIT_TRACE2_EVENT: "0",
});
test.after(() => {
  assert.equal(path.dirname(sandbox), path.resolve(os.tmpdir()));
  assert.ok(path.basename(sandbox).startsWith("dip-host-qa-"));
  fs.rmSync(sandbox, { recursive: true, force: true });
});

test("standalone literal reads preserve future backlog and do not acquire ownership", () => {
  const root = path.join(sandbox, "read");
  fs.mkdirSync(root);
  git(root, ["init", "-b", "main"]);
  const repo = ensure(root);
  const base = { cwd: root, session_id: "planning", turn_id: "future" };
  const output = handleHook(
    {
      ...base,
      hook_event_name: "UserPromptSubmit",
      prompt: "Plan future CSV export; do not implement it",
    },
    "codex",
  );
  const id = JSON.parse(output.hookSpecificOutput.additionalContext).task_id;
  const commands = [
    "Get-Content -LiteralPath '.agents/skills/dip/SKILL.md'",
    'Get-Content "docs/plan.md" -Raw',
    "cat docs/plan.md",
    "Get-Content -Path docs/plan.md -TotalCount 20",
  ];
  for (const command of commands) {
    handleHook(
      {
        ...base,
        hook_event_name: "PreToolUse",
        tool_name: "Bash",
        tool_input: { command },
      },
      "codex",
    );
    handleHook(
      {
        ...base,
        hook_event_name: "PostToolUse",
        tool_name: "Bash",
        tool_input: { command },
        tool_response: "Plan source text",
      },
      "codex",
    );
    assert.equal(taskRead(repo, id).status, "backlog");
  }
  const rt = new Runtime();
  try {
    assert.equal(
      rt.db
        .prepare("SELECT count(*) AS n FROM leases WHERE repo=? AND task=?")
        .get(repo.key, id).n,
      0,
    );
  } finally {
    rt.close();
  }
  handleHook({ ...base, hook_event_name: "Stop" }, "codex");
  assert.equal(taskRead(repo, id).status, "backlog");
});

test("read-like compounds, expressions, redirects and wrappers retain coordination", () => {
  const commands = [
    "Get-Content plan.md; Set-Content out.md changed",
    "cat plan.md > copied.md",
    "Get-Content $(Write-Output plan.md)",
    "Get-Content $planPath",
    "Get-Content plan.md | Invoke-Expression",
    "pwsh -Command Get-Content plan.md",
    "cat plan.md && node build.js",
    "Get-Content plan.md -UnknownFlag",
  ];
  for (const [index, command] of commands.entries()) {
    assert.equal(readingCommand({ command }), false, command);
    const root = path.join(sandbox, `write-${index}`);
    fs.mkdirSync(root);
    git(root, ["init", "-b", "main"]);
    const repo = ensure(root),
      base = { cwd: root, session_id: `s-${index}` };
    const output = handleHook(
      { ...base, hook_event_name: "UserPromptSubmit", prompt: "Future idea" },
      "codex",
    );
    const id = JSON.parse(output.hookSpecificOutput.additionalContext).task_id;
    handleHook(
      {
        ...base,
        hook_event_name: "PreToolUse",
        tool_name: "Bash",
        tool_input: { command },
      },
      "codex",
    );
    assert.equal(taskRead(repo, id).status, "in_progress", command);
  }
});
