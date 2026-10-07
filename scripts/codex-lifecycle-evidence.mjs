import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { ensure, taskRead } from "../src/core.js";
import { git } from "../src/util.js";

const file = "docs/host-qa/2026-10-07-lifecycle.json";
if (process.argv[2] === "--capture") {
  const raw = fs.readFileSync(
    process.argv[3] || ".dip-local/codex-lifecycle-result.json",
  );
  const source = JSON.parse(raw);
  const normalized = (value) =>
    JSON.parse(
      JSON.stringify(value)
        .replaceAll(source.root.replaceAll("\\", "\\\\"), "<project>")
        .replaceAll(os.homedir().replaceAll("\\", "\\\\"), "<home>"),
    );
  const events = (rows) =>
    rows.flatMap((e) => {
      if (e.method === "hook/completed" || e.method === "turn/plan/updated")
        return [e];
      if (
        e.method === "item/completed" &&
        ["agentMessage", "contextCompaction"].includes(e.params.item.type)
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
              threadId: e.params.threadId,
              turnId: e.params.turnId,
              item: { type, id, server, tool, status },
            },
          },
        ];
      }
      return [];
    });
  const report = normalized({
    schemaVersion: 1,
    startedAt: source.startedAt,
    completedAt: source.completedAt,
    host: {
      codex: source.codexVersion,
      dip: source.dipVersion,
      model: source.model,
      effort: source.effort,
      platform: process.platform,
      transport: source.transport,
      sandbox: "danger-full-access",
      approvals: "never",
      claude: "User confirmed not installed or authenticated",
    },
    trustConfirmed: source.trustConfirmed,
    hookTrustBypass: source.hookTrustBypass,
    rawSha256: createHash("sha256").update(raw).digest("hex"),
    transportSha256: source.transportSha256,
    threadId: source.threadId,
    phases: source.phases.map((p) => ({
      label: p.label,
      turnId: p.turnId,
      status: p.completed?.params.turn.status || null,
      probe: p.probe,
      events: events(p.events),
      state: {
        tasks: p.state.tasks,
        activity: p.state.activity,
        leases: p.state.leases,
      },
    })),
    limitations: [
      "Native update_plan was unavailable in the tested model/host tool set. No native structured plan was recorded, and no substitute tool was labeled native delivery.",
      "One synthetic session and manual compaction/cancellation via app-server; not a multi-day test, UI-click trial or quality benchmark.",
      "Post-compaction model retains a host-generated context summary as well as DIP; this does not isolate DIP memory causally.",
      "Fixture-local DIP MCP approvals were set per process for authorized QA. Existing hook trust and global host settings were unchanged.",
      "Initial inventory-only client check compared event-name casing incorrectly and stopped before any model turn. Corrected comparison found all required hooks trusted; original receipt remains local.",
      "Claude live coverage remains open.",
    ],
  });
  fs.writeFileSync(file, JSON.stringify(report, null, 2) + "\n");
}
const report = JSON.parse(fs.readFileSync(file));
assert.equal(report.trustConfirmed, true);
assert.equal(report.hookTrustBypass, false);
assert.equal(report.phases.length, 4);
const [planning, compact, resumed, interrupted] = report.phases;
const hook = (phase, event) =>
  phase.events.some(
    (e) =>
      e.method === "hook/completed" &&
      e.params.run.eventName === event &&
      e.params.run.status === "completed",
  );
const csv = planning.state.tasks.find(
  (t) => t.title === "CSV export with ordered headers",
);
const hebrew = planning.state.tasks.find(
  (t) => t.title === "Future Hebrew CSV header support",
);
assert.ok(csv && hebrew);
assert.equal(csv.plan, null);
assert.equal(
  planning.events.some((e) => e.method === "turn/plan/updated"),
  false,
);
assert.ok(
  planning.events.some(
    (e) =>
      e.params.item?.type === "agentMessage" &&
      /update_plan.*unavailable/.test(e.params.item.text),
  ),
);
assert.ok(hook(compact, "preCompact"));
assert.ok(
  compact.events.some((e) => e.params.item?.type === "contextCompaction"),
);
assert.ok(hook(resumed, "sessionStart"));
assert.ok(hook(interrupted, "interrupt"));
assert.equal(interrupted.status, "interrupted");
assert.equal(interrupted.probe, "PARTIAL");
assert.deepEqual(interrupted.state.leases, []);
const partial = interrupted.state.tasks.find((t) =>
  t.scope.includes("probe.txt"),
);
assert.ok(partial);
assert.equal(partial.status, "in_progress");
assert.equal(partial.evidence.length, 0);
assert.ok(partial.checkpoints.some((c) => c.automatic));
assert.ok(
  interrupted.state.activity.some(
    (a) => a.kind === "Interrupt" && a.taskId === partial.id,
  ),
);
for (const phase of report.phases)
  for (const expected of [csv, hebrew]) {
    const task = phase.state.tasks.find((t) => t.id === expected.id);
    assert.equal(task.status, "backlog");
    assert.deepEqual(task.acceptance, expected.acceptance);
    assert.equal(task.evidence.length, 0);
  }
assert.ok(
  compact.state.tasks.find((t) => t.id === csv.id).checkpoints.length >
    csv.checkpoints.length,
);
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "dip-lifecycle-replay-"));
process.env.GIT_TRACE2_EVENT = "0";
try {
  for (const phase of report.phases) {
    const root = path.join(sandbox, phase.label);
    fs.mkdirSync(root);
    git(root, ["init", "-b", "main"]);
    const repo = ensure(root);
    for (const task of phase.state.tasks) {
      const directory = path.join(repo.dir, "events", task.id);
      fs.mkdirSync(directory, { recursive: true });
      for (const event of task.history)
        fs.writeFileSync(
          path.join(directory, event.eventId + ".json"),
          JSON.stringify(event),
        );
    }
    for (const task of phase.state.tasks) {
      const actual = taskRead(repo, task.id);
      assert.equal(actual.status, task.status);
      assert.deepEqual(actual.acceptance, task.acceptance);
      assert.equal(actual.checkpoints.length, task.checkpoints.length);
      assert.equal(actual.evidence.length, 0);
    }
  }
} finally {
  assert.equal(path.dirname(sandbox), path.resolve(os.tmpdir()));
  assert.ok(path.basename(sandbox).startsWith("dip-lifecycle-replay-"));
  fs.rmSync(sandbox, { recursive: true, force: true });
}
console.log(
  "Causal lifecycle replay passed: real PreCompact, post-compaction recovery and Interrupt preserve open work and release ownership; native plan and Claude remain unproven.",
);
