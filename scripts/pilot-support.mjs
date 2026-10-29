import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

// Codex filters the MCP subprocess environment. Forward only pilot routing and
// isolation variables explicitly; never forward the host environment wholesale.
export const pilotMcpEnvVars = [
  "DIP_PILOT_ARM", "DIP_PILOT_TRIAL", "DIP_HOME", "DIP_WORKFLOW",
  "DIP_USER_HOME", "GIT_CONFIG_GLOBAL", "GIT_CONFIG_NOSYSTEM", "GIT_TRACE2_EVENT",
];

const quote = (s) => "'" + s.replaceAll("'", "'\\''") + "'";
export function installPilotShims(base) {
  for (const arm of ["reviewed", "automatic"]) {
    const bin = path.join(base, "cli", arm);
    fs.mkdirSync(bin, { recursive: true });
    fs.writeFileSync(path.join(bin, "dip"),
      `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(path.join(base, arm, "bin/dip.js"))} "$@"\n`,
      { mode: 0o700 });
  }
}

export function trialEnvironment(base, trial, inherited) {
  assert.ok(["reviewed", "automatic"].includes(trial.arm));
  return { ...inherited,
    PATH: path.join(base, "cli", trial.arm) + path.delimiter + (inherited.PATH || ""),
    DIP_HOME: path.join(trial.dir, "runtime"),
    DIP_WORKFLOW: trial.arm,
    DIP_PILOT_ARM: trial.arm,
    DIP_PILOT_TRIAL: trial.dir,
  };
}

export function forwardedMcpEnvironment(server, env) {
  const names = server.env_vars || [];
  for (const name of pilotMcpEnvVars) {
    assert.ok(names.includes(name), `MCP must explicitly forward ${name}`);
    assert.equal(typeof env[name], "string", `Missing pilot environment ${name}`);
  }
  return { ...Object.fromEntries(names.map((name) => [name, env[name]])), ...server.env };
}

// No model requests. Exercise real MCP initialization/discovery/read calls and
// CLI resolution in disposable repositories before spending a single turn.
export async function preflightPilot(base, config, inherited) {
  const receipt = { at: new Date().toISOString(), modelCalls: 0, arms: [] };
  const server = config.mcp_servers.dip;
  for (const arm of ["reviewed", "automatic"]) {
    const dir = fs.mkdtempSync(path.join(base, `preflight-${arm}-`));
    const root = path.join(dir, "project");
    fs.mkdirSync(root);
    const env = trialEnvironment(base, { arm, dir }, inherited);
    const forwarded = forwardedMcpEnvironment(server, env);
    const expectedCli = path.join(base, "cli", arm, "dip");
    const actualCli = execFileSync("/bin/sh", ["-c", "command -v dip"], { env, encoding: "utf8" }).trim();
    assert.equal(actualCli, expectedCli, "CLI fallback escaped the frozen arm");
    execFileSync("git", ["-c", "core.hooksPath=/dev/null", "init", "-b", "main", root], { env, stdio: "pipe" });
    execFileSync(actualCli, ["init", "--root", root], { env, stdio: "pipe" });
    const client = new Client({ name: "dip-pilot-preflight", version: "1.0.0" });
    const transport = new StdioClientTransport({ command: server.command, args: server.args, env: forwarded, cwd: root, stderr: "pipe" });
    let timer;
    try {
      await Promise.race([
        client.connect(transport),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("MCP handshake exceeded 10 seconds")), 10000); }),
      ]);
      clearTimeout(timer);
      const version = JSON.parse(fs.readFileSync(path.join(base, arm, "package.json"))).version;
      assert.equal(client.getServerVersion()?.version, version);
      const { tools } = await client.listTools({}, { timeout: 10000 });
      assert.equal(tools.some((t) => t.name === "project_requests"), arm === "automatic");
      const context = await client.callTool({ name: "project_context", arguments: { root } }, undefined, { timeout: 10000 });
      assert.ok(!context.isError, JSON.stringify(context));
      receipt.arms.push({ arm, version, cli: actualCli, tools: tools.length, contextRead: true });
    } finally {
      clearTimeout(timer);
      await client.close();
    }
  }
  return receipt;
}
