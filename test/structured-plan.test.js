import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { execute } from "../src/actions.js";
import { ensure, Runtime, taskRead } from "../src/core.js";
import { git, atomic } from "../src/util.js";

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "dip-structured-plan-"));
Object.assign(process.env, {
  DIP_HOME: path.join(sandbox, "runtime"),
  DIP_USER_HOME: path.join(sandbox, "user"),
  DIP_GIT_CONFIG: path.join(sandbox, "gitconfig"),
  GIT_CONFIG_GLOBAL: path.join(sandbox, "gitconfig"),
  GIT_TRACE2_EVENT: "0",
});
const cli = path.resolve("bin/dip.js");
const steps = [
  "Define CSV contract",
  "Implement quoting",
  "Verify empty output",
].map((step) => ({ step, status: "pending" }));
test.after(() => {
  assert.equal(path.dirname(sandbox), path.resolve(os.tmpdir()));
  assert.ok(path.basename(sandbox).startsWith("dip-structured-plan-"));
  fs.rmSync(sandbox, { recursive: true, force: true });
});
async function fixture(name) {
  const root = path.join(sandbox, name);
  fs.mkdirSync(root);
  git(root, ["init", "-b", "main"]);
  const repo = ensure(root);
  repo.config.verification.stage = {
    command: [process.execPath, "-e", "process.exit(0)"],
  };
  atomic(path.join(repo.dir, "config.json"), repo.config);
  const { id } = await execute("create", { title: "Future CSV" }, root);
  return {
    root,
    repo,
    id,
    run: (action, args = {}) =>
      execute(action, { id, actor: "qa", ...args }, root),
  };
}
test("explicit structured fallback is durable and idempotent; progress preserves evidence without completion or ownership", async () => {
  const f = await fixture("progress");
  await f.run("plan", { steps });
  const count = taskRead(f.repo, f.id).history.length;
  assert.equal((await f.run("plan", { steps })).unchanged, true);
  assert.equal(taskRead(f.repo, f.id).history.length, count);
  assert.equal(taskRead(f.repo, f.id).plan.tool, "task_plan");
  assert.deepEqual(taskRead(f.repo, f.id).plan.input.plan, steps);
  await f.run("verify", { check: "stage" });
  assert.equal(taskRead(f.repo, f.id).status, "backlog");
  const completed = steps.map((step) => ({ ...step, status: "completed" }));
  await f.run("plan", { steps: completed });
  const state = await f.run("reconcile");
  assert.equal(state.tasks[0].verification, "current");
  assert.equal(state.tasks[0].verifiedComplete, false);
  assert.deepEqual(state.activeWorkers, []);
  await f.run("plan", { steps: [{ step: "Add Unicode", status: "pending" }] });
  assert.equal((await f.run("reconcile")).tasks[0].verification, "stale");
});
test("invalid, ambiguous and fenced structured plans cannot mutate history", async () => {
  const f = await fixture("guards");
  const before = taskRead(f.repo, f.id).history.length;
  for (const args of [
    {},
    { text: "Same", steps },
    { steps: [] },
    { steps: [{ step: "", status: "pending" }] },
    { steps: [{ step: "Too broad", status: "done" }] },
    { steps: Array.from({ length: 101 }, () => steps[0]) },
    { steps: [{ ...steps[0], owner: "other" }] },
  ])
    await assert.rejects(f.run("plan", args), /exactly one|structured steps/);
  assert.equal(taskRead(f.repo, f.id).history.length, before);
  await f.run("claim", { actor: "other" });
  await assert.rejects(f.run("plan", { steps }), /owned by other/);
  assert.equal(taskRead(f.repo, f.id).plan, null);
});
test("real CLI and MCP accept bounded explicit steps without claiming future work", async () => {
  const f = await fixture("transport");
  execFileSync(
    process.execPath,
    [cli, "task", "plan", "--id", f.id, "--steps", JSON.stringify(steps)],
    { cwd: f.root, env: process.env, windowsHide: true, stdio: "pipe" },
  );
  assert.equal((await f.run("get")).plan.stepCount, 3);
  const client = new Client({ name: "structured-plan-qa", version: "1" });
  try {
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: ["--disable-warning=ExperimentalWarning", cli, "mcp"],
        cwd: f.root,
        env: process.env,
        stderr: "pipe",
      }),
    );
    const result = await client.callTool({
      name: "task_plan",
      arguments: {
        root: f.root,
        id: f.id,
        steps,
        actor: "qa",
      },
    });
    assert.equal(result.isError, undefined);
    assert.equal(JSON.parse(result.content[0].text).unchanged, true);
    const invalid = await client.callTool({
      name: "task_plan",
      arguments: { root: f.root, id: f.id, text: "duplicate", steps },
    });
    assert.equal(invalid.isError, true);
    assert.equal(taskRead(f.repo, f.id).status, "backlog");
    const rt = new Runtime();
    try {
      assert.deepEqual(rt.leases(f.repo), []);
    } finally {
      rt.close();
    }
  } finally {
    await client.close();
  }
});
