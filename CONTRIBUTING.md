# Contributing to DIP

## Find a useful first contribution

New to the project? Start with the [single-project walkthrough](https://github.com/vxu-labs/dip/issues/1), share a [first-run compatibility report](https://github.com/vxu-labs/dip/issues/2), or help [audit keyboard accessibility](https://github.com/vxu-labs/dip/issues/3). Check that an issue is still open before starting. You can also browse [good first issues](https://github.com/vxu-labs/dip/labels/good%20first%20issue) and [help wanted](https://github.com/vxu-labs/dip/labels/help%20wanted).

Comment on an issue with the change you want to make and your chosen environment. For a larger feature or new adapter, open an issue to discuss the scope before implementation. A small, reproducible contribution is useful: explain the problem, show the result and keep unrelated changes out of the PR.

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
