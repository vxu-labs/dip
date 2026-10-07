import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execute } from "../src/actions.js";
import { ensure, Runtime, taskRead } from "../src/core.js";
import { git } from "../src/util.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "dip-prepare-"));
Object.assign(process.env, {
  DIP_HOME: path.join(sandbox, "runtime"),
  DIP_USER_HOME: path.join(sandbox, "user"),
  GIT_CONFIG_GLOBAL: path.join(sandbox, "gitconfig"),
  DIP_GIT_CONFIG: path.join(sandbox, "gitconfig"),
  GIT_TRACE2_EVENT: "0",
});
test.after(() => {
  assert.equal(path.dirname(sandbox), path.resolve(os.tmpdir()));
  assert.ok(path.basename(sandbox).startsWith("dip-prepare-"));
  fs.rmSync(sandbox, { recursive: true, force: true });
});
async function fixture(name) {
  const root = path.join(sandbox, name);
  fs.mkdirSync(root);
  git(root, ["init", "-b", "main"]);
  const { id } = await execute(
    "create",
    { title: "Captured requirement", scope: ["lib.mjs"] },
    root,
  );
  return { root, id, repo: ensure(root) };
}

test("prepare refines and claims once, returns bounded criteria and rebinds the session; repeat preserves intent", async () => {
  const { root, id, repo } = await fixture("repeat");
  const args = {
    id,
    actor: "codex:session",
    session: "session",
    patch: {
      title: "Implement CSV",
      description: "Support ordering",
      acceptance: ["Empty input works"],
      scope: ["csv.mjs"],
    },
  };
  const first = await execute("prepare", args, root);
  assert.equal(first.task.status, "in_progress");
  assert.deepEqual(first.task.acceptance, args.patch.acceptance);
  assert.equal(first.task.history, undefined);
  assert.equal(first.lease.actor, args.actor);
  const history = taskRead(repo, id).history.length;
  const repeat = await execute("prepare", args, root);
  assert.equal(repeat.lease.token, first.lease.token);
  assert.equal(taskRead(repo, id).history.length, history);
  const rt = new Runtime();
  try {
    assert.equal(
      rt.db
        .prepare("SELECT task FROM sessions WHERE repo=? AND session=?")
        .get(repo.key, "session").task,
      id,
    );
  } finally {
    rt.close();
  }
});

test("foreign ownership, invalid patches, blockers and discussion leave intent and ownership unchanged", async () => {
  const { root, id, repo } = await fixture("guards");
  const other = await execute(
    "create",
    { title: "Owner", scope: ["busy.mjs"] },
    root,
  );
  await execute("claim", { id: other.id, actor: "other" }, root);
  const before = taskRead(repo, id).history.length;
  const base = { id, actor: "codex:session", session: "session" };
  await assert.rejects(
    execute(
      "prepare",
      { ...base, patch: { title: "Changed", scope: ["busy.mjs"] } },
      root,
    ),
    /Scope owned/,
  );
  await assert.rejects(
    execute("prepare", { ...base, patch: { scope: ["../outside"] } }, root),
    /relative/,
  );
  await assert.rejects(
    execute("prepare", { ...base, patch: { status: "verified" } }, root),
    /supports/,
  );
  await assert.rejects(
    execute("prepare", { ...base, patch: { acceptance: [7] } }, root),
    /strings/,
  );
  assert.equal(taskRead(repo, id).history.length, before);
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
  await execute("update", { id, patch: { dependencies: [other.id] } }, root);
  await assert.rejects(execute("prepare", base, root), /blockers/);
  const idea = await execute(
    "create",
    { title: "Question", kind: "discussion" },
    root,
  );
  await assert.rejects(
    execute("prepare", { ...base, id: idea.id }, root),
    /outstanding development/,
  );
  assert.equal(taskRead(repo, idea.id).status, "backlog");
});

test("real stdio MCP exposes prepare and validates unknown fields before intent mutation", async () => {
  const { root, id, repo } = await fixture("transport");
  const client = new Client({ name: "prepare-qa", version: "1" });
  try {
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: [
          "--disable-warning=ExperimentalWarning",
          path.resolve("bin/dip.js"),
          "mcp",
        ],
        env: Object.fromEntries(
          Object.entries(process.env).filter(
            ([, value]) => typeof value === "string",
          ),
        ),
        stderr: "pipe",
        cwd: root,
      }),
    );
    assert.ok(
      (await client.listTools()).tools.some((t) => t.name === "task_prepare"),
    );
    const invalid = await client.callTool({
      name: "task_prepare",
      arguments: {
        root,
        id,
        actor: "codex:transport",
        session: "transport",
        patch: { status: "verified" },
      },
    });
    assert.equal(invalid.isError, true);
    assert.equal(taskRead(repo, id).status, "backlog");
    const result = await client.callTool({
      name: "task_prepare",
      arguments: {
        root,
        id,
        actor: "codex:transport",
        session: "transport",
        patch: { acceptance: ["Regression checked"] },
      },
    });
    assert.equal(result.isError, undefined);
    assert.equal(JSON.parse(result.content[0].text).task.status, "in_progress");
  } finally {
    await client.close();
  }
});
