import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";

export const home = () =>
  path.resolve(process.env.DIP_HOME || path.join(os.homedir(), ".dip"));
export const digest = (value) =>
  crypto.createHash("sha256").update(value).digest("hex");
export const id = () => crypto.randomUUID();
export function git(cwd, args, optional = false, { raw = false } = {}) {
  try {
    const output = execFileSync("git", ["-C", cwd, ...args], {
      encoding: "utf8",
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 16 * 1024 * 1024,
    });
    return raw ? output : output.trim();
  } catch (e) {
    if (optional) return "";
    throw new Error(
      `Git ${args[0]} failed: ${e.stderr?.toString().trim() || e.message}`,
    );
  }
}
export function atomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${id()}.tmp`;
  try {
    fs.writeFileSync(
      temp,
      typeof data === "string" ? data : JSON.stringify(data, null, 2) + "\n",
      { mode: 0o600 },
    );
    fs.renameSync(temp, file);
  } finally {
    if (fs.existsSync(temp)) fs.unlinkSync(temp);
  }
}
export function json(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e) {
    if (e.code === "ENOENT") return fallback;
    throw new Error(`Invalid JSON in ${file}: ${e.message}`);
  }
}
export function redact(value) {
  return String(value ?? "")
    .replace(
      /\b(?:gh[pousr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+|sk-[A-Za-z0-9_-]{12,})\b/g,
      "[REDACTED]",
    )
    .replace(
      /((?:api[_-]?key|token|password|secret|authorization)\s*[=:]\s*)(?:"[^"]*"|'[^']*'|[^\s;,]+)/gi,
      "$1[REDACTED]",
    )
    .replace(/(Bearer\s+)[A-Za-z0-9._-]+/gi, "$1[REDACTED]")
    .replace(/(https?:\/\/)[^/@\s]+:[^/@\s]+@/gi, "$1[REDACTED]@");
}
export function safePath(root, relative) {
  const target = path.resolve(root, relative);
  if (target !== root && !target.startsWith(path.resolve(root) + path.sep))
    throw new Error("Path escapes project");
  return target;
}
export function repoAt(cwd = process.cwd()) {
  let root = fs.realpathSync(cwd);
  if (!fs.statSync(root).isDirectory()) root = path.dirname(root);
  while (!fs.existsSync(path.join(root, ".git"))) {
    const parent = path.dirname(root);
    if (parent === root)
      throw new Error("This directory is not inside a Git working tree");
    root = parent;
  }
  const marker = path.join(root, ".git");
  const gitDir = fs.statSync(marker).isDirectory()
    ? marker
    : path.resolve(
        root,
        fs
          .readFileSync(marker, "utf8")
          .trim()
          .replace(/^gitdir:\s*/, ""),
      );
  const common = fs.realpathSync(
    fs.existsSync(path.join(gitDir, "commondir"))
      ? path.resolve(
          gitDir,
          fs.readFileSync(path.join(gitDir, "commondir"), "utf8").trim(),
        )
      : gitDir,
  );
  const headText = fs.readFileSync(path.join(gitDir, "HEAD"), "utf8").trim();
  const ref = headText.startsWith("ref: ") ? headText.slice(5) : null;
  let head = ref ? null : headText;
  if (ref) {
    if (fs.existsSync(path.join(common, ref)))
      head = fs.readFileSync(path.join(common, ref), "utf8").trim();
    else if (fs.existsSync(path.join(common, "packed-refs")))
      head =
        fs
          .readFileSync(path.join(common, "packed-refs"), "utf8")
          .split("\n")
          .find((l) => l.endsWith(" " + ref))
          ?.split(" ")[0] || null;
  }
  return {
    root,
    common,
    key: digest(
      process.platform === "win32" ? common.toLowerCase() : common,
    ).slice(0, 24),
    branch: ref?.replace(/^refs\/heads\//, "") || "detached",
    head,
  };
}
export function captureSnapshot(repo) {
  const names = git(
    repo.root,
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    false,
    { raw: true },
  )
    .split("\0")
    .filter(Boolean)
    .filter(
      (p) =>
        !p.startsWith(".dip/") &&
        !p.startsWith("node_modules/") &&
        !p.startsWith(".git/") &&
        !sensitive(p),
    )
    .sort();
  const files = {};
  for (const name of names) {
    const file = safePath(repo.root, name);
    try {
      const stat = fs.lstatSync(file);
      files[name] = stat.isSymbolicLink()
        ? digest(fs.readlinkSync(file))
        : stat.isFile()
          ? digest(fs.readFileSync(file))
          : "directory";
    } catch (e) {
      if (e.code === "ENOENT") files[name] = "deleted";
      else throw e;
    }
  }
  const dirty = git(
    repo.root,
    ["status", "--porcelain", "-z", "--untracked-files=all"],
    false,
    { raw: true },
  )
    .split("\0")
    .filter(Boolean)
    .filter((line) => !line.slice(3).startsWith(".dip/"));
  return {
    hash: digest(JSON.stringify(files)),
    files,
    head: repo.head,
    committed: !!repo.head && dirty.length === 0,
  };
}
export const sensitive = (p) =>
  /(^|[/\\])(?:\.env(?:\..*)?|[^/\\]*\.(?:pem|key|p12)|credentials(?:\.json)?)(?:$|[/\\])/i.test(
    p,
  );
export function managed(file, body) {
  if (fs.existsSync(file) && fs.lstatSync(file).isSymbolicLink())
    throw new Error(`Refusing to replace linked instructions: ${file}`);
  const begin = "<!-- dip:start -->",
    end = "<!-- dip:end -->";
  let old = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  const start = old.indexOf(begin),
    finish = old.indexOf(end);
  if (start >= 0 !== finish >= 0)
    throw new Error(`Incomplete DIP block in ${file}`);
  const block = `${begin}\n${body}\n${end}`;
  const next =
    start >= 0
      ? old.slice(0, start) + block + old.slice(finish + end.length)
      : old.trimEnd() + (old ? "\n\n" : "") + block + "\n";
  if (next !== old) atomic(file, next);
}
