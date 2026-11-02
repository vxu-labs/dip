// Synthetic persistence workload; no model, network, or user repository writes.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { performance } from "node:perf_hooks";
import { ensure, events, taskRead } from "../src/core.js";
import { atomic, git, id, digest, repoAt } from "../src/util.js";
import {
  migrateStorage,
  publishStore,
  retireLegacy,
  storageStatus,
} from "../src/storage.js";
const sandbox = fs.mkdtempSync(
  path.join(os.tmpdir(), "dip-storage-benchmark-"),
);
process.env.DIP_HOME = path.join(sandbox, "runtime");
process.env.DIP_USER_HOME = path.join(sandbox, "user");
process.env.DIP_GIT_CONFIG = path.join(sandbox, "gitconfig");
process.env.GIT_CONFIG_GLOBAL = process.env.DIP_GIT_CONFIG;
process.env.GIT_CONFIG_NOSYSTEM = "1";
const output = process.argv[2];
function size(root) {
  const out = { files: 0, bytes: 0, allocatedBytes: 0 };
  if (!fs.existsSync(root)) return out;
  for (const e of fs.readdirSync(root, { withFileTypes: true })) {
    const file = path.join(root, e.name);
    if (e.isDirectory()) {
      const v = size(file);
      for (const k of Object.keys(out)) out[k] += v[k];
    } else if (e.isFile()) {
      const s = fs.statSync(file);
      out.files++;
      out.bytes += s.size;
      out.allocatedBytes += s.blocks * 512;
    }
  }
  return out;
}
try {
  const root = path.join(sandbox, "project");
  fs.mkdirSync(root);
  git(root, ["init", "-b", "main"]);
  git(root, ["config", "user.name", "Benchmark"]);
  git(root, ["config", "user.email", "benchmark@invalid"]);
  const repo = ensure(root),
    task = "task_benchmark",
    files = Object.fromEntries(
      Array.from({ length: 7000 }, (_, i) => [
        "resources/source-" + i + ".js",
        digest("contents-" + i),
      ]),
    );
  let parent;
  const write = (type, payload, taskId = task) => {
    const eventId = id(),
      e = {
        schemaVersion: 1,
        eventId,
        taskId,
        type,
        payload,
        parents: taskId === "_activity" ? [] : parent ? [parent] : [],
        createdAt: new Date().toISOString(),
        actor: "benchmark",
        branch: "main",
      };
    atomic(path.join(repo.dir, "events", taskId, eventId + ".json"), e);
    if (taskId !== "_activity") parent = eventId;
  };
  write("task.create", {
    title: "Retain requirements and evidence",
    status: "in_progress",
    scope: [],
    acceptance: ["Preserve every semantic event"],
  });
  for (let i = 0; i < 100; i++)
    write("task.evidence", {
      check: "synthetic",
      result: "passed",
      snapshot: { files, hash: digest(JSON.stringify(files)), head: null },
      summary: "Repeated manifest " + i,
    });
  for (let i = 0; i < 500; i++)
    write(
      "activity.batch",
      {
        session: "synthetic",
        records: [
          {
            kind: "files.changed",
            files: Object.keys(files),
            recordId: "record-" + i,
          },
        ],
      },
      "_activity",
    );
  git(root, ["add", "."]);
  git(root, ["commit", "-m", "Synthetic legacy history"]);
  const roots = [root, root + "-two", root + "-three"];
  for (const [i, r] of roots.entries())
    if (i) git(root, ["worktree", "add", r, "-b", "worker-" + i]);
  const before = {
    ledgers: roots.map((r) => size(path.join(r, ".dip"))),
    gitObjects: size(path.join(repo.common, "objects")),
  };
  const started = performance.now(),
    report = await migrateStorage(root);
  publishStore(repo);
  for (const r of roots) retireLegacy(r);
  const elapsedMs = performance.now() - started,
    status = storageStatus(repo);
  if (
    status.semanticEvents !== 101 ||
    status.snapshotManifests !== 1 ||
    taskRead(ensure(root), task).evidence.length !== 100
  )
    throw Error("Semantic fidelity failed");
  const after = {
    ledgers: roots.map((r) => size(path.join(r, ".dip"))),
    sharedIncludingBackup: size(path.join(repo.common, "dip")),
    gitObjects: size(path.join(repo.common, "objects")),
  };
  const beforeAllocated =
    before.ledgers.reduce((n, s) => n + s.allocatedBytes, 0) +
    before.gitObjects.allocatedBytes;
  const afterAllocated =
    after.ledgers.reduce((n, s) => n + s.allocatedBytes, 0) +
    after.sharedIncludingBackup.allocatedBytes +
    after.gitObjects.allocatedBytes;
  const samples = [];
  for (let i = 0; i < 20; i++) {
    const t = performance.now();
    events(ensure(root), task);
    samples.push(performance.now() - t);
  }
  samples.sort((a, b) => a - b);
  const result = {
    schemaVersion: 1,
    date: new Date().toISOString(),
    platform: process.platform,
    node: process.version,
    synthetic: true,
    workload: {
      worktrees: 3,
      semanticEvents: 101,
      evidence: 100,
      manifestPaths: 7000,
      activityEvents: 500,
      activityPathsPerEvent: 7000,
    },
    before,
    after,
    beforeAllocated,
    afterAllocated,
    reduction: 1 - afterAllocated / beforeAllocated,
    migrationMs: elapsedMs,
    readMs: { p50: samples[10], p95: samples[18] },
    fidelity: {
      semanticEvents: status.semanticEvents,
      snapshotManifests: status.snapshotManifests,
      allEvidenceReadable: true,
    },
    includes: [
      "legacy Git objects retained",
      "private compressed recovery archive",
      "shared SQLite and WAL",
      "all three worktree ledgers",
    ],
    limits: [
      "Synthetic file notifications, not a real recorder/checkout performance trial",
      "Allocated blocks are not exclusive APFS physical usage",
      "Historical Git objects were not rewritten or garbage-collected",
    ],
  };
  if (output) fs.writeFileSync(output, JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify(result, null, 2));
  if (result.reduction < 0.8)
    throw Error("Synthetic storage reduction missed the declared 80% target");
} finally {
  fs.rmSync(sandbox, { recursive: true, force: true });
}
