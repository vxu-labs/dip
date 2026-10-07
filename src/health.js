import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { parse } from "smol-toml";
import { home, json, git, redactValue } from "./util.js";
import { ensure, Runtime, project } from "./core.js";
import { daemonAlive } from "./automation.js";
import { capturePolicy } from "./capture-policy.js";
import { processAlive } from "./recorder-supervisor.js";

export function automationHealth(root) {
  const installation = json(path.join(home(), "install.json"), null);
  const daemon = json(path.join(home(), "daemon.json"), null);
  const supervisor = json(path.join(home(), "supervisor.json"), null);
  const control = json(path.join(home(), "recorder-control.json"), null);
  const user = path.resolve(process.env.DIP_USER_HOME || os.homedir());
  const issues = [],
    advisories = [],
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
    dataErrors = [],
    captured = { promptCount: 0, planCount: 0, lastPromptAt: null };
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
        const state = project(repo);
        dataErrors = state.errors;
        const prompts = state.activity.filter(
          (a) => a.kind === "UserPromptSubmit",
        );
        captured = {
          promptCount: prompts.length,
          planCount: state.tasks.filter((t) => t.plan).length,
          lastPromptAt: prompts[0]?.at || null,
        };
      }
    } else
      failures = runtime.db
        .prepare("SELECT root,error,at FROM queue_errors")
        .all();
  } finally {
    runtime.close();
  }
  const running = daemonAlive();
  const capture = capturePolicy(repo?.config);
  const intentionallyStopped = control?.enabled === false;
  if (repo && capture.enabled && installation?.active && !captured.promptCount)
    advisories.push(
      "Agent prompt capture has not been observed in this project. Review/load the host hooks; use explicit intent tools until the current hook supplies a task ID.",
    );
  const nativeGit = {
    enabled: !!installation?.gitDiscovery?.enabled,
    running: !!installation?.gitDiscovery?.enabled && running,
    conflict: !!installation?.gitDiscovery?.conflict,
    environmentOverride: !!process.env.GIT_TRACE2_EVENT,
    pendingFiles:
      installation?.gitDiscovery?.enabled &&
      fs.existsSync(installation.gitDiscovery.target)
        ? fs.readdirSync(installation.gitDiscovery.target).length
        : 0,
  };
  if (nativeGit.conflict)
    issues.push(
      "An existing Git Trace2 target was preserved; native Git discovery is unavailable.",
    );
  if (nativeGit.environmentOverride)
    issues.push(
      "GIT_TRACE2_EVENT overrides Git's configured discovery signal in this environment.",
    );
  if (installation?.gitDiscovery?.unsupported)
    issues.push(
      "The installed Git executable does not support native Trace2 discovery.",
    );
  if (repo && nativeGit.enabled) {
    nativeGit.configured =
      git(
        repo.root,
        ["config", "--global", "--get", "trace2.eventTarget"],
        true,
      ) === installation.gitDiscovery.target;
    if (!nativeGit.configured)
      issues.push(
        "Native Git discovery target changed. Run dip install to inspect the configuration.",
      );
  }
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
  else if (!running && !intentionallyStopped)
    issues.push("Recorder is not running. Run dip start.");
  if (intentionallyStopped)
    advisories.push(
      "Recorder was deliberately stopped. Automatic startup preserves this choice; dip start resumes explicitly.",
    );
  if (supervisor?.currentError && !intentionallyStopped)
    issues.push(supervisor.currentError);
  if (daemon?.lastError && running)
    issues.push(`Recorder currently reports: ${daemon.lastError}`);
  if (
    installation?.active &&
    !intentionallyStopped &&
    capture.enabled &&
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
  return redactValue({
    installed: !!installation?.active,
    gitDiscovery: nativeGit,
    clientDiscovery: {
      available: true,
      mode: "explicit_local_client_callback",
      automaticLibraryInterception: false,
      probe: "dip discover-project --client NAME --root WORKTREE --probe",
      limits:
        "Independent libraries require an integrated callback; remote hosts require host-local integration; bare/no-worktree paths are unsupported",
    },
    roots: installation?.roots || [],
    daemon: {
      running,
      pid: daemon?.pid || null,
      heartbeat: daemon?.heartbeat || null,
      dashboard: daemon?.dashboard || null,
      lastError: daemon?.lastError || null,
      lastFailure: daemon?.lastFailure || null,
      intentionallyStopped,
      supervision: {
        running:
          processAlive(supervisor?.pid) &&
          Date.now() - supervisor.heartbeat < 15000,
        status: intentionallyStopped
          ? "intentionally_stopped"
          : supervisor?.status || "unavailable",
        restartCount: supervisor?.restartCount || 0,
        currentError: intentionallyStopped
          ? null
          : supervisor?.currentError || null,
        lastFailure: supervisor?.lastFailure || null,
        openGap: supervisor?.openGap || null,
        observationGaps: (supervisor?.observationGaps || []).slice(-20),
        missingEventsReconstructed: false,
        limit:
          "Local supervisor retries at most 5 recorder launches in 60 seconds; supervisor itself is not OS-supervised. A live stale owner is never killed automatically.",
      },
    },
    adapters,
    projectDashboard:
      repo && daemon?.dashboard
        ? `${daemon.dashboard}/?root=${encodeURIComponent(repo.root)}`
        : null,
    agentCapture: {
      ...captured,
      status: !capture.enabled
        ? "intentionally_disabled"
        : captured.promptCount
          ? "observed"
          : "unobserved",
      policy: capture,
      explicitIntent: "available",
      meaning:
        "Observed hook records in this project; configuration alone does not prove host delivery or trust.",
    },
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
    advisories,
  });
}
