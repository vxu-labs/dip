import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { ensure, project, Runtime } from "../src/core.js";
import { instructions as commonInstructions } from "./longitudinal-fixtures.mjs";
export const workspace = fileURLToPath(new URL("../", import.meta.url));
const cli = path.join(workspace, "bin/dip.js");
export const model = "gpt-6.1-sol",
  effort = "high",
  timeoutMs = 360000;
export const sha = (text) => createHash("sha256").update(text).digest("hex");
export const sandbox = fs.mkdtempSync(
  path.join(os.tmpdir(), "dip-longitudinal-"),
);
const codex = process.env.DIP_BENCH_CODEX || "codex";
const authSource = path.join(
  process.env.CODEX_HOME || path.join(os.homedir(), ".codex"),
  "auth.json",
);
const credentials = [];
const baseEnv = {
  ...process.env,
  GIT_TRACE2_EVENT: "0",
  GIT_CONFIG_NOSYSTEM: "1",
};
for (const key of Object.keys(baseEnv))
  if (
    /^CODEX_(THREAD|SESSION|TURN|APP|INTERNAL|SHELL)|^DIP_|^GIT_CONFIG_(COUNT|KEY_|VALUE_)/.test(
      key,
    )
  )
    delete baseEnv[key];
export const codexVersion = () =>
  execFileSync(codex, ["--version"], {
    encoding: "utf8",
    windowsHide: true,
  }).trim();
export function prepare(index, arm) {
  const dir = path.join(sandbox, `pair-${index}`, arm);
  const root = path.join(dir, "project");
  const user = path.join(dir, "user");
  const runtime = path.join(dir, "runtime");
  const codexHome = path.join(user, ".codex");
  fs.mkdirSync(root, { recursive: true });
  fs.mkdirSync(codexHome, { recursive: true });
  const gitconfig = path.join(dir, "gitconfig");
  fs.writeFileSync(gitconfig, "");
  const env = {
    ...baseEnv,
    CODEX_HOME: codexHome,
    DIP_USER_HOME: user,
    DIP_HOME: runtime,
    DIP_GIT_CONFIG: gitconfig,
    GIT_CONFIG_GLOBAL: gitconfig,
  };
  execFileSync("git", ["init", "-b", "main", root], {
    env,
    stdio: "pipe",
    windowsHide: true,
  });
  fs.writeFileSync(path.join(root, "AGENTS.md"), commonInstructions + "\n");
  fs.writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify(
      {
        name: "controlled-module-fixture",
        private: true,
        type: "module",
        scripts: { test: "node --test" },
      },
      null,
      2,
    ),
  );
  if (arm === "with")
    execFileSync(
      process.execPath,
      [
        "--disable-warning=ExperimentalWarning",
        cli,
        "install",
        "--roots",
        root,
        "--no-start",
        "--no-startup",
        "--no-git-hooks",
        "--no-git-discovery",
      ],
      { env, stdio: "pipe", windowsHide: true },
    );
  if (arm === "with") {
    const configFile = path.join(root, ".dip", "config.json");
    const dipConfig = JSON.parse(fs.readFileSync(configFile, "utf8"));
    dipConfig.verification = {
      unit: { command: ["node", "--test"], timeoutMs: 30000 },
    };
    fs.writeFileSync(configFile, JSON.stringify(dipConfig, null, 2) + "\n");
  }
  const configPath = path.join(codexHome, "config.toml");
  const existing = fs.existsSync(configPath)
    ? fs.readFileSync(configPath, "utf8")
    : "";
  const config = `model = "${model}"\nmodel_reasoning_effort = "${effort}"\napproval_policy = "never"\nallow_login_shell = false\nweb_search = "disabled"\nsuppress_unstable_features_warning = true\n[shell_environment_policy]\nexperimental_use_profile = false\ninherit = "all"\n[agents]\nenabled = false\n[windows]\nsandbox = "elevated"\n`;
  const approvedTools =
    arm === "with"
      ? [
          ...fs
            .readFileSync(path.join(workspace, "src/mcp.js"), "utf8")
            .matchAll(/\badd\(\s*"([a-z_]+)"/g),
        ].map((m) => m[1])
      : [];
  const approvals = approvedTools
    .map(
      (name) =>
        `\n[mcp_servers.dip.tools.${name}]\napproval_mode = "approve"\n`,
    )
    .join("");
  fs.writeFileSync(configPath, config + existing + approvals);
  const auth = path.join(codexHome, "auth.json");
  fs.copyFileSync(authSource, auth);
  credentials.push(auth);
  return {
    index,
    arm,
    dir,
    root,
    runtime,
    env,
    setup: {
      hooks: fs.existsSync(path.join(codexHome, "hooks.json")),
      dipDirectory: fs.existsSync(path.join(root, ".dip")),
      mcp: existing.includes("mcp_servers.dip"),
      profilesDisabled: true,
      traceDisabled: true,
      reviewedMcpToolsApproved: approvedTools,
    },
  };
}

