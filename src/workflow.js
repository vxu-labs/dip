// Only known structured plan tools are promoted; unrelated task tools remain activity.
export const planningTool = (name) =>
  /(?:^|[.:])(?:update_plan|TodoWrite|ExitPlanMode)$/i.test(name);

export function promptRequest(raw) {
  const text = String(raw || "");
  const wrapper =
    /^<in-app-browser-context\s+source=["']ambient-ui-state["']>[\s\S]*?<\/in-app-browser-context>\s*## My request:[ \t]*\r?\n([\s\S]*)$/;
  const match = wrapper.exec(text.trimStart());
  return match ? match[1] : text;
}

// Recognize the observed host template only; ordinary questions still require
// classification by the current agent. Quoted reports must not match.
export function capturedKind(prompt) {
  return /^# Overview\r?\n\s*Generate 0 to 3 hyperpersonalized suggestions for what this user can do with Codex in this local project: [^\r\n]+(?:\r?\n|$)/.test(
    prompt.trimStart(),
  )
    ? "discussion"
    : "work";
}

export function validateRemaining(remaining) {
  if (remaining === undefined) return;
  if (
    !Array.isArray(remaining) ||
    remaining.length > 20 ||
    remaining.some(
      (item) =>
        !item ||
        ![
          "required",
          "follow_up",
          "verification_limit",
          "out_of_scope",
        ].includes(item.disposition) ||
        typeof item.summary !== "string" ||
        !item.summary.trim() ||
        item.summary.length > 1000 ||
        (item.taskId !== undefined &&
          (typeof item.taskId !== "string" || !/^[\w-]+$/.test(item.taskId))) ||
        (item.disposition === "follow_up" && !item.taskId) ||
        (item.disposition !== "follow_up" && item.taskId !== undefined),
    )
  )
    throw new Error(
      "Invalid remaining-work review: follow_up requires a taskId; omit taskId for required, verification_limit and out_of_scope. Use up to 20 items with nonempty summaries of at most 1000 characters.",
    );
}

export function verificationDetails(evidence) {
  if (!evidence) return null;
  const command = evidence.command || [];
  return {
    check: evidence.check,
    result: evidence.result,
    at: evidence.at,
    command: command.slice(0, 20).map((arg) => arg.slice(0, 500)),
    commandTruncated:
      command.length > 20 || command.some((arg) => arg.length > 500),
    runner: evidence.runner || null,
    meaning:
      "Evidence covers this configured command and snapshot only. Runner identifies the local process, not an emulator or physical device. Device coverage and acceptance coverage are not inferred; Git integration is separate.",
  };
}

export function planInput(tool, input) {
  if (/(?:^|[.:])ExitPlanMode$/i.test(tool) && typeof input.plan === "string") {
    const { plan, ...rest } = input;
    return { ...rest, text: plan };
  }
  return input;
}

export const readingTool = (name) =>
  /(?:^|[.:])(?:Read|Glob|Grep|read_file|list_files)$/i.test(name);

