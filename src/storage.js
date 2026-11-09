// Shared protocol-v2 storage. Git is the transport; SQLite is a durable local
// journal, never a Git blob. Raw activity is deliberately outside the transport.
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { gzipSync, gunzipSync } from "node:zlib";
import { execFileSync } from "node:child_process";
import { atomic, digest, git, home, id, json, repoAt } from "./util.js";
import { repositoryTemplates } from "./repository-integration.js";

export const STATE_REF = "refs/heads/dip/state";
export const DEFAULT_STORAGE = Object.freeze({
  activityBytes: 32 * 1024 ** 2,
  activityDays: 7,
  globalActivityBytes: 256 * 1024 ** 2,
  maxFiles: 128,
});
export const stable = (v) =>
  JSON.stringify(v, function (k, value) {
    return value && typeof value === "object" && !Array.isArray(value)
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => [key, value[key]]),
        )
      : value;
  });
export const storeDirectory = (repo) => path.join(repo.common, "dip");
export const sharedActive = (repo) =>
  json(path.join(storeDirectory(repo), "storage.json"), null)?.schemaVersion ===
  2;
export function recoverShared(repo) {
  if (sharedActive(repo)) return true;
  if (fs.existsSync(path.join(storeDirectory(repo), "migration.lock")))
    return false;
  const legacy = path.join(repo.root, ".dip", "events");
  if (fs.existsSync(legacy) && fs.readdirSync(legacy).length) return false;
  const known =
    git(repo.root, ["rev-parse", "--verify", STATE_REF], true) ||
    git(
      repo.root,
      ["rev-parse", "--verify", "refs/remotes/origin/dip/state"],
      true,
    );
  if (!known) return false;
  const manifest = importRef(repo, known);
  atomic(path.join(storeDirectory(repo), "storage.json"), {
    schemaVersion: 2,
    projectId: manifest.projectId,
    createdAt: new Date().toISOString(),
    retention: { ...DEFAULT_STORAGE },
  });
  registerStore(repo);
  return true;
}
export function initializeShared(repo) {
  if (recoverShared(repo)) return;
  withStore(repo, () => {});
  atomic(path.join(storeDirectory(repo), "storage.json"), {
    schemaVersion: 2,
    projectId: id(),
    createdAt: new Date().toISOString(),
    retention: { ...DEFAULT_STORAGE },
  });
  registerStore(repo);
}
const encode = (v) => gzipSync(Buffer.from(stable(v)));
const decode = (v) => JSON.parse(gunzipSync(v));
const identity = (value) => {
  if (typeof value !== "string" || !/^[\w-]{1,100}$/.test(value))
    throw Error("Invalid storage identity");
  return value;
};
function safeDirectory(dir) {
  if (
    fs.existsSync(dir) &&
    (!fs.lstatSync(dir).isDirectory() || fs.lstatSync(dir).isSymbolicLink())
  )
    throw Error("Shared storage must be a real directory");
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
}
export function openStore(repo) {
  const dir = storeDirectory(repo);
  safeDirectory(dir);
  const file = path.join(dir, "store.sqlite");
  if (fs.existsSync(file) && fs.lstatSync(file).isSymbolicLink())
    throw Error("Storage database cannot be a symbolic link");
  const db = new DatabaseSync(file);
  db.exec(
    "PRAGMA busy_timeout=10000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA auto_vacuum=INCREMENTAL;",
  );
  db.exec(`CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, task TEXT NOT NULL, type TEXT NOT NULL, created TEXT NOT NULL, hash TEXT NOT NULL, data BLOB NOT NULL);
    CREATE INDEX IF NOT EXISTS events_task ON events(task);
    CREATE TABLE IF NOT EXISTS artifacts (hash TEXT PRIMARY KEY, data BLOB NOT NULL);
    CREATE TABLE IF NOT EXISTS activity (id TEXT PRIMARY KEY, at INTEGER NOT NULL, bytes INTEGER NOT NULL, data BLOB NOT NULL);
    CREATE INDEX IF NOT EXISTS activity_at ON activity(at);
    CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);`);
  db.exec(
    "CREATE TABLE IF NOT EXISTS git_entries (name TEXT PRIMARY KEY, hash TEXT NOT NULL, oid TEXT NOT NULL)",
  );
  return db;
}
export function withStore(repo, fn) {
  const db = openStore(repo);
  try {
    return fn(db);
  } finally {
    db.close();
  }
}
function hydrate(db, event) {
  const ref = event.payload?.snapshot?.filesRef;
  if (ref) {
    if (!/^[a-f0-9]{64}$/.test(ref))
      throw Error("Invalid snapshot manifest reference");
    const row = db.prepare("SELECT data FROM artifacts WHERE hash=?").get(ref);
    if (!row) throw Error("Missing snapshot manifest " + ref);
    const files = decode(row.data);
    if (digest(stable(files)) !== ref)
      throw Error("Snapshot manifest hash mismatch");
    delete event.payload.snapshot.filesRef;
    event.payload.snapshot.files = files;
  }
  return event;
}
export function validateStoredEvent(e) {
  identity(e.eventId);
  identity(e.taskId);
  if (
    e.schemaVersion !== 1 ||
    !/^task\.(create|update|resolve|checkpoint|decision|plan|document|evidence|lifecycle)$/.test(
      e.type,
    ) ||
    typeof e.actor !== "string" ||
    typeof e.createdAt !== "string" ||
    !Array.isArray(e.parents) ||
    !e.payload ||
    typeof e.payload !== "object" ||
    Array.isArray(e.payload)
  )
    throw Error("Invalid semantic event schema");
  e.parents.forEach(identity);
  if (
    e.type === "task.create" &&
    (typeof e.payload.title !== "string" || !e.payload.title.trim())
  )
    throw Error("Task creation requires a title");
  for (const key of ["title", "description", "due"])
    if (e.payload[key] !== undefined && typeof e.payload[key] !== "string")
      throw Error("Invalid intent text");
  for (const key of ["scope", "acceptance", "dependencies"])
    if (
      e.payload[key] !== undefined &&
      (!Array.isArray(e.payload[key]) ||
        e.payload[key].some((v) => typeof v !== "string"))
    )
      throw Error("Invalid intent list");
}
function insertEvent(db, original) {
  validateStoredEvent(original);
  const event = structuredClone(original),
    hash = digest(stable(original));
  const old = db
    .prepare("SELECT hash FROM events WHERE id=?")
    .get(event.eventId);
  if (old) {
    if (old.hash !== hash)
      throw Error("Event ID has incompatible content: " + event.eventId);
    return false;
  }
  if (event.type === "task.evidence" && event.payload.snapshot?.files) {
    const files = event.payload.snapshot.files,
      ref = digest(stable(files));
    db.prepare("INSERT OR IGNORE INTO artifacts VALUES (?,?)").run(
      ref,
      encode(files),
    );
    delete event.payload.snapshot.files;
    event.payload.snapshot.filesRef = ref;
  }
  db.prepare("INSERT INTO events VALUES (?,?,?,?,?,?)").run(
    event.eventId,
    event.taskId,
    event.type,
    event.createdAt,
    hash,
    encode(event),
  );
  return true;
}
export function readShared(repo, task = null, { includeActivity = true } = {}) {
  drainPortable(repo);
  return withStore(repo, (db) => {
    const result = [],
      errors = [];
    const rows =
      task === "_activity"
        ? []
        : task
          ? db
              .prepare("SELECT * FROM events WHERE task=? ORDER BY id")
              .all(identity(task))
          : db.prepare("SELECT * FROM events ORDER BY task,id").all();
    for (const row of rows)
      try {
        const e = hydrate(db, decode(row.data));
        if (digest(stable(e)) !== row.hash)
          throw Error("Semantic event checksum mismatch");
        result.push(e);
      } catch (e) {
        errors.push({ file: row.task + "/" + row.id, error: e.message });
      }
    if (includeActivity && (!task || task === "_activity")) {
      for (const row of db
        .prepare("SELECT data FROM activity ORDER BY at")
        .all())
        try {
          result.push(decode(row.data));
        } catch (e) {
          errors.push({ file: "_activity", error: e.message });
        }
    }
    return { events: result, errors };
  });
}
export function sharedTasks(repo) {
  return withStore(repo, (db) =>
    db
      .prepare(
        "SELECT task, group_concat(id) AS signature FROM (SELECT task,id FROM events ORDER BY id) GROUP BY task",
      )
      .all(),
  );
}
export function hasSharedTask(repo, task) {
  return withStore(
    repo,
    (db) => !!db.prepare("SELECT 1 FROM events WHERE task=? LIMIT 1").get(task),
  );
}
export function sharedEvent(repo, eventId) {
  return withStore(repo, (db) => {
    const row = db.prepare("SELECT data FROM events WHERE id=?").get(eventId);
    return row ? hydrate(db, decode(row.data)) : null;
  });
}
export function pendingMigration(repo, task) {
  const result = { events: [], errors: [] },
    dir = path.join(storeDirectory(repo), "portable");
  if (!fs.existsSync(dir)) return result;
  for (const name of fs.readdirSync(dir)) {
    if (!/^[\w-]{1,100}\.json$/.test(name)) continue;
    try {
      const file = path.join(dir, name);
      if (fs.lstatSync(file).isSymbolicLink())
        throw Error("Invalid pending event link");
      const e = json(file);
      validateStoredEvent(e);
      if (!task || e.taskId === task) result.events.push(e);
    } catch (error) {
      result.errors.push({ file: name, error: error.message });
    }
  }
  return result;
}
export function spoolDuringMigration(repo, event) {
  if (event.type === "activity.batch")
    throw Error(
      "DIP migration is in progress; activity remains in the durable outbox",
    );
  validateStoredEvent(event);
  const dir = path.join(storeDirectory(repo), "portable");
  safeDirectory(dir);
  const file = path.join(dir, event.eventId + ".json"),
    old = json(file, null);
  if (old) {
    if (
      old.taskId !== event.taskId ||
      old.type !== event.type ||
      stable(old.payload) !== stable(event.payload)
    )
      throw Error("Incompatible pending event");
    return old;
  }
  atomic(file, event);
  return event;
}
function policy(repo) {
  const p = {
    ...DEFAULT_STORAGE,
    ...json(path.join(storeDirectory(repo), "storage.json"), {}).retention,
  };
  p.globalActivityBytes =
    json(path.join(home(), "storage-policy.json"), {}).globalActivityBytes ??
    p.globalActivityBytes;
  for (const k of [
    "activityBytes",
    "activityDays",
    "globalActivityBytes",
    "maxFiles",
  ])
    if (!Number.isSafeInteger(p[k]) || p[k] < 1)
      throw Error("Invalid retention setting: " + k);
  return p;
}
function trimActivity(db, p, now = Date.now(), limit = p.activityBytes) {
  const before = db
    .prepare("SELECT coalesce(sum(bytes),0) AS n FROM activity")
    .get().n;
  db.prepare("DELETE FROM activity WHERE at<?").run(
    now - p.activityDays * 86400000,
  );
  let bytes = db
    .prepare("SELECT coalesce(sum(bytes),0) AS n FROM activity")
    .get().n;
  const remove = db.prepare("DELETE FROM activity WHERE id=?");
  for (const row of db
    .prepare("SELECT id,bytes FROM activity ORDER BY at,id")
    .all()) {
    if (bytes <= limit) break;
    remove.run(row.id);
    bytes -= row.bytes;
  }
  if (before > bytes)
    db.prepare("INSERT OR REPLACE INTO metadata VALUES ('retention',?)").run(
      JSON.stringify({
        at: now,
        removedCompressedBytes: before - bytes,
        retainedBytes: bytes,
      }),
    );
  return bytes;
}
function observe(db, records) {
  const value = JSON.parse(
    db.prepare("SELECT value FROM metadata WHERE key='observations'").get()
      ?.value || "{}",
  );
  for (const r of records) {
    if (r.kind === "UserPromptSubmit") {
      value.promptCount = (value.promptCount || 0) + 1;
      if (!value.lastPromptAt || r.at > value.lastPromptAt)
        value.lastPromptAt = r.at;
    }
    if (r.kind === "PostToolUseFailure")
      value.failureCount = (value.failureCount || 0) + 1;
  }
  db.prepare("INSERT OR REPLACE INTO metadata VALUES ('observations',?)").run(
    JSON.stringify(value),
  );
}
export function boundActivity(repo, record) {
  const p = policy(repo),
    out = structuredClone(record);
  if (Array.isArray(out.files) && out.files.length > p.maxFiles) {
    out.fileCount = out.files.length;
    out.filesHash = digest(stable(out.files));
    out.files = out.files.slice(0, p.maxFiles);
    out.filesTruncated = true;
  }
  if (out.kind === "PostToolUse" || out.kind === "PostToolUseFailure")
    delete out.command;
  return out;
}
export function appendShared(repo, original) {
  drainPortable(repo);
  const result = withStore(repo, (db) => {
    db.exec("BEGIN IMMEDIATE");
    try {
      let event = original;
      if (event.type === "activity.batch") {
        event = structuredClone(event);
        event.payload.records = event.payload.records.map((r) =>
          boundActivity(repo, r),
        );
        const data = encode(event),
          p = policy(repo);
        const fresh = !db
          .prepare("SELECT 1 FROM activity WHERE id=?")
          .get(event.eventId);
        if (fresh) observe(db, event.payload.records);
        // Oversized incidental records cannot consume the entire local journal.
        if (data.length <= p.activityBytes)
          db.prepare("INSERT OR IGNORE INTO activity VALUES (?,?,?,?)").run(
            event.eventId,
            Date.parse(event.createdAt) || Date.now(),
            data.length,
            data,
          );
        trimActivity(db, p);
      } else insertEvent(db, event);
      db.exec("COMMIT");
      return event;
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  });
  const total = registerStore(repo);
  if (total > policy(repo).globalActivityBytes) maintainStorage(repo);
  return result;
}
function registry() {
  fs.mkdirSync(home(), { recursive: true });
  const db = new DatabaseSync(path.join(home(), "storage-registry.sqlite"));
  db.exec(
    "PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS stores (common TEXT PRIMARY KEY, root TEXT, touched INTEGER, activity_bytes INTEGER DEFAULT 0)",
  );
  if (
    !db
      .prepare("PRAGMA table_info(stores)")
      .all()
      .some((r) => r.name === "activity_bytes")
  )
    db.exec("ALTER TABLE stores ADD COLUMN activity_bytes INTEGER DEFAULT 0");
  return db;
}
export function registerStore(repo) {
  const bytes = withStore(
    repo,
    (db) =>
      db.prepare("SELECT coalesce(sum(bytes),0) AS n FROM activity").get().n,
  );
  const db = registry();
  try {
    db.prepare("INSERT OR REPLACE INTO stores VALUES (?,?,?,?)").run(
      repo.common,
      repo.root,
      Date.now(),
      bytes,
    );
    return db
      .prepare("SELECT coalesce(sum(activity_bytes),0) AS n FROM stores")
      .get().n;
  } finally {
    db.close();
  }
}
export function maintainStorage(
  repo,
  now = Date.now(),
  { global = true } = {},
) {
  const p = policy(repo);
  withStore(repo, (db) => {
    trimActivity(db, p, now);
    db.exec("PRAGMA incremental_vacuum; PRAGMA wal_checkpoint(TRUNCATE)");
  });
  if (!global) {
    registerStore(repo);
    return { maintained: true };
  }
  const reg = registry();
  let stores;
  try {
    stores = reg.prepare("SELECT * FROM stores").all();
  } finally {
    reg.close();
  }
  const entries = [];
  let total = 0;
  for (const s of stores) {
    if (!fs.existsSync(path.join(s.common, "dip", "store.sqlite"))) {
      const db = registry();
      try {
        db.prepare("UPDATE stores SET activity_bytes=0 WHERE common=?").run(
          s.common,
        );
      } finally {
        db.close();
      }
      continue;
    }
    const r = { common: s.common, root: s.root };
    withStore(r, (db) => {
      for (const row of db.prepare("SELECT id,at,bytes FROM activity").all()) {
        entries.push({ ...row, repo: r });
        total += row.bytes;
      }
    });
  }
  entries.sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
  for (const e of entries) {
    if (total <= p.globalActivityBytes) break;
    withStore(e.repo, (db) =>
      db.prepare("DELETE FROM activity WHERE id=?").run(e.id),
    );
    total -= e.bytes;
  }
  for (const s of stores)
    if (fs.existsSync(path.join(s.common, "dip", "store.sqlite")))
      registerStore({ common: s.common, root: s.root });
  return { globalActivityBytes: total, limit: p.globalActivityBytes };
}
function command(repo, args, options = {}) {
  return execFileSync("git", ["-C", repo.root, ...args], {
    encoding: "utf8",
    maxBuffer: 512 * 1024 ** 2,
    ...(["fetch", "push", "ls-remote"].includes(args[0])
      ? { timeout: 45000 }
      : {}),
    ...options,
    env: {
      ...process.env,
      GIT_TRACE2_EVENT: "0",
      DIP_INTERNAL_GIT: "1",
      ...(options.env || {}),
    },
  });
}
// Filtered clones may know the trees without possessing their blobs. Fetch only
// the required metadata objects in batches; never materialize source/media trees.
function materializeMetadata(repo, oids) {
  if (!oids.length) return;
  const rows = command(
    repo,
    ["cat-file", "--batch-check=%(objectname) %(objecttype)"],
    { input: oids.join("\n") + "\n", env: { GIT_NO_LAZY_FETCH: "1" } },
  )
    .trim()
    .split("\n");
  const missing = rows
    .filter((line) => line.endsWith(" missing"))
    .map((line) => line.split(" ")[0]);
  if (!missing.length) return;
  const configured = git(
    repo.root,
    ["config", "--get-regexp", "^remote\\..*\\.promisor$"],
    true,
  );
  const remote = configured
    .split("\n")
    .map((line) => line.match(/^remote\.(.+)\.promisor\s+true$/)?.[1])
    .find(Boolean);
  if (!remote)
    throw Error(
      "Missing Git metadata objects; restore the object database before migration",
    );
  for (let i = 0; i < missing.length; i += 512)
    command(
      repo,
      [
        "-c",
        "fetch.negotiationAlgorithm=noop",
        "fetch",
        "--no-tags",
        "--no-write-fetch-head",
        "--recurse-submodules=no",
        "--no-filter",
        "--stdin",
        remote,
      ],
      { input: missing.slice(i, i + 512).join("\n") + "\n", timeout: 45000 },
    );
}
export function branchInventory(repo) {
  return {
    refs: git(repo.root, [
      "for-each-ref",
      "--format=%(refname) %(objectname)",
      "refs/heads",
      "refs/remotes",
    ])
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [ref, oid] = line.split(" ");
        return { ref, oid };
      }),
    worktrees: git(repo.root, ["worktree", "list", "--porcelain"]),
  };
}
export function publishStore(repo, { remote, push = false } = {}) {
  drainPortable(repo);
  const marker = json(path.join(storeDirectory(repo), "storage.json"), null);
  if (!marker || marker.schemaVersion !== 2)
    throw Error("Migrate shared storage before synchronization");
  const lock = path.join(storeDirectory(repo), "publish.lock");
  // Recover a publisher killed after acquiring its local mutex. CAS still fences
  // the actual ref; a live process is never evicted by a timeout.
  if (fs.existsSync(lock)) {
    const pid = Number(fs.readFileSync(lock, "utf8"));
    try {
      process.kill(pid, 0);
    } catch (e) {
      if (e.code === "ESRCH") fs.rmSync(lock, { force: true });
    }
  }
  let fd;
  try {
    fd = fs.openSync(lock, "wx");
    fs.writeSync(fd, String(process.pid));
  } catch {
    throw Error("DIP metadata publisher is busy; retry");
  }
  const index = path.join(storeDirectory(repo), "index-" + id());
  try {
    let fetched = null;
    if (remote) {
      // A missing remote branch is normal on first publication; other errors are not.
      const advertised = command(repo, [
        "ls-remote",
        "--heads",
        remote,
        "dip/state",
      ]).trim();
      if (advertised) {
        command(repo, ["fetch", "--no-tags", remote, "refs/heads/dip/state"]);
        fetched = git(repo.root, ["rev-parse", "FETCH_HEAD"]);
        importRef(repo, fetched);
      }
    }
    const old = git(repo.root, ["rev-parse", "--verify", STATE_REF], true),
      env = { GIT_INDEX_FILE: index };
    if (old) {
      const manifest = JSON.parse(
        command(repo, ["show", old + ":.dip/storage.json"]),
      );
      if (
        manifest.schemaVersion !== 2 ||
        manifest.projectId !== marker.projectId
      )
        throw Error("Reserved dip/state branch belongs to a different ledger");
      command(repo, ["read-tree", old], { env });
    } else command(repo, ["read-tree", "--empty"], { env });
    const changes = [],
      publishedEntries = new Map();
    if (old)
      for (const line of git(repo.root, [
        "ls-tree",
        "-r",
        old,
        "--",
        ".dip",
      ]).split("\n")) {
        if (!line) continue;
        const [meta, name] = line.split("\t");
        publishedEntries.set(name, meta.split(" ")[2]);
      }
    withStore(repo, (db) => {
      const cacheUpdates = [];
      const blob = (name, data) => {
        const hash = digest(data),
          cached = db
            .prepare("SELECT * FROM git_entries WHERE name=?")
            .get(name);
        const oid =
          cached?.hash === hash && publishedEntries.get(name) === cached.oid
            ? cached.oid
            : command(repo, ["hash-object", "-w", "--stdin"], {
                input: data,
              }).trim();
        if (cached?.hash !== hash || cached?.oid !== oid)
          cacheUpdates.push([name, hash, oid]);
        changes.push("100644 " + oid + "\t" + name + "\0");
      };
      for (const row of db
        .prepare("SELECT id,task,data FROM events ORDER BY id")
        .all())
        blob(
          `.dip/events/${row.task}/${row.id}.json`,
          JSON.stringify(decode(row.data)) + "\n",
        );
      for (const row of db.prepare("SELECT hash,data FROM artifacts").all())
        blob(`.dip/artifacts/${row.hash}.json.gz`, Buffer.from(row.data));
      blob(
        ".dip/storage.json",
        JSON.stringify({
          schemaVersion: 2,
          projectId: marker.projectId,
          format: "events+gzip-manifests",
          activity: "local-only",
        }) + "\n",
      );
      // Cache writes are disposable. Commit new entries together after object
      // creation, without holding the durable journal's writer lock across Git.
      if (cacheUpdates.length) {
        db.exec("BEGIN IMMEDIATE");
        try {
          const insert = db.prepare(
            "INSERT OR REPLACE INTO git_entries VALUES (?,?,?)",
          );
          for (const row of cacheUpdates) insert.run(...row);
          db.exec("COMMIT");
        } catch (error) {
          db.exec("ROLLBACK");
          throw error;
        }
      }
    });
    command(repo, ["update-index", "-z", "--index-info"], {
      input: changes.join(""),
      env,
    });
    const tree = command(repo, ["write-tree"], { env }).trim();
    const parents = [...new Set([old, fetched].filter(Boolean))];
    let next = old;
    if (
      !old ||
      tree !== git(repo.root, ["rev-parse", old + "^{tree}"]) ||
      (fetched &&
        git(repo.root, ["merge-base", old, fetched], true) !== fetched)
    ) {
      const args = [
        "commit-tree",
        tree,
        ...parents.flatMap((p) => ["-p", p]),
        "-m",
        "DIP: synchronize project intent",
      ];
      next = command(repo, args, {
        env: {
          GIT_AUTHOR_NAME: "DIP",
          GIT_AUTHOR_EMAIL: "dip@localhost",
          GIT_COMMITTER_NAME: "DIP",
          GIT_COMMITTER_EMAIL: "dip@localhost",
        },
      }).trim();
      command(repo, ["update-ref", STATE_REF, next, old || ""]);
    }
    if (push) {
      if (!remote) throw Error("Choose a remote for push");
      command(repo, ["push", remote, STATE_REF + ":" + STATE_REF]);
    }
    withStore(repo, (db) =>
      db.prepare("INSERT OR REPLACE INTO metadata VALUES ('published',?)").run(
        JSON.stringify({
          oid: next,
          at: Date.now(),
          remote: push ? remote : null,
        }),
      ),
    );
    if (push)
      withStore(repo, (db) =>
        db
          .prepare("INSERT OR REPLACE INTO metadata VALUES ('remote_sync',?)")
          .run(JSON.stringify({ oid: next, at: Date.now(), remote })),
      );
    return { ref: STATE_REF, oid: next, pushed: push, remote: remote || null };
  } finally {
    fs.closeSync(fd);
    fs.rmSync(lock, { force: true });
    fs.rmSync(index, { force: true });
    fs.rmSync(index + ".lock", { force: true });
  }
}
export function drainPortable(repo) {
  const dir = path.join(storeDirectory(repo), "portable");
  if (!fs.existsSync(dir)) return;
  if (fs.lstatSync(dir).isSymbolicLink())
    throw Error("Portable spool must be a real directory");
  const files = fs
    .readdirSync(dir)
    .filter((n) => /^[\w-]{1,100}\.json$/.test(n));
  if (!files.length) return;
  withStore(repo, (db) => {
    db.exec("BEGIN IMMEDIATE");
    try {
      for (const name of files) {
        const file = path.join(dir, name);
        if (fs.lstatSync(file).isSymbolicLink())
          throw Error("Invalid portable spool file");
        const e = json(file);
        if (name !== e.eventId + ".json")
          throw Error("Invalid portable event identity");
        insertEvent(db, e);
      }
      validateGraph(db);
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  });
  for (const name of files) fs.rmSync(path.join(dir, name));
}
export function importRef(repo, ref) {
  const manifest = JSON.parse(
    command(repo, ["show", ref + ":.dip/storage.json"]),
  );
  if (manifest.schemaVersion !== 2)
    throw Error("Unsupported remote DIP schema");
  const marker = json(path.join(storeDirectory(repo), "storage.json"), null);
  if (marker && marker.projectId !== manifest.projectId)
    throw Error("Remote DIP project identity mismatch");
  const entries = command(repo, [
    "ls-tree",
    "-r",
    ref,
    "--",
    ".dip/events",
    ".dip/artifacts",
  ])
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [meta, name] = line.split("\t");
      return { name, oid: meta.split(" ")[2] };
    });
  materializeMetadata(
    repo,
    entries.map((e) => e.oid),
  );
  const names = entries.map((e) => e.name),
    input = entries.map((e) => e.oid + "\n").join("");
  const raw = command(repo, ["cat-file", "--batch"], { input, encoding: null });
  const content = new Map();
  let offset = 0;
  for (const name of names) {
    const end = raw.indexOf(10, offset),
      header = raw.subarray(offset, end).toString().split(" "),
      size = Number(header[2]);
    if (header[1] !== "blob" || !Number.isSafeInteger(size))
      throw Error("Invalid remote blob");
    offset = end + 1;
    content.set(name, raw.subarray(offset, offset + size));
    offset += size + 1;
  }
  withStore(repo, (db) => {
    db.exec("BEGIN IMMEDIATE");
    try {
      for (const [name, data] of content)
        if (name.startsWith(".dip/artifacts/")) {
          const hash = path.basename(name, ".json.gz");
          if (
            !/^[a-f0-9]{64}$/.test(hash) ||
            digest(stable(decode(data))) !== hash
          )
            throw Error("Invalid remote manifest");
          db.prepare("INSERT OR IGNORE INTO artifacts VALUES (?,?)").run(
            hash,
            data,
          );
        }
      for (const [name, data] of content)
        if (name.startsWith(".dip/events/")) {
          const e = hydrate(db, JSON.parse(data));
          if (name !== `.dip/events/${e.taskId}/${e.eventId}.json`)
            throw Error("Remote event path mismatch");
          insertEvent(db, e);
        }
      validateGraph(db);
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  });
  return manifest;
}
export function validateGraph(db) {
  const rows = db.prepare("SELECT id,task,data FROM events").all(),
    map = new Map(
      rows.map((r) => [r.id, { ...decode(r.data), taskId: r.task }]),
    );
  const done = new Set(),
    visiting = new Set();
  const visit = (e) => {
    if (done.has(e.eventId)) return;
    if (visiting.has(e.eventId)) throw Error("Cyclic imported history");
    visiting.add(e.eventId);
    for (const p of e.parents) {
      const parent = map.get(p);
      if (!parent || parent.taskId !== e.taskId)
        throw Error("Missing imported parent " + p);
      visit(parent);
    }
    visiting.delete(e.eventId);
    done.add(e.eventId);
  };
  for (const e of map.values()) visit(e);
  const created = new Set(
    [...map.values()]
      .filter((e) => e.type === "task.create")
      .map((e) => e.taskId),
  );
  for (const task of new Set(rows.map((r) => r.task)))
    if (!created.has(task))
      throw Error("Imported task has no creation event: " + task);
}
export function storageStatus(repo) {
  if (!sharedActive(repo))
    return { schemaVersion: 1, shared: false, migrationRequired: true };
  const dir = storeDirectory(repo),
    marker = json(path.join(dir, "storage.json"));
  return withStore(repo, (db) => ({
    schemaVersion: 2,
    shared: true,
    projectId: marker.projectId,
    directory: dir,
    semanticEvents: db.prepare("SELECT count(*) AS n FROM events").get().n,
    semanticCompressedBytes: db
      .prepare("SELECT coalesce(sum(length(data)),0) AS n FROM events")
      .get().n,
    manifestsCompressedBytes: db
      .prepare("SELECT coalesce(sum(length(data)),0) AS n FROM artifacts")
      .get().n,
    backups: fs.existsSync(path.join(dir, "backups"))
      ? fs
          .readdirSync(path.join(dir, "backups"))
          .filter((n) => n.endsWith(".gz"))
          .map((name) => {
            const st = fs.statSync(path.join(dir, "backups", name));
            return { name, bytes: st.size, allocatedBytes: st.blocks * 512 };
          })
      : [],
    snapshotManifests: db.prepare("SELECT count(*) AS n FROM artifacts").get()
      .n,
    activity: db
      .prepare(
        "SELECT count(*) AS records, coalesce(sum(bytes),0) AS compressedBytes FROM activity",
      )
      .get(),
    files: Object.fromEntries(
      ["store.sqlite", "store.sqlite-wal", "store.sqlite-shm"].map((n) => {
        const s = fs.statSync(path.join(dir, n), { throwIfNoEntry: false });
        return [
          n,
          { bytes: s?.size || 0, allocatedBytes: (s?.blocks || 0) * 512 },
        ];
      }),
    ),
    runtimeFiles: Object.fromEntries(
      [
        "daemon.log",
        "supervisor.log",
        "runtime.sqlite",
        "runtime.sqlite-wal",
        "navigation.sqlite",
        "storage-registry.sqlite",
      ].map((name) => {
        const stat = fs.statSync(path.join(home(), name), {
          throwIfNoEntry: false,
        });
        return [
          name,
          {
            sharedAcrossProjects: true,
            bytes: stat?.size || 0,
            allocatedBytes: (stat?.blocks || 0) * 512,
          },
        ];
      }),
    ),
    retention: policy(repo),
    lastRetention: JSON.parse(
      db.prepare("SELECT value FROM metadata WHERE key='retention'").get()
        ?.value || "null",
    ),
    captureObservations: JSON.parse(
      db.prepare("SELECT value FROM metadata WHERE key='observations'").get()
        ?.value || "{}",
    ),
    lastPublished: JSON.parse(
      db.prepare("SELECT value FROM metadata WHERE key='published'").get()
        ?.value || "null",
    ),
    lastRemoteSync: JSON.parse(
      db.prepare("SELECT value FROM metadata WHERE key='remote_sync'").get()
        ?.value || "null",
    ),
    branches: branchInventory(repo).refs,
  }));
}

