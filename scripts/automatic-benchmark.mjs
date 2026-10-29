// Read-only real-project context sampling and identical disposable hook fixtures.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { pathToFileURL, fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
const hash = (data) => createHash("sha256").update(data).digest("hex");
const fingerprint = (root) =>
  hash(
    JSON.stringify(
      [
        "package.json",
        ...["src", "bin", "skills"].flatMap((d) =>
          fs
            .readdirSync(path.join(root, d), { recursive: true })
            .filter((f) => fs.statSync(path.join(root, d, f)).isFile())
            .map((f) => d + "/" + f),
        ),
      ]
        .sort()
        .map((f) => [f, hash(fs.readFileSync(path.join(root, f)))]),
    ),
  );
const source = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const percentile = (xs, p) =>
  [...xs].sort((a, b) => a - b)[
    Math.min(xs.length - 1, Math.floor(xs.length * p))
  ];
const summary = (xs) => ({
  samples: xs,
  n: xs.length,
  median: percentile(xs, 0.5),
  p95: percentile(xs, 0.95),
  min: Math.min(...xs),
  max: Math.max(...xs),
});
if (process.argv[2] === "worker") {
  const [product, root, mode, action] = process.argv.slice(3);
  const core = await import(pathToFileURL(path.join(product, "src/core.js"))),
    util = await import(pathToFileURL(path.join(product, "src/util.js")));
  const repo = {
    ...util.repoAt(root),
    dir: path.join(root, ".dip"),
    config: {
      ...JSON.parse(fs.readFileSync(path.join(root, ".dip/config.json"))),
      workflow: mode,
    },
  };
  if (action === "runtime") {
    const start = performance.now();
    const rt = new core.Runtime();
    rt.register(repo);
    rt.close();
    console.log(JSON.stringify({ ms: performance.now() - start }));
  } else if (action === "context") {
    const samples = [];
    let result;
    for (let i = 0; i < 5; i++) {
      const s = performance.now();
      result = core.compactContext(repo, null);
      samples.push(performance.now() - s);
    }
    if (result.errors?.length)
      throw new Error(
        "Invalid benchmark fixture: " + JSON.stringify(result.errors),
      );
    console.log(
      JSON.stringify({
        ms: summary(samples),
        bytes: Buffer.byteLength(JSON.stringify(result)),
        recentBytes: Buffer.byteLength(JSON.stringify(result.recent || [])),
        truncated: result.truncated,
      }),
    );
  } else if (action === "hook") {
    const { handleHook } = await import(
      pathToFileURL(path.join(product, "src/automation.js"))
    );
    const samples = [],
      db = [],
      reads = [],
      writes = [];
    const task = process.env.DIP_BENCH_TASK;
    const setup = new core.Runtime();
    setup.setSession(repo, "bench", task, "fixture:bench");
    setup.close();
    for (let i = 0; i < 30; i++) {
      let s = performance.now();
      const rt = new core.Runtime();
      rt.register(repo);
      rt.close();
      db.push(performance.now() - s);
      s = performance.now();
      core.taskRead(repo, task);
      reads.push(performance.now() - s);
      s = performance.now();
      handleHook(
        {
          cwd: root,
          session_id: "bench",
          tool_use_id: "p" + i,
          hook_event_name: "PostToolUse",
          tool_name: "Bash",
          tool_input: { command: "rg -n TODO src" },
        },
        "fixture",
      );
      samples.push(performance.now() - s);
      s = performance.now();
      handleHook(
        {
          cwd: root,
          session_id: "bench",
          hook_event_name: "PreToolUse",
          tool_name: "Write",
          tool_input: { file_path: path.join(root, "src.js") },
        },
        "fixture",
      );
      writes.push(performance.now() - s);
    }
    console.log(
      JSON.stringify({
        warmHookMs: summary(samples),
        warmPreWriteMs: summary(writes),
        runtimeOpenRegisterMs: summary(db),
        taskReadMs: summary(reads),
      }),
    );
  }
  process.exit(0);
}
const base = fs.mkdtempSync(path.join(os.tmpdir(), "dip-auto-measure-"));
const products = {
  reviewed:
    process.env.DIP_BENCH_BASELINE ||
    "/private/tmp/dip-automatic-pilot-20261028/reviewed",
  automatic: source,
};
const env = {
  ...process.env,
  DIP_USER_HOME: path.join(base, "user"),
  DIP_HOME: path.join(base, "runtime"),
  GIT_CONFIG_GLOBAL: path.join(base, "gitconfig"),
  DIP_GIT_CONFIG: path.join(base, "gitconfig"),
  GIT_TRACE2_EVENT: "0",
};
for (const k of Object.keys(env))
  if (/^GIT_CONFIG_(COUNT|KEY_|VALUE_)/.test(k)) delete env[k];
