import { spawn } from "node:child_process";
import {
  ensure,
  Runtime,
  project,
  compactContext,
  createTask,
  taskGet,
  taskRead,
  updateTask,
  append,
  linkDocument,
  unlinkDocument,
  updateValidation,
} from "./core.js";
import {
  captureSnapshot,
  redact,
  git,
  digest,
  inScope,
  atomic,
} from "./util.js";
import { repositoryIntegration } from "./repository-integration.js";
import path from "node:path";
import { planIntent, planSteps } from "./workflow.js";
import {
  documentState,
  documentKey,
  readDocument,
  documentPath,
} from "./documents.js";
import { navigate } from "./navigation.js";
import { taskView } from "./views.js";

const intentHash = (task, repo) =>
  digest(
    JSON.stringify([
      task.description || "",
      task.acceptance || [],
      task.scope || [],
      task.dependencies || [],
      ...(task.plan ? [planIntent(task.plan)] : []),
      ...(task.documents?.length
        ? [
            task.documents.map((d) => {
              const state = documentState(repo, d);
              return [
                d.path,
                d.role,
                d.hash,
                state.currentness,
                state.currentHash || null,
                d.alternatives || null,
              ];
            }),
          ]
        : []),
    ]),
  );

const intentFields = (task, repo) =>
  Object.fromEntries(
    [
      ["description", task.description || ""],
      ["acceptance", task.acceptance || []],
      ["scope", task.scope || []],
      ["dependencies", task.dependencies || []],
      ["plan", planIntent(task.plan)],
      [
        "documents",
        (task.documents || []).map((d) => {
          const state = documentState(repo, d);
          return [
            d.path,
            d.role,
            d.hash,
            state.currentness,
            state.currentHash || null,
            d.alternatives || null,
          ];
        }),
      ],
    ].map(([key, value]) => [key, digest(JSON.stringify(value))]),
  );

