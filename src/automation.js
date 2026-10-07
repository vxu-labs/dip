import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { spawn, execFileSync } from "node:child_process";
import { parse, stringify } from "smol-toml";
import {
  ensure,
  Runtime,
  createTask,
  append,
  compactContext,
  taskRead,
  linkDocument,
  unlinkDocument,
} from "./core.js";
import {
  documentMutations,
  documentPath,
  projectRelativePath,
  inferredRole,
} from "./documents.js";
import {
  atomic,
  json,
  home,
  git,
  redact,
  managed,
  id,
  sensitive,
  digest,
  canonicalScope,
} from "./util.js";
import { writeGitHooks, restoreProjectHooks } from "./git-hooks.js";
import { installTransaction } from "./install-transaction.js";
import {
  planningTool,
  readingTool,
  intentCommand,
  promptRequest,
  planInput,
} from "./workflow.js";
import {
  GitDiscovery,
  traceDirectory,
  probeGitTrace,
} from "./git-discovery.js";
export { writeGitHooks } from "./git-hooks.js";

export const CLI = fileURLToPath(new URL("../bin/dip.js", import.meta.url));
const shellQuote = (s) => `'${String(s).replaceAll("'", "'\\''")}'`;
const quote = (s) => `"${String(s).replaceAll('"', '\\"')}"`;
const gitConfigArgs = () =>
  process.env.DIP_GIT_CONFIG
    ? ["--file", process.env.DIP_GIT_CONFIG]
    : ["--global"];
function configGit(args, optional = false) {
  try {
    return execFileSync("git", ["config", ...gitConfigArgs(), ...args], {
      encoding: "utf8",
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, GIT_TRACE2_EVENT: "0" },
    }).trim();
  } catch (e) {
    if (optional) return "";
    throw e;
  }
}
const USER_HOME = () => path.resolve(process.env.DIP_USER_HOME || os.homedir());

