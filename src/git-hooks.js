import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { atomic, json, home, git } from "./util.js";
const CLI = fileURLToPath(new URL("../bin/dip.js", import.meta.url));
const quote = (s) => `'${String(s).replaceAll("'", "'\\''")}'`;
export function writeGitHooks(directory, previous) {
  fs.mkdirSync(directory, { recursive: true });
  for (const name of [
    "pre-commit",
    "post-commit",
    "post-checkout",
    "post-merge",
    "post-rewrite",
    "pre-push",
  ]) {
    const original = previous
      ? `al_original=${quote(path.join(previous, name).replaceAll("\\", "/"))}`
      : `al_original="$(git rev-parse --git-path hooks)/${name}"`;
    atomic(
      path.join(directory, name),
      `#!/bin/sh\n# DIP managed hook; existing hooks are chained.\n${quote(process.execPath.replaceAll("\\", "/"))} ${quote(CLI.replaceAll("\\", "/"))} git-hook ${name}\nal_status=$?\nif [ "$al_status" -ne 0 ]; then exit "$al_status"; fi\n${original}\nif [ -x "$al_original" ] && [ "$al_original" != "$0" ]; then exec "$al_original" "$@"; fi\nexit 0\n`,
    );
    fs.chmodSync(path.join(directory, name), 0o755);
  }
}
export function ensureProjectHooks(repo) {
  const installation = json(path.join(home(), "install.json"), null);
  if (!installation?.active || !installation.hooksPath) return;
  const config = path.join(repo.common, "config"),
    mtime = fs.statSync(config).mtimeMs;
  const marker = path.join(repo.common, "dip-hook-state.json"),
    state = json(marker, null);
  if (state?.mtime === mtime && state.globalPath === installation.hooksPath)
    return;
  const local = git(
    repo.root,
    ["config", "--local", "--get", "core.hooksPath"],
    true,
  );
  const effective = git(repo.root, ["config", "--get", "core.hooksPath"], true);
  const managed = path.join(repo.common, "dip-hooks");
  if (
    effective &&
    effective !== installation.hooksPath &&
    effective !== managed
  ) {
    writeGitHooks(managed, effective);
    git(repo.root, ["config", "--local", "core.hooksPath", managed]);
    atomic(marker, {
      root: repo.root,
      previousLocal: local || null,
      path: managed,
      globalPath: installation.hooksPath,
      mtime: fs.statSync(config).mtimeMs,
    });
  } else
    atomic(marker, {
      ...state,
      root: repo.root,
      globalPath: installation.hooksPath,
      mtime,
    });
}
export function restoreProjectHooks(root) {
  const common = path.resolve(
    root,
    git(root, ["rev-parse", "--git-common-dir"]),
  );
  const file = path.join(common, "dip-hook-state.json"),
    state = json(file, null);
  if (!state?.path) return;
  if (
    git(root, ["config", "--local", "--get", "core.hooksPath"], true) ===
    state.path
  ) {
    if (state.previousLocal)
      git(root, ["config", "--local", "core.hooksPath", state.previousLocal]);
    else git(root, ["config", "--local", "--unset", "core.hooksPath"]);
  }
  fs.unlinkSync(file);
}
