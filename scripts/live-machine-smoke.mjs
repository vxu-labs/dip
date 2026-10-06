import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { ensure, project, Runtime } from "../src/core.js";
import { automationHealth } from "../src/health.js";
import { json } from "../src/util.js";

if (process.platform !== "win32")
  throw new Error(
    "This live-machine check uses the installed Windows PowerShell profile",
  );
if (
  process.env.DIP_USER_HOME ||
  process.env.DIP_GIT_CONFIG ||
  process.env.DIP_HOME
)
  throw new Error("Run against the actual installation without test overrides");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "dip-live-machine-"));
const invoke = (command, input) =>
  execFileSync("powershell", ["-NoLogo", "-Command", command], {
    input,
    encoding: "utf8",
    windowsHide: true,
  });
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let repo;
try {
  invoke(`git init -b main '${root.replaceAll("'", "''")}' | Out-Null`);
  assert.ok(
    fs.existsSync(path.join(root, ".dip", "config.json")),
    "Integrated git init did not create DIP immediately",
  );
  repo = ensure(root);
  const attachDeadline = Date.now() + 10000;
  while (Date.now() < attachDeadline && !automationHealth(root).watcherAttached)
    await wait(150);
  assert.ok(
    automationHealth(root).watcherAttached,
    "Project watcher did not attach",
  );
  fs.writeFileSync(
    path.join(root, "observed.js"),
    "export const observed = true;\n",
  );
  const hooks = json(path.join(os.homedir(), ".codex", "hooks.json"));
  const installed = hooks.hooks.SessionStart.flatMap((g) => g.hooks).find((h) =>
    h.command.includes("--dip-hook"),
  );
  const command = installed.commandWindows || installed.command;
  const base = { cwd: root, session_id: "live-machine-qa" };
  for (const input of [
    { hook_event_name: "SessionStart" },
    {
      hook_event_name: "UserPromptSubmit",
      prompt:
        "Synthetic native integration QA: record a command and a handoff.",
    },
    {
      hook_event_name: "PreToolUse",
      tool_name: "PowerShell",
      tool_use_id: "live-1",
      tool_input: { command: "Write-Output 42" },
    },
    {
      hook_event_name: "PostToolUse",
      tool_name: "PowerShell",
      tool_use_id: "live-1",
      tool_input: { command: "Write-Output 42" },
      tool_response: { exit_code: 0 },
    },
    { hook_event_name: "Stop" },
  ])
    invoke(command, JSON.stringify({ ...base, ...input }));
  const deadline = Date.now() + 10000;
  while (
    Date.now() < deadline &&
    !project(repo).activity.some((a) => a.files?.includes("observed.js"))
  )
    await wait(150);
  const state = project(repo);
  assert.ok(
    state.activity.some(
      (a) => a.kind === "files.changed" && a.files.includes("observed.js"),
    ),
  );
  assert.ok(state.activity.some((a) => a.kind === "git.after-init"));
  assert.ok(
    state.activity.some((a) => a.kind === "PostToolUse" && a.agent === "codex"),
  );
  assert.ok(state.tasks.some((t) => t.checkpoints.some((c) => c.automatic)));
  const health = automationHealth(root);
  assert.ok(
    health.installed && health.daemon.running && health.watcherAttached,
  );
  assert.ok(health.sources.some((s) => s.source === "codex"));
  console.log(
    JSON.stringify({
      passed: true,
      immediateGitInit: true,
      nativeInstalledHookCommands: true,
      filesystemRecording: true,
      observedSources: health.sources.map((s) => s.source),
      dashboard: health.daemon.dashboard,
      modelBackedSession: false,
    }),
  );
} finally {
  if (repo) {
    const rt = new Runtime();
    rt.flush(root);
    rt.db.prepare("DELETE FROM repositories WHERE root=?").run(repo.root);
    rt.close();
    const detachDeadline = Date.now() + 10000;
    while (
      Date.now() < detachDeadline &&
      automationHealth(root).watcherAttached
    )
      await wait(150);
  }
  assert.ok(root.startsWith(path.join(os.tmpdir(), "dip-live-machine-")));
  fs.rmSync(root, { recursive: true, force: true });
}
