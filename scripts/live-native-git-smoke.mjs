import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { ensure, project, Runtime } from "../src/core.js";
import { automationHealth } from "../src/health.js";

if (
  process.env.DIP_HOME ||
  process.env.DIP_USER_HOME ||
  process.env.DIP_GIT_CONFIG
)
  throw new Error(
    "This check requires the real machine installation, without test overrides",
  );
const root = fs.mkdtempSync(path.join(os.tmpdir(), "dip-live-native-"));
const executable =
  process.platform === "win32"
    ? execFileSync("where.exe", ["git"], { encoding: "utf8" })
        .trim()
        .split(/\r?\n/)[0]
    : execFileSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).trim();
const env = { ...process.env };
delete env.GIT_TRACE2_EVENT;
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let repo;
try {
  // Construct an existing repository without producing an initialization signal.
  execFileSync(executable, ["init", "-b", "main", root], {
    env: { ...env, GIT_TRACE2_EVENT: "0" },
    windowsHide: true,
    stdio: "pipe",
  });
  assert.equal(fs.existsSync(path.join(root, ".dip")), false);
  const output = execFileSync(
    executable,
    ["-C", root, "status", "--porcelain"],
    { env, windowsHide: true, encoding: "utf8" },
  );
  assert.equal(output, "");
  const deadline = Date.now() + 10000;
  while (
    Date.now() < deadline &&
    !fs.existsSync(path.join(root, ".dip", "config.json"))
  )
    await pause(100);
  assert.ok(fs.existsSync(path.join(root, ".dip", "config.json")));
  repo = ensure(root);
  while (
    Date.now() < deadline &&
    !project(repo).activity.some((e) => e.kind === "git.discovered")
  )
    await pause(100);
  assert.ok(
    project(repo).activity.some(
      (e) =>
        e.kind === "git.discovered" && e.command === "status" && e.initialized,
    ),
  );
  const health = automationHealth(root);
  assert.ok(health.gitDiscovery.running && health.gitDiscovery.configured);
  console.log(
    JSON.stringify({
      passed: true,
      rawExecutable: true,
      shellProfilesUsed: false,
      bootstrapCommand: "git status",
      nativeDiscovery: true,
      gitOutputPreserved: true,
    }),
  );
} finally {
  if (repo) {
    const rt = new Runtime();
    rt.flush(repo.root);
    rt.db.prepare("DELETE FROM repositories WHERE root=?").run(repo.root);
    rt.close();
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline && automationHealth(root).watcherAttached)
      await pause(100);
  }
  assert.ok(root.startsWith(path.join(os.tmpdir(), "dip-live-native-")));
  fs.rmSync(root, { recursive: true, force: true });
}
