import fs from "node:fs";
import path from "node:path";
import { atomic, json, repoAt } from "./util.js";

export const projectIndexPath = (directory) =>
  path.join(directory, "projects.json");

// A rebuildable local projection, not a second ledger. The runtime writer lock
// serializes publishers across hooks/processes; every publisher reads fresh rows
// after acquiring it, so an older snapshot cannot overwrite a newer registration.
export function refreshProjectIndex(runtime) {
  const file = projectIndexPath(runtime.directory);
  runtime.db.exec("BEGIN IMMEDIATE");
  try {
    const families = new Map(),
      errors = [],
      known = runtime
        .repositories()
        .map((r) => r.root)
        .sort(),
      queued = new Set(known),
      commonDirs = new Set();
    const add = (root) => {
      if (!queued.has(root)) {
        queued.add(root);
        known.push(root);
      }
    };
    for (const root of known) {
      try {
        // Do not walk up to a parent repository after this checkout is removed.
        if (!fs.existsSync(path.join(root, ".git"))) continue;
        const repo = repoAt(root);
        if (!commonDirs.has(repo.common)) {
          commonDirs.add(repo.common);
          if (path.basename(repo.common) === ".git")
            add(path.dirname(repo.common));
          const links = path.join(repo.common, "worktrees");
          try {
            for (const entry of fs.readdirSync(links, {
              withFileTypes: true,
            })) {
              if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
              const directory = path.join(links, entry.name);
              try {
                const marker = fs
                  .readFileSync(path.join(directory, "gitdir"), "utf8")
                  .trim();
                add(path.dirname(path.resolve(directory, marker)));
              } catch (error) {
                if (error.code !== "ENOENT")
                  errors.push({ root, error: error.message });
              }
            }
          } catch (error) {
            if (error.code !== "ENOENT")
              errors.push({ root, error: error.message });
          }
        }
        if (!fs.existsSync(path.join(root, ".dip", "config.json"))) continue;
        const config = json(path.join(root, ".dip", "config.json"));
        if (![1, 2].includes(config?.schemaVersion))
          throw Error("Unsupported DIP project configuration");
        runtime.db
          .prepare("INSERT OR IGNORE INTO repositories VALUES (?,?,?)")
          .run(repo.root, repo.key, Date.now());
        let family = families.get(repo.key);
        if (!family) {
          family = { id: repo.key, gitCommonDir: repo.common, worktrees: [] };
          families.set(repo.key, family);
        }
        if (!family.worktrees.some((w) => w.path === repo.root))
          family.worktrees.push({
            path: repo.root,
            storageVersion: config.schemaVersion,
          });
      } catch (error) {
        if (error.code !== "ENOENT")
          errors.push({ root, error: error.message });
      }
    }
    const projects = [...families.values()]
      .map((family) => {
        family.worktrees.sort((a, b) => a.path.localeCompare(b.path));
        const primary =
          family.worktrees.find(
            (w) => path.join(w.path, ".git") === family.gitCommonDir,
          ) || family.worktrees[0];
        let projectId = null;
        try {
          projectId =
            json(path.join(family.gitCommonDir, "dip", "storage.json"))
              ?.projectId || null;
        } catch (error) {
          errors.push({ root: primary.path, error: error.message });
        }
        return {
          id: family.id,
          name: path.basename(primary.path),
          root: primary.path,
          gitCommonDir: family.gitCommonDir,
          projectId,
          worktrees: family.worktrees,
        };
      })
      .sort((a, b) => a.root.localeCompare(b.root));
    const content = {
      schemaVersion: 1,
      projectCount: projects.length,
      worktreeCount: projects.reduce((n, p) => n + p.worktrees.length, 0),
      projects,
      errors: errors.sort(
        (a, b) =>
          a.root.localeCompare(b.root) || a.error.localeCompare(b.error),
      ),
    };
    const stat = fs.lstatSync(file, { throwIfNoEntry: false });
    if (stat && (!stat.isFile() || stat.isSymbolicLink()))
      throw Error("Project index must be a regular file");
    let previous;
    try {
      previous = json(file);
    } catch {
      /* Rebuild a damaged projection. */
    }
    const { updatedAt: ignored, ...oldContent } = previous || {};
    let index = previous;
    if (
      !previous?.updatedAt ||
      JSON.stringify(oldContent) !== JSON.stringify(content)
    ) {
      index = { ...content, updatedAt: new Date().toISOString() };
      atomic(file, index);
    }
    runtime.db.exec("COMMIT");
    return { file, ...index };
  } catch (error) {
    runtime.db.exec("ROLLBACK");
    throw error;
  }
}

export function projectIndexStatus(directory) {
  const file = projectIndexPath(directory);
  try {
    const index = json(file);
    if (
      index &&
      (index.schemaVersion !== 1 ||
        !Array.isArray(index.projects) ||
        !Number.isInteger(index.projectCount) ||
        !Number.isInteger(index.worktreeCount))
    )
      throw Error("Invalid project index; run dip projects to rebuild it");
    return {
      file,
      available: !!index,
      schemaVersion: index?.schemaVersion || null,
      projectCount: index?.projectCount ?? null,
      worktreeCount: index?.worktreeCount ?? null,
      updatedAt: index?.updatedAt || null,
      errors: index?.errors || [],
    };
  } catch (error) {
    return { file, available: false, error: error.message };
  }
}
