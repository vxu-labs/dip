import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import {
  ensure,
  append,
  createTask,
  taskRead,
  events,
  Runtime,
} from "../src/core.js";
import { git, repoAt, atomic } from "../src/util.js";
import {
  migrateStorage,
  storageStatus,
  sharedActive,
  publishStore,
  retireLegacy,
  configureStorage,
  maintainStorage,
  withStore,
  recoverShared,
  STATE_REF,
} from "../src/storage.js";
import { navigate } from "../src/navigation.js";
import { portable } from "../src/portable.js";
import { restoreStorage } from "../src/storage.js";
import { migrateFleet } from "../src/storage-fleet.js";
import { trimRuntimeLog } from "../src/runtime-logs.js";

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "dip-storage-"));
process.env.DIP_HOME = path.join(sandbox, "runtime");
process.env.DIP_USER_HOME = path.join(sandbox, "user");
process.env.DIP_GIT_CONFIG = path.join(sandbox, "global.gitconfig");
process.env.GIT_CONFIG_GLOBAL = process.env.DIP_GIT_CONFIG;
process.env.GIT_CONFIG_NOSYSTEM = "1";
let serial = 0;
function fixture() {
  const root = path.join(sandbox, "repo-" + ++serial);
  fs.mkdirSync(root);
  git(root, ["init", "-b", "main"]);
  git(root, ["config", "user.name", "Storage Test"]);
  git(root, ["config", "user.email", "test@invalid"]);
  const repo = ensure(root);
  fs.writeFileSync(path.join(root, "source.js"), "export const n = 1;\n");
  return repo;
}
function commit(repo, message = "initial") {
  git(repo.root, ["add", "."]);
  git(repo.root, ["commit", "-m", message]);
  return repoAt(repo.root);
}
test.after(() => fs.rmSync(sandbox, { recursive: true, force: true }));

test("migration unifies unmerged branches and worktrees, deduplicates manifests and preserves semantic history", async () => {
  const repo = fixture(),
    id = createTask(repo, { title: "Shared requirement" });
  const files = { "source.js": "a".repeat(64) };
  for (let i = 0; i < 4; i++)
    append(repo, id, "task.evidence", {
      check: "test",
      result: "passed",
      snapshot: { files, hash: "h", head: null },
    });
  commit(repo);
  git(repo.root, ["branch", "feature"]);
  const other = repo.root + "-worktree";
  git(repo.root, ["worktree", "add", other, "feature"]);
  const second = ensure(other),
    future = createTask(second, { title: "Only in feature" });
  commit(second, "unmerged intent");
  const old = events(ensure(repo.root), id).events;
  const report = await migrateStorage(repo.root);
  assert.ok(fs.existsSync(report.backup));
  assert.equal(report.worktrees.length, 2);
  assert.equal(taskRead(ensure(repo.root), future).title, "Only in feature");
  assert.equal(taskRead(ensure(other), id).title, "Shared requirement");
  assert.deepEqual(
    events(ensure(other), id).events.sort((a, b) =>
      a.eventId.localeCompare(b.eventId),
    ),
    old.sort((a, b) => a.eventId.localeCompare(b.eventId)),
  );
  assert.equal(storageStatus(repo).snapshotManifests, 1);
  const before = storageStatus(repo).semanticEvents;
  await migrateStorage(other);
  assert.equal(storageStatus(repo).semanticEvents, before);
});

