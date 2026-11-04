import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ensure,
  Runtime,
  createTask,
  taskRead,
  compactContext,
  PRE_CATALOG_INSTRUCTIONS,
} from "../src/core.js";
import {
  PRE_CATALOG_AUTOMATIC_INSTRUCTIONS,
  AUTOMATIC_INSTRUCTIONS,
} from "../src/automatic.js";
import { handleHook } from "../src/automation.js";
import { execute } from "../src/actions.js";
import { createServer } from "../src/server.js";
import { git, atomic, json } from "../src/util.js";
import {
  listLocalProjects,
  dashboardLauncherPath,
} from "../src/project-index.js";

const sandbox = fs.realpathSync.native(
  fs.mkdtempSync(path.join(os.tmpdir(), "dip-local-workspace-")),
);
Object.assign(process.env, {
  DIP_HOME: path.join(sandbox, "runtime"),
  DIP_USER_HOME: path.join(sandbox, "user"),
  DIP_GIT_CONFIG: path.join(sandbox, "gitconfig"),
  GIT_CONFIG_GLOBAL: path.join(sandbox, "gitconfig"),
  GIT_TRACE2_EVENT: "0",
});
let serial = 0;
function fixture(name = `project ${++serial}`) {
  const root = path.join(sandbox, name);
  fs.mkdirSync(root, { recursive: true });
  git(root, ["init", "-b", "main"]);
  return ensure(root, { workflow: "automatic" });
}
const runtimeFile = (name) => path.join(process.env.DIP_HOME, name);
test.after(() => fs.rmSync(sandbox, { recursive: true, force: true }));

test("catalog links encode local paths and a separate private launcher follows the recorder endpoint", () => {
  const repo = fixture("Hebrew עברית & spaces"),
    rt = new Runtime();
  try {
    rt.register(repo);
    let index = rt.refreshProjects(),
      project = index.projects.find((p) => p.root === repo.root);
    assert.equal(new URL(project.links.folder).protocol, "file:");
    assert.equal(
      new URL(project.links.dashboard).searchParams.get("root"),
      repo.root,
    );
    assert.equal(new URL(project.links.localDashboard).pathname, "/local");
    assert.equal(new URL(project.links.tasks).pathname, "/api/state");
    assert.equal(project.worktrees[0].links.dashboard, project.links.dashboard);
    assert.equal(
      index.dashboard.file,
      dashboardLauncherPath(process.env.DIP_HOME),
    );
    assert.match(
      fs.readFileSync(index.dashboard.file, "utf8"),
      /http-equiv="refresh"/,
    );
    atomic(runtimeFile("daemon.json"), { dashboard: "http://127.0.0.1:47891" });
    index = rt.refreshProjects();
    assert.equal(new URL(index.dashboard.url).port, "47891");
    assert.match(fs.readFileSync(index.dashboard.file, "utf8"), /47891\/local/);
    atomic(runtimeFile("daemon.json"), {
      dashboard: "https://attacker.example/steal",
    });
    assert.equal(
      new URL(rt.refreshProjects().dashboard.url).origin,
      "http://127.0.0.1:4317",
    );
  } finally {
    rt.close();
  }
});

test("bounded discovery works outside a project, paginates and points to explicit per-project task reads", async () => {
  const one = fixture("catalog alpha"),
    two = fixture("catalog beta"),
    rt = new Runtime();
  try {
    rt.register(one);
    rt.register(two);
    const first = listLocalProjects(rt, { query: "catalog", limit: 1 });
    assert.equal(first.total, 2);
    assert.equal(first.projects.length, 1);
    assert.equal(first.nextOffset, 1);
    const second = await execute(
      "local-projects",
      { query: "catalog", limit: 1, offset: 1 },
      sandbox,
    );
    assert.equal(second.projects[0].root, two.root);
    assert.equal(second.nextOffset, null);
    assert.match(second.access.tasks, /project_reconcile/);
    assert.equal(fs.existsSync(path.join(sandbox, ".dip")), false);
    assert.throws(() => listLocalProjects(rt, { limit: 0 }), /pagination/);
  } finally {
    rt.close();
  }
});

