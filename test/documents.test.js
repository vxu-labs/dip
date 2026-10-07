import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { ensure, createTask, append, project, Runtime } from "../src/core.js";
import { execute } from "../src/actions.js";
import { handleHook } from "../src/automation.js";
import { git, atomic, digest } from "../src/util.js";
import { documentMutations } from "../src/documents.js";

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "dip-documents-"));
process.env.DIP_HOME = path.join(sandbox, "runtime");
process.env.DIP_USER_HOME = path.join(sandbox, "user");
process.env.DIP_GIT_CONFIG = path.join(sandbox, "gitconfig");
process.env.GIT_CONFIG_GLOBAL = process.env.DIP_GIT_CONFIG;
const cli = fileURLToPath(new URL("../bin/dip.js", import.meta.url));
let serial = 0;
function fixture() {
  const root = path.join(sandbox, String(++serial));
  fs.mkdirSync(root);
  git(root, ["init", "-b", "main"]);
  const repo = ensure(root),
    actor = "codex:docs",
    session = "docs";
  const hook = (data) =>
    handleHook({ cwd: root, session_id: session, ...data }, "codex");
  const result = hook({
    hook_event_name: "UserPromptSubmit",
    prompt: "Build Unicode export",
  });
  const id = JSON.parse(result.hookSpecificOutput.additionalContext).task_id;
  const write = (name, text) => {
    const file = path.join(root, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  };
  const run = (action, args = {}) =>
    execute(action, { id, actor, ...args }, root);
  return { root, repo, actor, id, hook, write, run };
}
test.after(() => {
  assert.ok(sandbox.startsWith(path.join(os.tmpdir(), "dip-documents-")));
  fs.rmSync(sandbox, { recursive: true, force: true });
});

test("supported successful writes persist only metadata and repeated post events are harmless", async () => {
  const f = fixture();
  const call = {
    tool_name: "Write",
    tool_use_id: "write-plan",
    tool_input: {
      file_path: path.join(f.root, "PLAN.md"),
      content: "# Plan\nUnique prose must not enter the ledger",
    },
  };
  f.hook({ ...call, hook_event_name: "PreToolUse" });
  f.write("PLAN.md", call.tool_input.content);
  f.hook({
    ...call,
    hook_event_name: "PostToolUse",
    tool_response: { success: true },
  });
  f.hook({ ...call, hook_event_name: "PostToolUse" });
  const task = project(f.repo).tasks[0];
  assert.equal(task.documents.length, 1);
  assert.equal(task.documents[0].role, "plan");
  assert.equal(task.documents[0].hash, digest(call.tool_input.content));
  assert.equal(
    task.history.filter((e) => e.type === "task.document").length,
    1,
  );
  assert.ok(
    !JSON.stringify(task.history).includes(
      "Unique prose must not enter the ledger",
    ),
  );
  assert.equal(
    (await f.run("document-list")).documents[0].currentness,
    "current",
  );
  assert.equal(task.plan, null);
});

test("failed, absent-pre, shell and filesystem-only writes do not invent document ownership", async () => {
  const f = fixture();
  f.write("plan.md", "# Plan\nunfinished");
  f.hook({
    hook_event_name: "PostToolUse",
    tool_name: "Write",
    tool_use_id: "no-pre",
    tool_input: { file_path: "plan.md" },
  });
  for (const [i, event, response] of [
    [1, "PostToolUse", { isError: true }],
    [2, "PostToolUseFailure", {}],
    [3, "PostToolUse", { exit_code: 1 }],
  ]) {
    const call = {
      tool_name: "Write",
      tool_use_id: String(i),
      tool_input: { file_path: "plan.md" },
    };
    f.hook({ ...call, hook_event_name: "PreToolUse" });
    f.hook({ ...call, hook_event_name: event, tool_response: response });
  }
  const shell = {
    tool_name: "exec_command",
    tool_use_id: "shell",
    tool_input: { cmd: "echo pretend > plan.md" },
  };
  f.hook({ ...shell, hook_event_name: "PreToolUse" });
  f.hook({
    ...shell,
    hook_event_name: "PostToolUse",
    tool_response: { exit_code: 0 },
  });
  assert.equal(project(f.repo).tasks[0].documents.length, 0);
  await f.run("document-link", { path: "plan.md", role: "plan" });
  assert.equal(project(f.repo).tasks[0].documents.length, 1);
});

test("late asynchronous post links to its pre-tool task across prompt changes and runtime restart", async () => {
  const f = fixture();
  const call = {
    tool_name: "Edit",
    tool_use_id: "late",
    tool_input: { file_path: "design.md" },
  };
  f.hook({ ...call, hook_event_name: "PreToolUse" });
  f.write("design.md", "# Design\nReviewed design");
  const next = f.hook({
    hook_event_name: "UserPromptSubmit",
    prompt: "A separate future idea",
  });
  const nextId = JSON.parse(next.hookSpecificOutput.additionalContext).task_id;
  f.hook({ ...call, hook_event_name: "PostToolUse" });
  const tasks = project(f.repo).tasks;
  assert.equal(tasks.find((t) => t.id === f.id).documents.length, 1);
  assert.equal(tasks.find((t) => t.id === nextId).documents.length, 0);
});

test("patch rename preserves role, removes the old reference and deletion stays visibly missing", async () => {
  const f = fixture();
  f.write("plan.md", "# Plan\nFirst");
  await f.run("document-link", { path: "plan.md", role: "plan" });
  const patch =
    "*** Begin Patch\n*** Update File: plan.md\n*** Move to: renamed.md\n@@\n-First\n+Second\n*** End Patch";
  const call = {
    tool_name: "functions.apply_patch",
    tool_use_id: "move",
    tool_input: patch,
  };
  f.hook({ ...call, hook_event_name: "PreToolUse" });
  fs.renameSync(path.join(f.root, "plan.md"), path.join(f.root, "renamed.md"));
  f.write("renamed.md", "# Plan\nSecond");
  f.hook({ ...call, hook_event_name: "PostToolUse" });
  const docs = (await f.run("document-list")).documents;
  assert.deepEqual(
    docs.map((d) => [d.path, d.role]),
    [["renamed.md", "plan"]],
  );
  fs.unlinkSync(path.join(f.root, "renamed.md"));
  assert.equal(
    (await f.run("document-list")).documents[0].currentness,
    "missing",
  );
});

test("section selection handles fenced headings, nested and setext headings, Hebrew and bounded continuation", async () => {
  const f = fixture();
  const body =
    "# Feature\nOverview\n## Implementation\nDo the work\n```md\n# fake heading\n```\n## בדיקות\nלבדוק יוניקוד\n### Cases\nHebrew CSV\nSetext\n------\n" +
    "x".repeat(1500);
  f.write("plan.md", body);
  await f.run("document-link", { path: "plan.md", role: "plan" });
  const query = await f.run("document-read", {
    path: "plan.md",
    role: "plan",
    query: "יוניקוד",
  });
  assert.equal(query.sections[0].heading, "בדיקות");
  assert.equal(query.selection, "lexical");
  assert.ok(!query.outline.some((s) => s.heading === "fake heading"));
  assert.equal(
    (
      await f.run("document-read", {
        path: "plan.md",
        role: "plan",
        heading: "בדיקות",
      })
    ).sections.length,
    2,
  );
  const a = await f.run("document-read", {
    path: "plan.md",
    role: "plan",
    heading: "Setext",
    maxChars: 200,
  });
  assert.equal(a.sections[0].text.length, 200);
  assert.equal(a.sections[0].truncated, true);
  const b = await f.run("document-read", {
    path: "plan.md",
    role: "plan",
    heading: "Setext",
    maxChars: 200,
    ...a.continuation,
  });
  assert.equal(b.sections[0].startChar, 200);
  assert.equal(b.sections[0].text, "x".repeat(200));
  assert.equal(
    (
      await f.run("document-read", {
        path: "plan.md",
        role: "plan",
        query: "doesnotexist",
      })
    ).sections.length,
    0,
  );
  await assert.rejects(
    f.run("document-read", { path: "plan.md", role: "plan", maxChars: 10 }),
    /maxChars/,
  );
  assert.equal(query.untrustedContent, true);
});

test("stale content and external renames stay explicit until reviewed relink/unlink", async () => {
  const f = fixture();
  f.write("plan.md", "# Plan\nOriginal");
  const ref = await f.run("document-link", { path: "plan.md", role: "plan" });
  f.write("plan.md", "# Plan\nRevised");
  const read = await f.run("document-read", { path: "plan.md", role: "plan" });
  assert.equal(read.currentness, "stale");
  assert.equal(read.recordedHash, ref.hash);
  assert.ok(read.sections[0].text.includes("Revised"));
  await assert.rejects(
    f.run("document-read", {
      path: "plan.md",
      role: "plan",
      expectedHash: ref.hash,
    }),
    /version changed/,
  );
  await f.run("document-link", { path: "plan.md", role: "plan" });
  fs.renameSync(path.join(f.root, "plan.md"), path.join(f.root, "new.md"));
  assert.equal(
    (await f.run("document-list")).documents[0].currentness,
    "missing",
  );
  await f.run("document-link", { path: "new.md", role: "plan" });
  await f.run("document-unlink", { path: "plan.md", role: "plan" });
  assert.equal((await f.run("document-list")).documents[0].path, "new.md");
});

test("many-to-many links paginate and idempotent linking does not duplicate events", async () => {
  const f = fixture();
  f.write("shared.md", "# Shared\nText");
  const other = createTask(f.repo, { title: "Another task" });
  await f.run("document-link", { path: "shared.md", role: "plan" });
  assert.equal(
    (await f.run("document-link", { path: "shared.md", role: "plan" }))
      .unchanged,
    true,
  );
  await f.run("document-link", { path: "shared.md", role: "spec" });
  await f.run("document-link", { id: other, path: "shared.md", role: "plan" });
  const first = await f.run("document-list", { limit: 1 });
  assert.equal(first.total, 2);
  assert.equal(first.nextOffset, 1);
  assert.equal(
    (await f.run("document-list", { offset: 1, limit: 1 })).documents.length,
    1,
  );
  await assert.rejects(
    f.run("document-read", { path: "unlinked.md" }),
    /reference not found/,
  );
});

test("concurrent versions and removal are visible; reviewed relink causally resolves them", async () => {
  const f = fixture();
  f.write("plan.md", "# Current");
  const parent = project(f.repo).tasks[0].heads;
  const payload = {
    path: "plan.md",
    role: "plan",
    bytes: 9,
    hash: digest("old"),
  };
  append(f.repo, f.id, "task.document", payload, { parents: parent });
  append(
    f.repo,
    f.id,
    "task.document",
    { path: "plan.md", role: "plan", removed: true },
    { parents: parent },
  );
  assert.equal(
    (await f.run("document-list")).documents[0].currentness,
    "conflict",
  );
  await assert.rejects(
    f.run("document-read", { path: "plan.md", role: "plan" }),
    /competing/,
  );
  await f.run("document-link", { path: "plan.md", role: "plan" });
  assert.equal(
    (await f.run("document-list")).documents[0].currentness,
    "current",
  );
});

test("unsafe, oversized, binary, symlink and ignored-area files cannot be linked", async (t) => {
  const f = fixture();
  for (const name of [
    "../outside.md",
    ".dip/secret.md",
    "node_modules/plan.md",
    "plan.md:stream.md",
    ".env/plan.md",
  ]) {
    await assert.rejects(f.run("document-link", { path: name }), /Document/);
  }
  f.write("huge.md", "x".repeat(1024 * 1024 + 1));
  await assert.rejects(f.run("document-link", { path: "huge.md" }), /1 MiB/);
  fs.writeFileSync(path.join(f.root, "binary.md"), Buffer.from([0xff, 0, 1]));
  await assert.rejects(f.run("document-link", { path: "binary.md" }));
  f.write("good.md", "# Good");
  try {
    fs.symlinkSync(path.join(f.root, "good.md"), path.join(f.root, "link.md"));
  } catch (e) {
    if (!["EPERM", "EACCES"].includes(e.code)) throw e;
    t.diagnostic(
      "OS denied symlink creation; other unsafe-path cases were tested",
    );
    return;
  }
  await assert.rejects(f.run("document-link", { path: "link.md" }), /symlink/);
});

test("configured verification is invalidated by linked content outside task scope, without accepting Markdown checkboxes", async () => {
  const f = fixture();
  f.write("source.js", "export const ok = true;");
  await f.run("update", { patch: { scope: ["source.js"] } });
  f.write("plan.md", "# Plan\n- [x] complete");
  await f.run("document-link", { path: "plan.md", role: "plan" });
  assert.notEqual(project(f.repo).tasks[0].status, "verified");
  f.repo.config.verification.pass = {
    command: [process.execPath, "-e", "process.exit(0)"],
  };
  atomic(path.join(f.repo.dir, "config.json"), f.repo.config);
  assert.equal((await f.run("verify", { check: "pass" })).passed, true);
  f.write("plan.md", "# Plan\nNew requirement");
  assert.equal((await f.run("reconcile")).tasks[0].verification, "stale");
  await assert.rejects(f.run("verify", { check: "pass" }), /relink/);
  await f.run("document-link", { path: "plan.md", role: "plan" });
  assert.equal((await f.run("verify", { check: "pass" })).passed, true);
});

test("linked ignored-file mutation during a successful check fails evidence", async () => {
  const f = fixture();
  f.write(".gitignore", "ignored-plan.md\n");
  f.write("ignored-plan.md", "# Plan\nBefore");
  await f.run("document-link", { path: "ignored-plan.md", role: "plan" });
  f.repo.config.verification.mutate = {
    command: [
      process.execPath,
      "-e",
      "require('node:fs').writeFileSync('ignored-plan.md','# Changed');",
    ],
  };
  atomic(path.join(f.repo.dir, "config.json"), f.repo.config);
  const result = await f.run("verify", { check: "mutate" });
  assert.equal(result.changedDuringCheck, false);
  assert.equal(result.changedIntentDuringCheck, true);
  assert.equal(result.passed, false);
});

test("MCP and CLI transport expose the same compact source references and bounded sections", async () => {
  const f = fixture();
  f.write("plan.md", "# Plan\n## QA\nCheck Hebrew CSV");
  const client = new Client({ name: "document-test", version: "1" });
  try {
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: [cli, "mcp"],
        cwd: f.root,
        env: { ...process.env },
      }),
    );
    const list = await client.listTools();
    assert.ok(list.tools.some((t) => t.name === "task_document_read"));
    const linked = await client.callTool({
      name: "task_document_link",
      arguments: {
        root: f.root,
        id: f.id,
        path: "plan.md",
        role: "plan",
        actor: f.actor,
      },
    });
    assert.ok(!linked.isError);
    const read = await client.callTool({
      name: "task_document_read",
      arguments: {
        root: f.root,
        id: f.id,
        path: "plan.md",
        role: "plan",
        heading: "QA",
      },
    });
    assert.equal(JSON.parse(read.content[0].text).sections[0].heading, "QA");
    const get = await client.callTool({
      name: "task_get",
      arguments: { root: f.root, id: f.id },
    });
    assert.equal(JSON.parse(get.content[0].text).documents.length, 1);
    assert.ok(!get.content[0].text.includes("Check Hebrew CSV"));
    const cliRead = JSON.parse(
      execFileSync(
        process.execPath,
        [
          cli,
          "task",
          "document-read",
          "--root",
          f.root,
          "--id",
          f.id,
          "--path",
          "plan.md",
          "--role",
          "plan",
          "--heading",
          "QA",
        ],
        { encoding: "utf8", windowsHide: true },
      ),
    );
    assert.equal(cliRead.sections[0].heading, "QA");
  } finally {
    await client.close();
  }
});