test("metadata publication keeps HEAD, index and dirty source unchanged and uses exactly one orphan branch", async () => {
  const repo = fixture(),
    id = createTask(repo, { title: "Publish" });
  commit(repo);
  await migrateStorage(repo.root);
  fs.writeFileSync(path.join(repo.root, "source.js"), "staged\n");
  git(repo.root, ["add", "source.js"]);
  fs.appendFileSync(path.join(repo.root, "source.js"), "unstaged\n");
  const head = git(repo.root, ["rev-parse", "HEAD"]),
    index = git(repo.root, ["ls-files", "--stage"]),
    source = fs.readFileSync(path.join(repo.root, "source.js"));
  const first = publishStore(repo),
    second = publishStore(repo);
  assert.equal(first.oid, second.oid);
  withStore(repo, (db) =>
    db.exec(
      "CREATE TABLE cache_writes(n INTEGER); INSERT INTO cache_writes VALUES (0); CREATE TRIGGER track_cache_writes AFTER INSERT ON git_entries BEGIN UPDATE cache_writes SET n=n+1; END;",
    ),
  );
  publishStore(repo);
  assert.equal(
    withStore(repo, (db) => db.prepare("SELECT n FROM cache_writes").get().n),
    0,
    "unchanged publication must not rewrite every cache entry",
  );
  assert.equal(git(repo.root, ["rev-parse", "HEAD"]), head);
  assert.equal(git(repo.root, ["ls-files", "--stage"]), index);
  assert.deepEqual(fs.readFileSync(path.join(repo.root, "source.js")), source);
  assert.equal(
    git(repo.root, ["rev-list", "--parents", "-n", "1", STATE_REF]).split(" ")
      .length,
    1,
  );
  assert.match(
    git(repo.root, [
      "show",
      STATE_REF +
        `:.dip/events/${id}/` +
        events(ensure(repo.root), id).events[0].eventId +
        ".json",
    ]),
    /Publish/,
  );
  assert.equal(
    git(repo.root, [
      "for-each-ref",
      "--format=%(refname)",
      "refs/heads/dip",
    ]).split("\n").length,
    1,
  );
});

test("retirement commits only metadata and preserves staged and unstaged user source", async () => {
  const repo = fixture(),
    id = createTask(repo, { title: "Retire" });
  commit(repo);
  await migrateStorage(repo.root);
  publishStore(repo);
  fs.writeFileSync(path.join(repo.root, "source.js"), "stage me\n");
  git(repo.root, ["add", "source.js"]);
  fs.appendFileSync(path.join(repo.root, "source.js"), "keep me\n");
  const staged = git(repo.root, ["show", ":source.js"]),
    working = fs.readFileSync(path.join(repo.root, "source.js"), "utf8");
  const result = retireLegacy(repo.root);
  assert.equal(result.retired, true);
  assert.equal(git(repo.root, ["show", ":source.js"]), staged);
  assert.equal(
    fs.readFileSync(path.join(repo.root, "source.js"), "utf8"),
    working,
  );
  assert.equal(
    git(repo.root, [
      "ls-tree",
      "-r",
      "--name-only",
      "HEAD",
      "--",
      ".dip/events",
    ]),
    "",
  );
  assert.equal(
    JSON.parse(git(repo.root, ["show", "HEAD:.dip/config.json"])).schemaVersion,
    2,
  );
  assert.equal(fs.existsSync(path.join(repo.root, ".dip", "events")), false);
  assert.equal(taskRead(ensure(repo.root), id).title, "Retire");
  append(ensure(repo.root), id, "task.checkpoint", {
    summary: "still writable",
  });
  assert.equal(fs.existsSync(path.join(repo.root, ".dip", "events")), false);
});

test("activity is bounded by compressed bytes and age, file floods are explicit and never enter Git", async () => {
  const repo = fixture();
  createTask(repo, { title: "Keep intent" });
  commit(repo);
  await migrateStorage(repo.root);
  configureStorage(repo, { activityBytes: 2000, maxFiles: 3 });
  for (let i = 0; i < 50; i++)
    append(
      ensure(repo.root),
      "_activity",
      "activity.batch",
      {
        records: [
          {
            kind: "files.changed",
            files: Array.from({ length: 7000 }, (_, n) => "path-" + n),
          },
        ],
      },
      { parents: [] },
    );
  const state = storageStatus(repo);
  assert.ok(state.activity.compressedBytes <= 2000);
  const raw = events(ensure(repo.root), "_activity").events.at(-1).payload
    .records[0];
  assert.equal(raw.files.length, 3);
  assert.equal(raw.fileCount, 7000);
  assert.equal(raw.filesTruncated, true);
  publishStore(repo);
  assert.equal(
    git(repo.root, ["ls-tree", "-r", "--name-only", STATE_REF]).includes(
      "_activity",
    ),
    false,
  );
  maintainStorage(repo, Date.now() + 9 * 86400000);
  assert.equal(storageStatus(repo).activity.records, 0);
  assert.equal(storageStatus(repo).semanticEvents, 1);
});

