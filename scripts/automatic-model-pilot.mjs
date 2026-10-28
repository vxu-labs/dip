// Twelve authorized turns only. Native hooks require human trust in /hooks.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { parse, stringify } from "smol-toml";
import { pilotMcpEnvVars, installPilotShims, trialEnvironment, preflightPilot } from "./pilot-support.mjs";
import {
  fixture,
  score,
  commonInstructions,
  recoveryPrompt,
} from "./model-benchmark-fixtures.mjs";
const source = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const base = path.resolve(
  process.env.DIP_PILOT_DIR || "/private/tmp/dip-automatic-pilot-20261028",
);
const codex =
  process.env.DIP_BENCH_CODEX ||
  "/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex";
const hostHome = process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
const installed = "/opt/homebrew/lib/node_modules/@vxu-labs/dip";
const pilotHome = path.join(base, "user", ".codex");
const write = (file, data) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    typeof data === "string" ? data : JSON.stringify(data, null, 2) + "\n",
  );
};
const hash = (data) => createHash("sha256").update(data).digest("hex");
function fingerprint(root) {
  return hash(
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
}
const env = { ...process.env };
for (const k of Object.keys(env))
  if (
    /^CODEX_(THREAD|SESSION|TURN|APP|INTERNAL|SHELL)|^DIP_|^GIT_CONFIG_(COUNT|KEY_|VALUE_)/.test(
      k,
    )
  )
    delete env[k];
Object.assign(env, {
  CODEX_HOME: pilotHome,
  DIP_USER_HOME: path.join(base, "user"),
  GIT_CONFIG_GLOBAL: path.join(base, "gitconfig"),
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_TRACE2_EVENT: "0",
});
const protocolFile = process.env.DIP_PILOT_PROTOCOL_FILE || path.join(base, "protocol.json");
if (process.argv[2] === "--score") {
  const result = await score(process.argv[3], Number(process.argv[4]), {
    seedOnly: process.argv[5] === "seed",
  });
  console.log(JSON.stringify(result));
  process.exit(0);
}
if (process.argv.includes("--prepare")) {
  if (fs.existsSync(protocolFile))
    throw new Error(
      "Pilot already prepared; preserve its protocol and failures.",
    );
  fs.mkdirSync(pilotHome, { recursive: true, mode: 0o700 });
  for (const arm of ["reviewed", "automatic"]) {
    const origin = arm === "reviewed" ? installed : source,
      target = path.join(base, arm);
    fs.mkdirSync(target, { recursive: true });
    for (const f of ["src", "bin", "skills", "public", "package.json"])
      fs.cpSync(path.join(origin, f), path.join(target, f), {
        recursive: true,
      });
    fs.symlinkSync(
      path.join(source, "node_modules"),
      path.join(target, "node_modules"),
      "dir",
    );
  }
  const hostConfig = parse(
    fs.readFileSync(path.join(hostHome, "config.toml"), "utf8"),
  );
  // Existing login is referenced, never serialized into trial artifacts or logs.
  fs.symlinkSync(
    path.join(hostHome, "auth.json"),
    path.join(pilotHome, "auth.json"),
  );
  write(path.join(base, "gitconfig"), "");
  const router = `import {spawnSync} from 'node:child_process';import fs from 'node:fs';import path from 'node:path';\nconst base=${JSON.stringify(base)};const arm=process.env.DIP_PILOT_ARM;if(!['reviewed','automatic'].includes(arm))process.exit(0);const args=process.argv.slice(2);const hook=args[0]==='hook';const input=hook?fs.readFileSync(0,'utf8'):null;const started=performance.now();const r=spawnSync(process.execPath,[path.join(base,arm,'bin/dip.js'),...args],{env:process.env,stdio:hook?['pipe','pipe','pipe']:'inherit',input,encoding:'utf8'});if(hook){process.stdout.write(r.stdout||'');process.stderr.write(r.stderr||'');const event=JSON.parse(input);let output={};try{output=JSON.parse(r.stdout||'{}')}catch{};fs.appendFileSync(path.join(process.env.DIP_PILOT_TRIAL,'hooks.jsonl'),JSON.stringify({event:event.hook_event_name,tool:event.tool_name,session:event.session_id,ms:performance.now()-started,exitCode:r.status,contextBytes:Buffer.byteLength(output.hookSpecificOutput?.additionalContext||''),output})+'\\n');}process.exit(r.status??1);`;
  write(path.join(base, "router.mjs"), router);
  installPilotShims(base);
  const command = `${JSON.stringify(process.execPath)} ${JSON.stringify(path.join(base, "router.mjs"))} hook --agent codex`;
  const hooks = {};
  for (const event of [
    "SessionStart",
    "UserPromptSubmit",
    "PreToolUse",
    "PostToolUse",
    "Stop",
    "SessionEnd",
    "PreCompact",
  ])
    hooks[event] = [
      {
        ...(event.includes("ToolUse") ? { matcher: ".*" } : {}),
        hooks: [
          {
            type: "command",
            command:
              command + (event === "PostToolUse" ? " --skip-plan-tools" : ""),
            timeout: event === "SessionEnd" ? 3 : 10,
            ...(event === "PostToolUse" ? { async: true } : {}),
          },
        ],
      },
    ];
  hooks.PostToolUse.push({
    matcher: "(?:^|[.:])(?:update_plan|TodoWrite)$",
    hooks: [{ type: "command", command, timeout: 10 }],
  });
  write(path.join(pilotHome, "hooks.json"), {
    description:
      "Isolated DIP before/after pilot. Writes only fixture ledger/runtime. No host configuration changes.",
    hooks,
  });
  const tools = [
    ...fs
      .readFileSync(path.join(source, "src/mcp.js"), "utf8")
      .matchAll(/\badd\(\s*["']([a-z_]+)["']/g),
  ].map((m) => m[1]);
  const config = {
    model: hostConfig.model,
    model_reasoning_effort: hostConfig.model_reasoning_effort,
    features: { hooks: true },
    web_search: "disabled",
    allow_login_shell: false,
    mcp_servers: {
      dip: {
        command: process.execPath,
        args: [path.join(base, "router.mjs"), "mcp"],
        env_vars: pilotMcpEnvVars,
        tools: Object.fromEntries(
          tools.map((t) => [t, { approval_mode: "approve" }]),
        ),
      },
    },
  };
  write(path.join(pilotHome, "config.toml"), stringify(config));
  const trials = [];
  for (let i = 0; i < 3; i++)
    for (const arm of i % 2
      ? ["automatic", "reviewed"]
      : ["reviewed", "automatic"]) {
      const dir = path.join(base, "trials", `${i}-${arm}`),
        root = path.join(dir, "project");
      fs.mkdirSync(root, { recursive: true });
      const e = {
        ...env,
        DIP_HOME: path.join(dir, "runtime"),
        DIP_WORKFLOW: arm,
        DIP_PILOT_ARM: arm,
        DIP_PILOT_TRIAL: dir,
      };
      execFileSync(
        "git",
        ["-c", "core.hooksPath=/dev/null", "init", "-b", "main", root],
        { env: e, stdio: "pipe" },
      );
      write(path.join(root, "AGENTS.md"), commonInstructions + "\n");
      write(path.join(root, "package.json"), {
        private: true,
        type: "module",
        scripts: { test: "node --test" },
      });
      execFileSync(
        process.execPath,
        [path.join(base, arm, "bin/dip.js"), "init", "--root", root],
        { env: e, stdio: "pipe" },
      );
      const file = path.join(root, ".dip", "config.json"),
        c = JSON.parse(fs.readFileSync(file));
      c.workflow = arm;
      c.verification = {
        unit: { command: [process.execPath, "--test"], timeoutMs: 30000 },
      };
      write(file, c);
      trials.push({ index: i, arm, dir, root });
    }
  write(protocolFile, {
    version: 1,
    createdAt: new Date().toISOString(),
    turns: 12,
    timeoutMs: 240000,
    design:
      "Three matched scenarios; two fresh conversations per arm: partial implementation with revised requirements, then recovery. Counterbalanced order. No retries or discarded failures. Identical fixtures and inherited model/effort.",
    model: config.model,
    effort: config.model_reasoning_effort,
    trust:
      "Human reviews native hooks in isolated CODEX_HOME via /hooks; no host trust change or bypass.",
    sourceFingerprints: Object.fromEntries(
      ["reviewed", "automatic"].map((a) => [
        a,
        fingerprint(path.join(base, a)),
      ]),
    ),
    fixtureHash: hash(
      fs.readFileSync(
        new URL("./model-benchmark-fixtures.mjs", import.meta.url),
      ),
    ),
    harnessHash: hash(fs.readFileSync(fileURLToPath(import.meta.url))),
    supportHash: hash(fs.readFileSync(new URL("./pilot-support.mjs", import.meta.url))),
    trials,
  });
  write(
    path.join(base, "review-hooks.sh"),
    `#!/bin/sh\nCODEX_HOME='${pilotHome}' '${codex}' --no-daemon --no-alt-screen --cd '${trials[0].root}'\n`,
  );
  fs.chmodSync(path.join(base, "review-hooks.sh"), 0o700);
  console.log(
    JSON.stringify({
      prepared: base,
      review: path.join(base, "review-hooks.sh"),
      hooks: path.join(pilotHome, "hooks.json"),
      turnsStarted: 0,
    }),
  );
  process.exit(0);
}
const protocol = JSON.parse(fs.readFileSync(protocolFile));
if (
  hash(
    fs.readFileSync(new URL("./model-benchmark-fixtures.mjs", import.meta.url)),
  ) !== protocol.fixtureHash ||
  (protocol.harnessHash &&
    hash(fs.readFileSync(fileURLToPath(import.meta.url))) !==
      protocol.harnessHash) ||
  (protocol.supportHash && hash(fs.readFileSync(new URL("./pilot-support.mjs", import.meta.url))) !== protocol.supportHash)
)
  throw new Error(
    "Protocol harness or fixtures changed; do not run a changed scored protocol.",
  );
if (!process.argv.includes("--run")) {
  console.log(JSON.stringify(protocol, null, 2));
  process.exit(0);
}
const trust = parse(
  fs.readFileSync(path.join(pilotHome, "config.toml"), "utf8"),
).hooks?.state;
if (
  !trust ||
  Object.keys(trust).filter(
    (k) =>
      k.startsWith(path.join(pilotHome, "hooks.json")) && trust[k].trusted_hash,
  ).length < 8
)
  throw new Error(
    "Human hook review required. Open review-hooks.sh and use /hooks. No model calls started.",
  );
const output = path.join(base, "results.json");
const continuing = process.argv.includes("--continue-unstarted");
if (fs.existsSync(output) && !continuing)
  throw new Error("Results already exist. No scored retries permitted.");
let results;
if (continuing) {
  results = JSON.parse(fs.readFileSync(output));
  if (!results.abortedAt || !protocol.resumes || results.finishedAt)
    throw new Error("Only an explicitly documented aborted protocol may continue unstarted turns.");
  for (const key of ["trials", "fixtureHash", "sourceFingerprints", "model", "effort", "turns", "timeoutMs"])
    if (JSON.stringify(protocol[key]) !== JSON.stringify(results.protocol[key]))
      throw new Error(`Resumption changed frozen ${key}`);
  const recorded = results.trials.reduce((n, t) => n + t.turns.length, 0);
  if (recorded !== results.turnsStarted || recorded + protocol.resumes.unstartedTurns !== 12)
    throw new Error("Every started turn must be retained, including interrupted failures; budget must remain twelve.");
  results.resumptionProtocol = protocol;
  results.resumedAt = new Date().toISOString();
} else {
  results = { protocol, startedAt: new Date().toISOString(), turnsStarted: 0, trials: [] };
}
const preflight = await preflightPilot(base,
  parse(fs.readFileSync(path.join(pilotHome, "config.toml"), "utf8")), env);
write(path.join(base, "preflight.json"), preflight);
const save = () => write(output, results);
save();
for (const t of protocol.trials) {
  const e = trialEnvironment(base, t, env);
  let trial = results.trials.find((trial) => trial.index === t.index && trial.arm === t.arm);
  if (!trial) {
    trial = { index: t.index, arm: t.arm, turns: [] };
    results.trials.push(trial);
  }
  save();
  for (const phase of ["seed", "recovery"]) {
    if (trial.turns.some((turn) => turn.phase === phase)) continue;
    if (fs.existsSync(path.join(t.dir, phase + ".jsonl")))
      throw new Error("Raw turn output already exists; never retry an unaccounted started turn.");
    if (results.turnsStarted >= 12) throw new Error("Authorized twelve-turn budget exhausted.");
    for (const a of ["reviewed", "automatic"])
      if (fingerprint(path.join(base, a)) !== protocol.sourceFingerprints[a])
        throw new Error("Frozen source changed; stop collection.");
    const prompt =
      phase === "seed" ? fixture(t.index).seedPrompt : recoveryPrompt;
    const hookFile = path.join(t.dir, "hooks.jsonl");
    const priorHooks = fs.existsSync(hookFile)
      ? fs.readFileSync(hookFile, "utf8").trim().split("\n").filter(Boolean)
          .length
      : 0;
    const args = [
      "exec",
      "--json",
      "--ephemeral",
      "--approve-for-me",
      "--cd",
      t.root,
      "--add-dir",
      t.dir,
      "-",
    ];
    const start = performance.now();
    results.turnsStarted++;
    save();
    const child = spawn(codex, args, {
      env: e,
      stdio: ["pipe", "pipe", "pipe"],
      detached: process.platform !== "win32",
    });
    let stdout = "",
      stderr = "",
      timedOut = false;
    child.stdout.on("data", (b) => {
      stdout += b;
      fs.appendFileSync(path.join(t.dir, phase + ".jsonl"), b);
    });
    child.stderr.on("data", (b) => {
      stderr += b;
      fs.appendFileSync(path.join(t.dir, phase + ".stderr.txt"), b);
    });
    child.stdin.end(prompt);
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch {
        child.kill("SIGTERM");
      }
    }, 240000);
    const exitCode = await new Promise((resolve) => {
      child.on("error", (error) => {
        stderr += error.message;
        resolve(-1);
      });
      child.on("close", resolve);
    });
    clearTimeout(timer);
    write(path.join(t.dir, phase + ".jsonl"), stdout);
    write(path.join(t.dir, phase + ".stderr.txt"), stderr);
    const events = stdout
        .split("\n")
        .filter(Boolean)
        .flatMap((s) => {
          try {
            return [JSON.parse(s)];
          } catch {
            return [];
          }
        }),
      items = events
        .filter((e) => e.type === "item.completed")
        .map((e) => e.item);
    const management = items.filter(
      (i) => i.type === "mcp_tool_call" && i.server === "dip",
    );
    const hookRows = fs.existsSync(hookFile)
      ? fs
          .readFileSync(hookFile, "utf8")
          .trim()
          .split("\n")
          .filter(Boolean)
          .map((s) => JSON.parse(s))
          .slice(priorHooks)
      : [];
    let ledger, ledgerError;
    try {
      ledger = JSON.parse(
        execFileSync(
          process.execPath,
          [
            path.join(base, t.arm, "bin/dip.js"),
            "status",
            "--full",
            "--root",
            t.root,
          ],
          { env: e, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
        ),
      );
      write(path.join(t.dir, phase + ".ledger.json"), ledger);
    } catch (error) {
      ledgerError = error.message;
    }
    let scored;
    try {
      scored = JSON.parse(
        execFileSync(
          process.execPath,
          [
            fileURLToPath(import.meta.url),
            "--score",
            t.root,
            String(t.index),
            phase,
          ],
          {
            timeout: 30000,
            encoding: "utf8",
            env: e,
            stdio: ["ignore", "pipe", "pipe"],
          },
        ),
      );
    } catch (error) {
      scored = { allPassed: false, error: String(error), scoringFailed: true };
    }
    const turn = {
      phase,
      wallMs: Math.round(performance.now() - start),
      exitCode,
      timedOut,
      ledgerError,
      hookEvents: hookRows.map((h) => ({
        event: h.event,
        tool: h.tool,
        ms: h.ms,
        exitCode: h.exitCode,
        contextBytes: h.contextBytes,
      })),
      injectedBytes: hookRows.reduce((n, h) => n + h.contextBytes, 0),
      falseCompletion:
        phase === "seed" &&
        ledger?.tasks.some(
          (task) => task.kind === "work" && task.status === "verified",
        ),
      ledgerErrors: ledger?.errors,
      completed: events.some((e) => e.type === "turn.completed"),
      usage: events.find((e) => e.type === "turn.completed")?.usage,
      management: management.map((i) => ({
        tool: i.tool,
        resultBytes: Buffer.byteLength(JSON.stringify(i.result ?? null)),
        status: i.status,
        failed:
          i.status === "failed" ||
          i.is_error === true ||
          i.result?.isError === true,
      })),
      cliManagement: items.filter(
        (i) =>
          i.type === "command_execution" &&
          /\bdip\s+(task|context|reconcile)/.test(i.command || ""),
      ).length,
      score: scored,
    };
    trial.turns.push(turn);
    save();
    console.log(JSON.stringify({ index: t.index, arm: t.arm, ...turn }));
    if (/MCP server startup failed|MCP startup failed/i.test(stderr)) {
      results.abortedAt = new Date().toISOString();
      results.abortReason = "Native MCP startup failed; keep this turn and stop before spending further model calls.";
      save();
      throw new Error(results.abortReason);
    }
  }
}
results.finishedAt = new Date().toISOString();
save();
