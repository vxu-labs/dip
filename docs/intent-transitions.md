# Follow-up intent without duplicate work

The current agent makes the relationship decision. DIP does not call an extra classifier or automatically infer semantic identity.

1. Read the current hook task. For a possible repeat, use `project_search`, `task_related` and `task_requirements` to inspect existing candidates and their current criteria/evidence.
2. If it is the same requirement, call `task_adopt` with the captured `id`, reviewed `targetId`, hook `actor` and `session`, a short relationship `summary` and any changed intent `patch`. The source must be an undeveloped captured prompt. DIP refines the target, supersedes the duplicate with a replacement reference and selects the target for subsequent hooks/planning. Claim the target separately before development.
3. A distinct future idea uses `task_create`, stays in backlog and does not take ownership. An informational question uses `kind: discussion` and finishes with `answered`. A discussion that becomes development must be explicitly reclassified as work.
4. Long Markdown plans are written once and linked. `task_plan` saves a plan that exists only in chat or when native planning capture is unconfirmed. Hook-captured structured plans follow the selected task.
5. Finish implemented work using a reviewed configured check. A plan marked completed, a successful shell command or an ended turn does not establish task verification. Interrupted work stays open with a checkpoint.

CLI example:

```text
dip task adopt --id CAPTURED_ID --targetId EXISTING_ID --actor codex:SESSION --session SESSION --summary "Same export requirement with revised headers"
dip task update --id EXISTING_ID --kind discussion
```

Adoption accepts intent fields, not status/proof assertions. Both histories and owners are checked before writes; foreign owners, unrelated sessions, conflicts and cancelled/superseded targets are rejected. A source that already has development scope, criteria, documents or evidence must be preserved as work and reconciled explicitly, rather than consumed as a duplicate prompt.

The target refinement, source receipt and local session binding are separate durable steps. Retrying the same operation after interruption completes missing steps without repeating unchanged intent. They are not a cross-file transaction; inspect records if an external failure interrupts adoption. Other concurrent agents still require atomic claims.

Without confirmed hooks, explicitly read/select/refine an existing task or create a distinct request, and save the plan/checkpoint through CLI/MCP. Without installed DIP, use the reviewed [portable helper](portable.md) for durable intent. No skill can guarantee that every agent follows this protocol; automatic semantic routing remains separate research.

## Accuracy boundaries from the Kiosk audit

The supplied audit is a report, not locally reproduced Samsung or APK evidence. It exposes four distinct risks: recommendation prompts in work queues, remaining work recorded only in prose, overly broad interpretations of verification, and interpreting hook configuration as execution health. A Git `cannot spawn ... No such file or directory` message alone does not establish that the hook file is absent.

The observed Codex prompt template beginning `# Overview` and `Generate 0 to 3 hyperpersonalized suggestions for what this user can do with Codex in this local project:` is captured as discussion. This is a narrow template recognizer, not semantic classification. Quoted reports, ordinary questions and changed templates still need agent review. Existing records are not automatically rewritten or marked answered. `active` and `interrupted` remain separate from recorded task status.

Before finishing development, review prose checkpoints and requirements. `task_finish.remaining` (CLI `--remaining JSON`) accepts up to 20 entries with `summary` and `disposition`:

- `required`: blocks finish. Keep the requirement open or explicitly revise the agreed scope first.
- `follow_up`: requires an existing applicable work `taskId`, different from the current task. Create that task first; finish never silently creates or completes it.
- `verification_limit`: records an untested environment or behavior. It cannot waive a required acceptance criterion.
- `out_of_scope`: records an explicit scope boundary.

An explicit `[]` records that the agent reviewed and found no remaining items. Omission remains accepted for older clients but is shown as `remainingReview: unreviewed`; DIP does not infer an empty review from silence or extract obligations from prose. These entries are agent declarations, not independent proof of completeness. Structured plan blockers still apply. Review changes invalidate existing evidence.

Task reads and reconcile/finish results show the configured command, evidence time, result and local runner platform/architecture/Node version. Legacy evidence has `runner: null`. `verifiedComplete` means recorded implemented intent with current configured evidence; it does not prove that each acceptance criterion has been tested. Runner metadata does not identify an emulator or physical device. Git `integrated` is separate. A build check must not be reported as Samsung validation unless it actually tests that device.

`doctor.gitHooksConfigured` is retained for compatibility. `gitHooks` adds file presence, historical handler entry timestamps and explicit unverified execution. Even a recorded entry precedes possible DIP or chained-hook failures. `failureObservation: unavailable` means startup failures are not captured by this health path; there is no reliable last-failure claim. Doctor does not execute project hooks or create a commit as a probe. Missing configured files are issues; existing files with unverified execution generate an advisory. Root-cause analysis of the Kiosk hook failure still requires that project's runtime evidence.

On the known Git for Windows `mingw32/64/libexec/git-core` layout, doctor also checks whether `usr/bin/sh.exe` exists. Other layouts remain unknown; presence never proves execution. During this investigation on 2026-10-09, the selected `E:\Program Files\Git` installation lacked that runtime. Its `bin/sh.exe` launcher also reported a missing `usr/bin/bash.exe`. The DIP hook-chain integration test reproduced `cannot spawn ... pre-commit` with that Git and passed when the same test used Codex's bundled Git via a process-local PATH override. The global installation and PATH were not changed. This supports the local diagnosis; it does not independently establish which Git the earlier Kiosk process selected.
