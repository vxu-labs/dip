import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { home } from "./util.js";
import { taskRead, events, validateId } from "./core.js";
import {
  captureSnapshot,
  digest,
  inScope,
  canonicalScope,
  redact,
} from "./util.js";
import { documentState } from "./documents.js";
import { planIntent } from "./workflow.js";

const STATES = [
  "backlog",
  "ready",
  "in_progress",
  "blocked",
  "implemented",
  "verified",
  "cancelled",
  "superseded",
  "conflict",
];
const clip = (s, n = 1000) => redact(s).slice(0, n);
const overlap = (a, b) => inScope(a, b) || inScope(b, a);
function page(args, max = 50) {
  const limit = Number(args.limit ?? 10),
    offset = Number(args.offset ?? 0);
  if (
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > max ||
    !Number.isInteger(offset) ||
    offset < 0
  )
    throw new Error(`limit must be 1..${max}, offset nonnegative`);
  return { limit, offset };
}
function scopeInput(args) {
  const values = args.scope || (args.path !== undefined ? [args.path] : []);
  if (
    !Array.isArray(values) ||
    values.length > 20 ||
    values.some(
      (s) =>
        typeof s !== "string" ||
        s.length > 1024 ||
        /[:\x00-\x1f]/.test(s) ||
        /^[\\/]/.test(s) ||
        s.replaceAll("\\", "/").split("/").includes(".."),
    )
  )
    throw new Error("Use at most 20 project-relative scopes");
  return values.map((s) => canonicalScope(s));
}
function statuses(args) {
  const values =
    args.statuses ||
    (args.status
      ? [args.status]
      : STATES.filter((s) => !["cancelled", "superseded"].includes(s)));
  if (
    !Array.isArray(values) ||
    !values.length ||
    values.length > STATES.length ||
    values.some((s) => !STATES.includes(s))
  )
    throw new Error("Invalid status filter");
  return [...new Set(values)];
}
function taskSummary(t) {
  return {
    id: t.id,
    title: clip(t.title, 300),
    status: t.status,
    scope: t.scope.slice(0, 20),
    dependencyCount: t.dependencies.length,
    documentCount: t.documents.length,
    verification: "not_checked",
  };
}

