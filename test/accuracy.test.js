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
  taskRead,
  Runtime,
  updateTask,
} from "../src/core.js";
import { execute, assessEvidence } from "../src/actions.js";
import { handleHook } from "../src/automation.js";
import { automationHealth, gitShellRuntime } from "../src/health.js";
import { capturedKind } from "../src/workflow.js";
import { reconcileView } from "../src/views.js";
import { atomic, git } from "../src/util.js";

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "dip-accuracy-"));
process.env.DIP_HOME = path.join(sandbox, "runtime");
process.env.DIP_USER_HOME = path.join(sandbox, "user");
process.env.DIP_GIT_CONFIG = path.join(sandbox, "gitconfig");
process.env.GIT_CONFIG_GLOBAL = process.env.DIP_GIT_CONFIG;
process.env.GIT_TRACE2_EVENT = "0";
const cli = fileURLToPath(new URL("../bin/dip.js", import.meta.url));
let serial = 0;
function fixture() {
  const root = path.join(sandbox, String(++serial));
  fs.mkdirSync(root);
  git(root, ["init", "-b", "main"]);
  const repo = ensure(root);
  repo.config.verification.build = {
    command: [process.execPath, "-e", "process.exit(0)"],
  };
  atomic(path.join(repo.dir, "config.json"), repo.config);
  const id = createTask(repo, { title: "Build package", scope: ["app.js"] });
  fs.writeFileSync(path.join(root, "app.js"), "export const ready = true;\n");
  return {
    root,
    repo,
    id,
    run: (action, args = {}) =>
      execute(action, { id, actor: "qa", ...args }, root),
  };
}
test.after(() => {
  assert.equal(path.dirname(sandbox), path.resolve(os.tmpdir()));
  assert.ok(path.basename(sandbox).startsWith("dip-accuracy-"));
  fs.rmSync(sandbox, { recursive: true, force: true });
});

test("known recommendation template captures discussion without classifying quoted reports or normal work", async () => {
  const f = fixture();
  const prompt =
    "# Overview\n\nGenerate 0 to 3 hyperpersonalized suggestions for what this user can do with Codex in this local project: C:\\Kiosk\n\n# Context\nMore context";
  for (const value of [prompt, prompt.replaceAll("\n", "\r\n")])
    assert.equal(capturedKind(value), "discussion");
  for (const value of [
    "Investigate this report:\n" + prompt,
    "Implement suggestions for Kiosk",
    "What is DIP?",
    "# Overview\nGenerate 3 suggestions",
  ])
    assert.equal(capturedKind(value), "work");
  const result = handleHook(
    {
      cwd: f.root,
      session_id: "suggest",
      turn_id: "one",
      hook_event_name: "UserPromptSubmit",
      prompt,
    },
    "codex",
  );
  const id = JSON.parse(result.hookSpecificOutput.additionalContext).task_id;
  assert.equal(taskRead(f.repo, id).kind, "discussion");
  handleHook(
    { cwd: f.root, session_id: "suggest", hook_event_name: "Stop" },
    "codex",
  );
  const current = taskRead(f.repo, id);
  assert.equal(current.resolution, null);
  assert.equal(current.status, "backlog");
  assert.equal(
    reconcileView(await f.run("reconcile"), {
      kind: "work",
      open: true,
    }).tasks.some((t) => t.id === id),
    false,
  );
});

test("remaining required work and invalid follow-ups reject completion before mutation", async () => {
  const f = fixture();
  const discussion = createTask(f.repo, {
    title: "Question",
    kind: "discussion",
  });
  const before = taskRead(f.repo, f.id).history.length;
  for (const remaining of [
    [{ disposition: "required", summary: "Test the required physical tablet" }],
    [{ disposition: "follow_up", summary: "Tablet" }],
    [{ disposition: "follow_up", summary: "Tablet", taskId: f.id }],
    [{ disposition: "follow_up", summary: "Tablet", taskId: "task_missing" }],
    [{ disposition: "follow_up", summary: "Tablet", taskId: discussion }],
    [{ disposition: "verification_limit", summary: "Tablet", taskId: f.id }],
    null,
  ])
    await assert.rejects(
      f.run("finish", {
        outcome: "implemented",
        summary: "Build complete",
        check: "build",
        remaining,
      }),
    );
  assert.equal(taskRead(f.repo, f.id).history.length, before);
  assert.equal(taskRead(f.repo, f.id).evidence.length, 0);
});

test("configured build evidence preserves device limits, follow-up and runner boundaries independently of Git", async () => {
  const f = fixture();
  const followUp = createTask(f.repo, { title: "Physical Samsung validation" });
  const remaining = [
    {
      disposition: "follow_up",
      summary: "Validate on Samsung",
      taskId: followUp,
    },
    {
      disposition: "verification_limit",
      summary: "Only configured build check; no physical tablet tested",
    },
    { disposition: "out_of_scope", summary: "Store publishing is excluded" },
  ];
  const done = await f.run("finish", {
    outcome: "implemented",
    summary: "Build passes",
    check: "build",
    remaining,
  });
  assert.equal(done.verifiedComplete, true);
  assert.equal(done.integrated, false);
  assert.equal(done.remainingReview, "recorded");
  assert.deepEqual(done.resolution.remaining, remaining);
  assert.equal(taskRead(f.repo, followUp).status, "backlog");
  assert.equal(done.verificationDetails.runner.platform, process.platform);
  assert.deepEqual(
    done.verificationDetails.command,
    f.repo.config.verification.build.command,
  );
  assert.ok(Date.parse(done.verificationDetails.at));
  const compact = reconcileView(await f.run("reconcile"), { id: f.id })
    .tasks[0];
  assert.deepEqual(compact.verificationDetails, done.verificationDetails);
  assert.equal((await f.run("get")).evidence.runner.platform, process.platform);
  const legacy = taskRead(f.repo, f.id);
  delete legacy.evidence.at(-1).runner;
  assert.equal(assessEvidence(f.repo, legacy).verificationDetails.runner, null);
  updateTask(f.repo, f.id, {
    resolution: { ...done.resolution, remaining: [] },
  });
  assert.equal(
    assessEvidence(f.repo, taskRead(f.repo, f.id)).verification,
    "stale",
  );
});