// Importer is deliberately separate from ensure(): ordinary reads never migrate
// an existing project or remove a user's files.
export async function migrateStorage(
  cwd,
  { roots = [], dryRun = false, cleanup = false } = {},
) {
  const repo = repoAt(cwd),
    dir = storeDirectory(repo),
    sources = new Set([repo.root, ...roots]);
  for (const line of git(repo.root, ["worktree", "list", "--porcelain"]).split(
    "\n",
  ))
    if (line.startsWith("worktree ")) sources.add(line.slice(9));
  const valid = [...sources].filter((r) => {
    try {
      return repoAt(r).key === repo.key;
    } catch {
      return false;
    }
  });
  if (dryRun)
    return {
      root: repo.root,
      family: repo.key,
      shared: sharedActive(repo),
      worktrees: valid,
      branches: branchInventory(repo).refs,
    };
  const remoteRef =
    git(repo.root, ["rev-parse", "--verify", STATE_REF], true) ||
    git(
      repo.root,
      ["rev-parse", "--verify", "refs/remotes/origin/dip/state"],
      true,
    );
  if (remoteRef && !sharedActive(repo)) importRef(repo, remoteRef);
  safeDirectory(dir);
  const lock = path.join(dir, "migration.lock");
  if (fs.existsSync(lock)) {
    const owner = Number(fs.readFileSync(lock, "utf8"));
    if (Number.isSafeInteger(owner) && owner > 1)
      try {
        process.kill(owner, 0);
      } catch (error) {
        if (error.code === "ESRCH") fs.rmSync(lock);
        else throw error;
      }
  }
  let fd;
  try {
    fd = fs.openSync(lock, "wx");
    fs.writeSync(fd, String(process.pid));
  } catch {
    throw Error("A DIP migration is already running");
  }
  const backup = path.join(
    dir,
    "backups",
    "migration-" +
      new Date().toISOString().replaceAll(/[:.]/g, "-") +
      ".ndjson.gz",
  );
  const partial = backup + ".partial",
    fenceFile = path.join(dir, "migration-configs.json");
  const originals =
    json(fenceFile, null) ||
    Object.fromEntries(
      valid
        .filter((root) => fs.existsSync(path.join(root, ".dip", "config.json")))
        .map((root) => [
          root,
          fs
            .readFileSync(path.join(root, ".dip", "config.json"))
            .toString("base64"),
        ]),
    );
  const { createGzip } = await import("node:zlib"),
    { once } = await import("node:events");
  const { pipeline } = await import("node:stream/promises");
  const projectId =
    json(path.join(dir, "storage.json"), {}).projectId ||
    (remoteRef
      ? JSON.parse(command(repo, ["show", remoteRef + ":.dip/storage.json"]))
          .projectId
      : id());
  safeDirectory(path.dirname(backup));
  const gzip = createGzip(),
    output = fs.createWriteStream(partial, { flags: "wx", mode: 0o600 });
  const backupDone = pipeline(gzip, output);
  let backupFailure;
  backupDone.catch((error) => {
    backupFailure = error;
  });
  gzip.write(
    JSON.stringify({
      manifest: {
        schemaVersion: 2,
        projectId,
        createdAt: new Date().toISOString(),
        sources: valid,
      },
    }) + "\n",
  );
  const db = openStore(repo);
  let imported = 0,
    activity = 0,
    duplicates = 0;
  const seen = new Map();
  try {
    db.exec("BEGIN IMMEDIATE");
    const accept = async (e, source) => {
      if (backupFailure) throw backupFailure;
      const hash = digest(stable(e)),
        old = seen.get(e.eventId);
      if (old) {
        if (old !== hash)
          throw Error("Conflicting imported event " + e.eventId);
        duplicates++;
        return;
      }
      seen.set(e.eventId, hash);
      if (!gzip.write(JSON.stringify({ source, event: e }) + "\n"))
        await Promise.race([
          once(gzip, "drain"),
          backupDone.then(() => {
            throw Error("Backup ended before import completed");
          }),
        ]);
      if (e.type === "activity.batch") {
        activity++;
        if (!db.prepare("SELECT 1 FROM activity WHERE id=?").get(e.eventId))
          observe(db, e.payload.records);
        const event = structuredClone(e);
        event.payload.records = event.payload.records.map((r) =>
          boundActivity(repo, r),
        );
        const data = encode(event);
        if (data.length <= DEFAULT_STORAGE.activityBytes)
          db.prepare("INSERT OR IGNORE INTO activity VALUES (?,?,?,?)").run(
            e.eventId,
            Date.parse(e.createdAt) || 0,
            data.length,
            data,
          );
      } else if (insertEvent(db, e)) imported++;
      else duplicates++;
    };
    for (const root of valid) {
      const configFile = path.join(root, ".dip", "config.json");
      if (fs.existsSync(configFile)) {
        const bytes = originals[root]
          ? Buffer.from(originals[root], "base64")
          : fs.readFileSync(configFile);
        if (
          !gzip.write(
            JSON.stringify({
              source: root,
              file: ".dip/config.json",
              hash: digest(bytes),
              base64: bytes.toString("base64"),
            }) + "\n",
          )
        )
          await once(gzip, "drain");
      }
      const base = path.join(root, ".dip", "events");
      if (!fs.existsSync(base)) continue;
      if (fs.lstatSync(base).isSymbolicLink())
        throw Error("Cannot import a symbolic event directory");
      for (const folder of fs.readdirSync(base)) {
        if (!/^[\w-]{1,100}$/.test(folder)) continue;
        const directory = path.join(base, folder);
        if (
          !fs.lstatSync(directory).isDirectory() ||
          fs.lstatSync(directory).isSymbolicLink()
        )
          throw Error("Invalid legacy event directory");
        for (const name of fs.readdirSync(directory)) {
          if (!name.endsWith(".json") || name.startsWith("._")) continue;
          const file = path.join(directory, name);
          if (
            !fs.lstatSync(file).isFile() ||
            fs.lstatSync(file).isSymbolicLink()
          )
            throw Error("Invalid legacy event file");
          const e = json(file);
          if (e.taskId !== folder || name !== e.eventId + ".json")
            throw Error("Legacy event identity mismatch");
          await accept(e, root);
        }
      }
    }
    // Include unmerged intent at every available branch tip, not just main.
    const blobs = new Map();
    for (const root of valid)
      for (const line of git(root, [
        "ls-files",
        "--stage",
        "--",
        ".dip/events",
      ]).split("\n")) {
        if (!line) continue;
        const [meta, name] = line.split("\t"),
          [, oid] = meta.split(" ");
        if (
          name?.endsWith(".json") &&
          !name.includes("/._") &&
          !name.startsWith(".dip/events/_activity/")
        )
          blobs.set(oid, name);
      }
    for (const { ref } of branchInventory(repo).refs) {
      if (ref === STATE_REF || ref.endsWith("/dip/state")) continue;
      for (const line of git(repo.root, [
        "ls-tree",
        "-r",
        ref,
        "--",
        ".dip/events",
      ]).split("\n")) {
        if (!line) continue;
        const [meta, name] = line.split("\t"),
          bits = meta.trim().split(/\s+/);
        if (
          !name?.endsWith(".json") ||
          name.includes("/._") ||
          name.startsWith(".dip/events/_activity/")
        )
          continue;
        blobs.set(bits[2], name);
      }
    }
    const keys = [...blobs.keys()];
    if (keys.length) {
      materializeMetadata(repo, keys);
      const raw = command(repo, ["cat-file", "--batch"], {
        input: keys.join("\n") + "\n",
        encoding: null,
      });
      let at = 0;
      for (const oid of keys) {
        const end = raw.indexOf(10, at),
          header = raw.subarray(at, end).toString().split(" "),
          size = Number(header[2]);
        if (header[1] !== "blob" || !Number.isSafeInteger(size))
          throw Error("Invalid legacy Git object");
        at = end + 1;
        const e = JSON.parse(raw.subarray(at, at + size));
        at += size + 1;
        if (blobs.get(oid) !== `.dip/events/${e.taskId}/${e.eventId}.json`)
          throw Error("Legacy Git identity mismatch");
        await accept(e, "git:" + oid);
      }
    }
    // Fence legacy readers before cutover, then include semantic writes that
    // arrived during the long initial scan. New writers use the durable spool.
    atomic(fenceFile, originals);
    for (const root of valid) {
      const file = path.join(root, ".dip", "config.json");
      if (fs.existsSync(file)) {
        const config = json(file);
        config.schemaVersion = 2;
        atomic(file, config);
      }
    }
    for (const root of valid) {
      const base = path.join(root, ".dip", "events");
      if (!fs.existsSync(base)) continue;
      for (const folder of fs.readdirSync(base)) {
        if (folder === "_activity" || !/^[\w-]{1,100}$/.test(folder)) continue;
        const directory = path.join(base, folder);
        if (
          !fs.lstatSync(directory).isDirectory() ||
          fs.lstatSync(directory).isSymbolicLink()
        )
          throw Error("Invalid cutover task directory");
        for (const name of fs.readdirSync(directory)) {
          if (!name.endsWith(".json") || name.startsWith("._")) continue;
          const file = path.join(directory, name);
          if (fs.lstatSync(file).isSymbolicLink())
            throw Error("Invalid cutover event link");
          const e = json(file);
          if (e.taskId !== folder || name !== e.eventId + ".json")
            throw Error("Cutover event identity mismatch");
          await accept(e, root + ":cutover");
        }
      }
    }
    const pending = pendingMigration(repo);
    if (pending.errors.length) throw Error("Invalid pending migration events");
    for (const event of pending.events) await accept(event, "portable:pending");
    validateGraph(db);
    trimActivity(db, policy(repo));
    gzip.end();
    await backupDone;
    const backupFd = fs.openSync(partial, "r");
    try {
      fs.fsyncSync(backupFd);
    } finally {
      fs.closeSync(backupFd);
    }
    fs.renameSync(partial, backup);
    db.exec("COMMIT");
    db.exec("PRAGMA incremental_vacuum; PRAGMA wal_checkpoint(TRUNCATE)");
    const known =
      git(repo.root, ["rev-parse", "--verify", STATE_REF], true) ||
      git(
        repo.root,
        ["rev-parse", "--verify", "refs/remotes/origin/dip/state"],
        true,
      );
    const knownMarker = known
      ? JSON.parse(command(repo, ["show", known + ":.dip/storage.json"]))
      : null;
    const marker = json(path.join(dir, "storage.json"), null) || {
      schemaVersion: 2,
      projectId: knownMarker?.projectId || projectId,
      createdAt: new Date().toISOString(),
      retention: { ...DEFAULT_STORAGE },
    };
    atomic(path.join(dir, "storage.json"), marker);
    registerStore(repo);
    drainPortable(repo);
    fs.rmSync(fenceFile, { force: true });
    const report = {
      root: repo.root,
      family: repo.key,
      projectId: marker.projectId,
      worktrees: valid,
      imported,
      activity,
      duplicates,
      backup,
      cleanup: false,
    };
    atomic(path.join(dir, "migration-report.json"), report);
    if (cleanup) {
      for (const root of valid)
        cleanupLegacy({ ...repoAt(root), dir: path.join(root, ".dip") });
      report.cleanup = true;
      atomic(path.join(dir, "migration-report.json"), report);
    }
    return report;
  } catch (e) {
    try {
      db.exec("ROLLBACK");
    } catch {}
    if (!sharedActive(repo)) {
      for (const [root, bytes] of Object.entries(originals))
        try {
          const file = path.join(root, ".dip", "config.json"),
            current = json(file),
            original = JSON.parse(Buffer.from(bytes, "base64"));
          current.schemaVersion = original.schemaVersion;
          atomic(file, current);
        } catch {}
      fs.rmSync(fenceFile, { force: true });
    }
    gzip.destroy();
    output.destroy();
    throw e;
  } finally {
    db.close();
    fs.closeSync(fd);
    fs.rmSync(lock, { force: true });
  }
}
export async function restoreStorage(cwd, archive) {
  const repo = repoAt(cwd),
    { createGunzip } = await import("node:zlib"),
    { createInterface } = await import("node:readline");
  const input = fs.createReadStream(archive),
    gunzip = createGunzip();
  input.pipe(gunzip);
  input.on("error", (error) => gunzip.destroy(error));
  const lines = createInterface({ input: gunzip, crlfDelay: Infinity }),
    db = openStore(repo);
  let manifest,
    restored = 0,
    bytes = 0;
  try {
    db.exec("BEGIN IMMEDIATE");
    for await (const line of lines) {
      bytes += Buffer.byteLength(line);
      if (bytes > 4 * 1024 ** 3)
        throw Error("Archive exceeds recovery size limit");
      const row = JSON.parse(line);
      if (row.manifest) {
        if (
          manifest ||
          row.manifest.schemaVersion !== 2 ||
          typeof row.manifest.projectId !== "string"
        )
          throw Error("Invalid recovery manifest");
        manifest = row.manifest;
        const current = json(
          path.join(storeDirectory(repo), "storage.json"),
          null,
        );
        if (current && current.projectId !== manifest.projectId)
          throw Error("Recovery project identity mismatch");
      } else if (row.event && row.event.type !== "activity.batch") {
        if (!manifest) throw Error("Recovery manifest must precede events");
        if (insertEvent(db, row.event)) restored++;
      } else if (
        row.file &&
        digest(Buffer.from(row.base64, "base64")) !== row.hash
      )
        throw Error("Recovery configuration checksum mismatch");
    }
    if (!manifest) throw Error("Recovery archive has no manifest");
    validateGraph(db);
    db.exec("COMMIT");
    atomic(path.join(storeDirectory(repo), "storage.json"), {
      schemaVersion: 2,
      projectId: manifest.projectId,
      recoveredAt: new Date().toISOString(),
      retention: { ...DEFAULT_STORAGE },
    });
    registerStore(repo);
    return {
      restored,
      projectId: manifest.projectId,
      rawActivity:
        "Retained in the private archive; expired diagnostic activity is not replayed",
    };
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {}
    throw error;
  } finally {
    lines.close();
    input.destroy();
    gunzip.destroy();
    db.close();
  }
}
export function cleanupLegacy(repo) {
  if (!sharedActive(repo))
    throw Error("Verify shared storage before legacy cleanup");
  const config = path.join(repo.root, ".dip", "config.json");
  if (fs.existsSync(config)) {
    const c = json(config);
    c.schemaVersion = 2;
    atomic(config, c);
  }
  const base = path.join(repo.root, ".dip", "events");
  // Fence old binaries before potentially slow directory deletion on HDDs.
  if (fs.existsSync(base))
    fs.rmSync(base, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 100,
    });
  const exclude = path.join(repo.common, "info", "exclude");
  fs.mkdirSync(path.dirname(exclude), { recursive: true });
  const previous = fs.existsSync(exclude)
    ? fs.readFileSync(exclude, "utf8")
    : "";
  if (!previous.split("\n").includes("/.dip/events/"))
    atomic(
      exclude,
      previous +
        "\n# DIP shared storage: dynamic records never belong in code branches\n/.dip/events/\n",
    );
}

