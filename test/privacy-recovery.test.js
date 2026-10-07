import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  ensure,
  createTask,
  taskRead,
  project,
  Runtime,
  append,
} from "../src/core.js";
import { handleHook, startDaemon, stopDaemon } from "../src/automation.js";
import { automationHealth } from "../src/health.js";
import { configureCapture, capturePolicy } from "../src/capture-policy.js";
import { redact, redactValue, atomic, json, git } from "../src/util.js";
import { portable } from "../src/portable.js";
import { processAlive } from "../src/recorder-supervisor.js";

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "dip-privacy-recovery-"));
Object.assign(process.env, {
  DIP_HOME: path.join(sandbox, "runtime"),
  DIP_USER_HOME: path.join(sandbox, "user"),
  DIP_GIT_CONFIG: path.join(sandbox, "gitconfig"),
  GIT_CONFIG_GLOBAL: path.join(sandbox, "gitconfig"),
  GIT_TRACE2_EVENT: "0",
});
const cli = fileURLToPath(new URL("../bin/dip.js", import.meta.url));
let serial = 0;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(predicate, ms = 15000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await wait(80);
  }
  throw new Error("Timed out waiting for isolated supervisor state");
}
function fixture() {
  const root = path.join(sandbox, `project-${++serial}`);
  fs.mkdirSync(root);
  git(root, ["init", "-b", "main"]);
  return ensure(root);
}
const runtimeFile = (name) => path.join(process.env.DIP_HOME, name);
test.after(async () => {
  stopDaemon();
  await until(
    () => !processAlive(json(runtimeFile("supervisor.json"), null)?.pid),
  );
  assert.equal(path.dirname(sandbox), path.resolve(os.tmpdir()));
  assert.ok(path.basename(sandbox).startsWith("dip-privacy-recovery-"));
  fs.rmSync(sandbox, { recursive: true, force: true });
});

test("capture settings reject malformed patches and disabled capture preserves explicit intent", () => {
  const repo = fixture();
  const original = fs.readFileSync(path.join(repo.dir, "config.json"), "utf8");
  for (const patch of [{ unknown: false }, { enabled: "false" }, [], null])
    assert.throws(() => configureCapture(repo, patch), /capture/);
  assert.equal(
    fs.readFileSync(path.join(repo.dir, "config.json"), "utf8"),
    original,
  );
  configureCapture(repo, { enabled: false });
  const result = handleHook(
    {
      cwd: repo.root,
      hook_event_name: "UserPromptSubmit",
      session_id: "privacy",
      prompt: "private request",
    },
    "codex",
  );
  assert.match(
    result.hookSpecificOutput.additionalContext,
    /intentionally disabled/,
  );
  assert.equal(project(repo).tasks.length, 0);
  const id = createTask(repo, { title: "Explicit future idea" });
  assert.equal(taskRead(repo, id).title, "Explicit future idea");
  const health = automationHealth(repo.root);
  assert.equal(health.agentCapture.status, "intentionally_disabled");
  assert.equal(health.agentCapture.explicitIntent, "available");
  assert.equal(
    health.advisories.some((s) => s.includes("not been observed")),
    false,
  );
});

test("minimized prompts plans commands and files do not enter automatic ledger or session text", () => {
  const repo = fixture();
  configureCapture(repo, {
    promptText: false,
    planText: false,
    commands: false,
    files: false,
  });
  const output = handleHook(
    {
      cwd: repo.root,
      hook_event_name: "UserPromptSubmit",
      session_id: "minimal",
      prompt: "PRIVATE_PROMPT",
    },
    "codex",
  );
  const id = JSON.parse(output.hookSpecificOutput.additionalContext).task_id;
  handleHook(
    {
      cwd: repo.root,
      hook_event_name: "PostToolUse",
      session_id: "minimal",
      tool_name: "update_plan",
      tool_input: { plan: [{ step: "PRIVATE_PLAN", status: "pending" }] },
    },
    "codex",
  );
  handleHook(
    {
      cwd: repo.root,
      hook_event_name: "PreToolUse",
      session_id: "minimal",
      tool_name: "Write",
      tool_input: { file_path: "PRIVATE_PATH.md" },
      tool_use_id: "minimal-write",
    },
    "codex",
  );
  const rt = new Runtime();
  try {
    rt.enqueue(repo, "minimal", {
      kind: "files.changed",
      agent: "filesystem",
      files: ["PRIVATE_PATH"],
    });
    rt.enqueue(repo, "minimal", {
      kind: "git",
      agent: "git",
      command: "PRIVATE_COMMAND",
      path: "PRIVATE_PATH",
    });
    rt.flush();
    assert.equal(rt.session(repo, "minimal").prompt, "");
  } finally {
    rt.close();
  }
  const state = project(repo);
  assert.equal(taskRead(repo, id).plan, null);
  assert.deepEqual(taskRead(repo, id).scope, []);
  assert.doesNotMatch(
    JSON.stringify(state),
    /PRIVATE_(PROMPT|PLAN|COMMAND|PATH)/,
  );
});

