# Development Intelligence Platform

**Your session ends. Your project remembers.**

[Product overview](https://vxu.me/products/dip) · [Launch story](https://vxu.me/blog/introducing-dip) · [Find your first contribution](https://github.com/vxu-labs/dip/contribute)

You ask your agent to remember a feature for later. A migration stops halfway through. A new session opens, and you need to know what was finished and what still needs work.

**DIP keeps that development memory in your repository.** Plans, future ideas, handoffs, task ownership and verification evidence live in **`.dip/`** and travel with your code through Git.

Your coding agent supplies the intent. DIP's automatic capture makes **no model calls**. Planning and task management use your agent's normal tool loop and add measurable overhead.

## What you get

Explicit [outcome receipts](docs/completion.md) distinguish answered questions, implemented work and verified code. Development views keep discussions separate; compact task reads expose the current handoff without dumping event history. [Our completion audit](docs/completion-audit.md) shows what was already delivered and what remains unfinished.

**Keep useful intent even on a machine without global DIP.** Projects now carry discoverable agent skills and a reviewed, dependency-free [portable intent helper](docs/portable.md). [Follow-up adoption](docs/intent-transitions.md) lets the existing agent select an earlier requirement, update its intent and retire the captured duplicate in one operation. Independent Git-library clients can use an [explicit discovery callback](docs/client-discovery.md).

- **A useful next session.** Pick up unfinished work with saved requirements, decisions and a handoff that explains the next step.
- **A backlog that survives the chat.** Keep "add CSV export later" beside the project and find it when you are ready to build it.
- **Clear ownership for parallel agents.** See who owns a task and its declared scope across local worktrees, and wait for conflicting work to be released.
- **Completion you can check.** Run configured checks against the code and requirements. Earlier evidence becomes stale when the relevant inputs change.
- **Automatic project adoption.** Install once. Compatible native Git commands, including `git status`, let the running recorder adopt projects outside watched folders.

**Local-first. Apache-2.0. Works with Codex and Claude Code.** DIP requires Node.js 24+ and enabled, trusted agent hooks. Live coordination covers one Git worktree family on one machine. See [automation coverage](docs/automation.md), [operations and recovery](docs/operations.md), and [adapter verification](docs/compatibility.md) for supported behavior and QA boundaries.

**Experimental software. Use at your own risk.** You are responsible for reviewing agent actions, hook permissions, backups and captured `.dip` data before committing or publishing it. Redaction does not guarantee that every secret or private detail is removed. See the [Apache-2.0 license](LICENSE) for warranty and liability terms.

**Control what gets recorded.** Per-project `dip capture` settings can omit request text, automatic plans, commands or file metadata. Explicit intent tools stay available. A bounded local supervisor restarts a crashed recorder, respects deliberate stops and reports observation gaps through `dip doctor`. [Privacy controls, retention and recovery limits](docs/operations.md).

**Tested with a real agent.** [Live Codex QA](docs/host-qa/README.md) saved future plans, recovered intent through CLI in a new session, and verified actual compaction and interruption hooks. DIP's explicit structured planning tool retained three pending steps and a distinct future idea in backlog. Original failed trials are preserved. Automatic native planning and live Claude remain open; this is integration evidence, not a quality or speedup claim.

## Install once

```sh
npm install -g github:vxu-labs/dip
dip install
```

The installer merges global Codex and Claude Code hooks/MCP configuration, chains existing Git hooks, initializes existing repositories under your home directory, and starts a local discovery/activity service. It adds startup entries and terminal-profile integration. Restart your coding tools and terminal and approve the hook definitions when your agent asks. It never bypasses the agent's trust settings.

Ask naturally for a plan, a feature or a future idea. Trusted hooks save the request and delivered native plan updates; the agent receives the captured task ID so it can refine the existing requirement. If its host exposes no native planning tool, it saves steps explicitly through DIP `task_plan`. Future ideas stay in backlog during planning and known read tools. Write a long plan once in Markdown: supported file-write hooks attach a small versioned reference to its task, and DIP tools retrieve the relevant sections. Status, ownership and verification stay structured. The dashboard and `dip doctor` show whether prompt capture has actually been observed in the selected project. See [document references](docs/documents.md) and [workflow coverage](docs/automation.md#requests-plans-and-future-ideas).

Ask DIP for current requirements, live component owners, changes since verification, or related tasks and decisions. Focused tools return bounded structured answers with source IDs; a local incremental search index keeps activity history out of the agent's context. Retrieval currently uses lexical search and explicit task relationships. [Agent navigation tools and limits](docs/navigation.md).

![DIP local project dashboard](docs/images/dashboard.png)

Native Git discovery also adopts existing repositories outside watched roots when compatible Git opens them, including on `git status` or `git diff`, without a shell profile. The running recorder processes this native signal shortly after the command completes. See [native discovery and its boundaries](docs/git-discovery.md).

New `git init` and `git clone` commands in integrated shells initialize DIP immediately, including outside watched roots. Git hooks and agent session entry initialize existing repositories on first use. Background discovery handles repositories created by other apps under monitored roots. Add external project directories or mounted drives:

```sh
dip install --roots ~/projects --roots /mnt/projects
```

Use explicit Windows paths in PowerShell, for example `--roots 'D:\Projects'`. The dashboard starts automatically at **http://127.0.0.1:4317**. It includes a project selector, work board, live activity, task details, checkpoints and evidence. Nothing is sent to a cloud service.

For a single project without machine configuration:

```sh
cd your-project
dip init
dip serve
```

## How an agent uses it

Session hooks inject a compact context with outstanding work and a stable actor/session identity. Prompts become persistent requests without an extra LLM call. Tool events and file changes are collected automatically and batched. A stopped turn saves a checkpoint; it does **not** claim the task is complete.

Use the MCP tools for meaningful transitions only:

1. `task_create` to save intent, acceptance criteria or a future idea.
2. `task_claim` to select work, declare scope and associate the hook's session/actor.
3. `task_update` for scope changes, dependencies and explicit state changes.
4. `task_checkpoint` for a handoff that explains what remains.
5. `task_verify` to execute a named, project-configured check.
6. `project_reconcile` when answering whether something actually exists now.
7. `task_adopt` to attach a reviewed follow-up to an existing requirement before development.
8. `task_finish` to record an explicit outcome, with configured verification for code.

No manual logging per edit, no repeated plan upload, no separate model account. `project_context` is available for a compact refresh; it is not needed after every tool call. The durable format is documented in [the protocol](docs/protocol.md).

When the current hook has not supplied a task ID, the agent must explicitly save intent and plans through MCP or CLI. `dip doctor` and the dashboard report unobserved prompt capture; installed configuration alone is insufficient. `dip --help` and task-specific help work outside Git. `dip status` returns a compact summary, with `--full` available for raw history.

## Measured quality, cost and real workflow QA

In a separate synthetic scale measurement, warm context p95 at 10,000 tasks changed from **10.11 seconds to 1.58 seconds** after local event caching; output stayed around 1.3 KB. Fresh-process projection remained around **10 seconds**. This is local persistence/navigation performance on one machine, not improved agent quality or productivity. [All scale/capture samples, memory and limitations](docs/benchmarks/scale.md).

A longer controlled quality experiment used **four matched project pairs and 72 scheduled fresh Codex turns**, including actual requirement revisions, abrupt process interruption, two concurrent Git worktree workers, real merges and final audits. Both arms were instructed to preserve repository intent and handoffs; the baseline used ordinary Markdown.

| Final quality measure                            | Without DIP |  With DIP |
| ------------------------------------------------ | ----------: | --------: |
| Projects passing every primary code case         |         4/4 |       4/4 |
| Primary functional cases                         |     120/120 |   120/120 |
| Current policy fields recovered                  |       40/40 |     40/40 |
| Deferred feature identifiers retained            |         8/8 |       8/8 |
| Cancelled feature identifiers retained           |         4/4 |       4/4 |
| False release-ready claims against primary cases |           0 |         0 |
| Supplementary exploratory stress checks          |   9216/9216 | 9216/9216 |

**No advantage was observed in the primary code-correctness or intent-recovery outcomes against this capable Markdown baseline.** DIP ownership checks produced observable claim refusals; Git integration still required conflict resolution. The stress supplement was specified after the primary run started and was evaluated only after collection finished. Thousands of input checks are clustered within four project pairs, not independent projects. This accelerated synthetic lifecycle does not establish general productivity, maintainability or multi-day reliability. [Longitudinal method, every outcome and replayable evidence](docs/benchmarks/longitudinal.md).

A controlled Codex pilot used **six matched pairs and 24 fresh model-backed turns**, with the same GPT-6.1 Sol model and High reasoning. The baseline could save ordinary Markdown plans and handoffs. Both arms passed **48/48 held-out code cases**, recovered **24/24 contract fields** and retained **6/6 deferred feature identifiers**.

| Complete workflow                   | Without DIP |  With DIP |
| ----------------------------------- | ----------: | --------: |
| Median time                         |    164.19 s |  360.84 s |
| Reported input tokens, all 12 turns |   1,056,828 | 2,124,368 |
| Of those, cached input tokens       |     826,624 | 1,782,784 |
| Reported output tokens              |      32,170 |    67,732 |

**No productivity or recovery advantage was observed in this small solo-task pilot.** DIP's median workflow time was **2.20 times** the note-taking baseline. Each arm had one strict completion-report mismatch. The study covers explicit durable handoffs, isolated CLI configuration and no resident recorder; parallel coordination and long-running development were not measured. The full report retains infrastructure failures, every valid outcome and reproducible scoring. [Controlled pilot, method and raw evidence](docs/benchmarks/model-controlled.md).

A subsequent repeat used the same six pairs, prompts, scoring and time limits with existing trusted hooks. With DIP 0.3.12, both arms passed **48/48 code cases** and recovered **30/30 contract fields and deferred identifiers**. The separate strict completion-report field passed 6/6 for Markdown and 5/6 for DIP.

| Repeat on 0.3.12                                       |  Markdown |          DIP |
| ------------------------------------------------------ | --------: | -----------: |
| Median observed pair time                              |  193.98 s |     274.04 s |
| Timed-out turns                                        |      1/12 |         3/12 |
| Both turns finish within the limit and code cases pass | 5/6 pairs |    4/6 pairs |
| Observed DIP MCP calls and result bytes                |         0 | 98 / 125,640 |

**This repeat did not prove an efficiency or quality advantage.** Times include censored runs and token totals are incomplete. All six partial DIP seed tasks stayed open after passing checks. The preceding 0.3.11 repeat retained a code failure, a false completion state and five timeouts; it remains public. [Both repeats, every outcome, overhead profile and limitations](docs/benchmarks/model-controlled-repeat.md).

DIP adds measurable tracking overhead. A Windows/Node.js 24 benchmark used 30 alternating pairs of identical file writes after three warm-up pairs:

| Blocking path | Without DIP |  With DIP |
| ------------- | ----------: | --------: |
| Median        |    79.17 ms | 229.25 ms |
| p95           |    85.43 ms | 251.20 ms |

The paired added median was **150.88 ms**. Capture made **zero additional model calls**, and a separate check recovered the task, plan and handoff after runtime deletion. This measures synthetic local tracking cost with no daemon; it does not establish faster coding, better model reasoning or token savings. [Method, both measured runs and raw samples](docs/benchmarks/README.md).

Real Codex desktop QA covered planning, future ideas, cross-session recovery and refinement in two projects. Existing plans were recovered without duplicate tasks, and a future idea gained acceptance criteria while staying in backlog. Those trials used the explicit CLI/MCP fallback while hooks awaited trust. A later trusted-session test observed actual prompt capture and matching pre/post records for an ordinary tool call; v0.3.4 fixes a matcher incompatibility found in that test. Native planning-tool delivery, a trusted live Claude Code run and long-session reliability remain open. [Desktop trial results and fixes](docs/desktop-qa.md).

## Verification against real code

Configure named checks in `.dip/config.json`. Command arrays are executed directly, without evaluating task text as shell commands:

```json
{
  "schemaVersion": 1,
  "mode": "observe",
  "verification": {
    "unit": {
      "command": ["node", "--test"],
      "timeoutMs": 120000
    }
  }
}
```

For npm scripts on Windows, use a direct Node script or `node` with the absolute path to `npm-cli.js`; `.cmd` files are not direct executables. Review project-defined commands before running verification in an unfamiliar repository.

Evidence records the command, exit result, sanitized output and code snapshot. Code changing during a check prevents successful verification. Subsequent changes within declared scope make evidence stale. From 0.3.12, a passing `task_verify` leaves open work open and retains ownership. Use `task_finish implemented` with a configured check after reviewing all requirements; outstanding structured plan steps prevent premature completion. The UI separates task state, current check evidence and presence in Git history. A passing check proves that check's outcome, not every possible product requirement.

When starting reviewed development, `task_prepare` refines the captured requirement, claims scope and returns compact criteria in one call. Avoid rereading unchanged context already supplied by the hook or receipt. If native planning is unavailable, `task_plan` accepts short structured steps or prose text explicitly. Write long prose once in linked Markdown; this fallback is distinct from native host capture.

## Git and parallel work

`.dip/` contains JSON event files, one file per immutable event. Commit this directory with the work. The Git pre-commit integration flushes and stages ledger data automatically. Commit history is the portable record; local runtime queues, leases and caches are not committed.

Independent field changes merge naturally. Competing task states produce a visible conflict even if Git's text merge succeeds. Resolve them explicitly with a task update using `resolve: true` or the dashboard. Dependency cycles are also visible.

Use separate Git worktrees for parallel agents. A shared local SQLite coordinator provides atomic ownership and scope claims, expiry and fencing tokens. Separate machines/clones require a shared coordinator to guarantee live exclusivity; ordinary Git synchronization alone cannot provide that guarantee.

Active workers appear across local worktrees even when their tasks exist only in another branch. Pass `waitMs` (up to 30000) to `task_claim` to wait locally for conflicting ownership to release in one MCP call.

## Useful commands

```sh
dip context
dip task create --title "Add CSV export later"
dip task next
dip task prepare --id TASK_ID --actor codex:SESSION_ID --session SESSION_ID
dip task checkpoint --id TASK_ID --actor codex:SESSION_ID --summary "Parser complete; UI remains"
dip task verify --id TASK_ID --actor codex:SESSION_ID --check unit
dip task finish --id TASK_ID --actor codex:SESSION_ID --outcome implemented --summary "All requirements fulfilled" --check unit
dip reconcile
dip doctor
dip discover
dip stop
dip start
dip uninstall
```

Uninstall removes DIP's machine integrations while retaining project history and unrelated settings. Original files are backed up during installation. Installed hooks are not retroactively loaded into an already-running agent session.

## Help build the next useful handoff

DIP is early. Help a developer return to a project and understand what happened, what remains and what has actually been checked.

The [QA contributor backlog](CONTRIBUTING.md#project-backlog-from-qa) indexes the original limitations and their later progress. The project's `.dip` contains current priorities, evidence and acceptance criteria; `dip reconcile --kind work --open` shows remaining development without captured discussions.

- **Start with documentation:** [write a reproducible single-project walkthrough](https://github.com/vxu-labs/dip/issues/1).
- **Bring your environment:** [report one real OS, shell and agent combination](https://github.com/vxu-labs/dip/issues/2).
- **Make the dashboard easier to use:** [audit one keyboard-only task flow](https://github.com/vxu-labs/dip/issues/3).

Each issue defines a concrete deliverable. Comment with your intended scope before starting, and read [CONTRIBUTING.md](CONTRIBUTING.md) for setup, isolated testing and DCO sign-off. Reproducible bug reports and documentation improvements are welcome alongside code.

## Development

```sh
npm ci
npm test
npm run check
```

Core integration tests cover persistence, merge conflicts, claims, scope exclusion, automatic capture, verification drift, installation preservation and HTTP access controls. See [contributing](CONTRIBUTING.md) and [the implementation plan](MVP_PLAN.md).

## License

[Apache-2.0](LICENSE). Commercial use and forks are permitted under its terms. Contributions use the same license and a Developer Certificate of Origin sign-off. No project trademark rights are granted by the code license.
