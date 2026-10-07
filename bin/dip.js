#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { ensure, Runtime, project } from "../src/core.js";
import { execute } from "../src/actions.js";
import {
  handleHook,
  handleGitHook,
  afterGit,
  install,
  uninstall,
  scan,
  startDaemon,
  stopDaemon,
  runDaemon,
  daemonAlive,
} from "../src/automation.js";
import { home, json } from "../src/util.js";
import { VERSION } from "../src/version.js";
import { cliHelp, compactStatus } from "../src/cli-help.js";
import { reconcileView, taskView } from "../src/views.js";
import { discoverClientProject } from "../src/client-discovery.js";

const argv = process.argv.slice(2);
const command = argv.shift() || "help";
if (
  ["help", "--help", "-h"].includes(command) ||
  argv.includes("--help") ||
  argv.includes("-h")
) {
  process.stdout.write(cliHelp(command, argv[0]));
  process.exit(0);
}
const options = {
  title: { type: "string" },
  id: { type: "string" },
  targetId: { type: "string" },
  targetToken: { type: "string" },
  summary: { type: "string" },
  text: { type: "string" },
  path: { type: "string" },
  role: { type: "string" },
  query: { type: "string" },
  heading: { type: "string" },
  expectedHash: { type: "string" },
  maxChars: { type: "string" },
  startChar: { type: "string" },
  next: { type: "string" },
  root: { type: "string" },
  runtime: { type: "string" },
  roots: { type: "string", multiple: true },
  actor: { type: "string" },
  session: { type: "string" },
  token: { type: "string" },
  check: { type: "string" },
  status: { type: "string" },
  statuses: { type: "string", multiple: true },
  kind: { type: "string" },
  outcome: { type: "string" },
  replacedBy: { type: "string", multiple: true },
  open: { type: "boolean" },
  description: { type: "string" },
  scope: { type: "string", multiple: true },
  waitMs: { type: "string" },
  port: { type: "string" },
  agent: { type: "string" },
  "dip-hook": { type: "boolean" },
  "skip-plan-tools": { type: "boolean" },
  "no-start": { type: "boolean" },
  "no-startup": { type: "boolean" },
  "no-agents": { type: "boolean" },
  "no-git-hooks": { type: "boolean" },
  "no-git-discovery": { type: "boolean" },
  json: { type: "boolean" },
  full: { type: "boolean" },
  remove: { type: "boolean" },
  client: { type: "string" },
  probe: { type: "boolean" },
  disabled: { type: "boolean" },
  limit: { type: "string" },
  offset: { type: "string" },
  patch: { type: "string" },
};
let flags, positionals;
try {
  ({ values: flags, positionals } = parseArgs({
    args: argv,
    options,
    allowPositionals: true,
    strict: true,
  }));
} catch (e) {
  process.stderr.write(`DIP: ${e.message}. Run dip --help.\n`);
  process.exit(1);
}
const cwd = flags.root || process.cwd();
if (flags.runtime) process.env.DIP_HOME = path.resolve(flags.runtime);
const print = (value) =>
  process.stdout.write(JSON.stringify(value, null, 2) + "\n");