test("patch schemas support named and freeform paths without parsing arbitrary command bodies", () => {
  assert.deepEqual(
    documentMutations("functions.apply_patch", {
      input: "*** Add File: PLAN.md\n+plan",
    }),
    [{ path: "PLAN.md", removed: false }],
  );
  assert.deepEqual(
    documentMutations("Bash", { command: "*** Add File: PLAN.md" }),
    [],
  );
});

test("standalone document CLI reads and linking are intent operations, preserving future backlog", () => {
  const f = fixture();
  for (const action of [
    "document-link",
    "document-unlink",
    "document-list",
    "document-read",
  ]) {
    f.hook({
      hook_event_name: "PreToolUse",
      tool_name: "PowerShell",
      tool_input: {
        command: `dip task ${action} --id ${f.id} --path PLAN.md --role plan`,
      },
    });
    assert.equal(project(f.repo).tasks[0].status, "backlog");
  }
});

test("checkout-root aliases preserve document attribution and scope without allowing document symlinks", async () => {
  const f = fixture(),
    alias = f.root + "-alias";
  fs.symlinkSync(
    f.root,
    alias,
    process.platform === "win32" ? "junction" : "dir",
  );
  const call = {
    cwd: alias,
    tool_name: "Write",
    tool_use_id: "alias",
    tool_input: { file_path: path.join(alias, "PLAN.md") },
  };
  f.hook({ ...call, hook_event_name: "PreToolUse" });
  f.write("PLAN.md", "# Plan\n## Validation\nRoot alias works");
  f.hook({ ...call, hook_event_name: "PostToolUse" });
  const task = project(f.repo).tasks[0];
  assert.ok(task.scope.includes("PLAN.md"));
  assert.equal(task.documents[0].path, "PLAN.md");
  assert.equal(
    (
      await f.run("document-read", {
        path: path.join(alias, "PLAN.md"),
        role: "plan",
        heading: "Validation",
      })
    ).sections[0].heading,
    "Validation",
  );
  fs.mkdirSync(path.join(f.root, "actual"));
  fs.writeFileSync(path.join(f.root, "actual", "bad.md"), "# Indirect");
  fs.symlinkSync(
    path.join(f.root, "actual"),
    path.join(f.root, "indirect"),
    process.platform === "win32" ? "junction" : "dir",
  );
  await assert.rejects(
    f.run("document-link", { path: path.join(alias, "indirect", "bad.md") }),
    /symlink/,
  );
});
