import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";

const cli = process.argv[2];
if (!cli || !fs.existsSync(cli))
  throw new Error(
    "Usage: node scripts/document-hook-smoke.mjs ABSOLUTE_INSTALLED_DIP_CLI",
  );
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "dip-document-hooks-"));
const env = {
  ...process.env,
  DIP_HOME: path.join(sandbox, "runtime"),
  DIP_USER_HOME: path.join(sandbox, "user"),
  GIT_CONFIG_GLOBAL: path.join(sandbox, "gitconfig"),
  DIP_GIT_CONFIG: path.join(sandbox, "gitconfig"),
  GIT_TRACE2_EVENT: "0",
};
const run = (args, input) => {
  const text = execFileSync(process.execPath, [cli, ...args], {
    input,
    encoding: "utf8",
    windowsHide: true,
    env,
  });
  return text.trim() ? JSON.parse(text) : {};
};
try {
  for (const agent of ["codex", "claude"]) {
    const root = path.join(sandbox, agent);
    fs.mkdirSync(root);
    execFileSync("git", ["init", root], {
      windowsHide: true,
      stdio: "pipe",
      env,
    });
    const hook = (data) =>
      run(
        ["hook", "--agent", agent],
        JSON.stringify({ cwd: root, session_id: agent + "-docs", ...data }),
      );
    const response = hook({
      hook_event_name: "UserPromptSubmit",
      prompt: "Plan export once",
    });
    const context = JSON.parse(response.hookSpecificOutput.additionalContext);
    const text = "# Export\n## Validation\nVerify Unicode CSV";
    const call = {
      tool_name: agent === "codex" ? "functions.apply_patch" : "Write",
      tool_use_id: "plan-write",
      tool_input:
        agent === "codex"
          ? "*** Begin Patch\n*** Add File: PLAN.md\n+# Export\n+## Validation\n+Verify Unicode CSV\n*** End Patch"
          : { file_path: path.join(root, "PLAN.md"), content: text },
    };
    hook({ ...call, hook_event_name: "PreToolUse" });
    fs.writeFileSync(path.join(root, "PLAN.md"), text);
    hook({
      hook_event_name: "UserPromptSubmit",
      prompt: "Remember a separate future idea",
    });
    hook({
      ...call,
      hook_event_name: "PostToolUse",
      tool_response: { success: true },
    });
    const task = run(["task", "get", "--root", root, "--id", context.task_id]);
    assert.equal(task.documents.length, 1);
    assert.equal(
      task.documents[0].hash,
      createHash("sha256").update(text).digest("hex"),
    );
    assert.ok(!JSON.stringify(task.history).includes("Verify Unicode CSV"));
    const read = run([
      "task",
      "document-read",
      "--root",
      root,
      "--id",
      context.task_id,
      "--path",
      "PLAN.md",
      "--role",
      "plan",
      "--heading",
      "Validation",
    ]);
    assert.equal(read.currentness, "current");
    assert.equal(read.sections[0].heading, "Validation");
    fs.writeFileSync(
      path.join(root, "PLAN.md"),
      text + "\nChanged requirement",
    );
    assert.equal(
      run(["task", "document-list", "--root", root, "--id", context.task_id])
        .documents[0].currentness,
      "stale",
    );
    console.log(
      `${agent}: installed CLI captured one metadata-only plan reference, retained pre-tool task binding, retrieved sections and detected stale content.`,
    );
  }
  console.log(
    "Synthetic installed hook inputs passed for both adapters; no AI model or live host session was invoked.",
  );
} finally {
  assert.ok(sandbox.startsWith(path.join(os.tmpdir(), "dip-document-hooks-")));
  fs.rmSync(sandbox, { recursive: true, force: true });
}