function normalize(text, trial) {
  return String(text)
    .replaceAll(trial.root, "<project>")
    .replaceAll(trial.dir, "<trial>")
    .replaceAll(sandbox, "<experiment>")
    .replaceAll(workspace.replace(/[\\/]$/, ""), "<dip-source>")
    .replaceAll(os.homedir(), "<home>");
}

export async function run(trial, phase, prompt, { interruptFile = null } = {}) {
  const args = [
    "exec",
    "--json",
    "--ephemeral",
    "--ignore-rules",
    "--sandbox",
    "danger-full-access",
    "--model",
    model,
    "--cd",
    trial.root,
    "--add-dir",
    trial.dir,
  ];
  if (trial.arm === "with") args.push("--dangerously-bypass-hook-trust");
  else args.push("--disable", "hooks");
  args.push("-");
  const startedAt = new Date().toISOString();
  const start = performance.now();
  const child = spawn(codex, args, {
    env: trial.env,
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stdout = "",
    stderr = "",
    timedOut = false;
  child.stdout.on("data", (b) => (stdout += b));
  child.stderr.on("data", (b) => (stderr += b));
  let interruption = null;
  const kill = () => {
    if (process.platform === "win32") {
      try {
        execFileSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
          stdio: "pipe",
          windowsHide: true,
        });
      } catch {}
    } else child.kill("SIGTERM");
  };
  const timer = setTimeout(
    () => {
      timedOut = true;
      kill();
    },
    interruptFile ? 180000 : timeoutMs,
  );
  const original =
    interruptFile &&
    fs.readFileSync(path.join(trial.root, interruptFile), "utf8");
  let interrupted = false,
    killTimer;
  const watcher =
    interruptFile &&
    setInterval(() => {
      if (interrupted) return;
      const current = fs.existsSync(path.join(trial.root, interruptFile))
        ? fs.readFileSync(path.join(trial.root, interruptFile), "utf8")
        : "<deleted>";
      if (current !== original) {
        interrupted = true;
        interruption = {
          trigger: "first receipt.mjs content mutation",
          observedAfterMs: Math.round(performance.now() - start),
          graceMs: 2000,
          contentHash: sha(current),
        };
        killTimer = setTimeout(kill, 2000);
      }
    }, 100);
  child.stdin.end(prompt);
  const exitCode = await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", resolve);
  });
  clearTimeout(timer);
  if (watcher) clearInterval(watcher);
  if (killTimer) clearTimeout(killTimer);
  const wallMs = Math.round(performance.now() - start);
  fs.writeFileSync(path.join(trial.dir, `${phase}.jsonl`), stdout);
  fs.writeFileSync(path.join(trial.dir, `${phase}.stderr.txt`), stderr);
  const events = stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return { type: "unparsed", text: line };
      }
    });
  const completed = events.findLast((e) => e.type === "turn.completed");
  const items = events
    .filter((e) => e.type === "item.completed")
    .map((e) => e.item);
  const counts = {};
  for (const item of items) counts[item.type] = (counts[item.type] || 0) + 1;
  const answers = items
    .filter((x) => x.type === "agent_message")
    .map((x) => normalize(x.text, trial));
  const errors = events
    .filter((e) => /error|failed/.test(e.type))
    .map((e) => normalize(JSON.stringify(e), trial));
  const out = {
    phase,
    startedAt,
    wallMs,
    exitCode,
    timedOut,
    interruption,
    mcpCalls: items
      .filter((x) => x.type === "mcp_tool_call")
      .map((x) => ({
        server: x.server,
        tool: x.tool,
        status: x.status,
        arguments: normalize(JSON.stringify(x.arguments || {}), trial),
        result: normalize(JSON.stringify(x.result || {}), trial).slice(0, 5000),
      })),
    completed: !!completed,
    usage: completed?.usage || null,
    itemCounts: counts,
    answers,
    errors,
    mcpErrors: items
      .filter(
        (x) =>
          (x.type === "error" &&
            !x.message?.startsWith(
              "`--dangerously-bypass-hook-trust` is enabled.",
            )) ||
          (x.type === "mcp_tool_call" && (x.status === "failed" || x.is_error)),
      )
      .map((x) => normalize(JSON.stringify(x), trial)),
    stderr: normalize(stderr, trial).slice(-4000),
  };
  console.log(
    JSON.stringify({
      pair: trial.index,
      arm: trial.arm,
      phase,
      wallMs,
      exitCode,
      completed: !!completed,
      usage: out.usage,
    }),
  );
  return out;
}