test("global activity budget evicts only raw records across independent repositories", async () => {
  const a = fixture(),
    b = fixture();
  await migrateStorage(a.root);
  await migrateStorage(b.root);
  configureStorage(a, { globalActivityBytes: 1200 });
  for (const repo of [a, b])
    for (let i = 0; i < 10; i++)
      append(
        ensure(repo.root),
        "_activity",
        "activity.batch",
        { records: [{ kind: "PreToolUse", command: "operation-" + i }] },
        { parents: [] },
      );
  const r = maintainStorage(a);
  assert.ok(r.globalActivityBytes <= 1200);
});

test("incompatible event IDs roll migration back without enabling shared storage", async () => {
  const repo = fixture(),
    id = createTask(repo, { title: "Original" });
  commit(repo);
  git(repo.root, ["branch", "other"]);
  const other = repo.root + "-conflict";
  git(repo.root, ["worktree", "add", other, "other"]);
  const file = path.join(
    other,
    ".dip",
    "events",
    id,
    events(repo, id).events[0].eventId + ".json",
  );
  const e = JSON.parse(fs.readFileSync(file));
  e.payload.title = "Incompatible";
  atomic(file, e);
  await assert.rejects(migrateStorage(repo.root), /Conflicting imported event/);
  assert.equal(sharedActive(repo), false);
  assert.equal(taskRead(repo, id).title, "Original");
});

test("two independent clones synchronize concurrent histories without force or invented causality", async () => {
  const a = fixture(),
    id = createTask(a, { title: "Across clones" });
  commit(a);
  await migrateStorage(a.root);
  publishStore(a);
  retireLegacy(a.root);
  const bare = path.join(sandbox, "remote-" + serial + ".git");
  git(a.root, ["clone", "--bare", a.root, bare]);
  git(a.root, ["remote", "add", "origin", bare]);
  const bRoot = path.join(sandbox, "clone-" + serial);
  git(a.root, ["clone", bare, bRoot]);
  const b = repoAt(bRoot);
  assert.equal(recoverShared(b), true);
  const parent = events(ensure(a.root), id).events[0].eventId;
  append(
    ensure(a.root),
    id,
    "task.update",
    { description: "from A" },
    { parents: [parent], actor: "a" },
  );
  append(
    ensure(b.root),
    id,
    "task.update",
    { description: "from B" },
    { parents: [parent], actor: "b" },
  );
  publishStore(a, { remote: "origin", push: true });
  publishStore(b, { remote: "origin", push: true });
  publishStore(a, { remote: "origin", push: true });
  assert.equal(taskRead(ensure(a.root), id).status, "conflict");
  assert.equal(taskRead(ensure(b.root), id).status, "conflict");
  const remote = git(a.root, [
    "ls-remote",
    "--heads",
    "origin",
    "dip/state",
  ]).split(/\s+/)[0];
  assert.equal(remote, git(a.root, ["rev-parse", STATE_REF]));
  publishStore(a);
  assert.equal(storageStatus(a).lastRemoteSync.oid, remote);
  assert.equal(storageStatus(a).lastPublished.remote, null);
});

test("shared navigation indexes task revisions and isolates unrelated projects with matching branch names", async () => {
  const a = fixture(),
    b = fixture();
  const id = createTask(a, { title: "Unicode שלום source" });
  await migrateStorage(a.root);
  await migrateStorage(b.root);
  const rt = new Runtime();
  try {
    const result = navigate(ensure(a.root), rt, "search", { query: "שלום" });
    assert.ok(result.hits.some((r) => r.id === id));
    assert.throws(() => taskRead(ensure(b.root), id), /Unknown task|not found/);
  } finally {
    rt.close();
  }
});

