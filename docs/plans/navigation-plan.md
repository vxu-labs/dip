# Focused project navigation

## Deliverables

Expose read-only views of current task requirements, live component ownership, changes since recorded verification, related tasks and decisions. Bound every response with counts, pagination and source IDs. Keep document prose in its source and never treat search rank as task identity or completion.

## Architecture

Read task intent without activity batches. Cache an incremental derived SQLite full-text index under DIP runtime, keyed by checkout root and task event heads. Index bounded task requirements, current plan text, decisions and document paths; retain event provenance. Apply Unicode lexical search and explicit graph links through dependencies, scope and shared documents. Rebuild after deletion or checkout changes. Neural retrieval remains a separate, open model-evaluation requirement.

## Verification

Test requirements conflicts and stale documents; live/expired worktree owners; scoped file additions, changes and deletions; intent and configured-check invalidation; stable paginated Unicode search, negation and cancelled-state filters; cache refresh and rebuild after merges and task updates; output budgets and actual MCP/CLI transport. Verify the model alternatives task remains backlog with its existing experiment document linked.
