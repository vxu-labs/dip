export function cliHelp(command = "help", action = "") {
  const specific = {
    create:
      'dip task create --title "..." [--description "..."] [--status backlog|ready] [--scope PATH] [--actor NAME]\n',
    get: "dip task get --id ID [--full]\n",
    finish:
      'dip task finish --id ID --outcome answered|implemented|superseded|cancelled --summary "..." [--check NAME] [--replacedBy ID] [--actor NAME] [--token TOKEN]\n',
    requirements:
      "dip task requirements --id ID [--limit 10] [--offset 0] [--maxChars 6000]\n",
    changes: "dip task changes --id ID [--limit 10] [--offset 0]\n",
    related: "dip task related --id ID [--statuses backlog] [--limit 10]\n",
    update:
      'dip task update --id ID --patch \'{"title":"...","status":"backlog"}\' [--actor NAME] [--token TOKEN]\n',
    plan: 'dip task plan --id ID --text "..." [--actor NAME] [--token TOKEN]\n',
    "document-link":
      "dip task document-link --id ID --path plans/feature.md --role plan [--actor NAME] [--token TOKEN]\n",
    "document-unlink":
      "dip task document-unlink --id ID --path plans/feature.md --role plan [--actor NAME] [--token TOKEN]\n",
    "document-list":
      "dip task document-list --id ID [--limit 30] [--offset 0]\n",
    "document-read":
      'dip task document-read --id ID --path plans/feature.md --role plan [--heading "Validation"] [--query "Unicode"] [--maxChars 12000] [--expectedHash SHA256]\n',
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
    `dip task requirements --id ID   Current requirements and source freshness\n` +
    `dip task changes --id ID        Changes since latest verification\n` +
    `dip task related --id ID        Explicit task relationships\n` +
    `dip search --query WORDS        Indexed task and decision candidates\n` +
    `dip owners --path src/module    Current local component ownership\n` +
    `dip task plan --id ID --text X  Save a plan when hooks are unavailable\n` +
    `dip task document-link --id ID --path FILE.md --role plan\n` +
    `dip task document-list --id ID  Inspect linked document versions\n` +
    `dip task document-read --id ID --path FILE.md --role plan\n` +
    `dip task update --id ID --patch JSON\n` +
    `dip task finish --id ID --outcome answered --summary X\n` +
    `dip task claim --id ID --actor NAME\n` +
    `dip task checkpoint --id ID --summary X\n` +
    `dip task verify --id ID --check NAME\n` +
    `dip reconcile [--kind work] [--open] [--statuses backlog] [--limit 30] [--offset 0]\n` +
    `dip reconcile --full            Explicit raw task/activity diagnostics\n` +
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