// Disposable SQLite cache. Canonical data remains the Git-backed event ledger.
function index(repo, rt) {
  const table = "navigation_text_" + digest(repo.root).slice(0, 24);
  const existed = !!rt.db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
    .get(table);
  rt.db
    .exec(`CREATE TABLE IF NOT EXISTS navigation_tasks (root TEXT, id TEXT, signature TEXT, data TEXT, PRIMARY KEY(root,id));
    CREATE VIRTUAL TABLE IF NOT EXISTS ${table} USING fts5(root UNINDEXED, key UNINDEXED, task_id UNINDEXED, kind UNINDEXED, event_id UNINDEXED, text, tokenize='unicode61');`);
  if (!existed)
    rt.db.prepare("DELETE FROM navigation_tasks WHERE root=?").run(repo.root);
  const base = path.join(repo.dir, "events");
  const folders = fs
    .readdirSync(base)
    .filter((n) => n !== "_activity" && /^[a-zA-Z0-9_-]+$/.test(n));
  const old = new Map(
    rt.db
      .prepare("SELECT id,signature FROM navigation_tasks WHERE root=?")
      .all(repo.root)
      .map((r) => [r.id, r.signature]),
  );
  const errors = [];
  let refreshed = 0;
  rt.db.exec("BEGIN IMMEDIATE");
  try {
    for (const id of folders) {
      old.delete(id);
      try {
        const directory = path.join(base, id),
          stat = fs.lstatSync(directory);
        if (!stat.isDirectory() || stat.isSymbolicLink())
          throw new Error("Invalid task directory");
        const signature = digest(
          JSON.stringify(
            fs
              .readdirSync(directory)
              .filter((s) => s.endsWith(".json"))
              .sort()
              .map((name) => {
                const s = fs.lstatSync(path.join(directory, name));
                return [name, s.size, s.mtimeMs, s.ctimeMs, s.isSymbolicLink()];
              }),
          ),
        );
        if (
          rt.db
            .prepare(
              "SELECT signature FROM navigation_tasks WHERE root=? AND id=?",
            )
            .get(repo.root, id)?.signature === signature
        )
          continue;
        if (events(repo, id).errors.length)
          throw new Error("Task has corrupt events");
        const t = taskRead(repo, id);
        const data = {
          ...taskSummary(t),
          scope: t.scope,
          dependencies: t.dependencies,
          documents: t.documents.map((d) => ({ path: d.path, role: d.role })),
          heads: t.heads,
        };
        rt.db
          .prepare(`DELETE FROM ${table} WHERE root=? AND task_id=?`)
          .run(repo.root, id);
        rt.db
          .prepare("INSERT OR REPLACE INTO navigation_tasks VALUES (?,?,?,?)")
          .run(repo.root, id, signature, JSON.stringify(data));
        const insert = (kind, eventId, text) =>
          rt.db
            .prepare(
              `INSERT INTO ${table}(root,key,task_id,kind,event_id,text) VALUES (?,?,?,?,?,?)`,
            )
            .run(
              repo.root,
              id + ":" + kind + ":" + eventId,
              id,
              kind,
              eventId,
              text.slice(0, 40000),
            );
        insert(
          "task",
          t.heads.join(","),
          [
            clip(t.title, 300),
            clip(t.description, 12000),
            clip(t.acceptance.join("\n"), 12000),
            clip(JSON.stringify(planIntent(t.plan)), 8000),
            t.scope.join(" "),
            t.documents.map((d) => d.path).join(" "),
          ].join("\n"),
        );
        for (const e of t.history.filter((e) => e.type === "task.decision"))
          insert(
            "decision",
            e.eventId,
            clip(t.title, 300) +
              "\n" +
              clip(e.payload.summary, 8000) +
              "\n" +
              clip(e.payload.next, 1000),
          );
        refreshed++;
      } catch (e) {
        rt.db
          .prepare(`DELETE FROM ${table} WHERE root=? AND task_id=?`)
          .run(repo.root, id);
        rt.db
          .prepare("DELETE FROM navigation_tasks WHERE root=? AND id=?")
          .run(repo.root, id);
        errors.push({ id, error: clip(e.message, 200) });
      }
    }
    for (const id of old.keys()) {
      rt.db
        .prepare(`DELETE FROM ${table} WHERE root=? AND task_id=?`)
        .run(repo.root, id);
      rt.db
        .prepare("DELETE FROM navigation_tasks WHERE root=? AND id=?")
        .run(repo.root, id);
    }
    rt.db
      .prepare(
        `DELETE FROM ${table} WHERE task_id NOT IN (SELECT id FROM navigation_tasks WHERE root=?)`,
      )
      .run(repo.root);
    rt.db.exec("COMMIT");
  } catch (e) {
    rt.db.exec("ROLLBACK");
    throw e;
  }
  return {
    table,
    tasks: rt.db
      .prepare("SELECT data FROM navigation_tasks WHERE root=? ORDER BY id")
      .all(repo.root)
      .map((r) => JSON.parse(r.data)),
    refreshed,
    errors: errors.slice(0, 10),
    errorCount: errors.length,
  };
}

function relations(seed, t) {
  const labels = [];
  if (seed.dependencies.includes(t.id)) labels.push("dependency");
  if (t.dependencies.includes(seed.id)) labels.push("dependent");
  if (seed.scope.some((s) => t.scope.some((p) => overlap(s, p))))
    labels.push("overlapping_scope");
  if (
    seed.documents.some((d) =>
      t.documents.some(
        (other) => canonicalScope(d.path) === canonicalScope(other.path),
      ),
    )
  )
    labels.push("shared_document");
  return labels;
}

