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

export function planInput(tool, input) {
  if (/(?:^|[.:])ExitPlanMode$/i.test(tool) && typeof input.plan === "string") {
    const { plan, ...rest } = input;
    return { ...rest, text: plan };
  }
  return input;
}

export const readingTool = (name) =>
  /(?:^|[.:])(?:Read|Glob|Grep|read_file|list_files)$/i.test(name);

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
  return /^(?:context|status|reconcile|doctor|init|search|owners|task\s+(?:create|get|next|update|finish|plan|checkpoint|decision|claim|release|heartbeat|verify|requirements|changes|related|document-(?:link|unlink|list|read)))(?:\s|$)/.test(
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
