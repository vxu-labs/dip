import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { setImmediate } from "node:timers/promises";
import {
  projectSkillSources,
  skillActivation,
  skillHeader,
} from "./knowledge.js";
import { linkedSkillBundle } from "./skill-storage.js";
import { atomic, digest, home, json, repoAt } from "./util.js";

const catalogFile = () => path.join(home(), "skills.json");
const directories = (root) => {
  try {
    return fs
      .readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
      .map((entry) => path.join(root, entry.name))
      .sort();
  } catch (error) {
    if (!["ENOENT", "ENOTDIR"].includes(error.code)) throw error;
    return [];
  }
};
const contained = (root, folder) => {
  const relative = path.relative(root, folder);
  return (
    !path.isAbsolute(relative) &&
    relative !== ".." &&
    !relative.startsWith(".." + path.sep)
  );
};
function machineRoots(user, env) {
  const codex = path.resolve(env.CODEX_HOME || path.join(user, ".codex"));
  const claude = path.resolve(
    env.CLAUDE_CONFIG_DIR || path.join(user, ".claude"),
  );
  const cache = path.join(codex, "plugins", "cache");
  return {
    installations: [
      {
        root: path.join(user, ".agents", "skills"),
        host: "codex",
        installation: "User",
      },
      { root: path.join(codex, "skills"), host: "codex", installation: "User" },
      {
        root: path.join(codex, "skills", ".system"),
        host: "codex",
        installation: "Built-in",
      },
      {
        root: path.join(claude, "skills"),
        host: "claude",
        installation: "User",
      },
    ],
    excluded: [
      path.join(user, ".agents", "skills"),
      path.join(codex, "skills"),
      path.join(claude, "skills"),
      path.join(codex, "vendor_imports"),
      cache,
      path.join(user, ".local", "share", "openoffice", "backups"),
    ],
    cache,
  };
}
function globalSkills({ installations, cache }) {
  const pluginRoots = directories(cache).flatMap((market) =>
    directories(market).flatMap((plugin) => {
      const version = directories(plugin).sort((a, b) =>
        b.localeCompare(a, "en", { numeric: true }),
      )[0];
      return version
        ? [
            {
              root: path.join(version, "skills"),
              host: "codex",
              installation: path.basename(plugin) + " plugin cache",
            },
          ]
        : [];
    }),
  );
  const sources = new Set();
  return [...installations, ...pluginRoots]
    .flatMap(({ root, host, installation }) =>
      directories(root).flatMap((folder) => {
        try {
          const file = path.join(folder, "SKILL.md");
          const real = fs.realpathSync.native(file);
          const key = host + ":" + real;
          if (sources.has(key)) return [];
          const stat = fs.statSync(real);
          if (!stat.isFile() || stat.size > 1024 * 1024) return [];
          const data = fs.readFileSync(real);
          const body = new TextDecoder("utf-8", { fatal: true }).decode(data);
          let canonicalSource;
          try {
            const bundle = linkedSkillBundle(
              folder,
              home(),
              host === "claude" ? ["skills", "claude-skills"] : undefined,
            );
            if (bundle && path.join(bundle, "SKILL.md") === real)
              canonicalSource = real;
          } catch {
            // Existing user-managed links retain their original classification.
          }
          const policy = skillActivation(
            { root: fs.realpathSync.native(folder) },
            "SKILL.md",
            host,
            body,
          );
          sources.add(key);
          return [
            {
              source: file,
              ...(canonicalSource && { canonicalSource }),
              host,
              installation,
              hash: digest(data),
              activation: policy.activation,
              ...skillHeader(body, path.basename(folder)),
            },
          ];
        } catch {
          return [];
        }
      }),
    )
    .sort(
      (a, b) => a.name.localeCompare(b.name) || a.host.localeCompare(b.host),
    );
}

export async function syncSkills(
  catalog,
  { user = os.homedir(), env = process.env } = {},
) {
  const roots = machineRoots(user, env);
  const startedAt = new Date().toISOString();
  const errors = [];
  const projects = [];
  for (const project of catalog.projects) {
    const worktrees = [];
    for (const { path: root } of project.worktrees) {
      if (roots.excluded.some((excluded) => contained(excluded, root)))
        continue;
      await setImmediate();
      try {
        const repo = repoAt(root);
        if (repo.key !== project.id || repo.root !== root) continue;
        const skills = projectSkillSources(repo);
        if (skills.length)
          worktrees.push({ root, branch: repo.branch, skills });
      } catch {
        errors.push({ root, error: "Could not index project skills" });
      }
    }
    if (worktrees.length)
      projects.push({
        id: project.id,
        name: project.name,
        root: project.root,
        worktrees,
      });
  }
  const index = {
    version: 1,
    startedAt,
    updatedAt: new Date().toISOString(),
    global: globalSkills(roots),
    projects,
    errors,
  };
  const previous = readSkillCatalog();
  if (previous?.startedAt > startedAt) return previous;
  atomic(catalogFile(), index);
  return index;
}

export function readSkillCatalog() {
  try {
    const index = json(catalogFile(), null);
    return index?.version === 1 &&
      ["global", "projects", "errors"].every((key) => Array.isArray(index[key]))
      ? index
      : null;
  } catch {
    return null;
  }
}

export function exportGlobalSkills(catalog) {
  return {
    format: "dip-global-skills-v1",
    skills: [
      ...new Map(
        catalog.global.map(({ name, host, activation }) => [
          JSON.stringify([name, host, activation]),
          { name, host, activation },
        ]),
      ).values(),
    ],
  };
}
