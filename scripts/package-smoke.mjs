import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const root = fs.mkdtempSync(path.join(os.tmpdir(), "dip-package-"));
const npm = process.env.npm_execpath;
if (!npm) throw new Error("Run this script through npm run test:package");
const env = {
  ...process.env,
  DIP_HOME: path.join(root, "runtime"),
  DIP_USER_HOME: path.join(root, "user"),
  DIP_GIT_CONFIG: path.join(root, "gitconfig"),
  GIT_CONFIG_GLOBAL: path.join(root, "gitconfig"),
  GIT_TRACE2_EVENT: "0",
};
const source = fileURLToPath(new URL("../", import.meta.url));
const version = JSON.parse(
  fs.readFileSync(path.join(source, "package.json"), "utf8"),
).version;
try {
  const packed = JSON.parse(
    execFileSync(
      process.execPath,
      [npm, "pack", "--json", "--ignore-scripts", "--pack-destination", root],
      { cwd: source, encoding: "utf8", windowsHide: true, env },
    ),
  )[0];
  if (
    packed.version !== version ||
    path.basename(packed.filename) !== packed.filename
  )
    throw new Error("Unexpected package artifact");
  const archive = path.join(root, packed.filename);
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
    version,
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
  fs.writeFileSync(
    path.join(project, "PLAN.md"),
    "# Plan\n## Validation\nCheck Unicode",
  );
  run([
    "task",
    "document-link",
    "--id",
    created.id,
    "--path",
    "PLAN.md",
    "--role",
    "plan",
    "--root",
    project,
  ]);
  const sections = run([
    "task",
    "document-read",
    "--id",
    created.id,
    "--path",
    "PLAN.md",
    "--role",
    "plan",
    "--heading",
    "Validation",
    "--root",
    project,
  ]);
  assert.equal(sections.sections[0].heading, "Validation");
  const portable = path.join(project, ".dip", "tools", "portable.mjs");
  assert.ok(
    fs.existsSync(path.join(project, ".agents", "skills", "dip", "SKILL.md")),
  );
  assert.ok(
    fs.existsSync(path.join(project, ".claude", "skills", "dip", "SKILL.md")),
  );
  const portableCreated = JSON.parse(
    execFileSync(
      process.execPath,
      [portable, "create", "--title", "Portable package idea"],
      {
        cwd: project,
        env: {
          ...env,
          PATH: "",
          DIP_HOME: path.join(root, "no-portable-runtime"),
        },
        encoding: "utf8",
        windowsHide: true,
      },
    ),
  );
  assert.equal(
    run(["task", "get", "--id", portableCreated.id, "--root", project]).status,
    "backlog",
  );
  assert.ok(!fs.existsSync(path.join(root, "no-portable-runtime")));
  assert.equal(
    run([
      "discover-project",
      "--client",
      "package-qa",
      "--root",
      project,
      "--probe",
    ]).supported,
    true,
  );
  run(["uninstall"]);
  assert.ok(fs.existsSync(path.join(project, ".dip", "config.json")));
  console.log(
    `Clean package ${version} smoke passed: fresh archive, install, version, machine config, auto discovery, task/context, linked sections and uninstall.`,
  );
} finally {
  assert.ok(root.startsWith(path.join(os.tmpdir(), "dip-package-")));
  fs.rmSync(root, { recursive: true, force: true });
}
