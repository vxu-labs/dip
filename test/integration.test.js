import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";
import { ensure, createTask, Runtime, project } from "../src/core.js";
import { git, atomic } from "../src/util.js";
import { install, uninstall, writeGitHooks } from "../src/automation.js";

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "dip-integration-"));
const cli = fileURLToPath(new URL("../bin/dip.js", import.meta.url));
process.env.DIP_HOME = path.join(sandbox, "runtime");
process.env.DIP_USER_HOME = path.join(sandbox, "user");
process.env.DIP_GIT_CONFIG = path.join(sandbox, "gitconfig");
const repoRoot = path.join(sandbox, "project");
fs.mkdirSync(repoRoot);
git(repoRoot, ["init", "-b", "main"]);
git(repoRoot, ["config", "user.name", "Test"]);
git(repoRoot, ["config", "user.email", "test@example.invalid"]);
const repo = ensure(repoRoot);
test.after(() => {
  assert.ok(sandbox.startsWith(path.join(os.tmpdir(), "dip-integration-")));
  fs.rmSync(sandbox, { recursive: true, force: true });
});
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(predicate, timeout = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await predicate()) return;
    await wait(100);
  }
  throw new Error("Timed out waiting for observable state");
}

test("MCP transport exposes concise intent tools and creates/claims persistent work", async () => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [cli, "mcp"],
    cwd: repoRoot,
    env: { ...process.env, DIP_HOME: process.env.DIP_HOME },
  });
  const client = new Client({ name: "integration-test", version: "1.0.0" });
  try {
    await client.connect(transport);
    const tools = await client.listTools();
    assert.ok(tools.tools.some((t) => t.name === "task_get"));
    const result = await client.callTool({
      name: "task_create",
      arguments: {
        title: "Created through MCP",
        acceptance: ["Available after context loss"],
        root: repoRoot,
      },
    });
    assert.ok(!result.isError);
    const { id } = JSON.parse(result.content[0].text);
    assert.ok(project(repo).tasks.some((t) => t.id === id));
    const read = await client.callTool({
      name: "task_get",
      arguments: { id, root: repoRoot },
    });
    assert.deepEqual(JSON.parse(read.content[0].text).acceptance, [
      "Available after context loss",
    ]);
    const claimed = await client.callTool({
      name: "task_claim",
      arguments: {
        id,
        actor: "codex:fixture",
        session: "fixture",
        root: repoRoot,
      },
    });
    assert.ok(!claimed.isError);
    assert.ok(JSON.parse(claimed.content[0].text).token);
  } finally {
    await client.close();
  }
});
test("claims from two independent processes have exactly one winner", async () => {
  const task = createTask(repo, { title: "Concurrent process claim" });
  const run = (actor) =>
    new Promise((resolve) => {
      const child = spawn(
        process.execPath,
        [
          cli,
          "task",
          "claim",
          "--id",
          task,
          "--actor",
          actor,
          "--root",
          repoRoot,
        ],
        { windowsHide: true, env: process.env },
      );
      let stdout = "",
        stderr = "";
      child.stdout.on("data", (c) => (stdout += c));
      child.stderr.on("data", (c) => (stderr += c));
      child.on("exit", (code) => resolve({ code, stdout, stderr }));
    });
  const results = await Promise.all([run("worker-a"), run("worker-b")]);
  assert.equal(results.filter((r) => r.code === 0).length, 1);
  assert.match(results.find((r) => r.code !== 0).stderr, /owned/);
});
test("worktrees share ownership but their durable task state remains branch-specific", () => {
  const task = createTask(repo, { title: "Worktree shared claim" });
  git(repoRoot, ["add", "."]);
  git(repoRoot, ["commit", "-m", "initial"]);
  const otherRoot = path.join(sandbox, "worktree");
  git(repoRoot, ["worktree", "add", otherRoot, "-b", "parallel"]);
  const other = ensure(otherRoot);
  assert.equal(
    other.key,
    repo.key,
    JSON.stringify({ expected: repo.common, actual: other.common }),
  );
  const rt = new Runtime();
  try {
    rt.claim(repo, task, "first");
    assert.throws(() => rt.claim(other, task, "second"), /owned/);
    const branchTask = createTask(other, {
      title: "Branch-only work",
      scope: ["src/branch"],
    });
    rt.register(other);
    rt.claim(other, branchTask, "branch-worker", 120000, ["src/branch"]);
    const mainState = project(repo, rt);
    assert.ok(!mainState.tasks.some((t) => t.id === branchTask));
    assert.deepEqual(
      mainState.activeWorkers.find((w) => w.task === branchTask),
      {
        task: branchTask,
        actor: "branch-worker",
        scope: ["src/branch"],
        expires: rt.leases(other).find((l) => l.task === branchTask).expires,
        root: other.root,
        branch: "parallel",
        title: "Branch-only work",
        visibleInBranch: false,
      },
    );
    assert.throws(
      () => rt.claim(repo, task, "first", 120000, ["src/branch/file"]),
      /Scope owned/,
    );
  } finally {
    rt.close();
  }
  git(repoRoot, ["worktree", "remove", otherRoot, "--force"]);
});
test("Git hook chain retains the original hook and stages ledger events", () => {
  const original = path.join(sandbox, "original-hooks"),
    hooks = path.join(sandbox, "hooks");
  fs.mkdirSync(original);
  const marker = path.join(sandbox, "hook-result").replaceAll("\\", "/");
  atomic(
    path.join(original, "pre-commit"),
    `#!/bin/sh\nprintf success > '${marker}'\n`,
  );
  fs.chmodSync(path.join(original, "pre-commit"), 0o755);
  writeGitHooks(hooks, original);
  git(repoRoot, ["config", "core.hooksPath", hooks]);
  createTask(repo, { title: "Hook capture" });
  git(repoRoot, ["add", "."]);
  git(repoRoot, ["commit", "-m", "hook test"]);
  assert.equal(fs.readFileSync(marker, "utf8"), "success");
  assert.ok(
    git(repoRoot, ["ls-tree", "-r", "--name-only", "HEAD"]).includes(
      ".dip/events",
    ),
  );
  git(repoRoot, ["config", "--unset", "core.hooksPath"]);
});
test("background service discovers a newly created repo and batches filesystem changes", async () => {
  install({
    roots: [sandbox],
    agents: false,
    gitHooks: false,
    startup: false,
    start: false,
  });
  const daemon = spawn(process.execPath, [cli, "daemon"], {
    env: process.env,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let logs = "";
  daemon.stderr.on("data", (c) => (logs += c.toString()));
  daemon.stdout.on("data", () => {});
  try {
    await until(() =>
      fs.existsSync(path.join(process.env.DIP_HOME, "daemon.json")),
    );
    const fresh = path.join(sandbox, "discovered-new");
    fs.mkdirSync(fresh);
    git(fresh, ["init"]);
    await until(() => fs.existsSync(path.join(fresh, ".dip", "config.json")));
    await wait(1500);
    fs.writeFileSync(path.join(fresh, "app.js"), "console.log(42)");
    await until(() =>
      project(ensure(fresh)).activity.some(
        (a) => a.kind === "files.changed" && a.files.includes("app.js"),
      ),
    );
    assert.ok(!logs.includes("SQLITE_BUSY"));
  } finally {
    daemon.kill();
    await new Promise((resolve) => daemon.once("exit", resolve));
  }
});
test(
  "integrated PowerShell initializes git init outside discovery roots",
  { skip: process.platform !== "win32" },
  () => {
    install({
      roots: [],
      agents: false,
      gitHooks: false,
      startup: true,
      start: false,
    });
    const profile = path.join(
      process.env.DIP_USER_HOME,
      "Documents",
      "PowerShell",
      "Microsoft.PowerShell_profile.ps1",
    );
    const target = path.join(sandbox, "shell-bootstrap");
    fs.mkdirSync(target);
    const escaped = path.join(target, "new project").replaceAll("'", "''");
    execFileSync(
      "powershell",
      [
        "-NoProfile",
        "-Command",
        `. '${profile.replaceAll("'", "''")}'; git init '${escaped}'; & '${process.execPath}' '${cli}' stop`,
      ],
      { encoding: "utf8", windowsHide: true, env: process.env },
    );
    assert.ok(
      fs.existsSync(path.join(target, "new project", ".dip", "config.json")),
    );
    uninstall();
  },
);
test(
  "integrated Bash initializes repositories outside discovery roots",
  { skip: process.platform === "win32" },
  () => {
    install({
      roots: [],
      agents: false,
      gitHooks: false,
      startup: true,
      start: false,
    });
    const profile = path.join(process.env.DIP_USER_HOME, ".bashrc"),
      target = path.join(sandbox, "bash-new");
    execFileSync(
      "bash",
      [
        "--noprofile",
        "--norc",
        "-c",
        `. '${profile}'; git init '${target}'; '${process.execPath}' '${cli}' stop`,
      ],
      { env: process.env, stdio: "pipe" },
    );
    assert.ok(fs.existsSync(path.join(target, ".dip", "config.json")));
    uninstall();
  },
);
test(
  "integrated Zsh initializes repositories outside discovery roots",
  { skip: process.platform !== "darwin" },
  () => {
    install({
      roots: [],
      agents: false,
      gitHooks: false,
      startup: true,
      start: false,
    });
    const profile = path.join(process.env.DIP_USER_HOME, ".zshrc"),
      target = path.join(sandbox, "zsh-new");
    execFileSync(
      "zsh",
      [
        "-f",
        "-c",
        `. '${profile}'; git init '${target}'; '${process.execPath}' '${cli}' stop`,
      ],
      { env: process.env, stdio: "pipe" },
    );
    assert.ok(fs.existsSync(path.join(target, ".dip", "config.json")));
    uninstall();
  },
);
test("repo-local hook overrides are wrapped automatically and restored on removal", () => {
  const original = path.join(sandbox, "repo-local-hooks");
  fs.mkdirSync(original);
  git(repoRoot, ["config", "core.hooksPath", original]);
  install({ roots: [repoRoot], agents: false, startup: false, start: false });
  const wrapped = git(repoRoot, [
    "config",
    "--local",
    "--get",
    "core.hooksPath",
  ]);
  assert.ok(wrapped.endsWith("dip-hooks"));
  assert.ok(fs.existsSync(path.join(wrapped, "pre-commit")));
  uninstall();
  assert.equal(
    git(repoRoot, ["config", "--local", "--get", "core.hooksPath"]),
    original,
  );
  git(repoRoot, ["config", "--unset", "core.hooksPath"]);
});
test(
  "installed Windows hooks execute with paths containing spaces",
  { skip: process.platform !== "win32" },
  () => {
    install({ roots: [], gitHooks: false, startup: false, start: false });
    for (const [agent, file] of [
      ["codex", path.join(process.env.DIP_USER_HOME, ".codex", "hooks.json")],
      [
        "claude",
        path.join(process.env.DIP_USER_HOME, ".claude", "settings.json"),
      ],
    ]) {
      const settings = JSON.parse(fs.readFileSync(file, "utf8"));
      const handler = settings.hooks.SessionStart.find((g) =>
        g.hooks.some((h) => h.command.includes("--dip-hook")),
      ).hooks[0];
      const output = execFileSync(
        "powershell",
        ["-NoProfile", "-Command", handler.commandWindows || handler.command],
        {
          input: JSON.stringify({
            cwd: repoRoot,
            session_id: "native-hook-" + agent,
            hook_event_name: "SessionStart",
          }),
          env: process.env,
          windowsHide: true,
          encoding: "utf8",
        },
      );
      const response = JSON.parse(output);
      assert.ok(response.hookSpecificOutput.additionalContext.includes(agent));
    }
    uninstall();
  },
);
