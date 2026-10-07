import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { ensure, taskRead } from "../src/core.js";
import { git } from "../src/util.js";

const file = "docs/host-qa/2026-10-07-structured-plan.json";
if (process.argv[2] === "--capture") {
  const raw = fs.readFileSync(
    process.argv[3] || ".dip-local/codex-structured-result.json",
  );
  const source = JSON.parse(raw);
  assert.ok(source.completedAt && !source.failure);
  const phase = source.phases[0];
  const report = {
    schemaVersion: 1,
    host: {
      codex: source.codexVersion,
      dip: source.dipVersion,
      model: source.model,
      effort: source.effort,
      platform: process.platform,
      transport: source.transport,
    },
    startedAt: source.startedAt,
    completedAt: source.completedAt,
    threadId: source.threadId,
    trustConfirmed: source.trustConfirmed,
    hookTrustBypass: source.hookTrustBypass,
    rawSha256: createHash("sha256").update(raw).digest("hex"),
    transportSha256: source.transportSha256,
    phase: {
      label: phase.label,
      status: phase.completed.params.turn.status,
      tasks: phase.state.tasks,
      activity: phase.state.activity,
      leases: phase.state.leases,
      events: phase.events.flatMap((e) => {
        if (e.method === "hook/completed" || e.method === "turn/plan/updated")
          return [e];
        if (
          e.method === "item/completed" &&
          e.params.item.type === "agentMessage"
        )
          return [e];
        if (
          e.method === "item/completed" &&
          e.params.item.type === "mcpToolCall"
        ) {
          const { type, id, server, tool, status } = e.params.item;
          return [
            {
              method: e.method,
              params: {
                item: { type, id, server, tool, status },
                threadId: e.params.threadId,
                turnId: e.params.turnId,
              },
            },
          ];
        }
        return [];
      }),
    },
    limitations: [
      "Explicit DIP task_plan steps, not native update_plan or automatic native-plan capture.",
      "One instructed future-planning turn in a synthetic fixture; no long-duration or quality superiority claim.",
      "Existing trusted hooks were preserved. Reviewed fixture-local MCP tools were approved per process; no global approval changes.",
      "Claude remains absent/unauthed and untested.",
    ],
  };
  const text = JSON.stringify(report, null, 2)
    .replaceAll(source.root.replaceAll("\\", "\\\\"), "<project>")
    .replaceAll(os.homedir().replaceAll("\\", "\\\\"), "<home>");
  fs.writeFileSync(file, text + "\n");
}
const report = JSON.parse(fs.readFileSync(file));
assert.equal(report.trustConfirmed, true);
assert.equal(report.hookTrustBypass, false);
assert.equal(report.phase.status, "completed");
assert.equal(report.phase.label, "explicit-structured-plan");
assert.deepEqual(report.phase.leases, []);
const csv = report.phase.tasks.find((t) => t.plan),
  hebrew = report.phase.tasks.find((t) => /Hebrew/.test(t.title));
assert.ok(csv && hebrew && csv.id !== hebrew.id);
assert.equal(csv.plan.tool, "task_plan");
assert.equal(csv.plan.input.text, undefined);
assert.equal(csv.plan.input.plan.length, 3);
assert.ok(csv.plan.input.plan.every((step) => step.status === "pending"));
assert.ok(hebrew.acceptance.some((s) => /UTF-8/.test(s)));
assert.ok(hebrew.acceptance.some((s) => /order/.test(s)));
assert.ok(
  report.phase.events.some(
    (e) =>
      e.params.item?.tool === "task_plan" &&
      e.params.item.status === "completed",
  ),
);
assert.equal(
  report.phase.events.some((e) => e.method === "turn/plan/updated"),
  false,
);
for (const task of [csv, hebrew]) {
  assert.equal(task.status, "backlog");
  assert.equal(task.evidence.length, 0);
}
const sandbox = fs.mkdtempSync(
  path.join(os.tmpdir(), "dip-structured-replay-"),
);
process.env.GIT_TRACE2_EVENT = "0";
try {
  git(sandbox, ["init", "-b", "main"]);
  const repo = ensure(sandbox);
  for (const task of report.phase.tasks) {
    const directory = path.join(repo.dir, "events", task.id);
    fs.mkdirSync(directory, { recursive: true });
    for (const event of task.history)
      fs.writeFileSync(
        path.join(directory, event.eventId + ".json"),
        JSON.stringify(event),
      );
  }
  const replayed = taskRead(repo, csv.id);
  assert.deepEqual(replayed.plan.input, csv.plan.input);
  assert.equal(replayed.status, "backlog");
  assert.deepEqual(taskRead(repo, hebrew.id).acceptance, hebrew.acceptance);
} finally {
  assert.equal(path.dirname(sandbox), path.resolve(os.tmpdir()));
  assert.ok(path.basename(sandbox).startsWith("dip-structured-replay-"));
  fs.rmSync(sandbox, { recursive: true, force: true });
}
console.log(
  "Real-host explicit structured-plan replay passed; future ideas stay backlog with no leases or verification. Native plan delivery remains distinct and unproven.",
);
