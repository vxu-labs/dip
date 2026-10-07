import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import libraryGit from "isomorphic-git";
import {
  ensure,
  Runtime,
  createTask,
  taskRead,
  project,
  append,
} from "../src/core.js";
import { execute } from "../src/actions.js";
import { portable } from "../src/portable.js";
import { repositoryIntegration } from "../src/repository-integration.js";
import { discoverClientProject } from "../src/client-discovery.js";
import { handleHook } from "../src/automation.js";
import { git, atomic } from "../src/util.js";
import { clearEventCache, eventCacheStats } from "../src/event-cache.js";
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "dip-low-friction-"));
Object.assign(process.env, {
  DIP_HOME: path.join(sandbox, "runtime"),
  DIP_USER_HOME: path.join(sandbox, "user"),
  DIP_GIT_CONFIG: path.join(sandbox, "gitconfig"),
  GIT_CONFIG_GLOBAL: path.join(sandbox, "gitconfig"),
  GIT_TRACE2_EVENT: "0",
});
const cli = fileURLToPath(new URL("../bin/dip.js", import.meta.url));
let serial = 0;
function fixture() {
  const root = path.join(sandbox, String(++serial));
  fs.mkdirSync(root);
  git(root, ["init", "-b", "main"]);
  return { root, repo: ensure(root) };
}
test.after(() => {
  assert.equal(path.dirname(sandbox), path.resolve(os.tmpdir()));
  assert.ok(path.basename(sandbox).startsWith("dip-low-friction-"));
  fs.rmSync(sandbox, { recursive: true, force: true });
});