try {
  if (command === "--version" || command === "version")
    process.stdout.write(VERSION + "\n");
  else if (command === "init") {
    const r = ensure(cwd),
      rt = new Runtime();
    try {
      rt.register(r);
    } finally {
      rt.close();
    }
    print({ initialized: r.root });
  } else if (command === "install")
    print(
      install({
        roots: flags.roots,
        start: !flags["no-start"],
        startup: !flags["no-startup"],
        agents: !flags["no-agents"],
        gitHooks: !flags["no-git-hooks"],
        gitDiscovery: !flags["no-git-discovery"],
        port: flags.port === undefined ? undefined : Number(flags.port),
      }),
    );
  else if (command === "uninstall") print(uninstall());
  else if (command === "repository")
    print(await execute("repository", flags, cwd));
  else if (command === "discover-project")
    print(
      discoverClientProject(cwd, {
        client: flags.client,
        probe: !!flags.probe,
        enabled: !flags.disabled,
      }),
    );
  else if (command === "connect")
    print(
      install({
        roots:
          flags.roots ||
          json(path.join(home(), "install.json"), { roots: [cwd] }).roots,
        start: false,
        startup: false,
        gitHooks: false,
        gitDiscovery: false,
      }),
    );
  else if (command === "start") print(startDaemon());
  else if (command === "stop") print(stopDaemon());
  else if (command === "flush") {
    const rt = new Runtime();
    try {
      print({ flushed: rt.flush(), errors: rt.lastFlushErrors });
    } finally {
      rt.close();
    }
  } else if (command === "daemon") await runDaemon();
  else if (command === "discover")
    print(
      scan(
        flags.roots ||
          json(path.join(home(), "install.json"), { roots: [cwd] }).roots,
      ),
    );
  else if (command === "hook") {
    let text = "";
    for await (const chunk of process.stdin) {
      text += chunk;
      if (text.length > 8 * 1024 * 1024)
        throw new Error("Hook input too large");
    }
    const output = handleHook(JSON.parse(text || "{}"), flags.agent, {
      skipPlanTools: !!flags["skip-plan-tools"],
    });
    if (Object.keys(output).length) print(output);
  } else if (command === "git-hook") {
    handleGitHook(positionals[0], cwd);
  } else if (command === "after-git") {
    print(afterGit(positionals, cwd));
  } else if (command === "mcp") {
    const { runMcp } = await import("../src/mcp.js");
    await runMcp();
  } else if (command === "serve") {
    const { createServer } = await import("../src/server.js");
    const server = createServer({
      root: cwd,
      port: Number(flags.port || 4317),
    });
    server.on("listening", () =>
      print({ dashboard: `http://127.0.0.1:${server.address().port}` }),
    );
  } else if (
    command === "context" ||
    command === "status" ||
    command === "reconcile"
  ) {
    const result = await execute(command, { ...flags }, cwd);
    print(
      command === "status" && !flags.full
        ? compactStatus(
            result,
            Number(flags.limit || 30),
            Number(flags.offset || 0),
          )
        : command === "reconcile" && !flags.full
          ? reconcileView(result, flags)
          : result,
    );
  } else if (command === "search" || command === "owners") {
    print(await execute(command, { ...flags }, cwd));
  } else if (command === "task") {
    const action = positionals.shift();
    const args = { ...flags };
    if (flags.patch) args.patch = JSON.parse(flags.patch);
    else if (action === "update")
      args.patch = {
        ...(flags.status ? { status: flags.status } : {}),
        ...(flags.kind ? { kind: flags.kind } : {}),
        ...(flags.scope ? { scope: flags.scope } : {}),
        ...(flags.title ? { title: flags.title } : {}),
      };
    const result = await execute(action, args, cwd);
    print(action === "update" && !flags.full ? taskView(result) : result);
  } else if (command === "doctor") {
    const { automationHealth } = await import("../src/health.js");
    print({
      version: VERSION,
      node: process.version,
      repo: path.resolve(cwd),
      runtime: home(),
      automation: automationHealth(cwd),
      limitations: [
        "Independent clones need shared live coordination",
        "Hooks do not cover unobserved tools or bypassed integrations",
        "Model assertions never establish verified completion",
      ],
    });
  } else {
    process.stdout.write(
      `DIP — automatic project memory and development activity\n\ndip install [--roots PATH]  One-time machine integration and discovery\ndip init                   Initialize this project\ndip serve                  Open the local dashboard URL\ndip context                Compact agent handoff\ndip task create --title X  Save meaningful intent\ndip task next              Find unblocked work\ndip task claim --id ID --actor AGENT\ndip task checkpoint --id ID --summary X\ndip task verify --id ID --check NAME\ndip reconcile              Compare evidence with current code\ndip doctor                 Inspect automation coverage\ndip uninstall              Remove machine integration; preserve data\n\nRequires Node.js 24+. No separate model calls or API key.\n`,
    );
  }
} catch (e) {
  process.stderr.write(`DIP: ${e.message}\n`);
  process.exitCode = 1;
}