function artifacts(trial) {
  const entries = fs.readdirSync(trial.root, { withFileTypes: true });
  const files = {};
  for (const entry of entries)
    if (entry.isFile() && /\.(mjs|js|json|md)$/i.test(entry.name)) {
      const text = fs.readFileSync(path.join(trial.root, entry.name), "utf8");
      files[entry.name] = { sha256: sha(text), text: normalize(text, trial) };
    }
  return files;
}

export function capture(trial) {
  if (!fs.existsSync(path.join(trial.root, ".dip")))
    return { present: false, taskCount: 0, kinds: {} };
  const rt = new Runtime(trial.runtime);
  const repo = ensure(trial.root, { instructions: false });
  rt.flush(trial.root);
  const p = project(repo, rt);
  rt.close();
  const kinds = {};
  for (const r of p.activity) kinds[r.kind] = (kinds[r.kind] || 0) + 1;
  return {
    present: true,
    taskCount: p.tasks.length,
    kinds,
    denialIds: p.activity
      .filter((r) => r.kind === "coordination.denied")
      .map((r) => r.id || sha(JSON.stringify(r))),
    tasks: p.tasks.map((t) => ({
      id: t.id,
      description: t.description,
      acceptance: t.acceptance,
      scope: t.scope,
      conflicts: t.conflicts,
      title: t.title,
      status: t.status,
      source: t.source,
      planPresent: !!t.plan,
      planTool: t.plan?.tool || null,
      checkpointPresent: t.checkpoints.length > 0,
    })),
  };
}

export function git(trial, args) {
  return execFileSync(
    "git",
    [
      "-c",
      "core.hooksPath=" + path.join(trial.dir, "empty-hooks"),
      "-c",
      "user.name=DIP benchmark",
      "-c",
      "user.email=benchmark@example.invalid",
      ...args,
    ],
    {
      cwd: trial.root,
      env: trial.env,
      encoding: "utf8",
      windowsHide: true,
      stdio: "pipe",
    },
  );
}
export function commit(trial, message) {
  git(trial, ["add", "--all"]);
  try {
    git(trial, ["commit", "-m", message]);
  } catch (e) {
    if (!String(e.stdout).includes("nothing to commit")) throw e;
  }
}
export function worktree(trial, name) {
  const root = path.join(trial.dir, name);
  git(trial, ["worktree", "add", "-b", name, root]);
  return { ...trial, root, dir: trial.dir };
}
export function snapshot(trial, label) {
  const result = {},
    excluded = new Set([".git", ".dip", ".dip-local", "node_modules"]);
  const walk = (dir, relative = "") => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (excluded.has(entry.name)) continue;
      const rel = relative ? relative + "/" + entry.name : entry.name;
      if (entry.isDirectory()) walk(path.join(dir, entry.name), rel);
      else if (entry.isFile() && /\.(mjs|js|json|md|txt)$/.test(entry.name)) {
        const raw = fs.readFileSync(path.join(dir, entry.name), "utf8");
        if (raw.length > 200000)
          throw new Error("Unexpected oversized artifact");
        const text = normalize(raw, trial);
        result[rel] = { sha256: sha(text), text };
      }
    }
  };
  walk(trial.root);
  const replay = path.join(trial.dir, "snapshots", label);
  fs.mkdirSync(replay, { recursive: true });
  for (const [name, file] of Object.entries(result)) {
    const target = path.join(replay, name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, file.text);
  }
  return { artifacts: result, root: replay };
}
export function cleanup() {
  for (const auth of credentials) {
    const resolved = path.resolve(auth);
    if (!resolved.startsWith(path.resolve(sandbox) + path.sep))
      throw new Error("Credential cleanup escaped experiment");
    try {
      fs.unlinkSync(resolved);
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
  }
  fs.writeFileSync(
    path.join(sandbox, "retained-fixtures.txt"),
    "Synthetic worktrees and transcripts retained locally. Authentication copies removed.\n",
  );
  console.log(
    "Authentication copies removed; synthetic evidence retained locally.",
  );
}