test("portable v2 intent is durable without the global runtime and is drained atomically", async () => {
  const repo = fixture();
  createTask(repo, { title: "Before portable" });
  commit(repo);
  await migrateStorage(repo.root);
  publishStore(repo);
  retireLegacy(repo.root);
  const result = portable("create", { title: "Portable שלום" }, repo.root);
  portable("plan", { id: result.id, text: "Deferred plan" }, repo.root);
  assert.ok(
    portable("list", {}, repo.root).tasks.some((t) => t.id === result.id),
  );
  assert.equal(taskRead(ensure(repo.root), result.id).title, "Portable שלום");
  assert.equal(
    taskRead(ensure(repo.root), result.id).plan.input.text,
    "Deferred plan",
  );
  assert.equal(
    fs.readdirSync(path.join(repo.common, "dip", "portable")).length,
    0,
  );
  assert.equal(fs.existsSync(path.join(repo.root, ".dip", "events")), false);
});

test("compressed migration archive restores semantic evidence and requirements into another checkout", async () => {
  const repo = fixture(),
    id = createTask(repo, { title: "Recover original intent" });
  append(repo, id, "task.evidence", {
    check: "pass",
    result: "passed",
    snapshot: { files: { "source.js": "a".repeat(64) }, hash: "sample" },
  });
  const report = await migrateStorage(repo.root);
  const other = fixture();
  const restored = await restoreStorage(other.root, report.backup);
  assert.equal(restored.restored, 2);
  assert.equal(
    taskRead(ensure(other.root), id).title,
    "Recover original intent",
  );
  assert.deepEqual(
    taskRead(ensure(other.root), id).evidence[0].snapshot.files,
    { "source.js": "a".repeat(64) },
  );
  assert.equal(storageStatus(repo).projectId, storageStatus(other).projectId);
});

test("stable operation IDs survive retry without inventing a second causal event", async () => {
  const repo = fixture(),
    id = createTask(repo, { title: "Replay" });
  await migrateStorage(repo.root);
  const a = append(
    ensure(repo.root),
    id,
    "task.checkpoint",
    { summary: "durable" },
    { eventId: "stable_operation" },
  );
  const b = append(
    ensure(repo.root),
    id,
    "task.checkpoint",
    { summary: "durable" },
    { eventId: "stable_operation" },
  );
  assert.deepEqual(a, b);
  assert.equal(storageStatus(repo).semanticEvents, 2);
  assert.throws(
    () =>
      append(
        ensure(repo.root),
        id,
        "task.checkpoint",
        { summary: "different" },
        { eventId: "stable_operation" },
      ),
    /incompatible/,
  );
});

test("outbox failure handoff survives raw retention and preserves the observation's origin", async () => {
  const repo = fixture(),
    id = createTask(repo, { title: "Failed command" });
  commit(repo);
  await migrateStorage(repo.root);
  const rt = new Runtime();
  try {
    rt.enqueue(ensure(repo.root), "session", {
      at: new Date().toISOString(),
      kind: "PostToolUseFailure",
      tool: "exec_command",
      taskId: id,
      useId: "tool-1",
      origin: { branch: "feature", head: "b".repeat(40), worktree: repo.root },
    });
    rt.flush(repo.root);
    assert.equal(rt.db.prepare("SELECT count(*) AS n FROM queue").get().n, 0);
    maintainStorage(repo, Date.now() + 9 * 86400000);
    const checkpoint = taskRead(ensure(repo.root), id).checkpoints.at(-1);
    assert.match(checkpoint.summary, /failed/i);
    assert.equal(checkpoint.failure.origin.branch, "feature");
  } finally {
    rt.close();
  }
});