test("legacy finish is explicitly unreviewed and CLI supports an explicit empty review", async () => {
  const f = fixture();
  const done = await f.run("finish", {
    outcome: "implemented",
    summary: "Build",
    check: "build",
  });
  assert.equal(done.remainingReview, "unreviewed");
  const result = JSON.parse(
    execFileSync(
      process.execPath,
      [
        cli,
        "task",
        "finish",
        "--id",
        f.id,
        "--outcome",
        "implemented",
        "--summary",
        "Reviewed build",
        "--check",
        "build",
        "--remaining",
        "[]",
        "--actor",
        "qa",
      ],
      { cwd: f.root, encoding: "utf8", windowsHide: true },
    ),
  );
  assert.equal(result.remainingReview, "recorded");
  assert.deepEqual(result.resolution.remaining, []);
});

test("MCP exposes remaining review and rejects a required item through the real transport", async () => {
  const f = fixture();
  const client = new Client({ name: "accuracy", version: "1" });
  try {
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: [cli, "mcp"],
        cwd: f.root,
        env: process.env,
        stderr: "pipe",
      }),
    );
    const remaining = [
      { disposition: "required", summary: "Tablet acceptance still required" },
    ];
    const blocked = await client.callTool({
      name: "task_finish",
      arguments: {
        root: f.root,
        id: f.id,
        outcome: "implemented",
        summary: "Premature",
        check: "build",
        remaining,
        actor: "qa",
      },
    });
    assert.equal(blocked.isError, true);
    assert.match(blocked.content[0].text, /Required remaining work/);
    const done = await client.callTool({
      name: "task_finish",
      arguments: {
        root: f.root,
        id: f.id,
        outcome: "implemented",
        summary: "Build scope reviewed",
        check: "build",
        remaining: [],
        actor: "qa",
      },
    });
    assert.equal(done.isError, undefined);
    assert.equal(JSON.parse(done.content[0].text).remainingReview, "recorded");
  } finally {
    await client.close();
  }
});

test("doctor separates present configured hooks and historical entry from proven execution", () => {
  const f = fixture();
  const hooksPath = path.join(sandbox, "hooks");
  fs.mkdirSync(hooksPath);
  for (const name of [
    "pre-commit",
    "post-commit",
    "post-checkout",
    "post-merge",
    "post-rewrite",
    "pre-push",
  ])
    fs.writeFileSync(
      path.join(hooksPath, name),
      "#!/missing/interpreter\nexit 0\n",
    );
  atomic(path.join(process.env.DIP_HOME, "install.json"), {
    active: true,
    hooksPath,
  });
  git(f.root, ["config", "core.hooksPath", hooksPath]);
  const rt = new Runtime();
  try {
    rt.enqueue(f.repo, "git", {
      kind: "git.pre-commit",
      at: "2026-01-01T00:00:00.000Z",
      agent: "git",
    });
    rt.flush(f.root);
  } finally {
    rt.close();
  }
  const health = automationHealth(f.root);
  assert.equal(health.gitHooksConfigured, true);
  assert.equal(health.gitHooks.execution, "unverified");
  assert.equal(health.gitHooks.failureObservation, "unavailable");
  assert.equal(
    health.gitHooks.hooks.find((h) => h.name === "pre-commit").filePresent,
    true,
  );
  assert.equal(
    health.gitHooks.hooks.find((h) => h.name === "pre-commit").lastEnteredAt,
    "2026-01-01T00:00:00.000Z",
  );
  assert.ok(
    health.advisories.some((a) => /hook execution is unverified/.test(a)),
  );
  fs.unlinkSync(path.join(hooksPath, "pre-commit"));
  assert.ok(
    automationHealth(f.root).issues.some((issue) =>
      /hook files are missing: pre-commit/.test(issue),
    ),
  );
});

test("Git for Windows diagnostics distinguish a missing shell runtime from unknown layouts and presence", () => {
  const gitRoot = path.join(sandbox, "git-runtime");
  const execPath = path.join(gitRoot, "mingw64", "libexec", "git-core");
  const missing = gitShellRuntime(execPath, "win32");
  assert.equal(missing.status, "missing");
  assert.equal(missing.shell, path.join(gitRoot, "usr", "bin", "sh.exe"));
  fs.mkdirSync(path.dirname(missing.shell), { recursive: true });
  fs.writeFileSync(missing.shell, "presence is not execution");
  assert.equal(gitShellRuntime(execPath, "win32").status, "present");
  assert.equal(gitShellRuntime(execPath, "linux").status, "unknown");
  assert.equal(
    gitShellRuntime(path.join(gitRoot, "custom"), "win32").status,
    "unknown",
  );
});
