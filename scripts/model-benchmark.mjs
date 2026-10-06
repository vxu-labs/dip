import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import {
  commonInstructions,
  recoveryPrompt,
  fixture,
  score,
} from "./model-benchmark-fixtures.mjs";
import { ensure, project, Runtime } from "../src/core.js";

const { values } = parseArgs({
  options: {
    preflight: { type: "boolean" },
    output: { type: "string" },
    protocol: { type: "boolean" },
  },
});
const workspace = fileURLToPath(new URL("../", import.meta.url));
const cli = path.join(workspace, "bin/dip.js");
const model = "gpt-6.1-sol";
const effort = "high";
const pairCount = 6;
const timeoutMs = 240000;
const sha = (text) => createHash("sha256").update(text).digest("hex");
const protocol = {
  schemaVersion: 1,
  protocolVersion: 2,
  createdAt: new Date().toISOString(),
  model,
  effort,
  pairCount,
  timeoutMs,
  design:
    "six matched pairs; three tasks repeated twice with revised constants; counterbalanced arm order; seed and fresh recovery per arm; no resumed sessions",
  baseline:
    "ordinary repository instructions, Markdown plans and handoffs allowed; no DIP hooks/MCP/config, profiles or native Git trace",
  treatment:
    "same baseline plus DIP 0.3.4 instructions, real Codex hooks and MCP; isolated runtime with immediate durable fallback; no resident recorder",
  primary: "all eight held-out functional cases pass in fresh-session recovery",
  secondary:
    "six exact contract/deferred/completion recovery checks, seed partial-work checks, wall time, reported token usage and tool counts",
  policy:
    "all scheduled trials retained; no scored-run retries, adaptive prompt edits or omitted failures; preflight excluded and reported separately",
  priorAttempt:
    "Attempt 1 aborted after missing MCP approvals were observed. Its raw outcomes remain separate. Version 2 changes infrastructure only: explicitly authorize reviewed fixture-local MCP tools, configure the same visible node --test command, and strengthen preflight with actual intent persistence. All scored arms restart from fresh repositories; scoring and prompts are unchanged.",
  trust:
    "only generated, source-reviewed DIP command hooks in an isolated config; --dangerously-bypass-hook-trust authorizes this vetted automation, not normal installation",
  sources: {
    fixtures: sha(
      fs.readFileSync(
        new URL("./model-benchmark-fixtures.mjs", import.meta.url),
      ),
    ),
    harness: sha(fs.readFileSync(fileURLToPath(import.meta.url))),
  },
  commonInstructions,
  recoveryPrompt,
  pairs: Array.from({ length: pairCount }, (_, index) => {
    const f = fixture(index);
    return {
      index,
      scenario: f.kind,
      repeat: f.repeat,
      order: index % 2 ? ["with", "without"] : ["without", "with"],
      seedPrompt: f.seedPrompt,
      expectedContract: f.contract,
      deferred: f.future,
    };
  }),
};
const output = path.resolve(
  values.output ||
    (values.preflight
      ? ".dip-local/model-preflight.json"
      : "docs/benchmarks/2026-10-06-model-controlled-v2.json"),
);
fs.mkdirSync(path.dirname(output), { recursive: true });
if (values.protocol) {
  fs.writeFileSync(output, JSON.stringify(protocol, null, 2) + "\n");
  console.log("Protocol saved before model execution.");
  process.exit(0);
}
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "dip-model-controlled-"));
const codex = process.env.DIP_BENCH_CODEX || "codex";
const authSource = path.join(
  process.env.CODEX_HOME || path.join(os.homedir(), ".codex"),
  "auth.json",
);
if (!fs.existsSync(authSource))
  throw new Error(
    "Existing Codex login required; credentials are never included in results.",
  );
const credentials = [];
const result = {
  protocol,
  startedAt: new Date().toISOString(),
  platform: process.platform,
  node: process.version,
  codexVersion: execFileSync(codex, ["--version"], {
    encoding: "utf8",
    windowsHide: true,
  }).trim(),
  dipVersion: JSON.parse(fs.readFileSync(path.join(workspace, "package.json")))
    .version,
  preflight: !!values.preflight,
  pairs: [],
};
const save = () =>
  fs.writeFileSync(output, JSON.stringify(result, null, 2) + "\n");
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

function prepare(index, arm) {
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

async function run(trial, phase, prompt) {
  const args = [
    "exec",
    "--json",
    "--ephemeral",
    "--ignore-rules",
    "--sandbox",
    "workspace-write",
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
  const timer = setTimeout(() => {
    timedOut = true;
    if (process.platform === "win32") {
      try {
        execFileSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
          stdio: "pipe",
          windowsHide: true,
        });
      } catch {}
    } else child.kill("SIGTERM");
  }, timeoutMs);
  child.stdin.end(prompt);
  const exitCode = await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", resolve);
  });
  clearTimeout(timer);
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

function capture(trial) {
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
    tasks: p.tasks.map((t) => ({
      title: t.title,
      status: t.status,
      source: t.source,
      planPresent: !!t.plan,
      planTool: t.plan?.tool || null,
      checkpointPresent: t.checkpoints.length > 0,
    })),
  };
}

