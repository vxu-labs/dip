import { spawn } from "node:child_process";
import {
  ensure,
  Runtime,
  project,
  compactContext,
  createTask,
  taskGet,
  updateTask,
  append,
} from "./core.js";
import { captureSnapshot, redact, git } from "./util.js";

export async function execute(action, args = {}, cwd = process.cwd()) {
  const repo = ensure(cwd),
    rt = new Runtime();
  try {
    rt.register(repo);
    const actor = args.actor || "agent";
    if (action === "context") return compactContext(repo, rt);
    if (action === "status") {
      rt.flush(repo.root);
      return project(repo, rt);
    }
    if (action === "create") return { id: createTask(repo, args, actor) };
    if (action === "get") return taskGet(repo, args.id);
    if (action === "next")
      return reconcile(repo, rt)
        .tasks.filter(
          (t) =>
            !t.active &&
            !t.blockedBy.length &&
            !t.dependencyCycle &&
            ["ready", "backlog"].includes(t.status),
        )
        .slice(0, 10)
        .map((t) => ({
          id: t.id,
          title: t.title,
          status: t.status,
          scope: t.scope,
          priority: t.priority,
        }));
    if (action === "update" || action === "resolve") {
      if (args.token) rt.assert(repo, args.id, args.token);
      if (repo.config.mode === "strict" && !args.token)
        throw new Error("Strict mode requires an ownership token");
      return updateTask(
        repo,
        args.id,
        args.patch || {},
        actor,
        action === "resolve" || args.resolve === true,
      );
    }
    if (action === "claim") {
      const task = reconcile(repo, rt).tasks.find((t) => t.id === args.id);
      if (!task) throw new Error("Task not found");
      if (
        task.conflicts.length ||
        task.dependencyCycle ||
        task.blockedBy.length
      )
        throw new Error("Task has unresolved blockers");
      const lease = rt.claim(
        repo,
        args.id,
        actor,
        args.ttl || 120000,
        args.scope || task.scope,
      );
      if (args.scope) updateTask(repo, args.id, { scope: args.scope }, actor);
      append(
        repo,
        args.id,
        "task.update",
        { status: "in_progress" },
        { actor },
      );
      if (args.session) rt.setSession(repo, args.session, args.id, actor);
      return lease;
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
      if (args.token) rt.assert(repo, args.id, args.token);
      if (repo.config.mode === "strict" && !args.token)
        throw new Error("Strict mode requires an ownership token");
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
      if (args.token) rt.assert(repo, args.id, args.token);
      if (repo.config.mode === "strict" && !args.token)
        throw new Error("Strict mode requires an ownership token");
      return await verify(repo, args, actor);
    }
    if (action === "reconcile") return reconcile(repo, rt);
    throw new Error(`Unknown action ${action}`);
  } finally {
    rt.close();
  }
}

async function verify(repo, args, actor) {
  const task = taskGet(repo, args.id),
    name = args.check;
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
  const before = captureSnapshot(repo);
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
  const after = captureSnapshot(repo),
    passed = result.exitCode === 0 && before.hash === after.hash;
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
      codeHead: after.committed ? repo.head : null,
    },
    { actor },
  );
  if (passed)
    append(repo, args.id, "task.update", { status: "verified" }, { actor });
  return {
    passed,
    ...result,
    changedDuringCheck: before.hash !== after.hash,
    snapshot: after.hash,
  };
}
export function reconcile(repo, rt) {
  const state = project(repo, rt),
    snapshot = state.tasks.some((t) => t.evidence.length)
      ? captureSnapshot(repo)
      : null;
  for (const task of state.tasks) {
    const evidence = task.evidence.at(-1);
    if (!evidence) {
      task.verification = "missing";
      task.integrated = false;
      continue;
    }
    task.verification =
      evidence.result === "passed" && evidence.snapshot?.hash === snapshot.hash
        ? "current"
        : "stale";
    if (task.scope.length && evidence.result === "passed") {
      const names = new Set(
        [
          ...Object.keys(evidence.snapshot?.files || {}),
          ...Object.keys(snapshot.files),
        ].filter((p) =>
          task.scope.some((s) => p === s || p.startsWith(s + "/")),
        ),
      );
      task.verification = [...names].every(
        (p) => evidence.snapshot.files[p] === snapshot.files[p],
      )
        ? "current"
        : "stale";
    }
    if (
      JSON.stringify(repo.config.verification?.[evidence.check]?.command) !==
      JSON.stringify(evidence.command)
    )
      task.verification = "stale";
    task.integrated = snapshot.committed && task.verification === "current";
    task.verifiedComplete =
      task.status === "verified" && task.verification === "current";
  }
  const taskMap = new Map(state.tasks.map((t) => [t.id, t]));
  for (const task of state.tasks)
    task.blockedBy = task.dependencies.filter(
      (id) => !taskMap.get(id)?.verifiedComplete,
    );
  return state;
}
