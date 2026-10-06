import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { parse } from "smol-toml";
import { home, json, git } from "./util.js";
import { ensure, Runtime, project } from "./core.js";
import { daemonAlive } from "./automation.js";

export function automationHealth(root) {
  const installation = json(path.join(home(), "install.json"), null);
  const daemon = json(path.join(home(), "daemon.json"), null);
  const user = path.resolve(process.env.DIP_USER_HOME || os.homedir());
  const issues = [],
    adapters = {};
  const configuration = (name, hookFile, mcpFile, toml = false) => {
    try {
      const hooks = json(hookFile, {}).hooks || {};
      const count = Object.values(hooks)
        .flatMap((v) => v)
        .flatMap((g) => g.hooks || [])
        .filter((h) => h.command?.includes("--dip-hook")).length;
      const config =
        toml && fs.existsSync(mcpFile)
          ? parse(fs.readFileSync(mcpFile, "utf8"))
          : json(mcpFile, {});
      const mcp = toml ? config.mcp_servers?.dip : config.mcpServers?.dip;
      adapters[name] = {
        hooksConfigured: count,
        mcpConfigured: !!mcp,
        hooksEnabled: !toml || config.features?.hooks === true,
        hostTrust: "not observable; confirm in the agent",
      };
    } catch (e) {
      adapters[name] = { error: e.message };
      issues.push(`${name} configuration cannot be read`);
    }
  };
  configuration(
    "codex",
    path.join(user, ".codex", "hooks.json"),
    path.join(user, ".codex", "config.toml"),
    true,
  );
  configuration(
    "claude",
    path.join(user, ".claude", "settings.json"),
    path.join(user, ".claude.json"),
  );
  const runtime = new Runtime();
  let repo = null,
    sources = [],
    pending = 0,
    failures = [],
    dataErrors = [];
  try {
    if (root) {
      try {
        repo = ensure(root, { instructions: false });
      } catch (e) {
        issues.push(`Project cannot be read: ${e.message}`);
        dataErrors.push({ error: e.message });
      }
      if (repo) {
        pending = runtime.db
          .prepare("SELECT count(*) AS n FROM queue WHERE root=?")
          .get(repo.root).n;
        sources = runtime.db
          .prepare("SELECT source,kind,last FROM recorder_sources WHERE root=?")
          .all(repo.root);
        failures = runtime.db
          .prepare("SELECT root,error,at FROM queue_errors WHERE root=?")
          .all(repo.root);
        dataErrors = project(repo).errors;
      }
    } else
      failures = runtime.db
        .prepare("SELECT root,error,at FROM queue_errors")
        .all();
  } finally {
    runtime.close();
  }
  const running = daemonAlive();
  let gitHooksConfigured = false;
  if (repo && installation?.active && installation.hooksPath) {
    const hooksPath = git(
      repo.root,
      ["config", "--get", "core.hooksPath"],
      true,
    );
    gitHooksConfigured =
      hooksPath === installation.hooksPath ||
      hooksPath === path.join(repo.common, "dip-hooks");
  }
  if (!installation?.active)
    issues.push("Machine automation is not installed. Run dip install.");
  else if (!running) issues.push("Recorder is not running. Run dip start.");
  if (
    installation?.active &&
    repo &&
    !(daemon?.watchedRepositories || []).includes(repo.root)
  )
    issues.push(
      "Project watcher is not attached yet; agent/Git hooks can still record activity.",
    );
  if (failures.length)
    issues.push(
      "Some outbox records could not be persisted. Repair the reported project and run dip flush.",
    );
  if (dataErrors.length)
    issues.push(
      "Project event history contains errors; inspect reported files before editing them.",
    );
  if (fs.existsSync(path.join(home(), "install-journal.json")))
    issues.push(
      "An interrupted installation journal exists. Run dip install to recover it.",
    );
  return {
    installed: !!installation?.active,
    roots: installation?.roots || [],
    daemon: {
      running,
      pid: daemon?.pid || null,
      heartbeat: daemon?.heartbeat || null,
      dashboard: daemon?.dashboard || null,
      lastError: daemon?.lastError || null,
    },
    adapters,
    gitHooksConfigured,
    watcherAttached:
      !!repo &&
      running &&
      (daemon?.watchedRepositories || []).includes(repo.root),
    sources,
    pending,
    failures,
    dataErrors,
    issues,
  };
}
