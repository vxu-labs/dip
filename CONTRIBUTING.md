# Contributing to DIP

Use Node.js 24 or later. Run `npm ci`, `npm test` and `npm run check` before opening a pull request. Add integration coverage when changing persistence, ownership, installation, adapter schemas or verification behavior.

Keep ordinary activity recording deterministic and local. Do not add implicit LLM calls, telemetry or per-edit semantic tool requirements. Adapter-specific behavior belongs in the adapter; the durable protocol should stay readable and versioned.

Contributions are licensed under Apache-2.0. Sign off commits with `git commit -s` to certify the [Developer Certificate of Origin](https://developercertificate.org/). A sign-off confirms that you have the right to contribute the work under the project's license.

Changes to machine integrations must preserve user settings and provide a removal path. Test them using isolated `DIP_HOME`, `DIP_USER_HOME` and `DIP_GIT_CONFIG` directories. Never run installation tests against a contributor's actual global configuration.
