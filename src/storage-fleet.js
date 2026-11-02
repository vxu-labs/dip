import fs from "node:fs";
import path from "node:path";
import { Runtime, ensure } from "./core.js";
import { repoAt, home, json, atomic, git } from "./util.js";
import {
  migrateStorage,
  storageStatus,
  publishStore,
  retireLegacy,
  maintainStorage,
  sharedActive,
} from "./storage.js";

export function checkpointFleet() {
  const lock = path.join(home(), "storage-maintenance.lock");
  if (fs.existsSync(lock)) {
    try {
      process.kill(Number(fs.readFileSync(lock, "utf8")), 0);
      return { busy: true };
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
      fs.rmSync(lock);
    }
  }
  let fd;
  try {
    fd = fs.openSync(lock, "wx");
    fs.writeSync(fd, String(process.pid));
  } catch {
    return { busy: true };
  }
  const rt = new Runtime(),
    seen = new Set(),
    results = [];
  let first;
  try {
    for (const { root } of rt.repositories())
      try {
        const repo = repoAt(root);
        if (seen.has(repo.key) || !sharedActive(repo)) continue;
        seen.add(repo.key);
        first ||= repo;
        const published = publishStore(repo);
        maintainStorage(repo, Date.now(), { global: false });
        results.push({ root, oid: published.oid });
      } catch (error) {
        results.push({ root, error: error.message });
      }
    if (first) maintainStorage(first);
    atomic(path.join(home(), "storage-maintenance-latest.json"), {
      at: new Date().toISOString(),
      results,
    });
    return {
      projects: seen.size,
      failed: results.filter((r) => r.error).length,
    };
  } finally {
    rt.close();
    fs.closeSync(fd);
    fs.rmSync(lock, { force: true });
  }
}

export async function migrateFleet({
  roots = [],
  dryRun = false,
  cleanup = false,
  push = false,
  remote = "origin",
  onProgress = () => {},
} = {}) {
  const rt = new Runtime();
  let registered;
  try {
    registered = rt.repositories().map((r) => r.root);
  } finally {
    rt.close();
  }
  const families = new Map(),
    unavailable = [];
  for (const root of new Set([...registered, ...roots])) {
    try {
      if (!fs.existsSync(path.join(root, ".dip", "config.json"))) {
        unavailable.push({
          root,
          reason: fs.existsSync(root) ? "no_dip_config" : "missing_root",
        });
        continue;
      }
      const repo = repoAt(root);
      if (!families.has(repo.key)) families.set(repo.key, { repo, roots: [] });
      families.get(repo.key).roots.push(root);
    } catch (error) {
      unavailable.push({ root, reason: error.message });
    }
  }
  const results = [];
  let n = 0;
  for (const { repo, roots: familyRoots } of families.values()) {
    const result = { family: repo.key, root: repo.root };
    try {
      onProgress({
        index: ++n,
        total: families.size,
        root: repo.root,
        stage: dryRun ? "inventory" : "migrating",
      });
      // Fetch only the reserved branch, if it exists. No user code is pulled.
      const hasRemote = !!git(repo.root, ["remote", "get-url", remote], true);
      if (push && hasRemote && !dryRun) {
        try {
          const advertised = git(repo.root, [
            "ls-remote",
            "--heads",
            remote,
            "dip/state",
          ]);
          if (advertised)
            git(repo.root, [
              "fetch",
              "--no-tags",
              remote,
              "refs/heads/dip/state:refs/remotes/" + remote + "/dip/state",
            ]);
        } catch (error) {
          result.syncError = error.message;
        }
      }
      Object.assign(
        result,
        await migrateStorage(repo.root, {
          roots: familyRoots,
          dryRun,
          cleanup: false,
        }),
      );
      if (!dryRun) {
        result.integrations = result.worktrees.map((root) => {
          const project = ensure(root);
          return { root, preservedInstructions: project.preservedInstructions };
        });
        const hasIntent = storageStatus(repo).semanticEvents > 0;
        if (!hasIntent) {
          delete result.syncError;
          result.remoteSkipped = "no_semantic_events";
        }
        try {
          result.published = publishStore(repo, {
            remote:
              push && hasRemote && hasIntent && !result.syncError
                ? remote
                : undefined,
            push: push && hasRemote && hasIntent && !result.syncError,
          });
        } catch (error) {
          result.syncError = error.message;
          result.published = publishStore(repo);
        }
        result.retired = cleanup
          ? result.worktrees.map((root) => retireLegacy(root))
          : [];
        maintainStorage(repo);
        result.storage = storageStatus(repo);
        result.status = result.syncError
          ? "migrated_sync_failed"
          : push && (!hasRemote || !hasIntent)
            ? "migrated_local_only"
            : "migrated";
      } else result.status = "inventoried";
    } catch (error) {
      result.status = "failed";
      result.error = error.message;
    }
    results.push(result);
    onProgress({
      index: n,
      total: families.size,
      root: repo.root,
      stage: result.status,
      error: result.error,
    });
    if (!dryRun)
      atomic(path.join(home(), "storage-migration-latest.json"), {
        schemaVersion: 1,
        at: new Date().toISOString(),
        results,
        unavailable,
        complete: false,
      });
  }
  const report = {
    schemaVersion: 1,
    at: new Date().toISOString(),
    families: families.size,
    results,
    unavailable,
    migrated: results.filter((r) => r.status.startsWith("migrated")).length,
    failed: results.filter((r) => r.status === "failed" || r.syncError).length,
    syncFailures: results.filter((r) => r.syncError).length,
    localComplete: results.every((r) => r.status.startsWith("migrated")),
    complete: results.every(
      (r) => r.status.startsWith("migrated") && !r.syncError,
    ),
    historicalMissingRootsRetained: unavailable.length,
  };
  if (!dryRun) {
    atomic(path.join(home(), "storage-migration-latest.json"), report);
    if (report.localComplete) {
      const file = path.join(home(), "install.json"),
        installation = json(file, null);
      if (installation) atomic(file, { ...installation, storageVersion: 2 });
    }
  }

  return report;
}
