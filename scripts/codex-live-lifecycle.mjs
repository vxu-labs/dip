// Explicitly invoked, bounded real-host QA. Never fabricates hook delivery or trust.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { parse as parseToml } from "smol-toml";
import { ensure, Runtime, project } from "../src/core.js";

const codex = process.env.DIP_BENCH_CODEX || "codex";
const structuredOnly = process.env.DIP_QA_STRUCTURED_ONLY === "1";
const host = process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
const config = parseToml(
  fs.readFileSync(path.join(host, "config.toml"), "utf8"),
);
const runtime = config.mcp_servers.dip.env.DIP_HOME;
const installed = config.mcp_servers.dip.args.find((arg) =>
  /[/\\]bin[/\\]dip\.js$/.test(arg),
);
const root = fs.mkdtempSync(path.resolve(".dip-local/codex-lifecycle-"));
const output = path.resolve(
  process.argv[2] || ".dip-local/codex-lifecycle-result.json",
);
const log = path.resolve(
  ".dip-local",
  path.basename(root) + "-transport.jsonl",
);
const env = { ...process.env, GIT_TRACE2_EVENT: "0" };
execFileSync("git", ["init", "-b", "main", root], {
  env,
  windowsHide: true,
  stdio: "pipe",
});
execFileSync(process.execPath, [installed, "init", "--root", root], {
  env,
  windowsHide: true,
  stdio: "pipe",
});
fs.appendFileSync(
  path.join(root, "AGENTS.md"),
  "\nBounded fixture QA only. No outside files, installations, network, additional agents or changes to host trust/settings. Use existing task identity and authorized installed DIP only. Do not inspect transport logs.\n",
);
const args = [
  "app-server",
  "--listen",
  "stdio://",
  "-c",
  "allow_login_shell=false",
  "-c",
  'approval_policy="never"',
  ...Object.keys(config.mcp_servers)
    .filter((name) => name !== "dip")
    .flatMap((name) => ["-c", `mcp_servers.${name}.enabled=false`]),
];
// Fixture-local intent tools are explicitly authorized by this QA invocation.
const toolNames = [
  ...fs.readFileSync("src/mcp.js", "utf8").matchAll(/\badd\(\s*"([a-z_]+)"/g),
].map((m) => m[1]);
args.push(
  ...toolNames.flatMap((name) => [
    "-c",
    `mcp_servers.dip.tools.${name}.approval_mode=\"approve\"`,
  ]),
);
const child = spawn(codex, args, {
  cwd: root,
  env,
  windowsHide: true,
  stdio: ["pipe", "pipe", "pipe"],
});
const events = [],
  pending = new Map();
let sequence = 0,
  buffer = "",
  stderr = "";
function record(direction, message) {
  fs.appendFileSync(
    log,
    JSON.stringify({ at: new Date().toISOString(), direction, message }) + "\n",
  );
}
function send(message) {
  record("out", message);
  child.stdin.write(JSON.stringify(message) + "\n");
}
child.stderr.on("data", (chunk) => {
  stderr = (stderr + chunk.toString()).slice(-16000);
});
child.stdout.on("data", (chunk) => {
  buffer += chunk.toString();
  for (;;) {
    const newline = buffer.indexOf("\n");
    if (newline < 0) break;
    const line = buffer.slice(0, newline);
    buffer = buffer.slice(newline + 1);
    if (!line.trim()) continue;
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      continue;
    }
    record("in", message);
    events.push(message);
    if (
      message.id !== undefined &&
      !message.method &&
      pending.has(message.id)
    ) {
      const p = pending.get(message.id);
      pending.delete(message.id);
      clearTimeout(p.timer);
      message.error
        ? p.reject(new Error(JSON.stringify(message.error)))
        : p.resolve(message.result);
    } else if (message.id !== undefined && message.method) {
      // Unexpected interactive approval is a failed/unsupported trial, never an implicit approval.
      send({
        id: message.id,
        error: {
          code: -32601,
          message: "Interactive request unsupported by bounded QA client",
        },
      });
    }
  }
});
function rpc(method, params = {}) {
  const id = ++sequence;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`RPC timeout: ${method}`));
    }, 60000);
    pending.set(id, { resolve, reject, timer });
    send({ id, method, params });
  });
}
async function waitFor(predicate, since = 0, timeoutMs = 240000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const match = events.slice(since).find(predicate);
    if (match) return match;
    if (child.exitCode !== null)
      throw new Error("Own app-server exited before expected event");
    if (Date.now() >= deadline)
      throw new Error("Expected host event timed out");
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}
function snapshot() {
  const rt = new Runtime(runtime);
  try {
    const repo = ensure(root, { instructions: false });
    rt.flush(root);
    const state = project(repo, rt);
    return {
      tasks: state.tasks,
      activity: state.activity,
      leases: state.activeWorkers,
    };
  } finally {
    rt.close();
  }
}
const result = {
  schemaVersion: 1,
  startedAt: new Date().toISOString(),
  root,
  transport: "app-server stdio JSON-RPC",
  codexVersion: execFileSync(codex, ["--version"], {
    encoding: "utf8",
    windowsHide: true,
  }).trim(),
  dipVersion: JSON.parse(
    fs.readFileSync(path.join(path.dirname(installed), "../package.json")),
  ).version,
  model: "gpt-6.1-sol",
  effort: "high",
  hookTrustBypass: false,
  phases: [],
};
const save = () =>
  fs.writeFileSync(output, JSON.stringify(result, null, 2) + "\n");