export function configureStorage(repo, patch) {
  if (!sharedActive(repo))
    throw Error("Migrate before configuring shared storage");
  if (
    !patch ||
    typeof patch !== "object" ||
    Array.isArray(patch) ||
    Object.keys(patch).some((k) => !Object.hasOwn(DEFAULT_STORAGE, k))
  )
    throw Error("Unknown retention setting");
  const file = path.join(storeDirectory(repo), "storage.json"),
    marker = json(file);
  for (const v of Object.values(patch))
    if (!Number.isSafeInteger(v) || v < 1)
      throw Error("Retention settings must be positive integers");
  marker.retention = { ...policy(repo), ...patch };
  atomic(file, marker);
  if (patch.globalActivityBytes)
    atomic(path.join(home(), "storage-policy.json"), {
      globalActivityBytes: patch.globalActivityBytes,
    });
  maintainStorage(repo);
  return marker.retention;
}

// Commit only the imported metadata removal. The user's staged source changes
// remain staged, and no source checkout or branch switch is performed.
export function retireLegacy(cwd) {
  const repo = repoAt(cwd);
  if (!sharedActive(repo))
    throw Error("Migrate before retiring branch-local events");
  const head = repo.head,
    branch = git(repo.root, ["symbolic-ref", "-q", "HEAD"], true);
  if (branch === STATE_REF)
    throw Error("Select a source branch before migration cleanup");
  if (git(repo.root, ["ls-files", "--unmerged"]))
    return { root: repo.root, retired: false, reason: "unresolved_merge" };
  if (!head || !branch) {
    const tracked = git(
      repo.root,
      ["ls-files", "-z", "--", ".dip/events"],
      false,
      { raw: true },
    );
    if (tracked)
      command(
        repo,
        [
          "update-index",
          head ? "--skip-worktree" : "--force-remove",
          "-z",
          "--stdin",
        ],
        { input: tracked },
      );
    cleanupLegacy({ ...repo, dir: path.join(repo.root, ".dip") });
    return {
      root: repo.root,
      retired: true,
      sourceCommitCreated: false,
      reason: head ? "detached_metadata_hidden" : "unborn_metadata_local",
    };
  }
  const journal = path.join(
    storeDirectory(repo),
    "retirement-" + digest(repo.root).slice(0, 24) + ".json",
  );
  const pending = json(journal, null);
  const finishIndex = (entry) => {
    if (entry.tracked.length)
      command(repo, ["update-index", "--force-remove", "-z", "--stdin"], {
        input: entry.tracked.join("\0") + "\0",
      });
    const staged = git(repo.root, ["show", ":.dip/config.json"], true);
    if (staged === entry.committed)
      command(repo, [
        "update-index",
        "--add",
        "--cacheinfo",
        "100644",
        entry.blob,
        ".dip/config.json",
      ]);
    else if (staged) {
      const c = JSON.parse(staged);
      c.schemaVersion = 2;
      const blob = command(repo, ["hash-object", "-w", "--stdin"], {
        input: JSON.stringify(c, null, 2) + "\n",
      }).trim();
      command(repo, [
        "update-index",
        "--add",
        "--cacheinfo",
        "100644",
        blob,
        ".dip/config.json",
      ]);
    }
    for (const item of entry.generated || []) {
      const staged = git(repo.root, ["show", ":" + item.name], true);
      if (
        staged === item.committed ||
        digest(staged + "\n") === item.hash ||
        digest(staged) === item.hash
      )
        command(repo, [
          "update-index",
          "--add",
          "--cacheinfo",
          "100644",
          item.blob,
          item.name,
        ]);
    }
    cleanupLegacy({ ...repo, dir: path.join(repo.root, ".dip") });
    fs.rmSync(journal, { force: true });
  };
  if (pending) {
    if (head === pending.oid) {
      finishIndex(pending);
      return {
        root: repo.root,
        retired: true,
        branch,
        oid: head,
        recovered: true,
      };
    }
    if (head !== pending.head)
      throw Error(
        "Source HEAD changed during an unfinished metadata retirement; inspect " +
          journal,
      );
    fs.rmSync(journal);
  }
  const tracked = git(repo.root, [
    "ls-tree",
    "-r",
    "--name-only",
    head,
    "--",
    ".dip/events",
  ])
    .split("\n")
    .filter(Boolean);
  const cfile = path.join(repo.root, ".dip", "config.json");
  if (!fs.existsSync(cfile))
    return { root: repo.root, retired: false, reason: "missing_config" };
  const committed = git(repo.root, ["show", head + ":.dip/config.json"], true);
  if (!committed && !tracked.length) {
    cleanupLegacy({ ...repo, dir: path.join(repo.root, ".dip") });
    return {
      root: repo.root,
      retired: true,
      reason: "metadata_never_committed",
    };
  }
  const index = path.join(storeDirectory(repo), "retire-" + id()),
    env = { GIT_INDEX_FILE: index };
  try {
    command(repo, ["read-tree", head], { env });
    if (tracked.length)
      command(repo, ["update-index", "--force-remove", "-z", "--stdin"], {
        env,
        input: tracked.join("\0") + "\0",
      });
    // A code branch keeps only code-versioned configuration. Its v2 marker also
    // makes legacy installed binaries refuse writes rather than fork the ledger.
    const config = committed ? JSON.parse(committed) : json(cfile);
    config.schemaVersion = 2;
    const blob = command(repo, ["hash-object", "-w", "--stdin"], {
      input: JSON.stringify(config, null, 2) + "\n",
    }).trim();
    command(
      repo,
      [
        "update-index",
        "--add",
        "--cacheinfo",
        "100644",
        blob,
        ".dip/config.json",
      ],
      { env },
    );
    const generated = [],
      manifest = json(path.join(repo.root, ".dip", "integration.json"), null);
    if (manifest) {
      const official = repositoryTemplates({ ...repo, config: json(cfile) });
      for (const [name, content] of Object.entries(official)) {
        const expected = digest(content),
          file = path.join(repo.root, name);
        if (
          manifest.files?.[name] !== expected ||
          !fs.existsSync(file) ||
          fs.lstatSync(file).isSymbolicLink() ||
          digest(fs.readFileSync(file)) !== expected
        )
          continue;
        const committed = git(repo.root, ["show", head + ":" + name], true),
          staged = git(repo.root, ["show", ":" + name], true);
        if (
          staged !== committed &&
          digest(staged + "\n") !== expected &&
          digest(staged) !== expected
        )
          continue;
        if (
          digest(committed + "\n") === expected ||
          digest(committed) === expected
        )
          continue;
        const oid = command(repo, ["hash-object", "-w", "--stdin"], {
          input: content,
        }).trim();
        command(
          repo,
          ["update-index", "--add", "--cacheinfo", "100644", oid, name],
          { env },
        );
        generated.push({ name, blob: oid, committed, hash: expected });
      }
      const name = ".dip/integration.json",
        data = fs.readFileSync(path.join(repo.root, name)),
        committed = git(repo.root, ["show", head + ":" + name], true),
        staged = git(repo.root, ["show", ":" + name], true),
        hash = digest(data);
      if (
        (staged === committed || digest(staged + "\n") === hash) &&
        digest(committed + "\n") !== hash &&
        digest(committed) !== hash
      ) {
        const oid = command(repo, ["hash-object", "-w", "--stdin"], {
          input: data,
        }).trim();
        command(
          repo,
          ["update-index", "--add", "--cacheinfo", "100644", oid, name],
          { env },
        );
        generated.push({ name, blob: oid, committed, hash });
      }
    }
    const tree = command(repo, ["write-tree"], { env }).trim();
    if (tree === git(repo.root, ["rev-parse", head + "^{tree}"])) {
      cleanupLegacy({ ...repo, dir: path.join(repo.root, ".dip") });
      return { root: repo.root, retired: true, unchanged: true };
    }
    const oid = command(
      repo,
      [
        "commit-tree",
        tree,
        "-p",
        head,
        "-m",
        "DIP: move dynamic history to shared metadata storage",
      ],
      {
        env: {
          GIT_AUTHOR_NAME: "DIP",
          GIT_AUTHOR_EMAIL: "dip@localhost",
          GIT_COMMITTER_NAME: "DIP",
          GIT_COMMITTER_EMAIL: "dip@localhost",
        },
      },
    ).trim();
    atomic(journal, { head, oid, branch, blob, committed, tracked, generated });
    command(repo, ["update-ref", branch, oid, head]);
    // Source index entries are deliberately untouched; remove only the imported
    // event entries and update config only when it had no staged user edits.
    finishIndex({ tracked, committed, blob, generated });
    return {
      root: repo.root,
      retired: true,
      branch,
      oid,
      generatedFiles: generated.map((f) => f.name),
    };
  } finally {
    fs.rmSync(index, { force: true });
    fs.rmSync(index + ".lock", { force: true });
  }
}
