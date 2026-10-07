# Real Codex structured DIP fallback

On 7 October 2026, an authenticated Codex 0.160.0 app-server session used GPT-6.1 Sol with high effort and installed DIP 0.3.12. Existing user-approved hooks remained unchanged. The client checked their trust and authorized reviewed fixture intent tools for that process; global approval settings were not changed.

The user-style prompt requested future CSV export planning and a distinct Hebrew-header idea. An actual completed MCP `task_plan` call saved exactly three pending structured steps: define CSV contract, implement quoting and verify empty output. Durable readback and causal-history replay confirmed all three steps, CSV backlog status and the separate UTF-8/column-order requirement in backlog. Neither requirement had a lease or verification evidence. The final agent message matched that state.

This verifies the explicit DIP structured fallback. The preceding [lifecycle trial](lifecycle.md) found native `update_plan` unavailable to this model/host configuration. This trial did not inject a native tool or establish automatic native-plan delivery. It is one instructed synthetic planning turn, not a quality, speed or multi-day reliability result. Claude Code remains absent and unauthenticated.

[Sanitized host events and causal histories](2026-10-07-structured-plan.json) omit private paths and tool arguments while preserving the structured plan and durable task history. Full private fixture and transport logs remain locally retained, with hashes in the public evidence. Replay reconstructs ledger state and rejects a prose substitute, completed step, claimed requirement or false native-plan assertion:

```sh
node scripts/codex-structured-evidence.mjs
```

The explicitly invoked live runner supports `DIP_QA_STRUCTURED_ONLY=1`; it requires an existing authenticated host and trusted DIP hooks. Running a cloned script and using DIP remain the user's responsibility.
