// Only known structured plan tools are promoted; unrelated task tools remain activity.
export const planningTool = (name) =>
  /(?:^|[.:])(?:update_plan|TodoWrite)$/i.test(name);

export const readingTool = (name) =>
  /(?:^|[.:])(?:Read|Glob|Grep|read_file|list_files)$/i.test(name);

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