function search(repo, rt, args) {
  if (typeof args.query !== "string" || args.query.length > 1000)
    throw new Error("query is required and limited to 1000 characters");
  const terms = [
    ...new Set(args.query.toLowerCase().match(/[\p{L}\p{N}_]+/gu) || []),
  ].slice(0, 24);
  if (!terms.length) throw new Error("Query must contain words");
  const { limit, offset } = page(args),
    allowed = statuses(args),
    scopes = scopeInput(args),
    cache = index(repo, rt);
  if (args.kind && !["task", "decision"].includes(args.kind))
    throw new Error("kind must be task or decision");
  const metadata = new Map(cache.tasks.map((t) => [t.id, t]));
  if (args.id) validateId(args.id);
  const seed = args.id ? metadata.get(args.id) : null;
  if (args.id && !seed) throw new Error("Task not found");
  const eligible = new Set(
    cache.tasks
      .filter(
        (t) =>
          allowed.includes(t.status) &&
          (!scopes.length ||
            t.scope.some((s) => scopes.some((p) => overlap(s, p)))),
      )
      .map((t) => t.id),
  );
  const expression = terms.map((s) => '"' + s + '"').join(" OR ");
  const rows = rt.db
    .prepare(
      `SELECT task_id,kind,event_id,snippet(${cache.table},5,'','',' … ',48) AS text,length(text) AS textLength,bm25(${cache.table}) AS rank FROM ${cache.table} WHERE ${cache.table} MATCH ? AND root=? ORDER BY rank,key`,
    )
    .all(expression, repo.root)
    .filter(
      (r) => eligible.has(r.task_id) && (!args.kind || args.kind === r.kind),
    );
  const hits = rows
    .map((r) => ({
      ...r,
      links:
        seed && seed.id !== r.task_id
          ? relations(seed, metadata.get(r.task_id))
          : [],
    }))
    .sort(
      (a, b) =>
        b.links.length - a.links.length ||
        a.rank - b.rank ||
        a.task_id.localeCompare(b.task_id) ||
        a.event_id.localeCompare(b.event_id),
    );
  return {
    strategy: "lexical-graph",
    identityEstablished: false,
    queryTerms: terms,
    total: hits.length,
    nextOffset: offset + limit < hits.length ? offset + limit : null,
    hits: hits.slice(offset, offset + limit).map((r) => ({
      ...taskSummary(metadata.get(r.task_id)),
      kind: r.kind,
      eventIds: r.event_id.split(",").slice(0, 10),
      relevance: -r.rank,
      relations: r.links,
      excerpt: clip(r.text, 800),
      textTruncated: r.textLength > r.text.length || r.text.length > 800,
    })),
    index: {
      refreshedTasks: cache.refreshed,
      errors: cache.errors,
      errorCount: cache.errorCount,
    },
    limitations:
      "Lexical and explicit graph candidates, not semantic equivalence or completion evidence. Neural encoder evaluation remains open.",
  };
}

export function navigate(repo, rt, action, args, helpers) {
  if (!["search", "related"].includes(action))
    return navigateRead(repo, rt, action, args, helpers);
  const db = new DatabaseSync(path.join(home(), "navigation.sqlite"));
  try {
    db.exec("PRAGMA busy_timeout=5000");
    if (db.prepare("PRAGMA journal_mode").get().journal_mode !== "wal")
      db.exec("PRAGMA journal_mode=WAL");
    return navigateRead(repo, { db }, action, args, helpers);
  } finally {
    db.close();
  }
}