try {
  result.initialize = await rpc("initialize", {
    clientInfo: { name: "dip-lifecycle-qa", version: "1" },
    capabilities: { experimentalApi: true },
  });
  send({ method: "initialized", params: {} });
  result.hooks = await rpc("hooks/list", { cwds: [root] });
  result.modes = await rpc("collaborationMode/list");
  save();
  const hookRows = result.hooks.data.flatMap((entry) => entry.hooks);
  const required = [
    "SessionStart",
    "UserPromptSubmit",
    "PreToolUse",
    "PostToolUse",
    "PreCompact",
    "Interrupt",
  ];
  result.trustConfirmed = required.every((eventName) =>
    hookRows.some(
      (h) =>
        h.eventName.toLowerCase() === eventName.toLowerCase() &&
        h.enabled &&
        h.trustStatus === "trusted",
    ),
  );
  if (!result.trustConfirmed)
    throw new Error(
      "Required host hooks are not all user-trusted; no bypass attempted",
    );
  const started = await rpc("thread/start", {
    cwd: root,
    model: result.model,
    approvalPolicy: "never",
    sandbox: "danger-full-access",
  });
  const threadId = started.thread.id;
  result.threadId = threadId;
  async function turn(label, prompt) {
    const since = events.length;
    const startedTurn = await rpc("turn/start", {
      threadId,
      input: [{ type: "text", text: prompt }],
      collaborationMode: {
        mode: "default",
        settings: {
          model: result.model,
          reasoning_effort: result.effort,
          developer_instructions: null,
        },
      },
    });
    const completed = await waitFor(
      (e) =>
        e.method === "turn/completed" &&
        e.params.turn.id === startedTurn.turn.id,
      since,
    );
    result.phases.push({
      label,
      prompt,
      turnId: startedTurn.turn.id,
      completed,
      events: events.slice(since),
      state: snapshot(),
    });
    save();
    console.log(
      JSON.stringify({ phase: label, status: completed.params.turn.status }),
    );
  }
  await turn(
    structuredOnly ? "explicit-structured-plan" : "native-plan",
    structuredOnly
      ? "Plan future CSV export with ordered headers. Refine the captured requirement and use DIP task_plan with structured steps (not prose text) to save exactly three pending steps: define CSV contract, implement quoting, verify empty output. This explicitly tests the DIP fallback because native update_plan is unavailable; do not label it native capture. Create a distinct future backlog idea for Hebrew header support preserving UTF-8 and column order. Do not implement, claim work, finish either feature or complete any step. Read back the saved structured plan and return task IDs and statuses. No QA transcripts, outside files, additional models or host changes."
      : "Plan future CSV export with ordered headers. Use native update_plan to save exactly three pending steps: define CSV contract, implement quoting, verify empty output. Create a distinct future backlog idea for Hebrew header support preserving UTF-8 and column order. Refine the captured task as CSV export with acceptance criteria. Do not implement, claim work or complete any step. Do not substitute prose task_plan for native update_plan; report if native tool unavailable. Return task IDs.",
  );
  if (!structuredOnly) {
    const beforeCompact = events.length;
    result.compactResponse = await rpc("thread/compact/start", { threadId });
    await waitFor(
      (e) =>
        e.method === "thread/compacted" ||
        e.method === "thread/contextCompacted" ||
        (e.method === "item/completed" &&
          e.params.item.type === "contextCompaction"),
      beforeCompact,
    );
    result.phases.push({
      label: "forced-compaction",
      events: events.slice(beforeCompact),
      state: snapshot(),
    });
    save();
    await turn(
      "after-compaction",
      "Using DIP, report the existing CSV plan steps and Hebrew-header future criteria and their IDs/statuses. This is an informational check only: classify the captured request as discussion, do not implement or claim the future work. Do not read any QA transcript or snapshot file.",
    );
    const since = events.length;
    const interruptTurn = await rpc("turn/start", {
      threadId,
      input: [
        {
          type: "text",
          text: "Start a separate bounded interruption-test development task. Refine and claim captured task with scope probe.txt. Write probe.txt containing PARTIAL. Then run Node with a 30-second timer and stdout INTERRUPT-WAIT before the timer. I will interrupt the host during that command. Keep task unfinished; do not finish or verify anything. No outside files or settings.",
        },
      ],
      effort: "high",
    });
    const command = await waitFor(
      (e) =>
        e.method === "item/started" &&
        e.params.item.type === "commandExecution" &&
        /30000|30_000/.test(e.params.item.command || ""),
      since,
    );
    result.interruptAt = new Date().toISOString();
    result.interruptedCommand = command;
    result.interruptResponse = await rpc("turn/interrupt", {
      threadId,
      turnId: interruptTurn.turn.id,
    });
    const completed = await waitFor(
      (e) =>
        e.method === "turn/completed" &&
        e.params.turn.id === interruptTurn.turn.id,
      since,
      60000,
    );
    await new Promise((resolve) => setTimeout(resolve, 1500));
    result.phases.push({
      label: "interrupted",
      turnId: interruptTurn.turn.id,
      completed,
      events: events.slice(since),
      state: snapshot(),
      probe: fs.existsSync(path.join(root, "probe.txt"))
        ? fs.readFileSync(path.join(root, "probe.txt"), "utf8")
        : null,
    });
  }
  result.threadRead = await rpc("thread/read", {
    threadId,
    includeTurns: true,
  });
  result.completedAt = new Date().toISOString();
  save();
} catch (error) {
  result.failure = error.message;
  result.failureState = snapshot();
  save();
  process.exitCode = 1;
  console.error(error.message);
} finally {
  for (const p of pending.values()) {
    clearTimeout(p.timer);
    p.reject(new Error("QA client closing"));
  }
  pending.clear();
  child.stdin.end();
  await Promise.race([
    new Promise((resolve) => child.once("close", resolve)),
    new Promise((resolve) => setTimeout(resolve, 5000)),
  ]);
  if (child.exitCode === null) child.kill();
  result.stderr = stderr;
  result.transportSha256 = createHash("sha256")
    .update(fs.readFileSync(log))
    .digest("hex");
  save();
  console.log(
    JSON.stringify({
      output,
      root,
      completed: !!result.completedAt,
      failure: result.failure || null,
    }),
  );
}
