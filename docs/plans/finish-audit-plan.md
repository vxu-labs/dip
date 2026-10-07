# Completion and read-budget plan

Audit open intent against acceptance criteria and existing code/evidence. Preserve partial requirements, and keep unconfirmed historical requests open. Link replaced requirements to the task that actually performed the work.

## Implementation

- Add explicit work/discussion classification and structured finish receipts for answered, implemented, superseded and cancelled outcomes.
- Let implemented outcomes run a configured check in the same tool call. Only a passing stable check establishes verified completion. Preserve ownership on failed checks.
- Make CLI task reads and reconciliation compact by default, with filters and pagination. Keep full event/activity diagnostics behind an explicit flag.
- Preserve receipts when hooks stop; ending a turn is still not completion. Exclude discussions from development queues while retaining access in the dashboard.

## Validation

Exercise ownership, failed checks, invalid replacements, causal merge conflicts, Stop behavior, corruption diagnostics, compact CLI/MCP output and browser discussion filtering. Audit the repository backlog separately from tests of this mechanism. Record source references and incomplete criteria; no automatic semantic completion or general token-saving claim.
