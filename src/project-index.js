import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { atomic, json, repoAt } from "./util.js";
import {
  readProjectPreferences,
  projectPreferencesPath,
} from "./project-preferences.js";

export const projectIndexPath = (directory) =>
  path.join(directory, "projects.json");

export const dashboardLauncherPath = (directory) =>
  path.join(directory, "dashboard.html");
export function localDashboardOrigin(directory) {
  try {
    const value = json(path.join(directory, "daemon.json"))?.dashboard;
    if (value) {
      const url = new URL(value);
      if (
        url.protocol === "http:" &&
        ["127.0.0.1", "localhost"].includes(url.hostname) &&
        !url.username &&
        !url.password &&
        url.pathname === "/" &&
        !url.search &&
        !url.hash
      )
        return url.origin;
    }
  } catch {
    /* An unavailable recorder still has a configured local endpoint. */
  }
  let port;
  try {
    port = json(path.join(directory, "install.json"))?.port;
  } catch {}
  return `http://127.0.0.1:${Number.isInteger(port) && port > 0 && port <= 65535 ? port : 4317}`;
}
export function projectLinks(root, origin) {
  const query = "?root=" + encodeURIComponent(root);
  return {
    folder: pathToFileURL(root + path.sep).href,
    dashboard: origin + "/" + query,
    localDashboard: origin + "/local" + query,
    tasks: origin + "/api/state" + query,
  };
}
export function catalogForOrigin(index, origin) {
  return {
    ...index,
    dashboard: { ...index.dashboard, url: origin + "/local" },
    projects: index.projects.map((project) => ({
      ...project,
      links: projectLinks(project.root, origin),
      worktrees: project.worktrees.map((worktree) => ({
        ...worktree,
        links: projectLinks(worktree.path, origin),
      })),
    })),
  };
}
export function localProjectDirectory(directory) {
  return {
    index: projectIndexPath(directory),
    dashboard: localDashboardOrigin(directory) + "/local",
    discover: "local_projects or dip projects",
    tasks:
      "Use a returned root with project_context / project_reconcile, or dip status --root PATH. Read project files with normal file tools; discovery grants no task ownership.",
  };
}
export function listLocalProjects(
  runtime,
  { query = "", limit = 20, offset = 0 } = {},
) {
  if (
    typeof query !== "string" ||
    query.length > 300 ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 50 ||
    !Number.isInteger(offset) ||
    offset < 0
  )
    throw Error("Invalid local-project pagination or query");
  const index = runtime.refreshProjects();
  const matched = index.projects.filter((p) =>
    JSON.stringify([p.name, p.root, p.worktrees.map((w) => w.path)])
      .toLocaleLowerCase()
      .includes(query.toLocaleLowerCase()),
  );
  return {
    file: index.file,
    dashboard: index.dashboard,
    projectCount: index.projectCount,
    favoriteCount: index.favoriteCount,
    total: matched.length,
    nextOffset: offset + limit < matched.length ? offset + limit : null,
    projects: matched.slice(offset, offset + limit).map((p) => ({
      ...p,
      worktreeCount: p.worktrees.length,
      worktrees: p.worktrees.slice(0, 12),
      worktreesTruncated: p.worktrees.length > 12,
    })),
    access: localProjectDirectory(runtime.directory),
    errors: index.errors,
  };
}

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
    let favorites = new Set();
    try {
      favorites = readProjectPreferences(runtime.directory).favorites;
    } catch (error) {
      errors.push({
        root: projectPreferencesPath(runtime.directory),
        error: error.message,
      });
    }
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
          favorite: favorites.has(family.id),
          name: path.basename(primary.path),
          root: primary.path,
          gitCommonDir: family.gitCommonDir,
          projectId,
          worktrees: family.worktrees,
        };
      })
      .sort(
        (a, b) =>
          Number(b.favorite) - Number(a.favorite) ||
          a.root.localeCompare(b.root),
      );
    const origin = localDashboardOrigin(runtime.directory);
    const linked = catalogForOrigin({ projects }, origin);
    const content = {
      schemaVersion: 1,
      projectCount: projects.length,
      favoriteCount: projects.filter((project) => project.favorite).length,
      worktreeCount: projects.reduce((n, p) => n + p.worktrees.length, 0),
      dashboard: {
        url: origin + "/local",
        file: dashboardLauncherPath(runtime.directory),
      },
      projects: linked.projects,
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
    const launcher = dashboardLauncherPath(runtime.directory);
    const html = `<!doctype html>\n<html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="refresh" content="0;url=${origin}/local"><title>DIP · Local projects</title><h1>DIP local projects</h1><p><a href="${origin}/local">Open the local project dashboard</a></p><p>The DIP recorder serves this dashboard on this computer.</p></html>\n`;
    const launcherStat = fs.lstatSync(launcher, { throwIfNoEntry: false });
    if (
      launcherStat &&
      (!launcherStat.isFile() || launcherStat.isSymbolicLink())
    )
      throw Error("Dashboard launcher must be a regular file");
    if (!launcherStat || fs.readFileSync(launcher, "utf8") !== html)
      atomic(launcher, html);
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
      favoriteCount: index?.favoriteCount ?? 0,
      worktreeCount: index?.worktreeCount ?? null,
      updatedAt: index?.updatedAt || null,
      dashboard: index?.dashboard || null,
      errors: index?.errors || [],
    };
  } catch (error) {
    return { file, available: false, error: error.message };
  }
}
