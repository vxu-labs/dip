import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { handleHook } from "../src/automation.js";
import { execute } from "../src/actions.js";
import { createTask, ensure } from "../src/core.js";
import { git } from "../src/util.js";

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "dip-knowledge-"));
Object.assign(process.env, {
  DIP_HOME: path.join(sandbox, "runtime"),
  DIP_USER_HOME: path.join(sandbox, "user"),
  DIP_GIT_CONFIG: path.join(sandbox, "gitconfig"),
  GIT_CONFIG_GLOBAL: path.join(sandbox, "gitconfig"),
});
const cli = fileURLToPath(new URL("../bin/dip.js", import.meta.url));
const runbook = "docs/operations/itaymac-preview.md";
const world = "content/assets/world-expansion";
const original =
  "# Device preview\n\n## Publishing a PNG\n\nThe poller tracks the device preview branch.\n";
const entry = {
  title: "itaymac world asset preview",
  category: "deployment",
  source: runbook,
  scopes: [world],
  topics: ["world assets", "נכסי עולם"],
  summary:
    "itaymac tracks the dedicated preview branch. Registered PNG and manifest publish without a rebuild or Vite restart.",
};
function fixture(name) {
  const root = fs.mkdtempSync(path.join(sandbox, name + "-"));
  git(root, ["init", "-b", "main"]);
  git(root, ["config", "user.name", "QA"]);
  git(root, ["config", "user.email", "qa@example.invalid"]);
  const repo = ensure(root, {
    instructions: false,
    hooks: false,
    workflow: "automatic",
  });
  const write = (relative, data) => {
    const dest = path.join(root, relative);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, data);
  };
  const run = (operation, args) =>
    execute("knowledge-" + operation, args, root);
  const hook = (hook_event_name, extra) => {
    const result = handleHook(
      {
        cwd: root,
        session_id: name + "-fresh",
        hook_event_name,
        ...extra,
      },
      "codex",
    );
    return JSON.parse(result.hookSpecificOutput.additionalContext);
  };
  return { root, repo, write, run, hook };
}
test.after(() => fs.rmSync(sandbox, { recursive: true, force: true }));

test("new session and prompt resolve the right project and deployment path", async () => {
  const codeip = fixture("CodeIP"),
    other = fixture("other");
  codeip.write(runbook, original);
  codeip.write(world + "/guide.png", "");
  await codeip.run("set", { id: "preview", patch: entry });
  assert.deepEqual(codeip.hook("SessionStart").knowledge.sources, []);
  const initial = codeip.hook("SessionStart", {
    cwd: path.join(codeip.root, world),
  });
  assert.match(initial.skillAuthoring, /dip skills create/);
  assert.match(
    codeip.hook("UserPromptSubmit", { prompt: "Create a skill" })
      .skillAuthoring,
    /internal agents belong with that application/,
  );
  assert.ok(Buffer.byteLength(JSON.stringify(initial)) <= 4096);
  assert.equal(initial.knowledge.root, fs.realpathSync(codeip.root));
  assert.deepEqual(
    initial.knowledge.sources.map(({ path, state, summary }) => ({
      path,
      state,
      summary,
    })),
    [{ path: runbook, state: "current", summary: entry.summary }],
  );
  const prompt = {
    prompt: "צריך לפרוס נכסי עולם ב-CodeIP",
    turn_id: "world-assets",
  };
  assert.equal(
    codeip.hook("UserPromptSubmit", prompt).knowledge.sources[0].summary,
    entry.summary,
  );
  assert.deepEqual(
    other.hook("UserPromptSubmit", prompt).knowledge.sources,
    [],
  );
  assert.deepEqual(
    (await codeip.run("context", { path: "apps/admin" })).guidance,
    [],
  );
  const taskId = createTask(codeip.repo, {
    title: "Publish one PNG",
    scope: [world + "/guide.png"],
  });
  assert.equal(
    (await codeip.run("context", { taskId })).guidance[0].source,
    runbook,
  );
  await assert.rejects(other.run("context", { taskId }), /Task not found/);
});