test("reviewed follow-up adoption preserves prompt, updates intent and routes native plan/write/interrupt to the selected task", async () => {
  const f = fixture(),
    target = createTask(f.repo, {
      title: "CSV export",
      description: "Initial requirement",
      scope: ["src/export.js"],
    });
  const output = handleHook(
    {
      cwd: f.root,
      session_id: "s",
      turn_id: "followup",
      hook_event_name: "UserPromptSubmit",
      prompt: "Use Hebrew headers for the export",
    },
    "codex",
  );
  const source = JSON.parse(
    output.hookSpecificOutput.additionalContext,
  ).task_id;
  const args = {
    id: source,
    targetId: target,
    actor: "codex:s",
    session: "s",
    summary: "Same export requirement, updated headers",
    patch: {
      description: "Export with Hebrew headers",
      acceptance: ["UTF-8 output"],
      dependencies: [],
      scope: ["src/export.js", "test/export.js"],
    },
  };
  await execute("adopt", args, f.root);
  assert.equal(
    taskRead(f.repo, source).description,
    "Use Hebrew headers for the export",
  );
  assert.equal(taskRead(f.repo, source).status, "superseded");
  assert.deepEqual(taskRead(f.repo, source).resolution.replacedBy, [target]);
  const before = taskRead(f.repo, target).history.length;
  await execute("adopt", args, f.root);
  assert.equal(taskRead(f.repo, target).history.length, before);
  handleHook(
    {
      cwd: f.root,
      session_id: "s",
      tool_use_id: "plan",
      hook_event_name: "PostToolUse",
      tool_name: "update_plan",
      tool_input: { plan: [{ step: "UTF-8 headers", status: "completed" }] },
    },
    "codex",
  );
  assert.ok(taskRead(f.repo, target).plan);
  assert.equal(taskRead(f.repo, target).status, "backlog");
  await execute(
    "claim",
    { id: target, actor: "codex:s", session: "s" },
    f.root,
  );
  handleHook(
    { cwd: f.root, session_id: "s", hook_event_name: "Interrupt" },
    "codex",
  );
  assert.equal(taskRead(f.repo, target).status, "in_progress");
  assert.ok(taskRead(f.repo, target).checkpoints.length);
  const idea = await execute(
    "create",
    { title: "Future PDF export", actor: "codex:s" },
    f.root,
  );
  assert.equal(taskRead(f.repo, idea.id).status, "backlog");
  await execute(
    "plan",
    {
      id: target,
      actor: "codex:s",
      text: "Fallback plan without native planning tool",
    },
    f.root,
  );
  assert.equal(
    taskRead(f.repo, target).plan.input.text,
    "Fallback plan without native planning tool",
  );
});
test("adoption rejects developed sources, foreign owners, unrelated sessions and invalid patches before mutating either requirement", async () => {
  const f = fixture(),
    target = createTask(f.repo, { title: "Target" }),
    source = createTask(f.repo, { title: "Followup", source: "prompt" }),
    rt = new Runtime();
  const args = {
    id: source,
    targetId: target,
    actor: "qa",
    session: "s",
    summary: "Reviewed",
  };
  const counts = () => [
    taskRead(f.repo, target).history.length,
    taskRead(f.repo, source).history.length,
  ];
  try {
    const lease = rt.claim(f.repo, target, "other", 120000, []),
      before = counts();
    await assert.rejects(execute("adopt", args, f.root), /owned/);
    assert.deepEqual(counts(), before);
    rt.release(f.repo, target, lease.token);
    await assert.rejects(
      execute("adopt", { ...args, patch: { status: "verified" } }, f.root),
      /intent only/,
    );
    assert.deepEqual(counts(), before);
    rt.setSession(f.repo, "s", source, "other");
    await assert.rejects(execute("adopt", args, f.root), /Session belongs/);
    assert.deepEqual(counts(), before);
    rt.setSession(f.repo, "s", source, "qa");
    await execute(
      "update",
      { id: source, actor: "qa", patch: { scope: ["src"] } },
      f.root,
    );
    await assert.rejects(execute("adopt", args, f.root), /before development/);
  } finally {
    rt.close();
  }
});
test("CLI kind sugar classifies questions and genuine stdio MCP exposes adoption", async () => {
  const f = fixture(),
    id = createTask(f.repo, { title: "Question" });
  execFileSync(
    process.execPath,
    [
      cli,
      "task",
      "update",
      "--root",
      f.root,
      "--id",
      id,
      "--kind",
      "discussion",
    ],
    { env: process.env, windowsHide: true, stdio: "pipe" },
  );
  assert.equal(taskRead(f.repo, id).kind, "discussion");
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js"),
    { StdioClientTransport } =
      await import("@modelcontextprotocol/sdk/client/stdio.js");
  const client = new Client({ name: "qa", version: "1" });
  try {
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: ["--disable-warning=ExperimentalWarning", cli, "mcp"],
        env: process.env,
        stderr: "pipe",
      }),
    );
    assert.ok(
      (await client.listTools()).tools.some((t) => t.name === "task_adopt"),
    );
    const source = createTask(f.repo, {
      title: "Another question",
      source: "prompt",
    });
    const result = await client.callTool({
      name: "task_adopt",
      arguments: {
        root: f.root,
        id: source,
        targetId: id,
        actor: "qa",
        session: "mcp",
        summary: "Same informational question",
      },
    });
    assert.ok(!result.isError);
    assert.equal(taskRead(f.repo, source).status, "superseded");
  } finally {
    await client.close();
  }
});
test("fresh clone portable helper persists future idea, plan and handoff with no global executable or runtime", () => {
  const f = fixture(),
    clone = path.join(sandbox, String(++serial));
  git(f.root, ["config", "user.name", "QA"]);
  git(f.root, ["config", "user.email", "qa@example.invalid"]);
  git(f.root, ["add", "."]);
  git(f.root, [
    "-c",
    "core.hooksPath=empty-hooks",
    "commit",
    "-m",
    "Portable seed",
  ]);
  git(sandbox, ["clone", f.root, clone]);
  const script = path.join(clone, ".dip", "tools", "portable.mjs"),
    isolated = path.join(sandbox, "absent-runtime");
  const run = (args) =>
    JSON.parse(
      execFileSync(process.execPath, [script, ...args], {
        cwd: clone,
        env: { ...process.env, PATH: "", DIP_HOME: isolated },
        encoding: "utf8",
        windowsHide: true,
      }),
    );
  assert.equal(run(["list"]).total, 0);
  const { id } = run(["create", "--title", "Future multilingual export"]);
  run(["plan", "--id", id, "--text", "Implement later"]);
  run([
    "checkpoint",
    "--id",
    id,
    "--summary",
    "Unstarted",
    "--next",
    "Review requirements",
  ]);
  assert.equal(run(["get", "--id", id]).status, "backlog");
  assert.ok(!fs.existsSync(isolated));
  const actual = taskRead(ensure(clone, { instructions: false }), id);
  assert.equal(actual.plan.input.text, "Implement later");
  assert.equal(actual.checkpoints[0].next, "Review requirements");
  assert.throws(
    () => portable("update", { id, patch: { status: "verified" } }, clone),
    /cannot assert verified/,
  );
});
test("portable events merge causally through real Git branches, conflicts require reviewed resolve and corrupt history blocks writes", () => {
  const f = fixture(),
    id = portable("create", { title: "Shared future idea" }, f.root).id;
  git(f.root, ["config", "user.name", "QA"]);
  git(f.root, ["config", "user.email", "qa@example.invalid"]);
  const commit = (message) => {
    git(f.root, ["add", "."]);
    git(f.root, ["-c", "core.hooksPath=empty-hooks", "commit", "-m", message]);
  };
  commit("Seed");
  git(f.root, ["checkout", "-b", "left"]);
  portable(
    "update",
    { id, patch: { description: "Left requirement" } },
    f.root,
  );
  commit("Left");
  git(f.root, ["checkout", "main"]);
  portable(
    "update",
    { id, patch: { description: "Right requirement" } },
    f.root,
  );
  commit("Right");
  git(f.root, [
    "-c",
    "core.hooksPath=empty-hooks",
    "merge",
    "left",
    "--no-edit",
  ]);
  assert.equal(
    taskRead(ensure(f.root, { instructions: false }), id).status,
    "conflict",
  );
  assert.equal(portable("get", { id }, f.root).status, "conflict");
  assert.throws(
    () => portable("checkpoint", { id, summary: "Should not proceed" }, f.root),
    /Resolve competing/,
  );
  portable(
    "resolve",
    { id, patch: { description: "Reviewed combined requirement" } },
    f.root,
  );
  assert.equal(
    taskRead(f.repo, id).description,
    "Reviewed combined requirement",
  );
  assert.equal(taskRead(f.repo, id).conflicts.length, 0);
  const corrupt = path.join(f.repo.dir, "events", id, "corrupt.json");
  fs.writeFileSync(corrupt, "{broken");
  assert.throws(
    () => portable("plan", { id, text: "Must fail" }, f.root),
    /Corrupt task history/,
  );
  assert.equal(portable("list", {}, f.root).errors.length, 1);
  assert.throws(() => taskRead(f.repo, id), /corrupt events/);
});
test("repository integration preserves foreign/edited skills, upgrades owned files and supports opt-out removal", async (t) => {
  const f = fixture(),
    edited = path.join(f.root, ".agents", "skills", "dip", "SKILL.md");
  fs.appendFileSync(edited, "\nUser policy\n");
  const result = repositoryIntegration(f.repo);
  assert.ok(result.preserved.includes(".agents/skills/dip/SKILL.md"));
  const before = fs.readFileSync(edited, "utf8");
  await execute("repository", { remove: true }, f.root);
  ensure(f.root);
  assert.equal(fs.readFileSync(edited, "utf8"), before);
  assert.ok(!fs.existsSync(path.join(f.root, ".dip", "tools", "portable.mjs")));
  await execute("repository", {}, f.root);
  assert.ok(fs.existsSync(path.join(f.root, ".dip", "tools", "portable.mjs")));
  const g = fixture();
  fs.writeFileSync(
    path.join(g.root, ".claude", "skills", "dip", "SKILL.md"),
    "foreign skill",
  );
  const manifest = JSON.parse(
    fs.readFileSync(path.join(g.repo.dir, "integration.json")),
  );
  delete manifest.files[".claude/skills/dip/SKILL.md"];
  atomic(path.join(g.repo.dir, "integration.json"), manifest);
  assert.ok(
    repositoryIntegration(g.repo).preserved.includes(
      ".claude/skills/dip/SKILL.md",
    ),
  );
  const strict = fixture();
  atomic(path.join(strict.repo.dir, "config.json"), {
    ...strict.repo.config,
    mode: "strict",
  });
  assert.equal(portable("list", {}, strict.root).total, 0);
  assert.throws(
    () => portable("create", { title: "Must claim" }, strict.root),
    /Strict mode/,
  );
  const linked = fixture(),
    foreign = path.join(linked.root, ".agents", "skills", "dip", "SKILL.md");
  fs.unlinkSync(foreign);
  try {
    fs.symlinkSync(
      path.join(linked.root, "missing-user-file"),
      foreign,
      "file",
    );
  } catch (e) {
    if (!["EPERM", "EACCES"].includes(e.code)) throw e;
    t.diagnostic(
      "OS denied symbolic-link creation; dangling-link case runs on POSIX CI",
    );
    return;
  }
  assert.throws(() => repositoryIntegration(linked.repo), /symbolic links/);
  assert.ok(fs.lstatSync(foreign).isSymbolicLink());
});
test("warm event reads invalidate externally changed or corrupt history, branch checkout and cache deletion without blocking ownership", () => {
  const f = fixture(),
    id = createTask(f.repo, { title: "Initial" });
  clearEventCache();
  const first = taskRead(f.repo, id),
    stats = eventCacheStats();
  assert.equal(stats.reads, 1);
  first.title = "Caller mutation";
  first.history[0].payload.title = "Mutated history";
  assert.equal(taskRead(f.repo, id).title, "Initial");
  assert.ok(eventCacheStats().hits > 0);
  const event = taskRead(f.repo, id).history[0],
    file = path.join(f.repo.dir, "events", id, event.eventId + ".json");
  fs.writeFileSync(
    file,
    JSON.stringify({
      ...event,
      payload: { ...event.payload, title: "Changed externally" },
    }),
  );
  assert.equal(taskRead(f.repo, id).title, "Changed externally");
  fs.writeFileSync(file, "{bad");
  assert.throws(() => taskRead(f.repo, id), /corrupt events/);
  fs.writeFileSync(file, JSON.stringify(event));
  assert.equal(taskRead(f.repo, id).title, "Initial");
  const other = fixture();
  assert.equal(
    project(other.repo, null, null, { includeActivity: false }).tasks.length,
    0,
  );
  const rt = new Runtime();
  try {
    clearEventCache();
    assert.ok(rt.claim(f.repo, id, "qa", 120000, []).token);
  } finally {
    rt.close();
  }
});
test("explicit isomorphic-git client callback adopts an unmonitored repository without native trace; probes and disabled/unsupported paths never initialize", async () => {
  const root = path.join(sandbox, String(++serial));
  fs.mkdirSync(root);
  await libraryGit.init({ fs, dir: root, defaultBranch: "main" });
  fs.writeFileSync(path.join(root, "answer.js"), "export const answer = 42;\n");
  const before = await libraryGit.statusMatrix({
      fs,
      dir: root,
      filepaths: ["answer.js"],
    }),
    config = fs.readFileSync(path.join(root, ".git", "config"), "utf8");
  assert.equal(
    discoverClientProject(root, { client: "isomorphic-git", enabled: false })
      .reason,
    "adapter_disabled",
  );
  assert.ok(!fs.existsSync(path.join(root, ".dip")));
  assert.equal(
    discoverClientProject(root, { client: "isomorphic-git", probe: true })
      .hasLedger,
    false,
  );
  assert.ok(!fs.existsSync(path.join(root, ".dip")));
  const nested = path.join(root, "nested");
  fs.mkdirSync(nested);
  const result = JSON.parse(
    execFileSync(
      process.execPath,
      [cli, "discover-project", "--client", "isomorphic-git", "--root", nested],
      { env: process.env, encoding: "utf8", windowsHide: true },
    ),
  );
  assert.equal(result.initialized, true);
  assert.equal(result.nativeTraceRequired, false);
  assert.deepEqual(
    await libraryGit.statusMatrix({ fs, dir: root, filepaths: ["answer.js"] }),
    before,
  );
  assert.equal(
    fs.readFileSync(path.join(root, ".git", "config"), "utf8"),
    config,
  );
  assert.ok(
    project(ensure(root, { instructions: false })).activity.some(
      (r) => r.kind === "client.discovered" && r.client === "isomorphic-git",
    ),
  );
  const bare = path.join(sandbox, String(++serial));
  fs.mkdirSync(bare);
  await libraryGit.init({ fs, dir: bare, bare: true });
  assert.equal(
    discoverClientProject(bare, { client: "isomorphic-git" }).reason,
    "no_local_worktree_context",
  );
  assert.ok(!fs.existsSync(path.join(bare, ".dip")));
  assert.throws(
    () => discoverClientProject(root, { client: "bad client" }),
    /identifier/,
  );
  git(root, ["config", "user.name", "QA"]);
  git(root, ["config", "user.email", "qa@example.invalid"]);
  git(root, ["add", "."]);
  git(root, [
    "-c",
    "core.hooksPath=empty-hooks",
    "commit",
    "-m",
    "Client seed",
  ]);
  const linked = path.join(sandbox, String(++serial));
  git(root, [
    "-c",
    "core.hooksPath=empty-hooks",
    "worktree",
    "add",
    "-b",
    "client-worktree",
    linked,
  ]);
  const probe = discoverClientProject(linked, {
    client: "isomorphic-git",
    probe: true,
  });
  assert.equal(probe.supported, true);
  assert.equal(
    fs.realpathSync.native(probe.root),
    fs.realpathSync.native(linked),
  );
  const adopted = discoverClientProject(linked, { client: "isomorphic-git" });
  assert.equal(adopted.adopted, true);
});
