import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  atomic,
  json,
  git,
  repoAt,
  home,
  id,
  digest,
  managed,
  redact,
  captureSnapshot,
} from "./util.js";
import { ensureProjectHooks } from "./git-hooks.js";

export const INSTRUCTIONS = `DIP automatically records prompts, tool activity, file batches and Git lifecycle events. Do not log each edit manually or call an extra model.\nUse the dip MCP tools for intent only: creating/refining tasks, dependencies, decisions, meaningful checkpoints and verification.\nAt session start, read the compact context supplied by the hook. Use project_context only when more detail is needed.\nClaim a task before working; the hook creates a lightweight request/task if none is selected. Separate worktrees isolate parallel agents.\nCheckpoint unfinished work before handing off. Never mark a task verified from your own assertion: run configured checks using task_verify.\nA completed agent turn does not mean completed work. Scope changes must update the task; future ideas belong in backlog.\nFallback CLI: dip task create --title "..."; dip context; dip task checkpoint --id ID --summary "...".\nRun dip doctor to see automation coverage and health. Data lives in .dip and follows Git; commit it with the work.`;

export function ensure(cwd = process.cwd(), { instructions = true } = {}) {
  const repo = repoAt(cwd),
    dir = path.join(repo.root, ".dip");
  if (
    fs.existsSync(dir) &&
    (!fs.lstatSync(dir).isDirectory() || fs.lstatSync(dir).isSymbolicLink())
  )
    throw new Error("Ledger directory must be a real project directory");
  const eventDirectory = path.join(dir, "events");
  if (
    fs.existsSync(eventDirectory) &&
    (!fs.lstatSync(eventDirectory).isDirectory() ||
      fs.lstatSync(eventDirectory).isSymbolicLink())
  )
    throw new Error("Event directory must be a real project directory");
  fs.mkdirSync(path.join(dir, "events"), { recursive: true });
  const configPath = path.join(dir, "config.json");
  if (fs.existsSync(configPath) && fs.lstatSync(configPath).isSymbolicLink())
    throw new Error("Ledger configuration must not be a symbolic link");
  if (!fs.existsSync(configPath)) {
    try {
      fs.writeFileSync(
        configPath,
        JSON.stringify(
          { schemaVersion: 1, verification: {}, mode: "coordinate" },
          null,
          2,
        ) + "\n",
        { flag: "wx" },
      );
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
    }
  }
  const config = json(configPath);
  if (config.schemaVersion !== 1) throw new Error("Unsupported project schema");
  if (instructions)
    for (const name of ["AGENTS.md", "CLAUDE.md"])
      managed(path.join(repo.root, name), INSTRUCTIONS);
  ensureProjectHooks(repo);
  return { ...repo, dir, config };
}

