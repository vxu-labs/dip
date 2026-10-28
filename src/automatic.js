import path from "node:path";
import { home, json } from "./util.js";

export const AUTOMATIC_INSTRUCTIONS = `DIP automatic workflow: prompts, tool activity, files and native plans are recorded by trusted hooks. Do not duplicate them with management calls. Questions and read-only investigation require no DIP calls. Before supported writes, hooks associate the request and coordinate ownership automatically. Use id=task_id, actor and session=session_id from the hook.
For development, call task_finish once at the end with outcome implemented, summary, remaining and a configured check; use outcome paused with remaining work if unfinished. A Stop event or passing partial check never asserts completion. Never claim verification without current check evidence.
Use explicit intent tools only for an existing requirement that must be adopted, a material scope change, a distinct future idea, or a conflict. Plans written through native plan tools need no second copy. Keep long prose in linked Markdown. Read task_requirements or task_get only when relevant context is missing. If hooks are disabled or untrusted, persist intent explicitly; do not bypass hook trust or change host approval settings. Do not call another model for tracking.`;

export function workflowMode(config = {}) {
  const mode =
    process.env.DIP_WORKFLOW ||
    config.workflow ||
    json(path.join(home(), "install.json"), {}).workflow ||
    "reviewed";
  if (!["automatic", "reviewed"].includes(mode))
    throw new Error("Unknown DIP workflow; choose automatic or reviewed");
  return mode;
}
export function isRequest(task) {
  return (
    task.requestState === "captured" &&
    task.kind !== "work" &&
    !["implemented", "verified", "cancelled", "superseded"].includes(
      task.status,
    )
  );
}
const bytes = (value) => Buffer.byteLength(JSON.stringify(value));
// Budget serialized UTF-8 JSON, never cut a serialized document or a fencing token.
export function boundedContext(context, identity = {}, budget = 4096) {
  const out = {
    ...identity,
    branch: context.branch,
    workflow: "automatic",
    current: null,
    workers: [],
    resume: [],
    ready: [],
    errors: [],
    truncated: false,
    details:
      "task_get / task_requirements / component_owners; request inbox: project_requests",
  };
  const clip = (value, limit) => {
    if (typeof value !== "string") return value;
    if (value.length > limit) out.truncated = true;
    return value.slice(0, limit);
  };
  const first = (values, limit) => {
    if (values?.length > limit) out.truncated = true;
    return values?.slice(0, limit);
  };
  out.branch = clip(context.branch, 120);
  out.instructions =
    "Capture is automatic. No management calls for questions/reads. Continuing an existing requirement: review it, then task_adopt with captured id and targetId before development; do not finish a duplicate while leaving the original open. Development: task_finish once. implemented runs its configured check; no preliminary task_verify needed. paused requires remaining work and omits check/replacedBy. remaining.taskId is only for follow_up. Details on demand; Stop is not completion.";
  const brief = (t) => ({
    id: t.id,
    title: clip(t.title, 120),
    status: t.status,
    kind: t.kind,
  });
  const candidates = [
    ...(context.active || []),
    ...(context.resume || []),
    ...(context.ready || []),
    ...(context.requests || []),
  ];
  const current =
    context.current || candidates.find((t) => t.id === identity.task_id);
  if (current)
    out.current = {
      ...brief(current),
      acceptance: first(current.acceptance, 3)?.map((s) => clip(s, 160)),
      blockedBy: first(current.blockedBy, 3),
      checkpoint: clip(current.checkpoint, 300),
      remaining: first(current.remaining, 3)?.map((r) => ({
        disposition: r.disposition,
        summary: clip(r.summary, 160),
        taskId: r.taskId,
      })),
    };
  // A single multilingual current task can exceed the budget before any lists
  // are added. Remove optional detail, never slice identifiers or serialized JSON.
  while (bytes(out) > budget && out.current) {
    out.truncated = true;
    if (out.current.checkpoint) {
      delete out.current.checkpoint;
      continue;
    }
    const key = ["acceptance", "remaining", "blockedBy"].find(
      (k) => out.current[k]?.length,
    );
    if (key) {
      out.current[key].pop();
      continue;
    }
    break;
  }
  if (bytes(out) > budget)
    return {
      workflow: "automatic",
      truncated: true,
      identityOmitted: true,
      error:
        "Hook identity exceeds context budget; persist intent explicitly and read details.",
      details: "task_get / project_requests",
    };
  const add = (key, value) => {
    out[key].push(value);
    if (bytes(out) > budget) {
      out[key].pop();
      out.truncated = true;
    }
  };
  for (const e of context.errors || [])
    add("errors", { error: clip(String(e.error || e), 160) });
  for (const w of context.workers || [])
    add("workers", {
      task: w.task,
      actor: w.actor,
      scope: first(w.scope, 3)?.map((p) => clip(p, 100)),
    });
  for (const name of ["resume", "ready"])
    for (const t of context[name] || [])
      if (t.id !== identity.task_id) add(name, brief(t));
  return out;
}
export function mutationReceipt(action, result) {
  if (
    ![
      "update",
      "prepare",
      "adopt",
      "finish",
      "checkpoint",
      "plan",
      "decision",
      "claim",
      "release",
      "verify",
    ].includes(action)
  )
    return result;
  if (bytes(result) <= 1024) return result;
  const out = {
    id: result.id || result.task?.id || result.lease?.task,
    status: result.status || result.task?.status,
    kind: result.kind,
    passed: result.passed,
    verification: result.verification,
    verifiedComplete: result.verifiedComplete,
    released: result.released,
    reused: result.reused,
    outcome: result.outcome || result.resolution?.outcome,
    conflictCount: result.conflicts?.length,
    remainingCount: result.resolution?.remaining?.length,
    truncated: true,
    details: "task_get / task_requirements",
  };
  if (result.lease)
    out.lease = {
      task: result.lease.task,
      actor: result.lease.actor,
      token: result.lease.token,
      expires: result.lease.expires,
    };
  if (result.token) out.token = result.token;
  if (result.expires) out.expires = result.expires;
  if (result.check)
    out.check = {
      passed: result.check.passed,
      exitCode: result.check.exitCode,
      reused: result.check.reused,
    };
  if (bytes(out) > 1024 && out.lease) {
    delete out.lease.actor;
    delete out.lease.task;
  }
  return out;
}