test("trusted project and projectless sessions receive directory knowledge without fabricated capture or unbounded project dumps", () => {
  const repo = fixture(),
    task = createTask(repo, { title: "Current work" }),
    rt = new Runtime();
  try {
    for (const event of ["SessionStart", "UserPromptSubmit"]) {
      const global = JSON.parse(
        handleHook({ cwd: sandbox, hook_event_name: event }, "codex")
          .hookSpecificOutput.additionalContext,
      );
      assert.equal(global.localProjects.index, runtimeFile("projects.json"));
      assert.equal(global.task_id, undefined);
      assert.match(global.instructions, /No current DIP project/);
    }
    const prompt = JSON.parse(
      handleHook(
        {
          cwd: repo.root,
          hook_event_name: "UserPromptSubmit",
          session_id: "registry",
          prompt: "Inspect local projects",
        },
        "codex",
      ).hookSpecificOutput.additionalContext,
    );
    assert.ok(prompt.task_id);
    assert.equal(prompt.localProjects.index, runtimeFile("projects.json"));
    for (const [tool_name, tool_input] of [
      ["local_projects", {}],
      ["Bash", { command: "dip projects --query catalog" }],
    ]) {
      handleHook(
        {
          cwd: repo.root,
          hook_event_name: "PreToolUse",
          session_id: "registry",
          tool_name,
          tool_input,
        },
        "codex",
      );
    }
    assert.equal(taskRead(repo, prompt.task_id).status, "backlog");
    const start = JSON.parse(
      handleHook(
        {
          cwd: repo.root,
          hook_event_name: "SessionStart",
          session_id: "registry",
        },
        "codex",
      ).hookSpecificOutput.additionalContext,
    );
    assert.equal(
      start.localProjects.discover,
      "local_projects or dip projects",
    );
    assert.ok(Buffer.byteLength(JSON.stringify(start)) <= 4096);
    const context = compactContext(repo, rt, { task_id: task });
    assert.ok(context.localProjects);
    assert.equal(context.localProjects.projects, undefined);
  } finally {
    rt.close();
  }
});

test("owned old instruction blocks upgrade while custom instructions remain intact", () => {
  const repo = fixture();
  for (const old of [
    PRE_CATALOG_INSTRUCTIONS,
    PRE_CATALOG_AUTOMATIC_INSTRUCTIONS,
  ]) {
    fs.writeFileSync(
      path.join(repo.root, "AGENTS.md"),
      "User prefix\n<!-- dip:start -->\n" + old + "\n<!-- dip:end -->\n",
    );
    ensure(repo.root);
    const upgraded = fs.readFileSync(path.join(repo.root, "AGENTS.md"), "utf8");
    assert.ok(upgraded.includes(AUTOMATIC_INSTRUCTIONS));
    assert.ok(upgraded.startsWith("User prefix"));
  }
  const custom = "<!-- dip:start -->\nUser-owned workflow\n<!-- dip:end -->\n";
  fs.writeFileSync(path.join(repo.root, "AGENTS.md"), custom);
  ensure(repo.root);
  assert.equal(
    fs.readFileSync(path.join(repo.root, "AGENTS.md"), "utf8"),
    custom,
  );
});

test("an unreadable current project still provides directory discovery without asserting capture or permitting writes", () => {
  const repo = fixture("invalid-current-project");
  fs.writeFileSync(path.join(repo.root, ".dip/config.json"), "broken JSON");
  const hint = JSON.parse(
    handleHook(
      {
        cwd: repo.root,
        hook_event_name: "UserPromptSubmit",
        prompt: "Find another project",
      },
      "codex",
    ).hookSpecificOutput.additionalContext,
  );
  assert.ok(hint.projectError.includes("Invalid JSON"));
  assert.equal(hint.localProjects.index, runtimeFile("projects.json"));
  assert.equal(hint.task_id, undefined);
  assert.throws(
    () =>
      handleHook(
        {
          cwd: repo.root,
          hook_event_name: "PreToolUse",
          tool_name: "Write",
          tool_input: { file_path: "code.js" },
        },
        "codex",
      ),
    /Invalid JSON/,
  );
});