export class Runtime {
  constructor(directory = home()) {
    fs.mkdirSync(directory, { recursive: true });
    this.db = new DatabaseSync(path.join(directory, "runtime.sqlite"));
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS leases (repo TEXT, task TEXT, actor TEXT, token TEXT, expires INTEGER, scope TEXT DEFAULT '[]', PRIMARY KEY(repo,task));
      CREATE TABLE IF NOT EXISTS sessions (repo TEXT, session TEXT, task TEXT, actor TEXT, prompt TEXT, last INTEGER, PRIMARY KEY(repo,session));
      CREATE TABLE IF NOT EXISTS queue (id TEXT PRIMARY KEY, root TEXT, session TEXT, data TEXT, at INTEGER);
      CREATE TABLE IF NOT EXISTS repositories (root TEXT PRIMARY KEY, family TEXT, last INTEGER);`);
  }
  close() {
    this.db.close();
  }
  register(repo) {
    this.db
      .prepare("INSERT OR REPLACE INTO repositories VALUES (?,?,?)")
      .run(repo.root, repo.key, Date.now());
  }
  repositories() {
    return this.db.prepare("SELECT * FROM repositories").all();
  }
  session(repo, session) {
    return this.db
      .prepare("SELECT * FROM sessions WHERE repo=? AND session=?")
      .get(repo.key, session);
  }
  setSession(repo, session, task, actor, prompt = "") {
    this.db
      .prepare("INSERT OR REPLACE INTO sessions VALUES (?,?,?,?,?,?)")
      .run(repo.key, session, task, actor, redact(prompt), Date.now());
  }
  claim(repo, task, actor, ttl = 120000, scope = []) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const now = Date.now(),
        current = this.db
          .prepare("SELECT * FROM leases WHERE repo=? AND task=?")
          .get(repo.key, task);
      if (current && current.expires > now && current.actor !== actor)
        throw new Error(
          `Task owned by ${current.actor} until ${new Date(current.expires).toISOString()}`,
        );
      for (const other of this.db
        .prepare(
          "SELECT task, scope FROM leases WHERE repo=? AND task<>? AND expires>?",
        )
        .all(repo.key, task, now)) {
        if (
          scope.some((s) =>
            JSON.parse(other.scope).some(
              (o) => s === o || s.startsWith(o + "/") || o.startsWith(s + "/"),
            ),
          )
        )
          throw new Error(`Scope owned by ${other.task}`);
      }
      const token =
        current?.expires > now && current.actor === actor
          ? current.token
          : id();
      this.db
        .prepare("INSERT OR REPLACE INTO leases VALUES (?,?,?,?,?,?)")
        .run(repo.key, task, actor, token, now + ttl, JSON.stringify(scope));
      this.db.exec("COMMIT");
      return { task, actor, token, expires: now + ttl };
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  assert(repo, task, token) {
    const lease = this.db
      .prepare("SELECT * FROM leases WHERE repo=? AND task=?")
      .get(repo.key, task);
    if (!lease || lease.token !== token || lease.expires <= Date.now())
      throw new Error("Ownership expired or changed; claim the task again");
    return lease;
  }
  heartbeat(repo, task, token) {
    this.assert(repo, task, token);
    this.db
      .prepare(
        "UPDATE leases SET expires=? WHERE repo=? AND task=? AND token=?",
      )
      .run(Date.now() + 120000, repo.key, task, token);
  }
  release(repo, task, token) {
    this.assert(repo, task, token);
    this.db
      .prepare("DELETE FROM leases WHERE repo=? AND task=? AND token=?")
      .run(repo.key, task, token);
  }
  leases(repo) {
    return this.db
      .prepare("SELECT task, actor, expires, scope FROM leases WHERE repo=?")
      .all(repo.key)
      .map((l) => ({
        ...l,
        scope: JSON.parse(l.scope),
        active: l.expires > Date.now(),
      }));
  }
  enqueue(repo, session, data, key = id()) {
    this.db
      .prepare("INSERT OR IGNORE INTO queue VALUES (?,?,?,?,?)")
      .run(
        key,
        repo.root,
        session,
        JSON.stringify({ ...data, recordId: key }),
        Date.now(),
      );
  }
  flush(root = null) {
    const rows = root
      ? this.db
          .prepare("SELECT * FROM queue WHERE root=? ORDER BY at LIMIT 500")
          .all(root)
      : this.db.prepare("SELECT * FROM queue ORDER BY at LIMIT 500").all();
    const groups = new Map();
    for (const row of rows) {
      const key = row.root + "\0" + row.session;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(row);
    }
    for (const group of groups.values()) {
      const repo = ensure(group[0].root, { instructions: false });
      const eventId = digest(group.map((r) => r.id).join("\0"));
      append(
        repo,
        "_activity",
        "activity.batch",
        {
          session: group[0].session,
          records: group.map((r) => JSON.parse(r.data)),
        },
        { eventId, actor: "recorder", parents: [] },
      );
      this.db.exec("BEGIN IMMEDIATE");
      try {
        for (const row of group)
          this.db.prepare("DELETE FROM queue WHERE id=?").run(row.id);
        this.db.exec("COMMIT");
      } catch (e) {
        this.db.exec("ROLLBACK");
        throw e;
      }
    }
    return rows.length;
  }
}

function validateId(value) {
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(value))
    throw new Error("Invalid record ID");
  return value;
}
export function events(repo, task = null) {
  const result = [],
    errors = [],
    base = path.join(repo.dir, "events");
  const dirs = task
    ? [validateId(task)]
    : fs.readdirSync(base).filter((n) => /^[a-zA-Z0-9_-]+$/.test(n));
  for (const dir of dirs) {
    const folder = path.join(base, dir);
    if (!fs.existsSync(folder)) continue;
    if (
      !fs.lstatSync(folder).isDirectory() ||
      fs.lstatSync(folder).isSymbolicLink()
    ) {
      errors.push({
        file: dir,
        error: "Event folder must be a real directory",
      });
      continue;
    }
    for (const file of fs
      .readdirSync(folder)
      .filter((n) => n.endsWith(".json"))) {
      try {
        const e = json(path.join(folder, file));
        if (
          e.schemaVersion !== 1 ||
          e.taskId !== dir ||
          !Array.isArray(e.parents) ||
          !e.eventId ||
          !e.type ||
          !e.payload ||
          typeof e.payload !== "object"
        )
          throw new Error("Invalid event schema");
        if (`${e.eventId}.json` !== file)
          throw new Error("Event ID differs from filename");
        if (e.type === "activity.batch" && !Array.isArray(e.payload.records))
          throw new Error("Activity records must be an array");
        if (["task.create", "task.update", "task.resolve"].includes(e.type))
          updateValidation(e.payload);
        result.push(e);
      } catch (e) {
        errors.push({ file: `${dir}/${file}`, error: e.message });
      }
    }
  }
  return { events: result, errors };
}
export function append(repo, task, type, payload, options = {}) {
  validateId(task);
  const current = events(repo, task);
  if (current.errors.length)
    throw new Error("Repair corrupt events before updating this record");
  const parents = options.parents ?? heads(current.events);
  const event = {
    schemaVersion: 1,
    eventId: options.eventId || id(),
    taskId: task,
    type,
    payload,
    actor: options.actor || "human",
    createdAt: new Date().toISOString(),
    parents,
    branch: repo.branch,
  };
  validateId(event.eventId);
  const file = path.join(repo.dir, "events", task, `${event.eventId}.json`);
  if (fs.existsSync(file)) return json(file);
  atomic(file, event);
  return event;
}
function heads(list) {
  const parents = new Set(list.flatMap((e) => e.parents));
  return list.filter((e) => !parents.has(e.eventId)).map((e) => e.eventId);
}
export function project(repo, runtime = null, taskOnly = null) {
  const { events: all, errors } = events(repo, taskOnly),
    byTask = new Map(),
    activity = [],
    seenActivity = new Set();
  for (const e of all) {
    if (e.type === "activity.batch") {
      for (const r of e.payload.records) {
        if (r.recordId && seenActivity.has(r.recordId)) continue;
        if (r.recordId) seenActivity.add(r.recordId);
        activity.push({ ...r, eventId: e.eventId });
      }
      continue;
    }
    if (!byTask.has(e.taskId)) byTask.set(e.taskId, []);
    byTask.get(e.taskId).push(e);
  }
  const tasks = [];
  for (const [taskId, list] of byTask) {
    const map = new Map(list.map((e) => [e.eventId, e])),
      ancestors = new Map(),
      visiting = new Set();
    const ancestor = (eid) => {
      if (ancestors.has(eid)) return ancestors.get(eid);
      if (visiting.has(eid)) throw new Error("Cyclic event history");
      const event = map.get(eid);
      if (!event) throw new Error(`Missing parent ${eid}`);
      visiting.add(eid);
      const values = new Set(event.parents);
      for (const p of event.parents) for (const a of ancestor(p)) values.add(a);
      visiting.delete(eid);
      ancestors.set(eid, values);
      return values;
    };
    let ordered;
    try {
      for (const e of list) ancestor(e.eventId);
      ordered = [...list].sort(
        (a, b) =>
          ancestors.get(a.eventId).size - ancestors.get(b.eventId).size ||
          a.eventId.localeCompare(b.eventId),
      );
    } catch (e) {
      errors.push({ task: taskId, error: e.message });
      continue;
    }
    const state = {
      id: taskId,
      title: "",
      status: "backlog",
      dependencies: [],
      scope: [],
      checkpoints: [],
      decisions: [],
      evidence: [],
      history: ordered,
      heads: heads(list),
      conflicts: [],
    };
    const writes = new Map();
    for (const e of ordered) {
      if (
        e.type === "task.create" ||
        e.type === "task.update" ||
        e.type === "task.resolve"
      ) {
        for (const [key, value] of Object.entries(e.payload)) {
          if (
            ![
              "title",
              "description",
              "status",
              "dependencies",
              "scope",
              "priority",
              "due",
              "acceptance",
              "supersedes",
            ].includes(key)
          )
            continue;
          if (!writes.has(key)) writes.set(key, []);
          const previous = writes
            .get(key)
            .filter((w) => !ancestors.get(e.eventId).has(w.eventId));
          previous.push(e);
          writes.set(key, previous);
          state[key] = value;
        }
      }
      if (e.type === "task.checkpoint")
        state.checkpoints.push({
          ...e.payload,
          at: e.createdAt,
          actor: e.actor,
        });
      if (e.type === "task.decision")
        state.decisions.push({ ...e.payload, at: e.createdAt, actor: e.actor });
      if (e.type === "task.evidence")
        state.evidence.push({ ...e.payload, at: e.createdAt });
      state.updatedAt = e.createdAt;
    }
    for (const [field, writers] of writes)
      if (
        new Set(writers.map((w) => JSON.stringify(w.payload[field]))).size > 1
      )
        state.conflicts.push({
          field,
          alternatives: writers.map((e) => ({
            eventId: e.eventId,
            value: e.payload[field],
            actor: e.actor,
          })),
        });
    if (state.conflicts.length) state.status = "conflict";
    const lease = runtime?.leases(repo).find((l) => l.task === taskId);
    state.lease = lease || null;
    state.active = lease?.active || false;
    state.interrupted = state.status === "in_progress" && !state.active;
    tasks.push(state);
  }
  const taskMap = new Map(tasks.map((t) => [t.id, t]));
  for (const task of tasks) {
    task.blockedBy = task.dependencies.filter(
      (d) => !["verified", "done"].includes(taskMap.get(d)?.status),
    );
    const visit = (t, seen) => {
      if (seen.has(t.id)) return true;
      const next = new Set(seen).add(t.id);
      return t.dependencies.some(
        (d) => taskMap.has(d) && visit(taskMap.get(d), next),
      );
    };
    task.dependencyCycle = visit(task, new Set());
  }
  return {
    repo: {
      root: repo.root,
      branch: repo.branch,
      head: repo.head,
      family: repo.key,
    },
    tasks,
    activity: activity.sort((a, b) => String(b.at).localeCompare(String(a.at))),
    errors,
  };
}
export function createTask(repo, payload, actor = "human") {
  if (!payload.title?.trim()) throw new Error("Task title is required");
  const taskId = "task_" + id();
  updateValidation({ ...payload, status: payload.status || "backlog" });
  append(
    repo,
    taskId,
    "task.create",
    {
      ...payload,
      title: redact(payload.title),
      description: redact(payload.description || ""),
      status: payload.status || "backlog",
    },
    { actor },
  );
  return taskId;
}
export function updateValidation(patch) {
  if (
    patch.status &&
    ![
      "backlog",
      "ready",
      "in_progress",
      "blocked",
      "implemented",
      "verified",
      "done",
      "cancelled",
      "superseded",
    ].includes(patch.status)
  )
    throw new Error("Unknown task status");
  if (
    patch.dependencies &&
    (!Array.isArray(patch.dependencies) ||
      patch.dependencies.some((d) => !/^[\w-]+$/.test(d)))
  )
    throw new Error("Invalid dependencies");
  if (
    patch.scope &&
    (!Array.isArray(patch.scope) ||
      patch.scope.some(
        (p) =>
          typeof p !== "string" ||
          path.isAbsolute(p) ||
          p.split(/[\\/]/).includes(".."),
      ))
  )
    throw new Error("Scope must contain project-relative paths");
}
export function taskGet(repo, taskId) {
  const task = project(repo).tasks.find((t) => t.id === taskId);
  if (!task) throw new Error("Task not found");
  return task;
}
export function taskRead(repo, taskId) {
  const task = project(repo, null, taskId).tasks[0];
  if (!task) throw new Error("Task not found");
  return task;
}
export function updateTask(
  repo,
  taskId,
  patch,
  actor = "human",
  resolve = false,
) {
  const task = taskGet(repo, taskId);
  updateValidation(patch);
  if (patch.status === "verified" || patch.status === "done")
    throw new Error("Use verification to establish completion");
  if (task.conflicts.length && !resolve)
    throw new Error("Resolve task conflicts first");
  if (patch.dependencies?.includes(taskId))
    throw new Error("A task cannot depend on itself");
  for (const dep of patch.dependencies || []) taskGet(repo, dep);
  append(repo, taskId, resolve ? "task.resolve" : "task.update", patch, {
    actor,
  });
  return taskGet(repo, taskId);
}
export function compactContext(repo, runtime) {
  const state = project(repo, runtime);
  return {
    branch: repo.branch,
    errors: state.errors,
    active: state.tasks.filter((t) => t.active).map(brief),
    resume: state.tasks
      .filter((t) => t.interrupted)
      .map(brief)
      .slice(0, 5),
    ready: state.tasks
      .filter(
        (t) =>
          ["ready", "backlog"].includes(t.status) &&
          !t.blockedBy.length &&
          !t.dependencyCycle,
      )
      .map(brief)
      .slice(0, 5),
    recent: state.tasks
      .filter((t) => ["implemented", "verified"].includes(t.status))
      .slice(-5)
      .map(brief),
    instructions:
      "Activity capture is automatic. Use MCP for intent, scope changes, handoff and configured verification only.",
  };
}
const brief = (t) => ({
  id: t.id,
  title: t.title,
  status: t.status,
  scope: t.scope,
  checkpoint: t.checkpoints.at(-1)?.summary,
});