test("a source branch renamed or detached after migration never selects another ledger", async () => {
  const repo = fixture(),
    id = createTask(repo, { title: "Stable across refs" });
  commit(repo);
  await migrateStorage(repo.root);
  publishStore(repo);
  retireLegacy(repo.root);
  git(repo.root, ["branch", "-m", "renamed"]);
  assert.equal(taskRead(ensure(repo.root), id).title, "Stable across refs");
  git(repo.root, ["checkout", "--detach", "HEAD"]);
  append(ensure(repo.root), id, "task.checkpoint", { summary: "detached" });
  assert.equal(
    events(ensure(repo.root), id).events.find(
      (e) => e.payload.summary === "detached",
    ).origin.branch,
    "detached",
  );
  assert.equal(fs.existsSync(path.join(repo.root, ".dip", "events")), false);
});

test("a detached worktree hides only migrated event paths without moving source HEAD", async () => {
  const repo = fixture(),
    id = createTask(repo, { title: "Detached legacy" });
  commit(repo);
  git(repo.root, ["checkout", "--detach", "HEAD"]);
  const head = git(repo.root, ["rev-parse", "HEAD"]);
  await migrateStorage(repo.root);
  const result = retireLegacy(repo.root);
  assert.equal(result.retired, true);
  assert.equal(git(repo.root, ["rev-parse", "HEAD"]), head);
  assert.equal(fs.existsSync(path.join(repo.root, ".dip", "events")), false);
  assert.equal(
    git(repo.root, ["diff", "--name-only", "--", ".dip/events"]),
    "",
  );
  assert.equal(taskRead(ensure(repo.root), id).title, "Detached legacy");
});

test("migration preserves semantic events staged in the index but absent from the working tree", async () => {
  const repo = fixture();
  commit(repo);
  const id = createTask(repo, { title: "Only in index" });
  git(repo.root, ["add", ".dip/events"]);
  fs.rmSync(path.join(repo.dir, "events", id), { recursive: true });
  await migrateStorage(repo.root);
  assert.equal(taskRead(ensure(repo.root), id).title, "Only in index");
});

test("fleet migration retires local copies when a remote is unavailable and reports sync failure", async () => {
  const prior = process.env.DIP_HOME;
  process.env.DIP_HOME = path.join(sandbox, "isolated-fleet-runtime");
  try {
    const repo = fixture(),
      id = createTask(repo, {
        title: "Local migration survives network failure",
      });
    commit(repo);
    git(repo.root, [
      "remote",
      "add",
      "origin",
      path.join(sandbox, "absent-remote.git"),
    ]);
    const report = await migrateFleet({
      roots: [repo.root],
      cleanup: true,
      push: true,
    });
    assert.equal(report.localComplete, true);
    assert.equal(report.complete, false);
    assert.equal(report.syncFailures, 1);
    assert.equal(report.failed, 1);
    assert.equal(fs.existsSync(path.join(repo.root, ".dip", "events")), false);
    assert.equal(
      taskRead(ensure(repo.root), id).title,
      "Local migration survives network failure",
    );
  } finally {
    process.env.DIP_HOME = prior;
  }
});

test("migration resumes a dead owner's fence and imports durable pending writes", async () => {
  const repo = fixture(),
    task = createTask(repo, { title: "Crash recovery" }),
    dir = path.join(repo.common, "dip");
  fs.mkdirSync(dir, { recursive: true });
  const config = path.join(repo.root, ".dip", "config.json"),
    original = fs.readFileSync(config);
  atomic(path.join(dir, "migration-configs.json"), {
    [repo.root]: original.toString("base64"),
  });
  atomic(path.join(dir, "migration.lock"), "2147483647");
  const c = JSON.parse(original);
  c.schemaVersion = 2;
  atomic(config, c);
  append(ensure(repo.root), task, "task.checkpoint", {
    summary: "saved during interrupted import",
  });
  const report = await migrateStorage(repo.root);
  assert.ok(fs.existsSync(report.backup));
  assert.equal(fs.existsSync(report.backup + ".partial"), false);
  assert.equal(
    taskRead(ensure(repo.root), task).checkpoints.at(-1).summary,
    "saved during interrupted import",
  );
  assert.equal(fs.existsSync(path.join(dir, "migration.lock")), false);
  assert.equal(fs.existsSync(path.join(dir, "migration-configs.json")), false);
});