export function install({
  roots = [USER_HOME()],
  start = true,
  agents = true,
  gitHooks = true,
  gitDiscovery = true,
  startup = true,
  port,
} = {}) {
  if (
    port !== undefined &&
    (!Number.isInteger(port) || port < 0 || port > 65535)
  )
    throw new Error("Dashboard port must be between 0 and 65535");
  const directory = home();
  fs.mkdirSync(directory, { recursive: true });
  const user = USER_HOME();
  const agentFiles = [
    path.join(user, ".codex", "hooks.json"),
    path.join(user, ".codex", "config.toml"),
    path.join(user, ".claude", "settings.json"),
    path.join(user, ".claude.json"),
  ];
  const profiles =
    process.platform === "win32"
      ? [
          path.join(
            user,
            "Documents",
            "PowerShell",
            "Microsoft.PowerShell_profile.ps1",
          ),
          path.join(
            user,
            "Documents",
            "WindowsPowerShell",
            "Microsoft.PowerShell_profile.ps1",
          ),
        ]
      : [path.join(user, ".bashrc"), path.join(user, ".zshrc")];
  const startupFile =
    process.platform === "win32"
      ? path.join(
          user,
          "AppData",
          "Roaming",
          "Microsoft",
          "Windows",
          "Start Menu",
          "Programs",
          "Startup",
          "DIP.vbs",
        )
      : process.platform === "darwin"
        ? path.join(user, "Library", "LaunchAgents", "dev.dip.plist")
        : path.join(user, ".config", "autostart", "dip.desktop");
  const gitFiles = process.env.DIP_GIT_CONFIG
    ? [process.env.DIP_GIT_CONFIG]
    : process.env.GIT_CONFIG_GLOBAL
      ? [process.env.GIT_CONFIG_GLOBAL]
      : [
          path.join(os.homedir(), ".gitconfig"),
          path.join(
            process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"),
            "git",
            "config",
          ),
        ];
  const files = [
    path.join(directory, "install.json"),
    ...gitFiles,
    ...(agents ? agentFiles.flatMap((f) => [f, f + ".dip-backup"]) : []),
    ...(startup ? [...profiles, startupFile] : []),
    ...(gitHooks
      ? [
          "pre-commit",
          "post-commit",
          "post-checkout",
          "post-merge",
          "post-rewrite",
          "pre-push",
        ].map((n) => path.join(directory, "git-hooks", n))
      : []),
  ];
  return installTransaction(directory, files, () => {
    let state = json(path.join(directory, "install.json"), {});
    if (!state.active)
      for (const key of [
        "previousTraceTarget",
        "previousCodexHooks",
        "previousHooksPath",
        "hooksPath",
        "gitDiscovery",
      ])
        delete state[key];
    state = {
      ...state,
      cliBeforeUpgrade: state.cli,
      active: true,
      version: 1,
      roots: [...new Set(roots.map((p) => path.resolve(p)))],
      installedAt: state.installedAt || new Date().toISOString(),
      cli: CLI,
      node: process.execPath,
      port: port ?? state.port ?? 4317,
    };
    if (agents) installAgents(state);
    if (gitHooks) {
      const hooks = path.join(directory, "git-hooks");
      const previous = configGit(["--get", "core.hooksPath"], true);
      if (previous !== hooks) state.previousHooksPath = previous || null;
      writeGitHooks(hooks, state.previousHooksPath);
      configGit(["core.hooksPath", hooks]);
      state.hooksPath = hooks;
    }
    if (gitDiscovery) {
      const target = traceDirectory().replaceAll("\\", "/");
      const previous = configGit(["--get", "trace2.eventTarget"], true);
      if (previous && ![target, "0", "false"].includes(previous)) {
        state.gitDiscovery = {
          enabled: false,
          conflict: true,
          reason: "An existing Git Trace2 event target was preserved",
        };
      } else {
        fs.mkdirSync(traceDirectory(), { recursive: true, mode: 0o700 });
        if (fs.lstatSync(traceDirectory()).isSymbolicLink())
          throw new Error("Git trace directory must not be a symbolic link");
        if (!Object.hasOwn(state, "previousTraceTarget"))
          state.previousTraceTarget = previous || null;
        configGit(["trace2.eventTarget", target]);
        if (probeGitTrace(traceDirectory()))
          state.gitDiscovery = { enabled: true, target };
        else {
          if (state.previousTraceTarget === null)
            configGit(["--unset", "trace2.eventTarget"]);
          else configGit(["trace2.eventTarget", state.previousTraceTarget]);
          state.gitDiscovery = {
            enabled: false,
            unsupported: true,
            reason:
              "The installed Git executable did not emit native Trace2 events",
          };
        }
      }
    }
    if (startup) installStartup(state);
    if (start && daemonAlive()) stopDaemon();
    atomic(path.join(directory, "install.json"), state);
    const discovered = scan(state.roots);
    if (start) startDaemon();
    return {
      roots: state.roots,
      initialized: discovered.initialized,
      errors: discovered.errors,
      agents: !!agents,
      daemon: start,
      gitDiscovery: state.gitDiscovery || { enabled: false },
      restartAgents: true,
      trustRequired: true,
    };
  });
}
function installAgents(state) {
  const user = USER_HOME(),
    command = `${quote(process.execPath)} --disable-warning=ExperimentalWarning ${quote(CLI)} hook --dip-hook --runtime ${quote(home())}`;
  // Validate both agent configurations before changing either integration.
  const codex = path.join(user, ".codex", "config.toml");
  const settings = fs.existsSync(codex)
    ? parse(fs.readFileSync(codex, "utf8"))
    : {};
  const claude = path.join(user, ".claude.json");
  const claudeSettings = json(claude, {});
  for (const existing of [
    settings.mcp_servers?.dip,
    claudeSettings.mcpServers?.dip,
  ])
    if (
      existing &&
      !existing.args?.includes(CLI) &&
      !(
        state.cliBeforeUpgrade &&
        existing.args?.includes(state.cliBeforeUpgrade)
      )
    )
      throw new Error(
        "An unrelated MCP server named dip already exists; choose another name before installing DIP",
      );
  state.agentFiles = [];
  for (const [agent, file] of [
    ["codex", path.join(user, ".codex", "hooks.json")],
    ["claude", path.join(user, ".claude", "settings.json")],
  ]) {
    const settings = json(file, {});
    settings.hooks ||= {};
    const eventNames = [
      "SessionStart",
      "UserPromptSubmit",
      "PreToolUse",
      "PostToolUse",
      "Stop",
      "SessionEnd",
      "PreCompact",
      "SubagentStart",
      "SubagentStop",
    ];
    if (agent === "codex") eventNames.push("Interrupt");
    if (agent === "claude")
      eventNames.push("StopFailure", "PostToolUseFailure");
    for (const event of eventNames) {
      const groups = (settings.hooks[event] || [])
        .map((g) => ({
          ...g,
          hooks: (g.hooks || []).filter(
            (h) => !h.command?.includes("--dip-hook"),
          ),
        }))
        .filter((g) => g.hooks.length);
      const handler = {
        type: "command",
        command: `${command} --agent ${agent}`,
        timeout: ["SessionEnd", "Interrupt"].includes(event) ? 3 : 10,
      };
      if (event === "PostToolUse") handler.async = true;
      if (process.platform === "win32" && agent === "claude") {
        handler.shell = "powershell";
        handler.command = `& ${handler.command}`;
      }
      if (process.platform === "win32" && agent === "codex") {
        handler.commandWindows = `node --disable-warning=ExperimentalWarning ${quote(CLI)} hook --dip-hook --runtime ${quote(home())} --agent codex`;
      }
      const synchronous = { ...handler };
      delete synchronous.async;
      if (event === "PostToolUse") {
        handler.command += " --skip-plan-tools";
        if (handler.commandWindows)
          handler.commandWindows += " --skip-plan-tools";
      }
      groups.push({
        ...(event.includes("ToolUse")
          ? {
              matcher: ".*",
            }
          : {}),
        hooks: [handler],
      });
      // Plan revisions must arrive in order. Ordinary post-tool capture stays asynchronous.
      if (event === "PostToolUse") {
        groups.push({
          matcher:
            agent === "claude"
              ? "(?:^|[.:])(?:update_plan|TodoWrite|ExitPlanMode)$"
              : "(?:^|[.:])(?:update_plan|TodoWrite)$",
          hooks: [synchronous],
        });
      }
      settings.hooks[event] = groups;
    }
    backup(file);
    atomic(file, settings);
    state.agentFiles.push(file);
  }
  settings.features ||= {};
  if (!Object.hasOwn(state, "previousCodexHooks"))
    state.previousCodexHooks = settings.features.hooks ?? null;
  settings.features.hooks = true;
  settings.mcp_servers ||= {};
  settings.mcp_servers.dip = {
    command: process.execPath,
    args: ["--disable-warning=ExperimentalWarning", CLI, "mcp"],
    env: { DIP_HOME: home() },
  };
  backup(codex);
  atomic(codex, stringify(settings));
  state.codexConfig = codex;
  claudeSettings.mcpServers ||= {};
  claudeSettings.mcpServers.dip = {
    type: "stdio",
    command: process.execPath,
    args: ["--disable-warning=ExperimentalWarning", CLI, "mcp"],
    env: { DIP_HOME: home() },
  };
  backup(claude);
  atomic(claude, claudeSettings);
  state.claudeConfig = claude;
}
function backup(file) {
  if (fs.existsSync(file) && !fs.existsSync(file + ".dip-backup"))
    fs.copyFileSync(file, file + ".dip-backup");
}
function installStartup(state) {
  const user = USER_HOME(),
    command = `${quote(process.execPath)} --disable-warning=ExperimentalWarning ${quote(CLI)} start`;
  if (process.platform === "win32") {
    const file = path.join(
      user,
      "AppData",
      "Roaming",
      "Microsoft",
      "Windows",
      "Start Menu",
      "Programs",
      "Startup",
      "DIP.vbs",
    );
    atomic(
      file,
      `Set shell = CreateObject("WScript.Shell")\nshell.Run "${command.replaceAll('"', '""')}", 0, False\n`,
    );
    state.startupFile = file;
  } else if (process.platform === "darwin") {
    const file = path.join(user, "Library", "LaunchAgents", "dev.dip.plist");
    const xml = (s) => s.replaceAll("&", "&amp;").replaceAll("<", "&lt;");
    atomic(
      file,
      `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>Label</key><string>dev.dip</string><key>ProgramArguments</key><array><string>${xml(process.execPath)}</string><string>${xml(CLI)}</string><string>start</string></array><key>RunAtLoad</key><true/></dict></plist>`,
    );
    state.startupFile = file;
  } else {
    const file = path.join(user, ".config", "autostart", "dip.desktop");
    atomic(
      file,
      `[Desktop Entry]\nType=Application\nName=DIP\nExec=${command}\nX-GNOME-Autostart-enabled=true\n`,
    );
    state.startupFile = file;
  }
  // Terminal startup is also supported on servers and machines without a desktop login.
  const profiles =
    process.platform === "win32"
      ? [
          path.join(
            user,
            "Documents",
            "PowerShell",
            "Microsoft.PowerShell_profile.ps1",
          ),
          path.join(
            user,
            "Documents",
            "WindowsPowerShell",
            "Microsoft.PowerShell_profile.ps1",
          ),
        ]
      : [path.join(user, ".bashrc"), path.join(user, ".zshrc")];
  const begin = "# dip:start",
    end = "# dip:end";
  for (const file of profiles) {
    const old = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
    const escapedNode = process.execPath.replaceAll("'", "''"),
      escapedCli = CLI.replaceAll("'", "''");
    const body =
      process.platform === "win32"
        ? `if (Test-Path -LiteralPath '${escapedCli}') {\n  & '${escapedNode}' '${escapedCli}' start | Out-Null\n  if (-not (Get-Command git -CommandType Function -ErrorAction SilentlyContinue)) {\n    function global:git {\n      $alGitArgs = @($args)\n      & (Get-Command git -CommandType Application | Select-Object -First 1).Source @alGitArgs\n      $alGitExit = $LASTEXITCODE\n      if ($alGitExit -eq 0 -and ($alGitArgs -contains 'init' -or $alGitArgs -contains 'clone')) {\n        & '${escapedNode}' '${escapedCli}' after-git -- @alGitArgs | Out-Null\n      }\n      $global:LASTEXITCODE = $alGitExit\n    }\n  }\n}`
        : `[ ! -f ${shellQuote(CLI)} ] || ${shellQuote(process.execPath)} ${shellQuote(CLI)} start >/dev/null 2>&1\nif ! typeset -f git >/dev/null 2>&1; then\n  git() {\n    command git "$@"\n    al_git_exit=$?\n    if [ "$al_git_exit" -eq 0 ]; then\n      case " $* " in *" init "*|*" clone "*) ${shellQuote(process.execPath)} ${shellQuote(CLI)} after-git -- "$@" >/dev/null ;; esac\n    fi\n    return "$al_git_exit"\n  }\nfi`;
    const quietBody = body
      .replaceAll(
        `'${escapedNode}' '${escapedCli}'`,
        `'${escapedNode}' --disable-warning=ExperimentalWarning '${escapedCli}'`,
      )
      .replaceAll(
        `${shellQuote(process.execPath)} ${shellQuote(CLI)}`,
        `${shellQuote(process.execPath)} --disable-warning=ExperimentalWarning ${shellQuote(CLI)}`,
      );
    const block = `${begin}\n${quietBody}\n${end}`;
    const regex = /# dip:start[\s\S]*?# dip:end/g;
    atomic(
      file,
      regex.test(old)
        ? old.replace(regex, block)
        : old.trimEnd() + "\n" + block + "\n",
    );
  }
  state.profiles = profiles;
}
export function uninstall() {
  const state = json(path.join(home(), "install.json"), {});
  stopDaemon();
  const runtime = new Runtime();
  if (
    state.gitDiscovery?.enabled &&
    configGit(["--get", "trace2.eventTarget"], true) ===
      state.gitDiscovery.target
  ) {
    if (
      state.previousTraceTarget !== null &&
      state.previousTraceTarget !== undefined
    )
      configGit(["trace2.eventTarget", state.previousTraceTarget]);
    else configGit(["--unset", "trace2.eventTarget"]);
  }
  try {
    for (const repo of runtime.repositories())
      if (fs.existsSync(repo.root)) restoreProjectHooks(repo.root);
  } finally {
    runtime.close();
  }
  for (const file of state.agentFiles || []) {
    const settings = json(file, {});
    for (const event of Object.keys(settings.hooks || {}))
      settings.hooks[event] = settings.hooks[event]
        .map((g) => ({
          ...g,
          hooks: (g.hooks || []).filter(
            (h) => !h.command?.includes("--dip-hook"),
          ),
        }))
        .filter((g) => g.hooks.length);
    atomic(file, settings);
  }
  if (state.codexConfig && fs.existsSync(state.codexConfig)) {
    const settings = parse(fs.readFileSync(state.codexConfig, "utf8"));
    if (settings.mcp_servers?.dip?.args?.includes(CLI))
      delete settings.mcp_servers.dip;
    if (settings.features?.hooks === true) {
      if (state.previousCodexHooks === null) delete settings.features.hooks;
      else settings.features.hooks = state.previousCodexHooks;
    }
    atomic(state.codexConfig, stringify(settings));
  }
  if (state.claudeConfig) {
    const settings = json(state.claudeConfig, {});
    if (settings.mcpServers?.dip?.args?.includes(CLI))
      delete settings.mcpServers.dip;
    atomic(state.claudeConfig, settings);
  }
  if (
    state.hooksPath &&
    configGit(["--get", "core.hooksPath"], true) === state.hooksPath
  ) {
    if (state.previousHooksPath)
      configGit(["core.hooksPath", state.previousHooksPath]);
    else configGit(["--unset", "core.hooksPath"]);
  }
  for (const file of state.profiles || [])
    if (fs.existsSync(file))
      atomic(
        file,
        fs
          .readFileSync(file, "utf8")
          .replace(/\n?# dip:start[\s\S]*?# dip:end\n?/g, ""),
      );
  if (state.startupFile && fs.existsSync(state.startupFile))
    fs.unlinkSync(state.startupFile);
  atomic(path.join(home(), "install.json"), { ...state, active: false });
  return { uninstalled: true, dataPreserved: true };
}

export function handleHook(
  input,
  agent = "unknown",
  { skipPlanTools = false } = {},
) {
  if (
    skipPlanTools &&
    input.hook_event_name === "PostToolUse" &&
    planningTool(input.tool_name || "")
  )
    return {};
  if (!input.cwd) return {};
  let repo;
  try {
    repo = ensure(input.cwd);
  } catch (e) {
    if (e.message.includes("not inside")) return {};
    throw e;
  }
  const rt = new Runtime();
  try {
    rt.register(repo);
    const worker = input.agent_id || input.subagent_id || input.thread_id;
    const session =
        String(input.session_id || "unknown") +
        (worker ? ":" + String(worker) : ""),
      actor = `${agent}:${session}`;
    const event = input.hook_event_name || "Unknown";
    let active = rt.session(repo, session);
    if (event === "UserPromptSubmit") {
      const requestKey = input.turn_id
        ? `${repo.root}:${actor}:prompt:${input.turn_id}`
        : null;
      const repeated =
        requestKey && active?.task === "task_" + digest(requestKey);
      if (active?.task && !repeated) {
        const lease = rt.db
          .prepare("SELECT * FROM leases WHERE repo=? AND task=?")
          .get(repo.key, active.task);
        if (lease?.actor === actor && lease.expires > Date.now())
          rt.release(repo, active.task, lease.token);
      }
      const prompt = redact(
        promptRequest(input.prompt || input.user_prompt || ""),
      );
      const task = createTask(
        repo,
        {
          title: prompt.trim().slice(0, 160) || "Agent request",
          description: prompt,
          status: "backlog",
          source: "prompt",
        },
        actor,
        requestKey,
      );
      if (!repeated) rt.setSession(repo, session, task, actor, prompt);
      active = rt.session(repo, session);
    }
    const tool = input.tool_name || "",
      toolInput = input.tool_input || {};
    if (
      event === "PreToolUse" &&
      !tool.includes("dip") &&
      !planningTool(tool) &&
      !readingTool(tool) &&
      !(
        /(?:^|[.:])(?:Bash|PowerShell|exec_command|shell_command)$/i.test(
          tool,
        ) && intentCommand(toolInput)
      )
    ) {
      if (!active?.task) {
        const task = createTask(
          repo,
          { title: "Development activity", status: "ready" },
          actor,
        );
        rt.setSession(repo, session, task, actor);
        active = rt.session(repo, session);
      }
      if (!fs.existsSync(path.join(repo.dir, "events", active.task))) {
        const task = createTask(
          repo,
          { title: "Continue development in " + repo.branch, status: "ready" },
          actor,
        );
        rt.setSession(repo, session, task, actor);
        active = rt.session(repo, session);
      }
      const task = taskRead(repo, active.task);
      try {
        let scope = task.scope;
        if (/apply_patch|Write|Edit/.test(tool)) {
          const candidates = documentMutations(tool, toolInput)
            .flatMap((m) => [m.path, m.oldPath])
            .filter(Boolean);
          const inferred = candidates
            .flatMap((p) => {
              try {
                return [
                  projectRelativePath(repo.root, path.resolve(input.cwd, p)),
                ];
              } catch {
                return [];
              }
            })
            .filter(
              (p) =>
                p &&
                !p.startsWith("../") &&
                !path.isAbsolute(p) &&
                !p.startsWith(".dip/"),
            );
          scope = [...new Set([...scope, ...inferred])];
        }
        const lease = rt.claim(repo, active.task, actor, 120000, scope);
        if (input.tool_use_id) {
          const mutations = documentMutations(tool, toolInput)
            .slice(0, 20)
            .flatMap((m) => {
              try {
                return [
                  {
                    ...m,
                    path: documentPath(
                      repo.root,
                      path.resolve(input.cwd, m.path),
                    ),
                    ...(m.oldPath
                      ? {
                          oldPath: documentPath(
                            repo.root,
                            path.resolve(input.cwd, m.oldPath),
                          ),
                        }
                      : {}),
                  },
                ];
              } catch {
                return [];
              }
            });
          rt.db
            .prepare("DELETE FROM document_tools WHERE expires<?")
            .run(Date.now());
          if (mutations.length)
            rt.db
              .prepare(
                "INSERT OR IGNORE INTO document_tools VALUES (?,?,?,?,?,?,?,?)",
              )
              .run(
                repo.root,
                session,
                String(input.tool_use_id),
                active.task,
                actor,
                lease.token,
                JSON.stringify({ tool, mutations }),
                Date.now() + 3600000,
              );
        }
        if (input.tool_use_id && daemonAlive())
          rt.beginTool(
            repo,
            session,
            String(input.tool_use_id),
            active.task,
            lease.token,
            toolInput.timeout_ms ||
              (toolInput.timeout ? Number(toolInput.timeout) * 1000 : 1800000),
          );
        if (JSON.stringify(scope) !== JSON.stringify(task.scope))
          append(repo, active.task, "task.update", { scope }, { actor });
        if (["backlog", "ready"].includes(task.status))
          append(
            repo,
            active.task,
            "task.update",
            { status: "in_progress" },
            { actor },
          );
      } catch (e) {
        if (repo.config.mode !== "observe") {
          rt.enqueue(repo, session, {
            at: new Date().toISOString(),
            kind: "coordination.denied",
            tool,
            agent,
            session,
            taskId: active.task,
            reason: e.message,
          });
          rt.flush(repo.root);
          return {
            hookSpecificOutput: {
              hookEventName: "PreToolUse",
              permissionDecision: "deny",
              permissionDecisionReason: e.message,
            },
          };
        }
      }
    }
    const summary = {
      at: new Date().toISOString(),
      kind: event,
      agent,
      session,
      taskId: active?.task || null,
      tool,
      branch: repo.branch,
    };
    if (
      ["PostToolUse", "PostToolUseFailure"].includes(event) &&
      input.tool_use_id
    ) {
      const binding = rt.db
        .prepare(
          "SELECT * FROM document_tools WHERE root=? AND session=? AND use_id=?",
        )
        .get(repo.root, session, String(input.tool_use_id));
      if (binding) {
        rt.db
          .prepare(
            "DELETE FROM document_tools WHERE root=? AND session=? AND use_id=?",
          )
          .run(repo.root, session, String(input.tool_use_id));
        const response = input.tool_response,
          operation = JSON.parse(binding.mutations);
        const failed =
          response?.isError ||
          response?.is_error ||
          response?.error ||
          (response?.exit_code !== undefined && response.exit_code !== 0);
        if (
          event === "PostToolUse" &&
          !failed &&
          binding.expires > Date.now() &&
          binding.actor === actor &&
          operation.tool === tool
        ) {
          summary.taskId = binding.task;
          summary.documents = [];
          for (const mutation of operation.mutations) {
            if (mutation.removed) continue; // Retain deleted references so readers see missing content.
            try {
              rt.guard(
                repo,
                binding.task,
                actor,
                repo.config.mode === "strict" ? binding.token : undefined,
              );
              const task = taskRead(repo, binding.task);
              const previous = task.documents.filter(
                (d) =>
                  canonicalScope(d.path) ===
                  canonicalScope(mutation.oldPath || mutation.path),
              );
              const roles = previous.length
                ? [...new Set(previous.map((d) => d.role))]
                : [inferredRole(mutation.path)];
              for (const role of roles) {
                const ref = linkDocument(
                  repo,
                  binding.task,
                  { path: mutation.path, role, source: "hook" },
                  actor,
                );
                if (mutation.oldPath && previous.some((d) => d.role === role))
                  unlinkDocument(
                    repo,
                    binding.task,
                    { path: mutation.oldPath, role },
                    actor,
                  );
                summary.documents.push({
                  path: ref.path,
                  role: ref.role,
                  hash: ref.hash,
                });
              }
            } catch {
              summary.documentCaptureSkipped = true;
            }
          }
        }
      }
    }
    if (toolInput.command || toolInput.cmd) {
      const command = String(toolInput.command || toolInput.cmd);
      if (/apply_patch|Edit|Write/.test(tool)) {
        summary.files = [
          ...command.matchAll(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm),
        ].map((m) => m[1]);
        summary.changeHash = digest(command);
      } else summary.command = redact(command).slice(0, 2000);
    }
    if (/plan|task|todo/i.test(tool) && !tool.includes("dip"))
      summary.plan = redact(JSON.stringify(toolInput));
    if (
      event === "PostToolUse" &&
      planningTool(tool) &&
      !input.tool_response?.isError &&
      !input.tool_response?.is_error
    ) {
      if (!active?.task) {
        const task = createTask(repo, { title: "Development plan" }, actor);
        rt.setSession(repo, session, task, actor);
        active = rt.session(repo, session);
        summary.taskId = active.task;
      }
      append(
        repo,
        active.task,
        "task.plan",
        {
          tool,
          input: JSON.parse(redact(JSON.stringify(planInput(tool, toolInput)))),
        },
        {
          actor,
          ...(input.tool_use_id
            ? {
                eventId: digest(`${actor}:plan:${input.tool_use_id}`),
              }
            : {}),
        },
      );
    }
    if (toolInput.file_path || toolInput.path)
      summary.path = redact(toolInput.file_path || toolInput.path);
    if (input.tool_response?.exit_code !== undefined)
      summary.exitCode = input.tool_response.exit_code;
    if (summary.path && sensitive(summary.path))
      summary.path = "[sensitive file]";
    const unique = input.tool_use_id
      ? `${agent}:${session}:${event}:${input.tool_use_id}`
      : event === "UserPromptSubmit" && input.turn_id
        ? `${actor}:prompt:${input.turn_id}`
        : id();
    if (
      ["PostToolUse", "PostToolUseFailure"].includes(event) &&
      input.tool_use_id
    )
      rt.endTool(repo, session, String(input.tool_use_id));
    rt.enqueue(repo, session, summary, unique);
    if (
      ["Stop", "SessionEnd", "PreCompact", "Interrupt", "StopFailure"].includes(
        event,
      )
    ) {
      if (active?.task)
        append(
          repo,
          active.task,
          "task.checkpoint",
          {
            summary:
              "Automatic checkpoint: agent paused; see activity and working tree. Completion has not been asserted.",
            automatic: true,
            head: repo.head,
          },
          { actor },
        );
      rt.endSessionTools(repo, session);
      rt.flush(repo.root);
      if (
        ["Stop", "SessionEnd", "Interrupt", "StopFailure"].includes(event) &&
        active?.task
      ) {
        const lease = rt.db
          .prepare("SELECT * FROM leases WHERE repo=? AND task=? AND actor=?")
          .get(repo.key, active?.task, actor);
        if (lease && lease.expires > Date.now())
          rt.release(repo, lease.task, lease.token);
      }
    }
    // Without a running daemon, every hook persists its queue immediately; no data depends on process lifetime.
    if (!daemonAlive()) rt.flush(repo.root);
    if (event === "UserPromptSubmit")
      return {
        hookSpecificOutput: {
          hookEventName: "UserPromptSubmit",
          additionalContext: JSON.stringify({
            task_id: active.task,
            actor,
            session_id: session,
            instructions:
              "This request is already saved in DIP. Refine this task with task_update instead of creating a duplicate. Keep future ideas in backlog. Structured update_plan/TodoWrite calls are captured automatically; save a prose-only plan with task_plan. Claim with this actor/session only when starting development. Split distinct requirements with task_create as needed; do not call another model for tracking.",
          }),
        },
      };
    if (event === "SessionStart")
      return {
        hookSpecificOutput: {
          hookEventName: "SessionStart",
          additionalContext: JSON.stringify({
            ...compactContext(repo, rt),
            session_id: session,
            actor,
            task_id: active?.task || null,
          }),
        },
      };
    return {};
  } finally {
    rt.close();
  }
}
export function handleGitHook(name, cwd = process.cwd()) {
  const repo = ensure(cwd),
    rt = new Runtime();
  try {
    rt.register(repo);
    rt.enqueue(repo, "git", {
      at: new Date().toISOString(),
      kind: `git.${name}`,
      head: repo.head,
      branch: repo.branch,
      agent: "git",
    });
    rt.flush(repo.root);
    if (rt.lastFlushErrors.length && ["pre-commit", "pre-push"].includes(name))
      throw new Error(
        "DIP outbox could not be persisted; run dip doctor and repair the reported project before publishing",
      );
    if (name === "pre-commit") git(repo.root, ["add", "--", ".dip"]);
    return { recorded: name };
  } finally {
    rt.close();
  }
}
export function afterGit(args, cwd = process.cwd()) {
  let base = cwd,
    index = 0;
  while (index < args.length) {
    if (args[index] === "-C") {
      base = path.resolve(base, args[index + 1]);
      index += 2;
    } else if (args[index] === "-c") {
      index += 2;
    } else break;
  }
  const command = args[index++],
    rest = args.slice(index);
  let target = base;
  if (command === "init") {
    if (rest.includes("--bare")) return { bare: true };
    const positional = [];
    for (let n = 0; n < rest.length; n++) {
      if (
        [
          "--template",
          "--initial-branch",
          "-b",
          "--object-format",
          "--ref-format",
          "--separate-git-dir",
        ].includes(rest[n])
      )
        n++;
      else if (!rest[n].startsWith("-")) positional.push(rest[n]);
    }
    if (positional.length) target = path.resolve(base, positional.at(-1));
  } else if (command === "clone") {
    if (rest.includes("--bare") || rest.includes("--mirror"))
      return { bare: true };
    const positional = [];
    for (let n = 0; n < rest.length; n++) {
      if (
        [
          "--branch",
          "-b",
          "--depth",
          "--origin",
          "-o",
          "--reference",
          "--reference-if-able",
          "--template",
          "--separate-git-dir",
          "--filter",
          "--config",
          "-c",
          "--upload-pack",
          "-u",
          "--shallow-since",
          "--shallow-exclude",
          "--jobs",
          "-j",
        ].includes(rest[n])
      )
        n++;
      else if (!rest[n].startsWith("-")) positional.push(rest[n]);
    }
    if (!positional.length) throw new Error("Clone source not found");
    target = path.resolve(
      base,
      positional[1] ||
        positional[0]
          .replace(/[\\/]$/, "")
          .split(/[\\/:]/)
          .at(-1)
          .replace(/\.git$/, ""),
    );
  }
  return handleGitHook(`after-${command}`, target);
}
const excluded = new Set([
  "node_modules",
  ".git",
  ".codex",
  ".claude",
  ".cache",
  "AppData",
  "Library",
  ".dip",
  "vendor",
  "venv",
  ".venv",
  "dist",
  "build",
  "coverage",
  "$RECYCLE.BIN",
  "Windows",
  "Program Files",
  "Program Files (x86)",
]);
export function scan(roots, limit = 100000) {
  const result = { initialized: [], errors: [] },
    rt = new Runtime(),
    stack = [...roots],
    visited = new Set();
  let count = 0;
  try {
    while (stack.length && count++ < limit) {
      const folder = stack.pop();
      if (visited.has(folder)) continue;
      visited.add(folder);
      let entries;
      try {
        entries = fs.readdirSync(folder, { withFileTypes: true });
      } catch {
        continue;
      }
      if (entries.some((e) => e.name === ".git")) {
        try {
          const repo = ensure(folder);
          rt.register(repo);
          result.initialized.push(repo.root);
        } catch (e) {
          result.errors.push({ root: folder, error: e.message });
        }
      }
      for (const entry of entries)
        if (
          entry.isDirectory() &&
          !entry.isSymbolicLink() &&
          !excluded.has(entry.name) &&
          (!entry.name.startsWith(".") || entry.name === ".config")
        )
          stack.push(path.join(folder, entry.name));
    }
    if (stack.length)
      result.errors.push({
        error:
          "Discovery budget reached; add narrower roots or increase scan limit",
      });
    return result;
  } finally {
    rt.close();
  }
}
export function daemonAlive() {
  const state = json(path.join(home(), "daemon.json"), null);
  if (!state?.pid) return false;
  try {
    process.kill(state.pid, 0);
    return Date.now() - state.heartbeat < 15000;
  } catch {
    return false;
  }
}
function processAlive(pid) {
  if (!Number.isInteger(pid) || pid < 1) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
export function recordablePath(root, name) {
  const file = String(name || "").replaceAll("\\", "/");
  const parts = file.split("/");
  const relativeRuntime = path.relative(home(), path.resolve(root, file));
  return (
    !!file &&
    !parts.some((p) =>
      [
        ".git",
        ".dip",
        ".dip-local",
        "node_modules",
        ".venv",
        "venv",
        "target",
        "dist",
        "build",
        "coverage",
        "__pycache__",
        ".next",
        ".nuxt",
        ".turbo",
      ].includes(p),
    ) &&
    !sensitive(file) &&
    (relativeRuntime.startsWith(".." + path.sep) ||
      relativeRuntime === ".." ||
      path.isAbsolute(relativeRuntime))
  );
}
export function startDaemon() {
  if (daemonAlive()) return { running: true, alreadyRunning: true };
  const owner = json(path.join(home(), "daemon.lock", "owner.json"), null);
  if (owner?.pid && processAlive(owner.pid))
    return {
      running: true,
      unhealthy: true,
      pid: owner.pid,
      message:
        "Recorder process exists but its heartbeat is stale; run dip stop then dip start",
    };
  const file = path.join(home(), "daemon.log");
  fs.mkdirSync(home(), { recursive: true });
  const log = fs.openSync(file, "a");
  const child = spawn(
    process.execPath,
    ["--disable-warning=ExperimentalWarning", CLI, "daemon"],
    {
      detached: true,
      windowsHide: true,
      stdio: ["ignore", log, log],
      env: process.env,
    },
  );
  child.unref();
  fs.closeSync(log);
  atomic(path.join(home(), "daemon.json"), {
    pid: child.pid,
    heartbeat: Date.now(),
    starting: true,
  });
  return { started: true, pid: child.pid };
}
export function stopDaemon() {
  const file = path.join(home(), "daemon.json"),
    state = json(file, null);
  if (!state?.pid || !processAlive(state.pid)) return { stopped: true };
  atomic(path.join(home(), "stop-request.json"), {
    pid: state.pid,
    instance: state.instance,
    at: Date.now(),
  });
  const until = Date.now() + 4000;
  const sleeper = new Int32Array(new SharedArrayBuffer(4));
  while (
    processAlive(state.pid) &&
    json(file, null)?.pid === state.pid &&
    Date.now() < until
  )
    Atomics.wait(sleeper, 0, 0, 50);
  if (processAlive(state.pid) && json(file, null)?.pid === state.pid) {
    try {
      process.kill(state.pid);
    } catch {}
    return { stopped: true, forced: true, outboxPreserved: true };
  }
  return { stopped: true, graceful: true };
}
export async function runDaemon() {
  const lock = path.join(home(), "daemon.lock");
  fs.mkdirSync(home(), { recursive: true });
  try {
    fs.mkdirSync(lock);
  } catch (e) {
    const owner = json(path.join(lock, "owner.json"), null);
    if (owner?.pid && processAlive(owner.pid)) return;
    try {
      if (fs.existsSync(path.join(lock, "owner.json")))
        fs.unlinkSync(path.join(lock, "owner.json"));
      fs.rmdirSync(lock);
      fs.mkdirSync(lock);
    } catch {
      return;
    }
  }
  const instance = id();
  atomic(path.join(lock, "owner.json"), { pid: process.pid, instance });
  const rt = new Runtime(),
    watchers = new Map(),
    pending = new Map(),
    rootWatchers = [];
  const state = json(path.join(home(), "install.json"), {
    roots: [USER_HOME()],
  });
  const nativeGit = state.gitDiscovery?.enabled ? new GitDiscovery(rt) : null;
  const attach = () => {
    const roots = new Set(rt.repositories().map((r) => r.root));
    for (const [root, watcher] of watchers)
      if (!roots.has(root) || !fs.existsSync(root)) {
        watcher.close();
        watchers.delete(root);
        pending.delete(root);
      }
    for (const registered of rt.repositories()) {
      if (watchers.has(registered.root) || !fs.existsSync(registered.root))
        continue;
      try {
        watchers.set(
          registered.root,
          fs.watch(registered.root, { recursive: true }, (event, filename) => {
            const file = String(filename || "").replaceAll("\\", "/");
            if (!recordablePath(registered.root, file)) return;
            if (!pending.has(registered.root))
              pending.set(registered.root, new Set());
            pending.get(registered.root).add(file);
          }),
        );
      } catch (e) {
        console.error(`Watcher ${registered.root}: ${e.message}`);
      }
    }
  };
  const discover = () => {
    const result = scan(state.roots);
    for (const e of result.errors) console.error(JSON.stringify(e));
    attach();
  };
  let scheduled = null;
  const discoveryCandidates = new Set();
  for (const root of state.roots)
    try {
      rootWatchers.push(
        fs.watch(root, { recursive: true }, (event, name) => {
          const value = String(name || "").replaceAll("\\", "/");
          if (
            !value ||
            value
              .split("/")
              .some(
                (p) => p !== ".git" && (excluded.has(p) || p === ".dip-local"),
              ) ||
            !recordablePath(
              root,
              value.replace(/(^|\/)\.git(?=\/|$)/, "$1git-marker"),
            )
          )
            return;
          const segments = value.split("/"),
            gitIndex = segments.indexOf(".git");
          let candidate;
          if (gitIndex >= 0) {
            candidate = path.resolve(root, ...segments.slice(0, gitIndex));
            if (watchers.has(candidate)) return;
          } else if (event === "rename") {
            const changed = path.resolve(root, value);
            if (
              [...watchers.keys()].some(
                (p) => changed === p || changed.startsWith(p + path.sep),
              )
            )
              return;
            try {
              if (fs.statSync(changed).isDirectory()) candidate = changed;
            } catch {}
          }
          if (!candidate) return;
          discoveryCandidates.add(candidate);
          clearTimeout(scheduled);
          scheduled = setTimeout(() => {
            const result = scan([...discoveryCandidates]);
            discoveryCandidates.clear();
            for (const e of result.errors) console.error(JSON.stringify(e));
            attach();
          }, 1000);
        }),
      );
    } catch (e) {
      console.error(
        `Root watcher unavailable for ${root}: ${e.message}; periodic discovery remains enabled`,
      );
    }
  atomic(path.join(home(), "daemon.json"), {
    pid: process.pid,
    instance,
    heartbeat: Date.now(),
  });
  discover();
  const { createServer } = await import("./server.js");
  const dashboard = createServer({
    root: rt.repositories()[0]?.root || USER_HOME(),
    port: state.port ?? 4317,
  });
  let dashboardUrl = null,
    lastError = null;
  dashboard.on("error", (e) => {
    lastError = `Dashboard: ${e.message}`;
    if (e.code === "EADDRINUSE") dashboard.listen(0, "127.0.0.1");
    else console.error(lastError);
  });
  dashboard.on("listening", () => {
    dashboardUrl = `http://127.0.0.1:${dashboard.address().port}`;
  });
  const flushPending = () => {
    try {
      if (nativeGit) {
        const discovery = nativeGit.drain();
        if (discovery.errors.length)
          lastError = discovery.errors.map((e) => e.error).join("; ");
      }
      rt.renewRunningTools();
      for (const [root, files] of pending) {
        if (!files.size) continue;
        let repo;
        try {
          repo = ensure(root, { instructions: false });
        } catch (e) {
          repo = { root, branch: "unavailable" };
          lastError = redact(e.message);
        }
        rt.enqueue(repo, "filesystem", {
          at: new Date().toISOString(),
          kind: "files.changed",
          files: [...files],
          agent: "filesystem",
          branch: repo.branch,
        });
        pending.delete(root);
      }
      rt.flush();
      if (rt.lastFlushErrors.length)
        lastError = rt.lastFlushErrors.map((e) => e.error).join("; ");
      attach();
      atomic(path.join(home(), "daemon.json"), {
        pid: process.pid,
        instance,
        heartbeat: Date.now(),
        dashboard: dashboardUrl,
        watchedRepositories: [...watchers.keys()],
        watchedRoots: state.roots,
        lastError,
      });
    } catch (e) {
      console.error(e.stack);
      lastError = redact(e.message);
    }
  };
  const timer = setInterval(() => {
    flushPending();
    const request = json(path.join(home(), "stop-request.json"), null);
    if (
      request?.pid === process.pid &&
      (!request.instance || request.instance === instance)
    )
      cleanup();
  }, 1000);
  const periodic = setInterval(discover, 60000);
  const cleanup = () => {
    clearInterval(timer);
    clearInterval(periodic);
    clearTimeout(scheduled);
    dashboard.close();
    for (const w of [...watchers.values(), ...rootWatchers]) w.close();
    try {
      flushPending();
      rt.flush();
    } catch {}
    rt.close();
    try {
      fs.unlinkSync(path.join(lock, "owner.json"));
      fs.rmdirSync(lock);
    } catch {}
    const request = path.join(home(), "stop-request.json");
    if (json(request, null)?.pid === process.pid) fs.unlinkSync(request);
    if (json(path.join(home(), "daemon.json"), null)?.instance === instance)
      atomic(path.join(home(), "daemon.json"), {
        pid: null,
        stoppedAt: Date.now(),
      });
    process.exit(0);
  };
  process.on("SIGTERM", cleanup);
  process.on("SIGINT", cleanup);
}