export async function execute(action, args = {}, cwd = process.cwd()) {
  const repo = ensure(cwd, {
      instructions: ![
        "context",
        "status",
        "get",
        "next",
        "reconcile",
        "document-list",
        "document-read",
        "requirements",
        "owners",
        "changes",
        "search",
        "related",
        "repository",
      ].includes(action),
    }),
    rt = new Runtime();
  try {
    rt.register(repo);
    if (action === "repository") {
      const result = repositoryIntegration(repo, { remove: !!args.remove });
      atomic(path.join(repo.dir, "config.json"), {
        ...repo.config,
        repositoryIntegration: !args.remove,
      });
      return result;
    }
    if (
      ["requirements", "owners", "changes", "search", "related"].includes(
        action,
      )
    )
      return navigate(repo, rt, action, args, {
        intentHash,
        intentFields,
        assessEvidence,
      });
    const actor = args.actor || "agent";
    if (action === "context") return compactContext(repo, rt);
    if (action === "status") {
      rt.flush(repo.root);
      return project(repo, rt);
    }
    if (action === "create") return { id: createTask(repo, args, actor) };
    if (action === "get") {
      const task = args.full ? taskGet(repo, args.id) : taskRead(repo, args.id);
      return args.full ? task : taskView(task);
    }
    if (action === "adopt") {
      if (!args.session || typeof args.session !== "string")
        throw new Error("Adoption requires the current hook session");
      if (args.id === args.targetId) throw new Error("Adopt a different task");
      if (
        typeof args.summary !== "string" ||
        !args.summary.trim() ||
        args.summary.length > 2000
      )
        throw new Error(
          "Explain the reviewed relationship in 1..2000 characters",
        );
      const source = taskRead(repo, args.id),
        target = taskRead(repo, args.targetId);
      const resolution = {
        outcome: "superseded",
        summary: redact(args.summary),
        replacedBy: [args.targetId],
      };
      const repeated =
        source.status === "superseded" &&
        JSON.stringify(source.resolution) === JSON.stringify(resolution);
      if (
        !repeated &&
        (source.history[0]?.payload.source !== "prompt" ||
          source.scope.length ||
          source.acceptance.length ||
          source.evidence.length ||
          source.documents.length)
      )
        throw new Error(
          "Adopt only a captured request before development; preserve developed work separately",
        );
      if (
        source.conflicts.length ||
        target.conflicts.length ||
        ["cancelled", "superseded"].includes(target.status)
      )
        throw new Error(
          "Resolve conflicts or select an actionable target first",
        );
      const patch = args.patch || {};
      if (
        Object.keys(patch).some(
          (k) =>
            ![
              "title",
              "description",
              "acceptance",
              "dependencies",
              "scope",
              "kind",
              "priority",
              "due",
            ].includes(k),
        )
      )
        throw new Error(
          "Adoption refines intent only; use explicit status and finish operations",
        );
      updateValidation(patch);
      rt.guard(repo, args.id, actor, args.token);
      rt.guard(repo, args.targetId, actor, args.targetToken);
      const session = rt.session(repo, args.session);
      if (
        session &&
        (session.actor !== actor ||
          ![args.id, args.targetId].includes(session.task))
      )
        throw new Error("Session belongs to another actor or request");
      // Validate everything first. Causal files are individually durable; retrying
      // after interruption completes a missing receipt/session bind without a duplicate.
      if (
        Object.entries(patch).some(
          ([k, v]) => JSON.stringify(target[k]) !== JSON.stringify(v),
        )
      )
        await execute(
          "update",
          { id: args.targetId, actor, token: args.targetToken, patch },
          cwd,
        );
      await execute(
        "finish",
        {
          id: args.id,
          actor,
          token: args.token,
          outcome: "superseded",
          summary: args.summary,
          replacedBy: [args.targetId],
        },
        cwd,
      );
      rt.setSession(
        repo,
        args.session,
        args.targetId,
        actor,
        session?.prompt || source.description,
      );
      return {
        id: args.targetId,
        adoptedFrom: args.id,
        session: args.session,
        task: taskView(taskRead(repo, args.targetId)),
        instruction:
          "Intent selected by the existing agent, not an automatic identity classifier. Claim development separately; use configured checks for completion.",
      };
    }
    if (action === "finish") {
      const lease = rt.guard(repo, args.id, actor, args.token);
      const task = taskRead(repo, args.id);
      if (
        !["answered", "implemented", "superseded", "cancelled"].includes(
          args.outcome,
        )
      )
        throw new Error(
          "Choose answered, implemented, superseded or cancelled",
        );
      if (
        typeof args.summary !== "string" ||
        !args.summary.trim() ||
        args.summary.length > 2000
      )
        throw new Error("Finish requires a summary of 1..2000 characters");
      if (
        args.outcome === "answered" &&
        (task.scope.length || task.acceptance.length || task.evidence.length)
      )
        throw new Error(
          "Answered is for informational requests without development scope, acceptance criteria or code evidence",
        );
      const replacedBy = args.replacedBy || [];
      if (args.outcome === "superseded" && !replacedBy.length)
        throw new Error("Superseded requires replacement task IDs");
      if (args.outcome !== "superseded" && replacedBy.length)
        throw new Error("Replacement IDs require superseded outcome");
      if (args.check && args.outcome !== "implemented")
        throw new Error("Configured checks apply to implemented work");
      if (args.outcome === "implemented" && task.kind === "discussion")
        throw new Error("Reclassify discussion as work before implementation");
      if (
        args.outcome === "implemented" &&
        planSteps(task.plan?.input).some((step) => step.status !== "completed")
      )
        throw new Error(
          "Complete or explicitly revise outstanding structured plan steps before finishing work",
        );
      if (
        args.check &&
        !Array.isArray(repo.config.verification?.[args.check]?.command)
      )
        throw new Error(
          "Choose a configured verification check with a command array",
        );
      const resolution = {
        outcome: args.outcome,
        summary: redact(args.summary),
        replacedBy,
      };
      const retainVerified =
        args.outcome === "implemented" &&
        task.status === "verified" &&
        assessEvidence(repo, task).verifiedComplete;
      if (
        JSON.stringify(task.resolution) !== JSON.stringify(resolution) ||
        !["implemented", "verified", "superseded", "cancelled"].includes(
          task.status,
        ) ||
        args.check
      )
        updateTask(
          repo,
          args.id,
          {
            ...(!retainVerified
              ? {
                  status:
                    args.outcome === "answered" ? "implemented" : args.outcome,
                }
              : {}),
            ...(args.outcome === "answered" ? { kind: "discussion" } : {}),
            resolution,
          },
          actor,
        );
      let result;
      if (args.check) result = await execute("verify", { ...args }, cwd);
      if (lease && (!result || result.passed))
        rt.release(repo, args.id, lease.token);
      const current = taskRead(repo, args.id);
      return {
        id: args.id,
        kind: current.kind,
        status: current.status,
        resolution: current.resolution,
        ...assessEvidence(repo, current),
        ...(result ? { check: result } : {}),
        released: !!lease && (!result || result.passed),
        instruction:
          "Answered is not code verification; implemented awaits current configured evidence. Supersession preserves unfinished work in replacement IDs.",
      };
    }
    if (
      [
        "document-link",
        "document-unlink",
        "document-list",
        "document-read",
      ].includes(action)
    ) {
      const task = taskRead(repo, args.id);
      if (action === "document-link" || action === "document-unlink") {
        rt.guard(repo, args.id, actor, args.token);
        return action === "document-link"
          ? linkDocument(repo, args.id, args, actor)
          : unlinkDocument(
              repo,
              args.id,
              { ...args, path: documentPath(repo.root, args.path) },
              actor,
            );
      }
      if (action === "document-list") {
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
        return {
          total: task.documents.length,
          documents: task.documents
            .slice(offset, offset + limit)
            .map((d) => documentState(repo, d)),
          nextOffset:
            offset + limit < task.documents.length ? offset + limit : null,
        };
      }
      const relative = documentPath(repo.root, args.path),
        key = documentKey({ path: relative, role: args.role || "reference" });
      const reference = task.documents.find((d) => documentKey(d) === key);
      if (!reference)
        throw new Error(
          "Document reference not found; list the task documents first",
        );
      return readDocument(repo, reference, args);
    }
    if (action === "plan") {
      const task = taskRead(repo, args.id);
      rt.guard(repo, args.id, actor, args.token);
      if ((args.text !== undefined) === (args.steps !== undefined))
        throw new Error("Choose exactly one of plan text or structured steps");
      let input;
      if (args.steps !== undefined) {
        if (
          !Array.isArray(args.steps) ||
          args.steps.length < 1 ||
          args.steps.length > 100 ||
          args.steps.some(
            (step) =>
              !step ||
              typeof step !== "object" ||
              Array.isArray(step) ||
              Object.keys(step).some(
                (key) => !["step", "status"].includes(key),
              ) ||
              typeof step.step !== "string" ||
              !step.step.trim() ||
              step.step.length > 1000 ||
              !["pending", "in_progress", "completed"].includes(step.status),
          )
        )
          throw new Error(
            "Use 1..100 structured steps with 1..1000-character step text and pending, in_progress or completed status",
          );
        input = {
          plan: args.steps.map((step) => ({
            step: redact(step.step),
            status: step.status,
          })),
        };
      } else {
        if (typeof args.text !== "string" || !args.text.trim())
          throw new Error("Plan text is required");
        input = { text: redact(args.text) };
      }
      if (
        task.plan?.tool === "task_plan" &&
        JSON.stringify(task.plan.input) === JSON.stringify(input)
      )
        return { saved: true, id: args.id, unchanged: true };
      append(
        repo,
        args.id,
        "task.plan",
        {
          tool: "task_plan",
          input,
        },
        { actor },
      );
      return { saved: true, id: args.id };
    }
    if (action === "next") {
      const state = reconcile(repo, rt, { includeActivity: false });
      return state.tasks
        .filter(
          (t) =>
            !t.active &&
            !t.blockedBy.length &&
            !t.dependencyCycle &&
            t.kind === "work" &&
            !state.activeWorkers.some((w) =>
              t.scope.some((s) =>
                w.scope.some((o) => inScope(s, o) || inScope(o, s)),
              ),
            ) &&
            ["ready", "backlog"].includes(t.status),
        )
        .sort(
          (a, b) =>
            (a.priority || 3) - (b.priority || 3) ||
            (a.due || "9999").localeCompare(b.due || "9999") ||
            a.id.localeCompare(b.id),
        )
        .slice(0, 10)
        .map((t) => ({
          id: t.id,
          title: t.title,
          status: t.status,
          scope: t.scope,
          priority: t.priority,
          due: t.due,
        }));
    }
    if (action === "update" || action === "resolve") {
      const lease = rt.guard(repo, args.id, actor, args.token);
      return updateTask(
        repo,
        args.id,
        args.patch || {},
        actor,
        action === "resolve" || args.resolve === true,
        () => {
          if (lease && args.patch?.scope)
            rt.claim(repo, args.id, lease.actor, 120000, args.patch.scope);
        },
      );
    }
    if (action === "claim" || action === "prepare") {
      const preparing = action === "prepare";
      const patch = args.patch || {};
      if (preparing) {
        if (!args.actor || !args.session)
          throw new Error(
            "Preparation requires the current hook actor and session",
          );
        if (
          typeof patch !== "object" ||
          Array.isArray(patch) ||
          Object.keys(patch).some(
            (key) =>
              !["title", "description", "acceptance", "scope"].includes(key),
          )
        )
          throw new Error(
            "Preparation patch supports title, description, acceptance and scope only",
          );
        updateValidation(patch);
      }
      const task = reconcile(repo, rt, { includeActivity: false }).tasks.find(
        (t) => t.id === args.id,
      );
      if (!task) throw new Error("Task not found");
      if (
        preparing &&
        (task.kind !== "work" ||
          ["implemented", "verified", "cancelled", "superseded"].includes(
            task.status,
          ))
      )
        throw new Error(
          "Prepare only outstanding development work; refine or reopen other intent explicitly",
        );
      if (
        task.conflicts.length ||
        task.dependencyCycle ||
        task.blockedBy.length
      )
        throw new Error("Task has unresolved blockers");
      const waitMs = Number(args.waitMs || 0);
      if (!Number.isFinite(waitMs) || waitMs < 0 || waitMs > 30000)
        throw new Error("waitMs must be between 0 and 30000");
      const deadline = Date.now() + waitMs;
      let lease;
      for (;;) {
        try {
          lease = rt.claim(
            repo,
            args.id,
            actor,
            args.ttl || 120000,
            (preparing ? patch.scope : args.scope) || task.scope,
          );
          break;
        } catch (e) {
          if (
            !/^(Task|Scope) owned by /.test(e.message) ||
            Date.now() >= deadline
          )
            throw e;
          await new Promise((resolve) =>
            setTimeout(resolve, Math.min(200, deadline - Date.now())),
          );
          const current = reconcile(repo, rt, {
            includeActivity: false,
          }).tasks.find((t) => t.id === args.id);
          if (
            !current ||
            current.conflicts.length ||
            current.dependencyCycle ||
            current.blockedBy.length
          )
            throw new Error("Task changed while waiting; refresh its context");
          if (!(preparing ? patch.scope : args.scope))
            task.scope = current.scope;
        }
      }
      if (preparing) {
        // Ownership precedes intent writes. A persistence failure retains the
        // lease for a retry; this is not a transaction across Git and SQLite.
        const changed = Object.fromEntries(
          Object.entries({ ...patch, status: "in_progress" }).filter(
            ([key, value]) =>
              JSON.stringify(task[key]) !== JSON.stringify(value),
          ),
        );
        if (Object.keys(changed).length)
          updateTask(repo, args.id, changed, actor);
      } else {
        if (args.scope) updateTask(repo, args.id, { scope: args.scope }, actor);
        append(
          repo,
          args.id,
          "task.update",
          { status: "in_progress" },
          { actor },
        );
      }
      if (args.session) rt.setSession(repo, args.session, args.id, actor);
      return preparing
        ? { lease, task: taskView(taskRead(repo, args.id)) }
        : lease;
    }
    if (action === "heartbeat") {
      rt.heartbeat(repo, args.id, args.token);
      return { renewed: true };
    }
    if (action === "release") {
      rt.release(repo, args.id, args.token);
      return { released: true };
    }
    if (action === "checkpoint" || action === "decision") {
      taskGet(repo, args.id);
      rt.guard(repo, args.id, actor, args.token);
      append(
        repo,
        args.id,
        `task.${action}`,
        {
          summary: redact(args.summary),
          next: redact(args.next || ""),
          head: repo.head,
        },
        { actor },
      );
      return { saved: true };
    }
    if (action === "verify") {
      const lease = rt.guard(repo, args.id, actor, args.token);
      const renewal = lease
        ? setInterval(() => {
            try {
              rt.heartbeat(repo, args.id, lease.token);
            } catch {}
          }, 10000)
        : null;
      try {
        return await verify(repo, args, actor, () => {
          if (lease) rt.assert(repo, args.id, lease.token);
        });
      } finally {
        if (renewal) clearInterval(renewal);
      }
    }
    if (action === "reconcile")
      return reconcile(repo, rt, { includeActivity: !!args.full });
    throw new Error(`Unknown action ${action}`);
  } finally {
    rt.close();
  }
}

