# Contributing to DIP

## Find a useful first contribution

New to the project? Start with the [single-project walkthrough](https://github.com/vxu-labs/dip/issues/1), share a [first-run compatibility report](https://github.com/vxu-labs/dip/issues/2), or help [audit keyboard accessibility](https://github.com/vxu-labs/dip/issues/3). Check that an issue is still open before starting. You can also browse [good first issues](https://github.com/vxu-labs/dip/labels/good%20first%20issue) and [help wanted](https://github.com/vxu-labs/dip/labels/help%20wanted).

Comment on an issue with the change you want to make and your chosen environment. For a larger feature or new adapter, open an issue to discuss the scope before implementation. A small, reproducible contribution is useful: explain the problem, show the result and keep unrelated changes out of the PR.

## Project backlog from QA

The remaining v0.3.2 limitations are recorded as nine unassigned backlog tasks in this repository's **`.dip/`**. Each task contains its evidence, scope and four acceptance criteria. Priority 1 is highest. Verification gaps, implementation gaps and intentional scope boundaries are labeled separately; already-fixed QA findings are not reopened here.

| Task                                                                                          | Work needed                                                            | Priority | Kind                        |
| --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | -------- | --------------------------- |
| [DIP-L01](.dip/events/task_684b230686f33a194d0cf09079e991f477c74329fba46b022f19b1bb89213344/) | Verify trusted automatic capture in real coding hosts                  | 1        | Verification gap            |
| [DIP-L02](.dip/events/task_15f6f22f468d7f2ec8a226f523138f3b4d5132b0ab927266a6aa7b4d1ff75426/) | Ship repository-contained skills and a portable intent fallback        | 1        | Implementation gap          |
| [DIP-L03](.dip/events/task_c0bffa8c657be52733213fb619d4ab246777f7a978663dba448f57210da20e9f/) | Supervise the recorder and recover safely after failure                | 1        | Implementation gap          |
| [DIP-L04](.dip/events/task_f2990ba9f233c4b3e9c368de72ee92652370dd42ab5ea84d6191ce85d24c7bf7/) | Reconcile follow-up intent and prose plans without backlog noise       | 2        | Protocol boundary           |
| [DIP-L05](.dip/events/task_a12b530ef91361c8ff8527e0048dde3b5a6ef45fb2a96b39fb71057776392f1e/) | Design opt-in coordination across independent clones and machines      | 3        | Scope boundary              |
| [DIP-L06](.dip/events/task_1e029eabacf002f8b89aed6807e3d75e9bf33c718a8080f1c0d0456647888aee/) | Expand explicit discovery adapters beyond native Git execution         | 3        | Coverage boundary           |
| [DIP-L07](.dip/events/task_5866bd11d54080d7f6a31fe83f2674edf1f180738ac460f73954f38217d772d5/) | Run a matched model-backed with/without DIP evaluation                 | 2        | Verification gap            |
| [DIP-L08](.dip/events/task_fef5991042dd2c86eb047c1ac4db89f592beb1579913ffdbd3c5f19c0964030d/) | Validate large-ledger performance and reduce measured capture overhead | 2        | Measured cost and scale gap |
| [DIP-L09](.dip/events/task_8a06cdf69d80979e779048e33e769c8b3c3ed213ce6756f3d67944e74c0ea2a5/) | Add explicit capture privacy controls and redaction audit fixtures     | 2        | Privacy boundary            |

Use `dip task next` to discover available work and `dip task get --id TASK_ID` to read a requirement. The dashboard shows these as future work. This table is a publication index; the event history is authoritative for subsequent state changes. Propose focused work through an issue/PR and include the task code and ID. Local claims coordinate a worktree family on one machine; they do not assign ownership across contributors' independent forks.

## Set up a development checkout

Fork the repository, clone your fork and create a branch for your change. Install dependencies from the lockfile with `npm ci`. You do not need to run `dip install` to edit documentation or run the core development checks.

Use Node.js 24 or later. Run `npm ci`, `npm test` and `npm run check` before opening a pull request. Add integration coverage when changing persistence, ownership, installation, adapter schemas or verification behavior.

Keep ordinary activity recording deterministic and local. Do not add implicit LLM calls, telemetry or per-edit semantic tool requirements. Adapter-specific behavior belongs in the adapter; the durable protocol should stay readable and versioned.

Contributions are licensed under Apache-2.0. Sign off commits with `git commit -s` to certify the [Developer Certificate of Origin](https://developercertificate.org/). A sign-off confirms that you have the right to contribute the work under the project's license.

Changes to machine integrations must preserve user settings and provide a removal path. Test them using isolated `DIP_HOME`, `DIP_USER_HOME` and `DIP_GIT_CONFIG` directories. Never run installation tests against a contributor's actual global configuration.

## Make a report someone else can reproduce

Include the DIP commit or release, Node.js version, OS, shell and relevant agent version. Provide minimal steps, expected behavior and what actually happened. Say whether hooks were loaded and trusted when reporting automatic capture. Remove tokens, private prompts and personal project data from logs and screenshots. Follow [SECURITY.md](SECURITY.md) for security-sensitive reports.

## Open a focused pull request

Link the issue, summarize the user-visible change and list the checks you ran with their actual results. For documentation, try the commands in a disposable project and check the links. For a behavior change, include regression coverage appropriate to the affected area. Explain checks you could not run; do not claim untested platforms work.

Keep the existing license and DCO requirements above. A contributor does not need to add telemetry, model calls or a cloud service to make DIP more useful.