function navigateRead(repo, rt, action, args, helpers) {
  const { limit, offset } = page(args);
  if (action === "search") return search(repo, rt, args);
  if (action === "owners") {
    const scopes = scopeInput(args);
    if (!scopes.length)
      throw new Error("A component path or scope is required");
    const owners = rt
      .leases(repo)
      .filter(
        (l) =>
          l.active && l.scope.some((s) => scopes.some((p) => overlap(s, p))),
      );
    owners.sort((a, b) => a.task.localeCompare(b.task));
    return {
      coordination: "local-worktree-family",
      observedAt: new Date().toISOString(),
      total: owners.length,
      owners: owners.slice(offset, offset + limit).map((l) => ({
        task: l.task,
        actor: l.actor,
        expires: l.expires,
        matchedScopes: l.scope
          .filter((s) => scopes.some((p) => overlap(s, p)))
          .slice(0, 20),
        root: l.descriptor.root,
        branch: l.descriptor.branch,
      })),
      nextOffset: offset + limit < owners.length ? offset + limit : null,
      requiresAtomicClaim: true,
    };
  }
  if (action === "related") {
    validateId(args.id);
    const cache = index(repo, rt),
      seed = cache.tasks.find((t) => t.id === args.id);
    if (!seed) throw new Error("Task not found");
    const allowed = statuses(args),
      hits = cache.tasks
        .filter((t) => t.id !== seed.id && allowed.includes(t.status))
        .map((t) => ({ ...taskSummary(t), relations: relations(seed, t) }))
        .filter((t) => t.relations.length);
    return {
      id: seed.id,
      strategy: "explicit-graph",
      identityEstablished: false,
      total: hits.length,
      tasks: hits.slice(offset, offset + limit),
      nextOffset: offset + limit < hits.length ? offset + limit : null,
      errors: cache.errors,
    };
  }
  validateId(args.id);
  const task = taskRead(repo, args.id);
  if (action === "requirements") {
    const maxChars = Number(args.maxChars ?? 6000);
    if (!Number.isInteger(maxChars) || maxChars < 500 || maxChars > 16000)
      throw new Error("maxChars must be 500..16000");
    const description = clip(
      task.description,
      Math.min(2000, Math.floor(maxChars / 3)),
    );
    let remaining = maxChars - description.length;
    const acceptance = task.acceptance
      .slice(offset, offset + limit)
      .map((text, i) => {
        const excerpt = clip(text, Math.min(1000, remaining));
        remaining -= excerpt.length;
        return {
          index: offset + i,
          text: excerpt,
          truncated: excerpt.length < redact(text).length,
        };
      });
    const docs = task.documents.slice(0, 20).map((d) => {
      const state = documentState(repo, d);
      return {
        path: d.path,
        role: d.role,
        hash: d.hash,
        currentness: state.currentness,
        currentHash: state.currentHash,
      };
    });
    const prerequisiteTasks = task.dependencies.slice(0, 20).map((id) => {
      try {
        return taskRead(repo, id);
      } catch {
        return { id, missing: true };
      }
    });
    const snapshot =
      task.evidence.length || prerequisiteTasks.some((t) => t.evidence?.length)
        ? captureSnapshot(repo)
        : null;
    const dependencies = prerequisiteTasks.map((dep) => {
      try {
        if (dep.missing) throw new Error("Missing dependency");
        return {
          id: dep.id,
          status: dep.status,
          ...helpers.assessEvidence(repo, dep, snapshot),
        };
      } catch {
        return { id: dep.id, verification: "missing", verifiedComplete: false };
      }
    });
    const applicable = !["cancelled", "superseded"].includes(task.status);
    return {
      ...taskSummary(task),
      ...helpers.assessEvidence(repo, task, snapshot),
      applicable,
      requiresReview:
        !!task.conflicts.length ||
        task.documents.length > 20 ||
        task.dependencies.length > 20 ||
        docs.some((d) => d.currentness !== "current"),
      description,
      descriptionTruncated:
        description.length < redact(task.description).length,
      acceptance,
      totalAcceptance: task.acceptance.length,
      nextOffset:
        offset + limit < task.acceptance.length ? offset + limit : null,
      documents: docs,
      documentsTruncated: task.documents.length > 20,
      dependencies,
      dependenciesTruncated: task.dependencies.length > 20,
      conflicts: task.conflicts.slice(0, 10).map((c) => ({
        field: c.field,
        eventIds: c.alternatives.slice(0, 10).map((a) => a.eventId),
      })),
      plan: task.plan
        ? {
            at: task.plan.at,
            tool: task.plan.tool,
            excerpt: clip(
              JSON.stringify(planIntent(task.plan)),
              Math.min(1000, remaining),
            ),
            establishesCompletion: false,
          }
        : null,
      sourceHeads: task.heads.slice(0, 10),
      documentReadTool: "task_document_read",
      fullIntentTool: "task_get",
    };
  }
  if (action === "changes") {
    const e = task.evidence.at(-1);
    if (!e)
      return {
        id: task.id,
        baseline: null,
        verification: "missing",
        changes: [],
        needsVerification: true,
      };
    const snapshot = captureSnapshot(repo),
      files = e.snapshot?.files || {};
    const names = [
      ...new Set([...Object.keys(files), ...Object.keys(snapshot.files)]),
    ]
      .filter(
        (p) => !task.scope.length || task.scope.some((s) => inScope(p, s)),
      )
      .sort();
    const changes = names
      .filter((p) => files[p] !== snapshot.files[p])
      .map((p) => ({
        path: p,
        change:
          files[p] === undefined || files[p] === "deleted"
            ? "added"
            : snapshot.files[p] === undefined || snapshot.files[p] === "deleted"
              ? "deleted"
              : "modified",
      }));
    const fields = helpers.intentFields(task, repo),
      changedFields = e.intentFields
        ? Object.keys(fields).filter((k) => fields[k] !== e.intentFields[k])
        : null;
    return {
      id: task.id,
      baseline: {
        check: e.check,
        at: e.at,
        result: e.result,
        snapshot: e.snapshot?.hash,
      },
      ...helpers.assessEvidence(repo, task, snapshot),
      totalFileChanges: changes.length,
      changes: changes.slice(offset, offset + limit),
      nextOffset: offset + limit < changes.length ? offset + limit : null,
      intentChanged: e.intentHash !== helpers.intentHash(task, repo),
      changedIntentFields: changedFields,
      intentDetailsAvailable: !!e.intentFields,
      checkConfigurationChanged:
        JSON.stringify(repo.config.verification?.[e.check]?.command) !==
        JSON.stringify(e.command),
      documents: task.documents.slice(0, 20).map((d) => documentState(repo, d)),
      documentsTruncated: task.documents.length > 20,
    };
  }
  throw new Error("Unknown navigation action");
}