async function verify(repo, args, actor, assertOwnership) {
  const task = taskGet(repo, args.id),
    name = args.check;
  if (
    task.kind === "discussion" ||
    ["cancelled", "superseded"].includes(task.status)
  )
    throw new Error("Only applicable development work can be verified");
  const check = repo.config.verification?.[name];
  if (
    !check ||
    !Array.isArray(check.command) ||
    !check.command.length ||
    check.command.some((a) => typeof a !== "string")
  )
    throw new Error(
      "Choose a configured verification check with a command array",
    );
  if (task.conflicts.length)
    throw new Error("Resolve conflicts before verification");
  if (
    task.documents.some((d) => documentState(repo, d).currentness !== "current")
  )
    throw new Error(
      "Review and relink changed, missing or conflicting task documents before verification",
    );
  const before = captureSnapshot(repo);
  const beforeIntent = intentHash(task, repo);
  const beforeFields = intentFields(task, repo);
  const result = await new Promise((resolve, reject) => {
    const child = spawn(check.command[0], check.command.slice(1), {
      cwd: repo.root,
      windowsHide: true,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    const record = (data) => {
      output = (output + data.toString()).slice(-8192);
    };
    child.stdout.on("data", record);
    child.stderr.on("data", record);
    const timer = setTimeout(
      () => {
        child.kill();
      },
      Math.min(check.timeoutMs || 120000, 600000),
    );
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (exitCode, signal) => {
      clearTimeout(timer);
      resolve({ exitCode, signal, summary: redact(output).slice(-2000) });
    });
  });
  assertOwnership();
  const after = captureSnapshot(repo),
    changedIntentDuringCheck =
      beforeIntent !== intentHash(taskGet(repo, args.id), repo),
    passed =
      result.exitCode === 0 &&
      before.hash === after.hash &&
      !changedIntentDuringCheck;
  append(
    repo,
    args.id,
    "task.evidence",
    {
      check: name,
      command: check.command,
      result: passed ? "passed" : "failed",
      ...result,
      snapshot: after,
      changedDuringCheck: before.hash !== after.hash,
      intentHash: beforeIntent,
      intentFields: beforeFields,
      changedIntentDuringCheck,
      codeHead: after.committed ? repo.head : null,
    },
    { actor },
  );
  // A successful stage check is evidence, not a completion declaration.
  // finish first records explicit implemented intent, then invokes this check.
  if (
    passed &&
    task.status === "implemented" &&
    task.resolution?.outcome === "implemented"
  )
    append(repo, args.id, "task.update", { status: "verified" }, { actor });
  return {
    passed,
    ...result,
    changedDuringCheck: before.hash !== after.hash,
    changedIntentDuringCheck,
    snapshot: after.hash,
    taskStatus: taskRead(repo, args.id).status,
    instruction:
      "Check evidence does not finish open work. Use task_finish implemented after all requirements are fulfilled; outstanding structured plan steps must be completed or revised.",
  };
}
export function assessEvidence(repo, task, snapshot) {
  const evidence = task.evidence.at(-1);
  if (!evidence)
    return {
      verification: "missing",
      integrated: false,
      verifiedComplete: false,
    };
  snapshot ||= captureSnapshot(repo);
  const names = new Set(
    [
      ...Object.keys(evidence.snapshot?.files || {}),
      ...Object.keys(snapshot.files),
    ].filter(
      (p) => !task.scope.length || task.scope.some((s) => inScope(p, s)),
    ),
  );
  const current =
    evidence.result === "passed" &&
    [...names].every(
      (p) => evidence.snapshot?.files?.[p] === snapshot.files[p],
    ) &&
    JSON.stringify(repo.config.verification?.[evidence.check]?.command) ===
      JSON.stringify(evidence.command) &&
    evidence.intentHash === intentHash(task, repo);
  return {
    verification: current ? "current" : "stale",
    integrated: snapshot.committed && current,
    verifiedComplete:
      task.kind === "work" && task.status === "verified" && current,
  };
}

export function reconcile(repo, rt, options = {}) {
  const state = project(repo, rt, null, options),
    snapshot = state.tasks.some((t) => t.evidence.length)
      ? captureSnapshot(repo)
      : null;
  for (const task of state.tasks) {
    Object.assign(task, assessEvidence(repo, task, snapshot));
  }
  const taskMap = new Map(state.tasks.map((t) => [t.id, t]));
  for (const task of state.tasks)
    task.blockedBy = task.dependencies.filter(
      (id) => !taskMap.get(id)?.verifiedComplete,
    );
  return state;
}