test("capture policy is rechecked when queued activity flushes and defaults preserve behavior", () => {
  const repo = fixture(),
    rt = new Runtime();
  try {
    rt.enqueue(repo, "queued", {
      kind: "tool",
      command: "queued secret",
      agent: "codex",
    });
    configureCapture(repo, { enabled: false });
    assert.equal(rt.flush(repo.root), 1);
    assert.equal(project(repo).activity.length, 0);
    assert.equal(
      rt.db
        .prepare("SELECT count(*) AS n FROM queue WHERE root=?")
        .get(repo.root).n,
      0,
    );
    configureCapture(repo, { enabled: true });
    rt.enqueue(repo, "queued", {
      kind: "tool",
      command: "echo hello",
      agent: "codex",
    });
    rt.flush(repo.root);
    assert.equal(project(repo).activity[0].command, "echo hello");
    assert.equal(capturePolicy().enabled, true);
  } finally {
    rt.close();
  }
});

test("known-secret fixtures are structurally sanitized across hook explicit portable queue and diagnostics", () => {
  const repo = fixture();
  const secret = 'raw-value-with-"quotes"-and-\\slashes';
  const value = {
    password: secret,
    nested: {
      API_KEY: "secret-api",
      harmless: 'שלום api_key="another-secret"',
    },
    list: [{ authorization: "Basic dGVzdDp0ZXN0" }],
    text: "https://user:credential@example.test/path ghp_exampleCredential",
  };
  const sanitized = redactValue(value);
  assert.equal(value.password, secret);
  assert.equal(sanitized.password, "[REDACTED]");
  assert.equal(
    JSON.parse(redact(JSON.stringify(value))).password,
    "[REDACTED]",
  );
  assert.match(
    redact(
      "-----BEGIN PRIVATE KEY-----\nprivatebytes\n-----END PRIVATE KEY-----",
    ),
    /REDACTED PRIVATE KEY/,
  );
  const id = createTask(repo, {
    title: "Explicit",
    acceptance: ['password="explicit-secret"'],
  });
  append(repo, id, "task.plan", { tool: "test", input: value });
  const p = portable("create", { title: "Portable" }, repo.root);
  portable(
    "update",
    { id: p.id, patch: { acceptance: ['token="portable-secret"'] } },
    repo.root,
  );
  assert.ok(taskRead(repo, p.id).acceptance[0].includes("[REDACTED]"));
  handleHook(
    {
      cwd: repo.root,
      session_id: "secret",
      hook_event_name: "UserPromptSubmit",
      prompt: 'secret="prompt-secret"',
    },
    "codex",
  );
  handleHook(
    {
      cwd: repo.root,
      session_id: "secret",
      hook_event_name: "PostToolUse",
      tool_name: "TodoWrite",
      tool_input: value,
    },
    "codex",
  );
  const rt = new Runtime();
  try {
    rt.enqueue(repo, "secret", {
      kind: "test",
      command: JSON.stringify(value),
      details: value,
    });
    rt.flush();
  } finally {
    rt.close();
  }
  assert.doesNotMatch(
    JSON.stringify(project(repo)),
    /secret-api|another-secret|dGVzdDp0ZXN0|credential@|explicit-secret|portable-secret|prompt-secret|privatebytes/,
  );
  assert.equal(
    redact("email: person@example.test"),
    "email: person@example.test",
  ); // No universal PII classifier is claimed.
});