try {
  save();
  if (values.preflight) {
    for (const arm of ["without", "with"]) {
      const trial = prepare(-1, arm);
      const runResult = await run(
        trial,
        "preflight",
        arm === "with"
          ? "Infrastructure preflight only. Use DIP MCP project_context, save a prose-only plan containing 'PREFLIGHT-MCP-OK' on this captured task using task_plan, then read the task back with task_get. Use the supplied task ID and actor. Do not implement code or change settings. Return 4 after the saved plan is read back."
          : "This is an infrastructure preflight. Return the number 4. Do not change any files or call tools.",
      );
      result.pairs.push({
        arm,
        setup: trial.setup,
        run: runResult,
        capture: capture(trial),
      });
      save();
    }
    result.preflightPassed = result.pairs.every(
      (x) =>
        x.run.completed &&
        x.run.exitCode === 0 &&
        (x.arm === "with"
          ? x.capture.tasks.some((t) => t.planPresent) &&
            (x.run.itemCounts.mcp_tool_call || 0) >= 2 &&
            x.run.mcpErrors.length === 0
          : !x.capture.present && !x.setup.hooks && !x.setup.mcp),
    );
    if (!result.preflightPassed) process.exitCode = 1;
  } else {
    for (const pair of protocol.pairs) {
      const row = {
        index: pair.index,
        scenario: pair.scenario,
        repeat: pair.repeat,
        order: pair.order,
        arms: {},
      };
      result.pairs.push(row);
      for (const arm of pair.order) {
        const trial = prepare(pair.index, arm);
        const data = {
          setup: trial.setup,
          seed: await run(trial, "seed", pair.seedPrompt),
        };
        row.arms[arm] = data;
        data.seedScore = await score(trial.root, pair.index, {
          seedOnly: true,
        });
        data.seedArtifacts = artifacts(trial);
        data.seedCapture = capture(trial);
        save();
        data.recovery = await run(trial, "recovery", recoveryPrompt);
        data.score = await score(trial.root, pair.index);
        data.artifacts = artifacts(trial);
        data.capture = capture(trial);
        data.contamination =
          arm === "without" &&
          (data.capture.present ||
            data.setup.hooks ||
            data.setup.mcp ||
            [data.seed, data.recovery].some(
              (x) => (x.itemCounts.mcp_tool_call || 0) > 0,
            ));
        data.success =
          data.seed.completed &&
          data.recovery.completed &&
          data.seed.exitCode === 0 &&
          data.recovery.exitCode === 0 &&
          !data.seed.timedOut &&
          !data.recovery.timedOut &&
          data.score.allPassed &&
          !data.contamination;
        data.seedProtocolDeviation = !data.seedScore.allPassed;
        save();
        console.log(
          JSON.stringify({
            pair: pair.index,
            arm,
            success: data.success,
            functional: `${data.score.passed}/${data.score.total}`,
            memory: `${data.score.memoryPassed}/${data.score.memoryTotal}`,
            contamination: data.contamination,
          }),
        );
      }
    }
  }
  result.completedAt = new Date().toISOString();
  const median = (numbers) => {
    const sorted = [...numbers].sort((a, b) => a - b);
    const n = sorted.length;
    return n % 2
      ? sorted[Math.floor(n / 2)]
      : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
  };
  if (!values.preflight) {
    result.summary = {};
    for (const arm of ["without", "with"]) {
      const rows = result.pairs.map((p) => p.arms[arm]);
      const turns = rows.flatMap((x) => [x.seed, x.recovery]);
      result.summary[arm] = {
        trials: rows.length,
        success: rows.filter((x) => x.success).length,
        functionalPassed: rows.reduce((n, x) => n + x.score.passed, 0),
        functionalTotal: rows.reduce((n, x) => n + x.score.total, 0),
        memoryPassed: rows.reduce((n, x) => n + x.score.memoryPassed, 0),
        memoryTotal: rows.reduce((n, x) => n + x.score.memoryTotal, 0),
        medianTotalWallMs: median(
          rows.map((x) => x.seed.wallMs + x.recovery.wallMs),
        ),
        medianRecoveryWallMs: median(rows.map((x) => x.recovery.wallMs)),
        completedTurns: turns.filter((x) => x.completed).length,
        usageReportedTurns: turns.filter((x) => x.usage).length,
        seedProtocolDeviations: rows.filter((x) => x.seedProtocolDeviation)
          .length,
        inputTokens: turns.reduce(
          (n, x) => n + (x.usage?.input_tokens || 0),
          0,
        ),
        cachedInputTokens: turns.reduce(
          (n, x) => n + (x.usage?.cached_input_tokens || 0),
          0,
        ),
        outputTokens: turns.reduce(
          (n, x) => n + (x.usage?.output_tokens || 0),
          0,
        ),
      };
    }
    result.pairedDifferences = result.pairs.map((p) => ({
      index: p.index,
      totalWallMs:
        p.arms.with.seed.wallMs +
        p.arms.with.recovery.wallMs -
        p.arms.without.seed.wallMs -
        p.arms.without.recovery.wallMs,
      recoveryWallMs:
        p.arms.with.recovery.wallMs - p.arms.without.recovery.wallMs,
    }));
  }
  save();
  console.log(
    JSON.stringify({
      output,
      summary:
        result.summary ||
        result.pairs.map((x) => ({
          arm: x.arm,
          completed: x.run.completed,
          capture: x.capture.kinds,
        })),
    }),
  );
} finally {
  // Preserve fixtures and local transcripts; remove only authentication copies we created.
  for (const auth of credentials) {
    const resolved = path.resolve(auth);
    if (!resolved.startsWith(path.resolve(sandbox) + path.sep))
      throw new Error("Credential cleanup escaped fixture workspace");
    try {
      fs.unlinkSync(resolved);
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
  }
  fs.writeFileSync(
    path.join(sandbox, "retained-fixtures.txt"),
    "Authentication copies removed. Synthetic repositories and local transcripts retained for audit.\n",
  );
  console.log(
    "Synthetic fixtures retained locally; authentication copies removed.",
  );
}