Object.assign(process.env, env);
const { ensure, createTask, append } = await import("../src/core.js");
const seed = path.join(base, "seed");
fs.mkdirSync(seed);
execFileSync("git", ["-c", "core.hooksPath=/dev/null", "init", "-b", "main"], {
  cwd: seed,
  env,
  stdio: "pipe",
});
const repo = ensure(seed);
for (let i = 0; i < 100; i++)
  createTask(repo, {
    title: "Feature " + i,
    description: "Requirement ".repeat(30),
    kind: "work",
  });
for (let i = 0; i < 5; i++) {
  const id = createTask(repo, { title: "Completed " + i });
  append(repo, id, "task.update", {
    status: "implemented",
    resolution: {
      outcome: "implemented",
      summary: "Long completed history ".repeat(75),
      replacedBy: [],
      remaining: [],
    },
  });
}
const deep = createTask(repo, { title: "Deep history" });
for (let i = 0; i < 1000; i++)
  append(repo, deep, "task.checkpoint", { summary: "Checkpoint " + i });
const result = {
  sourceFingerprints: Object.fromEntries(
    Object.entries(products).map(([arm, root]) => [arm, fingerprint(root)]),
  ),
  createdAt: new Date().toISOString(),
  node: process.version,
  platform: process.platform,
  fixtures: { tasks: 106, deepEvents: 1001 },
  arms: {},
  realContexts: {},
};
const worker = (product, root, mode, action, e) =>
  JSON.parse(
    execFileSync(
      process.execPath,
      [fileURLToPath(import.meta.url), "worker", product, root, mode, action],
      { env: e, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    ),
  );
for (const [arm, product] of Object.entries(products)) {
  const root = path.join(base, arm);
  fs.cpSync(seed, root, { recursive: true });
  const e = {
    ...env,
    DIP_HOME: path.join(base, "runtime-" + arm),
    DIP_WORKFLOW: arm,
    DIP_BENCH_TASK: deep,
  };
  const c = path.join(root, ".dip/config.json"),
    config = JSON.parse(fs.readFileSync(c));
  config.workflow = arm;
  fs.writeFileSync(c, JSON.stringify(config));
  const warm = worker(product, root, arm, "hook", e),
    cold = [];
  for (let i = 0; i < 15; i++) {
    const t = performance.now();
    execFileSync(
      process.execPath,
      [path.join(product, "bin/dip.js"), "hook", "--agent", "fixture"],
      {
        env: e,
        input: JSON.stringify({
          cwd: root,
          session_id: "bench",
          tool_use_id: "cold" + i,
          hook_event_name: "PostToolUse",
          tool_name: "Bash",
          tool_input: { command: "rg -n TODO src" },
        }),
        stdio: ["pipe", "ignore", "pipe"],
      },
    );
    cold.push(performance.now() - t);
  }
  const lockSamples = [];
  for (let i = 0; i < 5; i++) {
    const locker = spawn(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `import {DatabaseSync} from 'node:sqlite';const db=new DatabaseSync(process.argv[1]);db.exec('BEGIN IMMEDIATE');process.stdout.write('locked');setTimeout(()=>{db.exec('COMMIT');db.close()},100);`,
        path.join(e.DIP_HOME, "runtime.sqlite"),
      ],
      { env: e, stdio: ["ignore", "pipe", "ignore"] },
    );
    const closed = new Promise((resolve, reject) => {
      locker.on("error", reject);
      locker.on("close", resolve);
    });
    await new Promise((resolve, reject) => {
      locker.stdout.once("data", resolve);
      locker.once("error", reject);
      locker.once("exit", (code) => {
        if (code) reject(new Error("Lock fixture failed"));
      });
    });
    lockSamples.push(worker(product, root, arm, "runtime", e).ms);
    await closed;
  }
  result.arms[arm] = {
    ...warm,
    coldHookMs: summary(cold),
    contendedRuntimeMs: {
      heldMs: 100,
      note: "Runtime open+register, after a separate child holds a write transaction. Includes actual remaining lock wait; process startup consumes part of the 100ms hold.",
      ...summary(lockSamples),
    },
    context: worker(product, root, arm, "context", e),
  };
}
for (const root of process.argv.slice(2)) {
  const name = path.basename(root);
  result.realContexts[name] = {};
  const snapshot = path.join(base, "snapshot-" + name);
  fs.mkdirSync(snapshot);
  execFileSync(
    "git",
    ["-c", "core.hooksPath=/dev/null", "init", "-b", "main"],
    { cwd: snapshot, env, stdio: "pipe" },
  );
  fs.cpSync(path.join(root, ".dip"), path.join(snapshot, ".dip"), {
    recursive: true,
    filter: (p) =>
      !p.includes(path.sep + "_activity") && !p.includes(path.sep + "tools"),
  });
  for (const [arm, product] of Object.entries(products))
    result.realContexts[name][arm] = worker(product, snapshot, arm, "context", {
      ...env,
      DIP_WORKFLOW: arm,
    });
}
const output =
  process.env.DIP_BENCH_OUTPUT ||
  path.join(source, "docs/benchmarks/2026-10-28-automatic-runtime.json");
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify(result, null, 2));
fs.rmSync(base, { recursive: true, force: true });