test("metadata edits preserve a stale pin, while explicit reviewed refresh updates it", async () => {
  const project = fixture("versions");
  project.write(runbook, original);
  git(project.root, ["add", runbook]);
  git(project.root, ["commit", "-m", "Add runbook"]);
  const { indexedHash } = await project.run("set", {
    id: "preview",
    patch: entry,
  });
  assert.equal(
    (
      await project.run("read", {
        id: "preview",
        heading: "Publishing",
        expectedHash: indexedHash,
      })
    ).currentness,
    "current",
  );
  project.write(runbook, original + "\nUse a second verification step.\n");
  assert.equal(
    (await project.run("list", { query: "second verification" })).entries[0].id,
    "preview",
  );
  await project.run("set", {
    id: "preview",
    patch: { title: "Updated title" },
  });
  const {
    entries: [stale],
  } = await project.run("list", { query: "updated title" });
  assert.equal(stale.currentness, "stale");
  assert.equal(stale.indexedHash, indexedHash);
  assert.equal(stale.indexedCommit, git(project.root, ["rev-parse", "HEAD"]));
  assert.equal(
    project.hook("UserPromptSubmit", { prompt: "Deploy world assets" })
      .knowledge.sources[0].summary,
    undefined,
  );
  await assert.rejects(
    project.run("read", { id: "preview", expectedHash: indexedHash }),
    /version changed/,
  );
  await assert.rejects(
    project.run("refresh", { id: "preview", expectedHash: indexedHash }),
    /version changed/,
  );
  await project.run("refresh", {
    id: "preview",
    expectedHash: stale.currentHash,
  });
  assert.equal(
    (await project.run("list", { query: "updated title" })).entries[0]
      .currentness,
    "current",
  );
  fs.rmSync(path.join(project.root, runbook));
  assert.equal(
    (await project.run("list", { query: "updated title" })).entries[0]
      .currentness,
    "missing",
  );
});

test("native scope and policy stay with the host, and overlapping declared conflicts are visible", async () => {
  const project = fixture("native");
  const nested = "game/world";
  const codex = nested + "/.agents/skills/deploy/SKILL.md";
  const claude = ".claude/skills/deploy/SKILL.md";
  const yaml = nested + "/.agents/skills/deploy/agents/openai.yaml";
  project.write(".gitignore", ".claude/\n");
  project.write("AGENTS.md", "# Root");
  project.write(nested + "/AGENTS.md", "# Nested default");
  project.write(nested + "/AGENTS.override.md", "# Nested override");
  project.write(
    codex,
    "---\nname: deploy\ndescription: deployment\n---\nExplicit only body",
  );
  project.write(
    claude,
    "---\nname: deploy\ndescription: deployment\ndisable-model-invocation: true\n---\nExplicit only body",
  );
  project.write(yaml, "policy: { allow_implicit_invocation: false }\n");
  await project.run("set", {
    id: "codex-skill",
    patch: { source: codex, category: "skill", title: "Deploy" },
  });
  const catalog = await project.run("list", {
    category: "skill",
    path: nested + "/file.ts",
  });
  assert.deepEqual(
    catalog.entries.map(({ host, activation, scope }) => [
      host,
      activation,
      scope,
    ]),
    [
      ["codex", "explicit-only", nested],
      ["claude", "explicit-only", "."],
    ],
  );
  assert.equal(catalog.entries[0].policySource, yaml);
  assert.equal(
    (
      await project.run("list", {
        category: "skill",
        path: "game/admin/file.ts",
      })
    ).total,
    1,
  );
  await assert.rejects(project.run("read", { path: codex }), /native host/);
  await assert.rejects(
    project.run("read", { id: "codex-skill" }),
    /native host/,
  );
  assert.doesNotMatch(
    JSON.stringify(project.hook("UserPromptSubmit", { prompt: "deploy" })),
    /SKILL\.md|Explicit only body/,
  );

  const taskId = createTask(project.repo, {
    title: "Deploy",
    scope: [nested + "/file.ts"],
  });
  project.write("docs/task.md", "# Task-specific deployment");
  for (const [id, source, value] of [
    ["project", "AGENTS.md", "test"],
    ["directory", nested + "/AGENTS.override.md", "preview"],
    ["task", "docs/task.md", "manual"],
  ]) {
    await project.run("set", {
      id,
      patch: {
        title: id,
        source,
        category: id === "task" ? "deployment" : "instruction",
        rule: { key: "target", value },
        ...(id === "task" && { taskId }),
      },
    });
  }
  const scoped = await project.run("context", { taskId });
  assert.deepEqual(
    scoped.instructions.map(({ source }) => source),
    ["AGENTS.md", nested + "/AGENTS.md", nested + "/AGENTS.override.md"],
  );
  assert.equal(
    scoped.instructions[1].shadowedBy,
    nested + "/AGENTS.override.md",
  );
  assert.equal(scoped.conflicts.length, 3);
  assert.equal(scoped.guidance.length, 1);
  const broad = createTask(project.repo, {
    title: "All game work",
    scope: ["game"],
  });
  assert.ok(
    (await project.run("context", { taskId: broad })).instructions.some(
      (instruction) => instruction.source === nested + "/AGENTS.override.md",
    ),
  );
  assert.equal(
    (await project.run("context", { path: nested })).guidance.length,
    0,
  );
  project.write(yaml, "policy: { allow_implicit_invocation: true }\n");
  const codexSkill = (await project.run("list", { query: "codex-skill" }))
    .entries[0];
  assert.equal(codexSkill.activation, "host-default");
  assert.equal(codexSkill.currentness, "stale");
});