test("local dashboard serves the shared UI, registered-root task data and protected folder actions", async () => {
  const one = fixture("server one"),
    two = fixture("server two"),
    rt = new Runtime();
  try {
    rt.register(one);
    rt.register(two);
  } finally {
    rt.close();
  }
  const first = createTask(one, { title: "Only project one" });
  const second = createTask(two, { title: "Only project two" });
  const opened = [],
    server = createServer({
      root: one.root,
      port: 0,
      openFolder: async (root) => opened.push(root),
    });
  await new Promise((resolve) => server.once("listening", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    const page = await fetch(origin + "/local");
    assert.match(await page.text(), /data-dashboard="local"/);
    assert.match(
      page.headers.get("content-security-policy"),
      /script-src 'self'/,
    );
    const catalog = await (await fetch(origin + "/api/catalog")).json();
    const project = catalog.projects.find((p) => p.root === two.root);
    assert.equal(new URL(project.links.dashboard).origin, origin);
    const state = await (await fetch(project.links.tasks)).json();
    assert.ok(state.tasks.some((t) => t.id === second));
    assert.equal(
      state.tasks.some((t) => t.id === first),
      false,
    );
    assert.equal(
      (await fetch(origin + "/api/state?root=" + encodeURIComponent(sandbox)))
        .status,
      400,
    );
    assert.equal(
      (
        await fetch(
          origin + "/api/open-project?root=" + encodeURIComponent(two.root),
          { method: "POST" },
        )
      ).status,
      403,
    );
    const { token } = await (await fetch(origin + "/api/session")).json();
    const options = { method: "POST", headers: { "x-dip-token": token } };
    assert.equal(
      (
        await fetch(
          origin + "/api/open-project?root=" + encodeURIComponent(sandbox),
          options,
        )
      ).status,
      400,
    );
    assert.equal(
      (
        await fetch(
          origin + "/api/open-project?root=" + encodeURIComponent(two.root),
          {
            ...options,
            headers: { ...options.headers, origin: "https://attacker.example" },
          },
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await fetch(
          origin + "/api/open-project?root=" + encodeURIComponent(two.root),
          options,
        )
      ).status,
      200,
    );
    assert.deepEqual(opened, [two.root]);
    fs.rmSync(two.root, { recursive: true });
    const removed = await (await fetch(origin + "/api/catalog")).json();
    assert.equal(
      removed.projects.some((p) => p.root === two.root),
      false,
    );
    assert.equal(
      (
        await fetch(
          origin + "/api/open-project?root=" + encodeURIComponent(two.root),
          options,
        )
      ).status,
      400,
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("real MCP advertises global local_projects discovery even with a non-project root", async () => {
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { StdioClientTransport } =
    await import("@modelcontextprotocol/sdk/client/stdio.js");
  const client = new Client({ name: "local-catalog-qa", version: "1" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [fileURLToPath(new URL("../bin/dip.js", import.meta.url)), "mcp"],
    env: process.env,
    stderr: "pipe",
    cwd: sandbox,
  });
  try {
    await client.connect(transport);
    assert.ok(
      (await client.listTools()).tools.some((t) => t.name === "local_projects"),
    );
    const result = await client.callTool({
      name: "local_projects",
      arguments: { root: sandbox, query: "catalog alpha", limit: 1 },
    });
    assert.equal(result.isError, undefined);
    const value = JSON.parse(result.content[0].text);
    assert.equal(value.total, 1);
    assert.equal(value.projects[0].name, "catalog alpha");
    assert.equal(fs.existsSync(path.join(sandbox, ".dip")), false);
  } finally {
    await client.close();
  }
});
