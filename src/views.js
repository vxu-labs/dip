import { briefPlan, verificationDetails } from "./workflow.js";

const clip = (s, max) => (typeof s === "string" ? s.slice(0, max) : s);
export function taskView(task) {
  const checkpoint =
    [...task.checkpoints].reverse().find((c) => !c.automatic) ||
    task.checkpoints.at(-1);
  return {
    id: task.id,
    title: clip(task.title, 300),
    kind: task.kind,
    status: task.status,
    description: clip(task.description, 6000),
    descriptionTruncated: task.description.length > 6000,
    acceptance: task.acceptance.slice(0, 30).map((s) => clip(s, 1000)),
    acceptanceCount: task.acceptance.length,
    acceptanceTruncated:
      task.acceptance.length > 30 ||
      task.acceptance.some((s) => s.length > 1000),
    scope: task.scope.slice(0, 30),
    scopeCount: task.scope.length,
    dependencies: task.dependencies.slice(0, 30),
    dependencyCount: task.dependencies.length,
    checkpoint: checkpoint
      ? {
          ...checkpoint,
          summary: clip(checkpoint.summary, 2000),
          next: clip(checkpoint.next, 1000),
        }
      : null,
    decision: task.decisions.at(-1)
      ? {
          ...task.decisions.at(-1),
          summary: clip(task.decisions.at(-1).summary, 2000),
          next: clip(task.decisions.at(-1).next, 1000),
        }
      : null,
    evidence: verificationDetails(task.evidence.at(-1)),
    remainingReview:
      task.resolution?.remaining === undefined ? "unreviewed" : "recorded",
    conflicts: task.conflicts.map((c) => ({
      field: c.field,
      eventIds: c.alternatives.map((a) => a.eventId),
    })),
    resolution: task.resolution,
    plan: briefPlan(task.plan),
    documents: task.documents.slice(0, 30),
    documentCount: task.documents.length,
    instructions:
      "Use task_requirements/document_read for bounded details; CLI --full explicitly returns raw history.",
  };
}

export function reconcileView(state, args = {}) {
  const limit = Number(args.limit ?? 30),
    offset = Number(args.offset ?? 0);
  if (
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 100 ||
    !Number.isInteger(offset) ||
    offset < 0
  )
    throw new Error("limit must be 1..100 and offset nonnegative");
  if (args.kind && !["work", "discussion"].includes(args.kind))
    throw new Error("kind must be work or discussion");
  const statuses = args.statuses || [];
  if (
    !Array.isArray(statuses) ||
    statuses.some(
      (s) =>
        ![
          "backlog",
          "ready",
          "in_progress",
          "blocked",
          "implemented",
          "verified",
          "cancelled",
          "superseded",
          "conflict",
          "done",
        ].includes(s),
    )
  )
    throw new Error("Invalid statuses");
  const all = state.tasks.filter(
    (t) =>
      (!args.id || t.id === args.id) &&
      (!args.kind || t.kind === args.kind) &&
      (!statuses.length || statuses.includes(t.status)) &&
      (!args.open ||
        ["backlog", "ready", "in_progress", "blocked", "conflict"].includes(
          t.status,
        )),
  );
  return {
    repo: state.repo,
    workers: state.activeWorkers.slice(0, 20),
    workerCount: state.activeWorkers.length,
    total: all.length,
    nextOffset: offset + limit < all.length ? offset + limit : null,
    tasks: all.slice(offset, offset + limit).map((t) => ({
      id: t.id,
      title: clip(t.title, 300),
      kind: t.kind,
      status: t.status,
      active: t.active,
      interrupted: t.interrupted,
      verification: t.verification,
      verificationDetails: t.verificationDetails,
      remainingReview: t.remainingReview,
      integrated: t.integrated,
      blockedBy: t.blockedBy.slice(0, 30),
      blockedByCount: t.blockedBy.length,
      conflicts: t.conflicts.map((c) => ({
        field: c.field,
        eventIds: c.alternatives.map((a) => a.eventId),
      })),
      resolution: t.resolution,
      checkpoint: clip(
        [...t.checkpoints].reverse().find((c) => !c.automatic)?.summary ||
          t.checkpoints.at(-1)?.summary,
        1000,
      ),
    })),
    errors: state.errors.slice(0, 20),
    errorCount: state.errors.length,
    activityIncluded: false,
    instructions:
      "Recorded implementation is not verified completion. Inspect task requirements or changes before resuming. Use --full only for raw-history diagnostics.",
  };
}