test("CLI and MCP read the same scoped view; local memories and nested Git roots stay isolated", async () => {
  const project = fixture("interfaces"),
    other = fixture("private");
  project.write(runbook, original);
  await project.run("set", { id: "preview", patch: entry });
  project.write("package.json", '{ "name": "fixture" }');
  await project.run("set", {
    id: "package",
    patch: {
      title: "Package settings",
      category: "configuration",
      source: "package.json",
    },
  });
  assert.equal(
    (await project.run("list", { query: "package" })).entries[0].currentness,
    "current",
  );
  await assert.rejects(
    project.run("read", { id: "package" }),
    /project file reader/,
  );
  const cliRun = (...args) =>
    JSON.parse(
      execFileSync(process.execPath, [cli, "knowledge", ...args], {
        cwd: project.root,
        encoding: "utf8",
      }),
    );
  project.write(".gitignore", "private.json\n");
  project.write(
    "private.json",
    JSON.stringify({
      title: "Personal preference",
      category: "memory",
      summary: "keep this local",
    }),
  );
  cliRun("set", "--id", "personal", "--local", "--input", "private.json");
  assert.equal(
    cliRun("list", "--local", "--category", "memory").entries[0].visibility,
    "local",
  );
  assert.doesNotMatch(
    fs.readFileSync(path.join(project.root, ".dip-knowledge.json"), "utf8"),
    /keep this local/,
  );
  assert.equal(
    (await other.run("list", { includeLocal: true, category: "memory" })).total,
    0,
  );
  const child = path.join(project.root, "independent");
  fs.mkdirSync(child);
  git(child, ["init"]);
  await assert.rejects(
    project.run("context", { path: "independent" }),
    /another Git project/,
  );
  const cliContext = cliRun("context", "--path", world);
  const client = new Client({ name: "knowledge-test", version: "1" });
  try {
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: [cli, "mcp"],
        cwd: project.root,
        env: { ...process.env },
      }),
    );
    const result = await client.callTool({
      name: "project_knowledge_context",
      arguments: { path: world },
    });
    assert.deepEqual(JSON.parse(result.content[0].text), cliContext);
    const inventory = await client.callTool({
      name: "project_knowledge_list",
      arguments: { category: "memory" },
    });
    assert.equal(JSON.parse(inventory.content[0].text).total, 0);
  } finally {
    await client.close();
  }
});