test("real supervisor recovers a killed recorder, preserves queued intent and fencing, and respects deliberate stop", async () => {
  const repo = fixture();
  atomic(runtimeFile("install.json"), { active: true, roots: [], port: 0 });
  const rt = new Runtime();
  const id = createTask(repo, { title: "Queued recovery" });
  let token;
  try {
    rt.register(repo);
    token = rt.claim(repo, id, "owner", 120000).token;
  } finally {
    rt.close();
  }
  try {
    startDaemon();
    startDaemon();
    await until(
      () =>
        automationHealth(repo.root).daemon.supervision.status === "running" &&
        automationHealth(repo.root).daemon.dashboard,
    );
    const first = json(runtimeFile("daemon.json"));
    const owner = json(runtimeFile("supervisor.lock/owner.json"));
    const queue = new Runtime();
    try {
      queue.enqueue(repo, "recovery", {
        kind: "recovery.pending",
        agent: "test",
      });
    } finally {
      queue.close();
    }
    process.kill(first.pid, "SIGKILL");
    await until(() => {
      const d = json(runtimeFile("daemon.json"), null);
      return d?.pid && d.pid !== first.pid && d.dashboard;
    });
    await until(() =>
      project(repo).activity.some((a) => a.kind === "recovery.pending"),
    );
    await until(
      () =>
        automationHealth(repo.root).daemon.supervision.observationGaps.length >
        0,
    );
    const health = automationHealth(repo.root);
    assert.equal(
      json(runtimeFile("supervisor.lock/owner.json")).instance,
      owner.instance,
    );
    assert.equal(health.daemon.supervision.currentError, null);
    assert.ok(health.daemon.supervision.lastFailure);
    assert.equal(
      health.daemon.supervision.observationGaps[0].missingEventsReconstructed,
      false,
    );
    const resumed = new Runtime();
    try {
      assert.equal(
        resumed.db.prepare("SELECT token FROM leases WHERE task=?").get(id)
          .token,
        token,
      );
      resumed.db.prepare("UPDATE leases SET expires=0 WHERE task=?").run(id);
    } finally {
      resumed.close();
    }
    await wait(1100);
    const expired = new Runtime();
    try {
      assert.equal(
        expired.leases(repo).find((l) => l.task === id).active,
        false,
      );
    } finally {
      expired.close();
    }
    stopDaemon();
    await until(
      () => !processAlive(json(runtimeFile("supervisor.json"), null)?.pid),
    );
    assert.equal(startDaemon({ automatic: true }).intentionallyStopped, true);
    await wait(1200);
    assert.equal(automationHealth(repo.root).daemon.running, false);
    assert.equal(automationHealth(repo.root).daemon.intentionallyStopped, true);
    assert.equal(
      automationHealth(repo.root).issues.some((s) =>
        s.includes("Recorder is not running"),
      ),
      false,
    );
    startDaemon();
    await until(() => automationHealth(repo.root).daemon.running);
  } finally {
    stopDaemon();
    await until(
      () => !processAlive(json(runtimeFile("supervisor.json"), null)?.pid),
    );
  }
});

test("a live stale owner is preserved and an unconfirmed PID is never terminated", async () => {
  atomic(runtimeFile("daemon.json"), {
    pid: process.pid,
    instance: "unowned",
    heartbeat: 1,
  });
  atomic(runtimeFile("recorder-control.json"), {
    enabled: true,
    generation: "stale",
  });
  startDaemon();
  try {
    await until(
      () => json(runtimeFile("supervisor.json"), null)?.status === "unhealthy",
    );
    assert.equal(processAlive(process.pid), true);
    assert.equal(stopDaemon().ownerUnconfirmed, true);
    await until(
      () => !processAlive(json(runtimeFile("supervisor.json"), null)?.pid),
    );
  } finally {
    atomic(runtimeFile("daemon.json"), { pid: null });
  }
});

test("supervisor restart attempts are bounded and uninstall state stops supervision", async () => {
  const control = runtimeFile("recorder-control.json"),
    calls = runtimeFile("fake-starts.json");
  atomic(control, { enabled: true, generation: "bounded" });
  const supervisorModule = new URL(
    "../src/recorder-supervisor.js",
    import.meta.url,
  ).href;
  const code = `import {runRecorderSupervisor} from ${JSON.stringify(supervisorModule)}; import fs from 'node:fs'; await runRecorderSupervisor(()=>{const file=${JSON.stringify(calls)};const n=fs.existsSync(file)?JSON.parse(fs.readFileSync(file)):0;fs.writeFileSync(file,JSON.stringify(n+1));return {};});`;
  const child = spawn(process.execPath, ["--input-type=module", "-e", code], {
    env: process.env,
    windowsHide: true,
    stdio: "ignore",
  });
  const exited = new Promise((resolve) => child.once("exit", resolve));
  try {
    await until(
      () => json(runtimeFile("supervisor.json"), null)?.status === "blocked",
      25000,
    );
    assert.equal(json(calls), 5);
    await wait(1100);
    assert.equal(json(calls), 5);
    atomic(runtimeFile("install.json"), { active: false });
    await exited;
    assert.equal(processAlive(child.pid), false);
  } finally {
    if (child.exitCode === null) {
      child.kill();
      await exited;
    }
  }
});

test("CLI capture configuration is discoverable and startup profiles use non-reviving automatic start", () => {
  const repo = fixture();
  const output = execFileSync(
    process.execPath,
    [cli, "capture", "--root", repo.root, "--patch", '{"commands":false}'],
    { env: process.env, encoding: "utf8", windowsHide: true },
  );
  assert.equal(JSON.parse(output).commands, false);
  const source = fs.readFileSync(
    new URL("../src/automation.js", import.meta.url),
    "utf8",
  );
  assert.match(source, /<string>--automatic<\/string>/);
  assert.match(source, /start --automatic/);
});
