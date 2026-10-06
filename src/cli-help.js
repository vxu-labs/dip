export function cliHelp(command = "help", action = "") {
  const specific = {
    create:
      'dip task create --title "..." [--description "..."] [--status backlog|ready] [--scope PATH] [--actor NAME]\n',
    get: "dip task get --id ID\n",
    update:
      'dip task update --id ID --patch \'{"title":"...","status":"backlog"}\' [--actor NAME] [--token TOKEN]\n',
    plan: 'dip task plan --id ID --text "..." [--actor NAME] [--token TOKEN]\n',
    checkpoint:
      'dip task checkpoint --id ID --summary "..." [--next "..."] [--actor NAME]\n',
    claim:
      "dip task claim --id ID --actor NAME [--session SESSION] [--scope PATH] [--waitMs 30000]\n",
    verify: "dip task verify --id ID --check NAME [--actor NAME]\n",
  };
  const header =
    command === "task" && specific[action] ? specific[action] + "\n" : "";
  return (
    header +
    `DIP: persistent project intent and automatic activity\n\n` +
    `dip install [--roots PATH]     One-time machine integration\n` +
    `dip context                    Compact handoff; no activity dump\n` +
    `dip status [--limit 30]         Compact tasks and capture counts\n` +
    `dip status --full              Full task/activity history\n` +
    `dip task create --title X       Save a distinct task or future idea\n` +
    `dip task get --id ID            Read one requirement\n` +
    `dip task plan --id ID --text X  Save a plan when hooks are unavailable\n` +
    `dip task update --id ID --patch JSON\n` +
    `dip task claim --id ID --actor NAME\n` +
    `dip task checkpoint --id ID --summary X\n` +
    `dip task verify --id ID --check NAME\n` +
    `dip reconcile                  Check evidence against current code\n` +
    `dip doctor                     Inspect actual capture coverage\n` +
    `dip init | serve | start | stop | uninstall\n\n` +
    `Use --root PATH for another project. Task commands accept --help.\n` +
    `Requires Node.js 24+. No additional model calls for capture.\n`
  );
}

export function compactStatus(state, limit = 30, offset = 0) {
  if (
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 100 ||
    !Number.isInteger(offset) ||
    offset < 0
  )
    throw new Error(
      "limit must be 1..100; offset must be a nonnegative integer",
    );
  return {
    repo: state.repo,
    totalTasks: state.tasks.length,
    nextOffset: state.tasks.length > offset + limit ? offset + limit : null,
    tasks: state.tasks.slice(offset, offset + limit).map((t) => ({
      id: t.id,
      title: t.title,
      status: t.status,
      scope: t.scope,
      active: t.active,
      interrupted: t.interrupted,
    })),
    activeWorkers: state.activeWorkers.slice(0, 20),
    workerCount: state.activeWorkers.length,
    activityRecords: state.activity.length,
    lastActivityAt: state.activity[0]?.at || null,
    errors: state.errors,
    instructions:
      "Use task get for one requirement; reconcile for current verification; --full for raw history.",
  };
}
