import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import assert from "node:assert/strict";
import { ensure, taskRead } from "../src/core.js";
import { git } from "../src/util.js";

// Replays published durable histories and assertions, never invokes a model or a hook.
const report = JSON.parse(
  fs.readFileSync(
    new URL("../docs/host-qa/2026-10-07-codex.json", import.meta.url),
  ),
);
assert.equal(report.schemaVersion, 1);
assert.equal(
  report.host.claude,
  "User confirmed not installed or authenticated",
);
assert.equal(report.failure.sandbox, "workspace-write");
assert.equal(report.success.sandbox, "danger-full-access");
assert.ok(
  report.limitations.some((s) => s.includes("sandbox mode also changed")),
);
const failed = report.failure.events.filter(
  (e) => e.item?.type === "mcp_tool_call",
);
assert.equal(failed.length, 6);
assert.ok(
  failed.every((e) =>
    /approval policy is never/.test(e.item.error?.message || e.item.error),
  ),
);
assert.ok(
  report.failure.events.some((e) =>
    /sandbox provisioning failed/.test(e.item?.output || ""),
  ),
);
assert.equal(report.failure.snapshot.tasks.length, 1);
assert.equal(report.failure.snapshot.tasks[0].plan, null);
const [first, resumed, fresh] = report.success.trials;
assert.equal(first.threadId, resumed.threadId);
assert.notEqual(first.threadId, fresh.threadId);
assert.equal(
  fresh.events.filter((e) => e.item?.type === "mcp_tool_call").length,
  0,
);
assert.ok(
  fresh.events.some(
    (e) =>
      e.item?.type === "command_execution" &&
      e.item.exitCode === 0 &&
      /dip(?:\.cmd)?.*task.*(?:get|requirements)/.test(e.item.command),
  ),
);
assert.ok(
  first.events.some(
    (e) =>
      e.item?.type === "mcp_tool_call" &&
      e.item.tool === "task_plan" &&
      e.item.status === "completed" &&
      !e.item.error,
  ),
);

const csv = first.snapshot.tasks.find((t) => t.plan),
  hebrew = first.snapshot.tasks.find((t) => /Hebrew/.test(t.title));
assert.ok(csv && hebrew && csv.id !== hebrew.id);
assert.equal((csv.plan.input.text.match(/\[pending\]/g) || []).length, 3);
assert.ok(hebrew.acceptance.some((s) => /UTF-8/.test(s)));
assert.ok(hebrew.acceptance.some((s) => /order/.test(s)));
for (const trial of [first, resumed, fresh]) {
  assert.equal(trial.snapshot.errors.length, 0);
  for (const id of [csv.id, hebrew.id]) {
    const t = trial.snapshot.tasks.find((t) => t.id === id);
    assert.equal(t.status, "backlog");
    assert.equal(t.evidence.length, 0);
  }
  assert.equal(
    trial.snapshot.tasks.filter((t) => t.kind === "work" && !t.resolution)
      .length,
    2,
  );
  for (const kind of [
    "SessionStart",
    "UserPromptSubmit",
    "PreToolUse",
    "PostToolUse",
    "Stop",
    "SessionEnd",
  ]) {
    assert.ok(
      trial.snapshot.hooks.some(
        (h) => h.session === trial.threadId && h.kind === kind,
      ),
      kind,
    );
  }
}
assert.ok(
  resumed.snapshot.tasks.some(
    (t) =>
      t.status === "superseded" && t.resolution.replacedBy.includes(hebrew.id),
  ),
);
assert.ok(
  fresh.snapshot.tasks.some(
    (t) => t.kind === "discussion" && t.resolution?.outcome === "answered",
  ),
);
for (const trial of [resumed, fresh]) {
  assert.ok(
    trial.snapshot.tasks
      .find((t) => t.id === hebrew.id)
      .acceptance.some((s) => /[Ee]mpty CSV/.test(s)),
  );
}
assert.ok(fresh.final.includes(csv.id) && fresh.final.includes(hebrew.id));

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "dip-host-evidence-"));
process.env.GIT_TRACE2_EVENT = "0";
try {
  for (const [index, trial] of [
    report.failure,
    first,
    resumed,
    fresh,
  ].entries()) {
    const root = path.join(sandbox, String(index));
    fs.mkdirSync(root);
    git(root, ["init", "-b", "main"]);
    const repo = ensure(root, { instructions: false });
    for (const expected of trial.snapshot.tasks) {
      const dir = path.join(repo.dir, "events", expected.id);
      fs.mkdirSync(dir, { recursive: true });
      for (const event of expected.history)
        fs.writeFileSync(
          path.join(dir, event.eventId + ".json"),
          JSON.stringify(event),
        );
      const actual = taskRead(repo, expected.id);
      for (const field of [
        "status",
        "kind",
        "acceptance",
        "plan",
        "resolution",
      ])
        assert.deepEqual(
          actual[field],
          expected[field],
          `${index}:${expected.id}:${field}`,
        );
    }
  }
} finally {
  assert.equal(path.dirname(sandbox), path.resolve(os.tmpdir()));
  assert.ok(path.basename(sandbox).startsWith("dip-host-evidence-"));
  fs.rmSync(sandbox, { recursive: true, force: true });
}
console.log(
  "Live Codex evidence replay passed: initial failure preserved, durable plans/criteria, same-session refinement and new-session CLI recovery. Native planning, compaction and Claude remain unconfirmed.",
);
