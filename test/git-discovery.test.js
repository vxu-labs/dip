import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Runtime, ensure, project } from "../src/core.js";
import { install, uninstall, stopDaemon } from "../src/automation.js";
import { GitDiscovery, traceDirectory } from "../src/git-discovery.js";
import { git, json } from "../src/util.js";

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "dip-native-git-"));
process.env.DIP_HOME = path.join(sandbox, "runtime");
process.env.DIP_USER_HOME = path.join(sandbox, "user");
process.env.DIP_GIT_CONFIG = path.join(sandbox, "global.gitconfig");
process.env.GIT_CONFIG_GLOBAL = process.env.DIP_GIT_CONFIG;
const env = { ...process.env };
delete env.GIT_TRACE2_EVENT;
const executable =
  process.platform === "win32"
    ? execFileSync("where.exe", ["git"], { encoding: "utf8" })
        .trim()
        .split(/\r?\n/)[0]
    : execFileSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).trim();
const cli = fileURLToPath(new URL("../bin/dip.js", import.meta.url));
const opts = {
  roots: [],
  agents: false,
  gitHooks: false,
  startup: false,
  start: false,
};
let serial = 0;
function fixture() {
  const root = path.join(sandbox, `unwatched repo ${++serial}`);
  execFileSync(executable, ["init", "-b", "main", root], {
    env: { ...env, GIT_TRACE2_EVENT: "0" },
    windowsHide: true,
    stdio: "pipe",
  });
  return fs.realpathSync.native(root);
}
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(predicate) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await pause(100);
  }
  throw new Error("Native Git discovery did not complete");
}
test.after(() => {
  stopDaemon();
  assert.ok(sandbox.startsWith(path.join(os.tmpdir(), "dip-native-git-")));
  fs.rmSync(sandbox, { recursive: true, force: true });
});

test("minor Git commands bootstrap unknown repos without profiles, hooks or watched roots", () => {
  assert.equal(install(opts).gitDiscovery.enabled, true);
  const rt = new Runtime(),
    discovery = new GitDiscovery(rt);
  try {
    for (const args of [
      ["status", "--porcelain"],
      ["diff"],
      ["branch"],
      ["rev-parse", "--show-toplevel"],
      ["ls-files"],
      ["config", "--local", "user.name", "Native"],
      ["log", "-1"],
    ]) {
      const root = fixture();
      let code = 0;
      try {
        execFileSync(executable, ["-C", root, ...args], {
          env,
          windowsHide: true,
          stdio: "pipe",
        });
      } catch (e) {
        code = e.status;
      }
      assert.equal(fs.existsSync(path.join(root, ".dip")), false);
      const result = discovery.drain();
      assert.deepEqual(result.errors, []);
      rt.flush(root);
      assert.ok(
        fs.existsSync(path.join(root, ".dip", "config.json")),
        args.join(" "),
      );
      const state = project(ensure(root));
      assert.ok(
        state.activity.some(
          (e) => e.kind === "git.discovered" && e.command === args[0],
        ),
      );
      assert.equal(code, args[0] === "log" ? 128 : 0);
    }
    assert.equal(
      fs.readdirSync(traceDirectory()).length,
      0,
      "DIP's internal Git calls must not create tracing loops",
    );
  } finally {
    rt.close();
  }
  uninstall();
});

test("trace discovery never persists argv or secrets and drains completed files", () => {
  const root = fixture();
  install(opts);
  const rt = new Runtime(),
    discovery = new GitDiscovery(rt);
  try {
    const output = execFileSync(
      executable,
      [
        "-C",
        root,
        "-c",
        "http.extraHeader=Authorization: Bearer SENSITIVE_TRACE_VALUE",
        "status",
        "--porcelain",
      ],
      { env, encoding: "utf8", windowsHide: true },
    );
    assert.equal(output, "");
    assert.ok(
      fs
        .readdirSync(traceDirectory())
        .some((n) =>
          fs
            .readFileSync(path.join(traceDirectory(), n), "utf8")
            .includes("SENSITIVE_TRACE_VALUE"),
        ),
    );
    discovery.drain();
    rt.flush(root);
    assert.ok(
      !JSON.stringify(project(ensure(root))).includes("SENSITIVE_TRACE_VALUE"),
    );
    assert.equal(fs.readdirSync(traceDirectory()).length, 0);
  } finally {
    rt.close();
  }
  uninstall();
});

test("installer preserves unrelated trace targets and restores disabled settings", () => {
  const original = path.join(sandbox, "original.trace");
  execFileSync(
    executable,
    [
      "config",
      "--file",
      process.env.DIP_GIT_CONFIG,
      "trace2.eventTarget",
      original,
    ],
    { env: { ...env, GIT_TRACE2_EVENT: "0" } },
  );
  assert.equal(install(opts).gitDiscovery.conflict, true);
  assert.equal(
    git(sandbox, ["config", "--get", "trace2.eventTarget"]),
    original,
  );
  uninstall();
  execFileSync(
    executable,
    ["config", "--file", process.env.DIP_GIT_CONFIG, "trace2.eventTarget", "0"],
    { env: { ...env, GIT_TRACE2_EVENT: "0" } },
  );
  install(opts);
  install(opts);
  uninstall();
  assert.equal(git(sandbox, ["config", "--get", "trace2.eventTarget"]), "0");
});

test("service consumes raw executable Git activity outside its configured roots", async () => {
  const root = fixture();
  install(opts);
  const child = spawn(
    process.execPath,
    ["--disable-warning=ExperimentalWarning", cli, "daemon"],
    { env, windowsHide: true, stdio: "ignore" },
  );
  const exit = new Promise((resolve) => child.on("exit", resolve));
  try {
    await until(
      () =>
        json(path.join(process.env.DIP_HOME, "daemon.json"), null)?.instance,
    );
    execFileSync(executable, ["-C", root, "status", "--porcelain"], {
      env,
      stdio: "pipe",
      windowsHide: true,
    });
    await until(() => fs.existsSync(path.join(root, ".dip", "config.json")));
    await until(() =>
      project(ensure(root)).activity.some((e) => e.kind === "git.discovered"),
    );
  } finally {
    execFileSync(process.execPath, [cli, "stop"], {
      env,
      windowsHide: true,
      stdio: "pipe",
    });
    await exit;
  }
});