test("owned helper upgrades are committed without including source edits", async () => {
  const prior = process.env.DIP_HOME;
  process.env.DIP_HOME = path.join(sandbox, "helper-fleet-runtime");
  try {
    const repo = fixture(),
      helper = path.join(repo.root, ".dip", "tools", "portable.mjs"),
      manifestFile = path.join(repo.root, ".dip", "integration.json");
    fs.writeFileSync(helper, "// old owned helper\n");
    const manifest = JSON.parse(fs.readFileSync(manifestFile));
    const { digest } = await import("../src/util.js");
    manifest.files[".dip/tools/portable.mjs"] = digest(fs.readFileSync(helper));
    atomic(manifestFile, manifest);
    commit(repo);
    fs.writeFileSync(path.join(repo.root, "source.js"), "keep local source\n");
    const result = await migrateFleet({ roots: [repo.root], cleanup: true });
    assert.equal(result.failed, 0);
    assert.equal(
      git(repo.root, [
        "diff",
        "--name-only",
        "HEAD",
        "--",
        ".dip/tools/portable.mjs",
      ]),
      "",
    );
    assert.equal(
      fs.readFileSync(path.join(repo.root, "source.js"), "utf8"),
      "keep local source\n",
    );
    assert.match(
      git(repo.root, ["show", "HEAD:.dip/tools/portable.mjs"]),
      /sharedPortable/,
    );
  } finally {
    process.env.DIP_HOME = prior;
  }
});

test("diagnostic log retention preserves open append handles and valid Unicode lines", () => {
  const file = path.join(process.env.DIP_HOME, "daemon.log");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, "שורת אבחון\n".repeat(1000));
  const inode = fs.statSync(file).ino,
    fd = fs.openSync(file, "a");
  try {
    assert.equal(trimRuntimeLog("daemon.log", 1024), true);
    fs.writeSync(fd, "after trimming\n");
  } finally {
    fs.closeSync(fd);
  }
  const result = fs.readFileSync(file, "utf8");
  assert.equal(fs.statSync(file).ino, inode);
  assert.ok(Buffer.byteLength(result) < 1024);
  assert.ok(result.endsWith("after trimming\n"));
  assert.equal(result.includes("\ufffd"), false);
});

test("filtered clones fetch required metadata in batches without materializing source blobs", async () => {
  const a = fixture(),
    task = createTask(a, { title: "Filtered metadata" });
  fs.writeFileSync(
    path.join(a.root, "code-only.bin"),
    Buffer.alloc(2 * 1024 * 1024, 61),
  );
  commit(a);
  const sourceOid = git(a.root, ["rev-parse", "HEAD:code-only.bin"]);
  await migrateStorage(a.root);
  publishStore(a);
  retireLegacy(a.root);
  const bare = path.join(sandbox, "filtered-remote.git");
  git(a.root, ["clone", "--bare", a.root, bare]);
  git(bare, ["config", "uploadpack.allowFilter", "true"]);
  git(bare, ["config", "uploadpack.allowAnySHA1InWant", "true"]);
  const root = path.join(sandbox, "filtered-clone");
  git(a.root, [
    "clone",
    "--filter=blob:none",
    "--no-checkout",
    pathToFileURL(bare).href,
    root,
  ]);
  const present = () => {
    try {
      execFileSync("git", ["-C", root, "cat-file", "-e", sourceOid], {
        env: { ...process.env, GIT_NO_LAZY_FETCH: "1" },
        stdio: "pipe",
      });
      return true;
    } catch {
      return false;
    }
  };
  assert.equal(present(), false);
  git(root, ["checkout", "HEAD", "--", ".dip/config.json"]);
  assert.equal(portable("get", { id: task }, root).title, "Filtered metadata");
  await migrateStorage(root);
  assert.equal(taskRead(ensure(root), task).title, "Filtered metadata");
  assert.equal(present(), false);
  assert.equal(
    git(root, ["config", "--get", "remote.origin.partialclonefilter"]),
    "blob:none",
  );
});
