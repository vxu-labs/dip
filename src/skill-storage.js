import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { home, repoAt, sensitive } from "./util.js";

export const SKILL_AUTHORING_INSTRUCTIONS =
  "Create new agent skills with dip skills create NAME --description TEXT (add --global for a user-wide skill). Write the skill and its resources in the returned DIP bundle. Skills loaded by an application's own internal agents belong with that application.";

// The host discovers the directory link. DIP reads the checked target directly.
export function linkedSkillBundle(
  alias,
  dipDirectory,
  storeNames = ["skills"],
) {
  if (!fs.lstatSync(alias).isSymbolicLink()) return null;
  let link = fs.readlinkSync(alias);
  // A Windows directory junction is a machine-local absolute alias.
  if (process.platform === "win32" && path.isAbsolute(link)) {
    link = fs.realpathSync.native(alias);
  } else if (path.isAbsolute(link) || link.includes(":")) return null;
  const bundle = path.resolve(path.dirname(alias), link);
  const store = path.dirname(bundle);
  if (
    path.dirname(store) !== dipDirectory ||
    !storeNames.includes(path.basename(store)) ||
    sensitive(path.basename(bundle))
  )
    return null;
  for (const directory of [dipDirectory, store, bundle]) {
    if (
      !fs.lstatSync(directory).isDirectory() ||
      fs.existsSync(path.join(directory, ".git"))
    )
      return null;
  }
  return bundle;
}

function realDirectories(root, parts) {
  let directory = root;
  for (const part of parts) {
    directory = path.join(directory, part);
    try {
      fs.mkdirSync(directory);
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
    if (
      !fs.lstatSync(directory).isDirectory() ||
      fs.existsSync(path.join(directory, ".git"))
    )
      throw new Error("Skill path crosses a link or a nested Git project");
  }
  return directory;
}

export function createSkill(
  cwd,
  { name, description, host = "codex", global, scope },
) {
  if (
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name || "") ||
    name.length > 64 ||
    name === "dip"
  )
    throw new Error(
      "Use a lowercase skill name with up to 64 letters, digits or hyphens; dip is reserved",
    );
  if (!["codex", "claude"].includes(host))
    throw new Error("Choose host codex or claude");
  if (
    !description?.trim() ||
    description.length > 1024 ||
    /[\x00-\x1f]/.test(description)
  )
    throw new Error(
      "Provide a single-line skill description of up to 1024 characters",
    );
  if (global && scope) throw new Error("A global skill has no project scope");

  let discovery, store;
  const hostDirectory = host === "codex" ? ".agents" : ".claude";
  if (global) {
    fs.mkdirSync(home(), { recursive: true });
    const base =
      host === "claude" && process.env.CLAUDE_CONFIG_DIR
        ? path.resolve(process.env.CLAUDE_CONFIG_DIR)
        : path.join(os.homedir(), hostDirectory);
    fs.mkdirSync(base, { recursive: true });
    discovery = realDirectories(fs.realpathSync.native(base), ["skills"]);
    store = realDirectories(fs.realpathSync.native(home()), [
      host === "claude" ? "claude-skills" : "skills",
    ]);
  } else {
    const { root } = repoAt(cwd);
    const parts = scope && scope !== "." ? scope.split(/[/\\]/) : [];
    if (
      parts.some(
        (part) =>
          !part ||
          /[:\x00-\x1f]/.test(part) ||
          [
            ".",
            "..",
            ".dip",
            ".dip-local",
            ".git",
            ".agents",
            ".claude",
            "node_modules",
          ].includes(part.toLowerCase()),
      )
    )
      throw new Error("Scope must be a project-relative directory");
    let scoped = root;
    for (const part of parts) {
      scoped = path.join(scoped, part);
      if (
        !fs.lstatSync(scoped).isDirectory() ||
        fs.existsSync(path.join(scoped, ".git"))
      )
        throw new Error("Scope crosses a link or a nested Git project");
    }
    discovery = realDirectories(scoped, [hostDirectory, "skills"]);
    store = realDirectories(scoped, [".dip", "skills"]);
  }

  const bundle = path.join(store, name);
  const alias = path.join(discovery, name);
  const canonicalSource = path.join(bundle, "SKILL.md");
  fs.mkdirSync(bundle);
  let discoveryType = "symlink";
  try {
    fs.writeFileSync(
      canonicalSource,
      `---\nname: ${name}\ndescription: ${JSON.stringify(description.trim())}\n---\n\n# ${name}\n`,
      { flag: "wx" },
    );
    try {
      fs.symlinkSync(path.relative(discovery, bundle), alias, "dir");
    } catch (error) {
      if (
        process.platform !== "win32" ||
        !["EPERM", "EACCES", "ENOTSUP"].includes(error.code)
      )
        throw error;
      fs.symlinkSync(bundle, alias, "junction");
      discoveryType = "junction";
    }
  } catch (error) {
    fs.rmSync(canonicalSource, { force: true });
    fs.rmdirSync(bundle);
    throw error;
  }
  return {
    host,
    canonicalSource,
    source: path.join(alias, "SKILL.md"),
    discoveryType,
  };
}
