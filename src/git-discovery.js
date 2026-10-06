import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { home, digest, redact, id } from "./util.js";
import { ensure } from "./core.js";

export const traceDirectory = () => path.join(home(), "git-trace");

export function probeGitTrace(directory) {
  const marker = "dip.traceprobe=" + id();
  const before = new Set(fs.readdirSync(directory));
  execFileSync("git", ["-c", marker, "--version"], {
    env: { ...process.env, GIT_TRACE2_EVENT: directory },
    stdio: "pipe",
    windowsHide: true,
  });
  for (const name of fs.readdirSync(directory)) {
    if (before.has(name)) continue;
    const file = path.join(directory, name),
      stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink()) continue;
    if (
      sample(file, stat.size).some(
        (e) =>
          e.event === "start" &&
          Array.isArray(e.argv) &&
          e.argv.includes(marker),
      )
    ) {
      fs.unlinkSync(file);
      return true;
    }
  }
  return false;
}

function sample(file, size) {
  const fd = fs.openSync(file, "r");
  try {
    const headSize = Math.min(size, 262144);
    const head = Buffer.alloc(headSize);
    fs.readSync(fd, head, 0, headSize, 0);
    let value = head.toString("utf8");
    if (size > headSize) {
      const tail = Buffer.alloc(Math.min(size - headSize, 65536));
      fs.readSync(fd, tail, 0, tail.length, size - tail.length);
      value += "\n" + tail.toString("utf8");
    }
    return value.split("\n").flatMap((line) => {
      try {
        const e = JSON.parse(line);
        return e && typeof e === "object" ? [e] : [];
      } catch {
        return [];
      }
    });
  } finally {
    fs.closeSync(fd);
  }
}

// Native Git writes private per-process files. Only repo identity and a command
// name reach the ledger; argv/config/environment data is never copied there.
export class GitDiscovery {
  constructor(runtime, directory = traceDirectory()) {
    this.runtime = runtime;
    this.directory = path.resolve(directory);
    this.known = new Set(runtime.repositories().map((r) => r.root));
    this.errors = [];
    this.cursor = "";
    fs.mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    if (fs.lstatSync(this.directory).isSymbolicLink())
      throw new Error("Git trace directory must not be a symbolic link");
  }
  drain(limit = 200) {
    this.errors = [];
    let processed = 0,
      initialized = 0;
    let discard = null;
    const names = fs.readdirSync(this.directory).sort();
    const ordered = [
      ...names.filter((n) => n > this.cursor),
      ...names.filter((n) => n <= this.cursor),
    ].slice(0, limit);
    for (const name of ordered) {
      this.cursor = name;
      if (!/^[a-zA-Z0-9._-]+$/.test(name)) continue;
      const file = path.join(this.directory, name);
      try {
        const stat = fs.lstatSync(file);
        if (!stat.isFile() || stat.isSymbolicLink()) continue;
        if (name === "git-trace2-discard") {
          discard = file;
          continue;
        }
        const events = sample(file, stat.size);
        const start = events.find((e) => e.event === "start");
        const end = events.find(
          (e) => e.event === "atexit" || e.event === "signal",
        );
        if (!end) {
          // Interrupted processes may never write a closing event. Abandoned
          // raw files are bounded; active long-running processes are retained.
          if (Date.now() - stat.mtimeMs > 86400000) {
            const pid = Number.parseInt(
              start?.sid?.match(/-P([a-f0-9]+)$/i)?.[1] || "0",
              16,
            );
            let alive = false;
            if (pid > 0)
              try {
                process.kill(pid, 0);
                alive = true;
              } catch {}
            if (!alive) fs.unlinkSync(file);
          }
          continue;
        }
        for (const worktree of new Set(
          events
            .filter(
              (e) =>
                e.event === "def_repo" &&
                typeof e.worktree === "string" &&
                e.worktree,
            )
            .map((e) => e.worktree),
        )) {
          const hadLedger = fs.existsSync(
            path.join(worktree, ".dip", "config.json"),
          );
          const repo = ensure(worktree);
          if (!this.known.has(repo.root) || !hadLedger) {
            this.runtime.register(repo);
            this.runtime.enqueue(
              repo,
              "git-discovery",
              {
                at: end.time || start?.time || new Date().toISOString(),
                kind: "git.discovered",
                agent: "git",
                branch: repo.branch,
                command: redact(
                  events.find((e) => e.event === "cmd_name")?.name || "git",
                ).slice(0, 100),
                initialized: !hadLedger,
              },
              "git-discovery:" +
                digest((end.sid || start?.sid || name) + repo.root),
            );
            this.known.add(repo.root);
            initialized++;
          }
        }
        fs.unlinkSync(file);
        processed++;
      } catch (e) {
        this.errors.push({ file: name, error: redact(e.message) });
      }
    }
    if (discard) {
      if (
        fs.readdirSync(this.directory).every((n) => n === "git-trace2-discard")
      )
        fs.unlinkSync(discard);
      else
        this.errors.push({
          error:
            "Git reached trace2.maxFiles; native discovery will resume after queued processes are drained",
        });
    }
    return { processed, initialized, errors: this.errors };
  }
}