// Status classification only: unknown shell syntax still takes the coordination path.
// Conservative single-command grammar. Metacharacters, expansion, escapes and
// executable options (rg --pre, git -c, external diff) never enter this path.
export function readingCommand(input) {
  const command = String(input.command || input.cmd || "").trim();
  // Preserve the literal PowerShell read grammar (backslashes are path separators).
  if (
    !/[;&|\n\r`<>$(){}]/.test(command) &&
    /^Get-Content\s+(?:(?:-LiteralPath|-Path)\s+)?(?:"[^"\r\n]+"|'[^'\r\n]+'|[^\s"'\-]+)(?:\s+(?:-Raw|-(?:TotalCount|Tail)\s+\d+))?$/i.test(
      command,
    )
  )
    return true;
  if (!command || /[;&|\n\r`<>$(){}\\]/.test(command)) return false;
  const tokens = command.match(/"[^"\r\n]*"|'[^'\r\n]*'|[^\s"']+/g) || [];
  if (tokens.join(" ") !== command.replace(/\s+/g, " ")) return false;
  const args = tokens.map((s) => (/^['"]/.test(s) ? s.slice(1, -1) : s));
  const name = args.shift();
  const allowed = {
    cat: new Set(["-n", "-b", "-s", "--"]),
    head: new Set(["-n", "-c", "--"]),
    tail: new Set(["-n", "-c", "--"]),
    rg: new Set([
      "--files",
      "-n",
      "--line-number",
      "-l",
      "--files-with-matches",
      "-i",
      "--ignore-case",
      "-F",
      "--fixed-strings",
      "-g",
      "--glob",
      "--hidden",
      "--no-ignore",
      "--count",
      "-c",
      "--",
      "-e",
      "--regexp",
      "-m",
      "--max-count",
    ]),
    ls: new Set(["-l", "-a", "-la", "-al", "-lh", "-lah", "-1", "--"]),
    pwd: new Set(["-L", "-P"]),
  };
  if (name === "git")
    return (
      ["status", "ls-files", "rev-parse"].includes(args[0]) &&
      args
        .slice(1)
        .every(
          (a) =>
            !a.startsWith("-") ||
            [
              "--short",
              "--porcelain",
              "--porcelain=v1",
              "--porcelain=v2",
              "--branch",
              "--untracked-files=no",
              "--cached",
              "--others",
              "--exclude-standard",
              "--show-toplevel",
              "--show-prefix",
              "--git-dir",
              "--abbrev-ref",
              "--verify",
              "--",
              "-z",
            ].includes(a),
        )
    );
  if (!allowed[name]) return false;
  return args.every(
    (a) => !a.startsWith("-") || allowed[name].has(a) || /^-[0-9]+$/.test(a),
  );
}

export function intentCommand(input) {
  const command = String(input.command || input.cmd || "")
    .trim()
    .replace(/^&\s+/, "");
  // Recognize only a standalone DIP CLI action; compound commands retain coordination.
  if (/[;&|\n\r`]/.test(command) || command.includes("$(")) return false;
  const launcher =
    /^(?:dip(?:\.cmd|\.ps1)?|["'][^"']*[/\\]dip(?:\.cmd|\.ps1)["'])\s+/i;
  const args = command.replace(launcher, "");
  if (args === command) return false;
  return /^(?:context|status|reconcile|doctor|init|capture|search|owners|repository|discover-project|task\s+(?:create|get|next|update|prepare|adopt|finish|plan|checkpoint|decision|claim|release|heartbeat|verify|requirements|changes|related|document-(?:link|unlink|list|read)))(?:\s|$)/.test(
    args,
  );
}

export function planSteps(input) {
  const entries = input?.plan || input?.todos || input?.steps;
  if (!Array.isArray(entries)) return [];
  return entries.map((entry) => ({
    step: String(entry?.step || entry?.content || entry?.title || ""),
    status: String(entry?.status || "pending"),
  }));
}

export function briefPlan(plan) {
  if (!plan) return null;
  const steps = planSteps(plan.input);
  return {
    tool: plan.tool,
    at: plan.at,
    stepCount: steps.length,
    completed: steps.filter((s) => s.status === "completed").length,
    steps: steps
      .slice(0, 20)
      .map((s) => ({ ...s, step: s.step.slice(0, 500) })),
    truncated: steps.length > 20 || steps.some((s) => s.step.length > 500),
    ...(plan.input?.text
      ? {
          text: plan.input.text.slice(0, 2000),
          textTruncated: plan.input.text.length > 2000,
        }
      : {}),
    evidence:
      "Agent-reported plan progress; use configured verification for completion.",
  };
}

export function planIntent(plan) {
  if (!plan) return null;
  const steps = planSteps(plan.input);
  return steps.length
    ? steps.map((s) => s.step)
    : plan.input.text || plan.input;
}
