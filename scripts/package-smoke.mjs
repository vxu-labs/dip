import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
const root = fs.mkdtempSync(path.join(os.tmpdir(), "dip-package-"));
const npm = process.env.npm_execpath;
if (!npm) throw new Error("Run this script through npm run test:package");
const env = {
  ...process.env,
  DIP_HOME: path.join(root, "runtime"),
  DIP_USER_HOME: path.join(root, "user"),
  DIP_GIT_CONFIG: path.join(root, "gitconfig"),
  GIT_CONFIG_GLOBAL: path.join(root, "gitconfig"),
};
const archive = path.resolve("vxu-labs-dip-0.3.3.tgz");
try {
  execFileSync(
    process.execPath,
    [
      npm,
      "install",
      "--prefix",
      root,
      archive,
      "--omit=dev",
      "--no-audit",
      "--no-fund",
    ],
    { stdio: "inherit", windowsHide: true, env },
  );
  const cli = path.join(
    root,
    "node_modules",
    "@vxu-labs",
    "dip",
    "bin",
    "dip.js",
  );
  assert.equal(
    execFileSync(process.execPath, [cli, "--version"], {
      encoding: "utf8",
      env,
      windowsHide: true,
    }).trim(),
    "0.3.3",
  );
  const project = path.join(root, "project");
  fs.mkdirSync(project);
  execFileSync("git", ["init", project], { stdio: "pipe", windowsHide: true });
  const run = (args) =>
    JSON.parse(
      execFileSync(process.execPath, [cli, ...args], {
        encoding: "utf8",
        env,
        windowsHide: true,
      }),
    );
  run(["install", "--roots", project, "--no-start", "--no-startup"]);
  assert.ok(fs.existsSync(path.join(project, ".dip", "config.json")));
  const created = run([
    "task",
    "create",
    "--title",
    "Installed package task",
    "--root",
    project,
  ]);
  assert.ok(created.id);
  const context = run(["context", "--root", project]);
  assert.ok(context.ready.some((t) => t.id === created.id));
  run(["uninstall"]);
  assert.ok(fs.existsSync(path.join(project, ".dip", "config.json")));
  console.log(
    "Clean package smoke passed: install, version, machine config, auto discovery, task/context and uninstall.",
  );
} finally {
  assert.ok(root.startsWith(path.join(os.tmpdir(), "dip-package-")));
  fs.rmSync(root, { recursive: true, force: true });
}
