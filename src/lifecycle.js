// Host activity is evidence of activity, never evidence that intent was fulfilled.
export const lifecycleStates = new Set([
  "running",
  "response_recorded",
  "stopped",
  "interrupted",
  "failed",
  "compacted",
  "paused",
]);

export function endObservation(input, previous) {
  const event = input.hook_event_name;
  const state =
    event === "Interrupt"
      ? "interrupted"
      : event === "StopFailure"
        ? "failed"
        : event === "PreCompact"
          ? "compacted"
          : previous?.state === "paused"
            ? "paused"
            : event === "SessionEnd" &&
                ["response_recorded", "interrupted", "failed"].includes(
                  previous?.state,
                )
              ? previous.state
              : event === "Stop" &&
                  typeof input.last_assistant_message === "string" &&
                  input.last_assistant_message.trim()
                ? "response_recorded"
                : "stopped";
  return {
    state,
    event,
    source: "hook",
    ...(input.turn_id ? { turnId: String(input.turn_id).slice(0, 200) } : {}),
    // Do not duplicate response prose or parse it as a completion assertion.
  };
}

export function activityState(task) {
  if (task.active) return "running";
  if (task.status !== "in_progress")
    return task.requestState === "captured" &&
      task.lifecycle?.state === "response_recorded" &&
      ["backlog", "ready"].includes(task.status)
      ? "responded"
      : null;
  const state = task.lifecycle?.state;
  if (state === "interrupted" || state === "failed") return "interrupted";
  if (state === "response_recorded") return "responded";
  if (state === "paused") return "paused";
  return "inactive";
}
