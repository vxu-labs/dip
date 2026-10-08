# Ask for the part of project memory you need

DIP exposes focused read-only views so an agent can inspect requirements, ownership, evidence changes and related intent without loading the activity journal or rewriting documents.

| Question                                     | MCP tool            | CLI                                |
| -------------------------------------------- | ------------------- | ---------------------------------- |
| Which requirements apply?                    | `task_requirements` | `dip task requirements --id ID`    |
| Who currently owns this component?           | `component_owners`  | `dip owners --path src/auth`       |
| What changed since verification?             | `task_changes`      | `dip task changes --id ID`         |
| Which tasks or decisions match this request? | `project_search`    | `dip search --query "CSV Unicode"` |
| Which tasks are explicitly connected?        | `task_related`      | `dip task related --id ID`         |

## Requirements and evidence

Requirements include the current description and acceptance criteria, document versions, conflicting field identities, actual prerequisite verification and source event heads. Cancelled and superseded tasks are marked inapplicable. Native plan progress is source data and never completion evidence. Long text is bounded and marked truncated; use `task_get` for full structured intent and `task_document_read` for selected document sections. `limit`, `offset` and the returned counts expose remaining acceptance criteria; `maxChars` bounds requirement/plan excerpts. Truncated dependency/document sets require further review.

Changes compare the latest verification snapshot against current scoped source paths. They distinguish added, modified and deleted files, linked-document freshness, requirement changes and configured check changes. New evidence contains hashes per intent field, without duplicating prose. Older evidence retains its aggregate intent hash; the tool reports field details as unavailable rather than inventing them. A latest failed attempt remains a failed baseline. Neither read operation writes status or evidence.

## Ownership

Ownership comes from current runtime leases shared by a local Git worktree family. Overlapping parent/child scopes and another worktree's root/branch are visible; expired leases are excluded. This is an observation at the returned time. Use `task_claim` for atomic ownership before editing. Independent clones and machines do not acquire distributed locks through this view.

## Search and explicit relationships

Search uses Unicode SQLite FTS5/BM25 over bounded task titles, descriptions, acceptance criteria, native plan intent, document paths and recorded decisions. Document bodies stay in their source and are retrieved through document tools. Search accepts optional task ID, scope, status and task/decision filters. A supplied task ID prioritizes candidates with explicit graph links. Cancelled and superseded items are excluded by default; include their statuses explicitly when inspecting historical intent. Matches return source task/event IDs and bounded excerpts, not full histories. Recorded status is returned with `verification: not_checked`; inspect requirements/changes before relying on completion.

`task_related` follows direct dependencies, dependents, overlapping scopes and shared document paths. Shared scope or text similarity does not establish identical intent. These tools never merge tasks, assign work or mark completion. Negative and opposing requirements remain in the retrieved source, for agent review.

This release implements lexical and explicit graph retrieval. It does not contain a production neural semantic encoder or infer cross-language equivalence. The [pretrained comparison](benchmarks/semantic-retrieval-pilot.md) and [E5/MiniLM follow-up](benchmarks/winner-retrieval.md) now provide separate research measurements, including frozen project sources, long-document sections and a persisted experimental vector cache. Those Python research tools do not change the production MCP search interface or automatically merge/complete tasks. The broader [model-comparison design](benchmarks/semantic-alternatives.md) remains open for custom training, independent labels and downstream quality.

The repository source now also includes an opt-in E5 prototype, separate from default lexical search. An explicitly configured source MCP process exposes `project_retrieve({query, channel:"tasks"|"documents"|"all", limit})`; see [setup and downstream evaluation](benchmarks/semantic-agent-quality.md). Python, pinned model snapshot and derived-cache paths must be supplied on that subprocess. The default installation loads no neural model and downloads none. Existing globally installed packages need an actual upgrade or an explicit source connection; a Git push alone does not add a tool to a running host.

The prototype retrieves compact intent or heading-aware linked Markdown sections, checks current source metadata again after asynchronous inference, and omits candidates changed during the read. Exact offsets count Unicode code points; bounded excerpts may be shorter than their source ranges. Freshness does not imply code verification. An unrelated query can still return candidates, and neither ranking nor a recorded completed status authorizes automatic task identity, merging or completion. The cache is disposable local vector data; authoritative source/status stay in the ledger and Markdown.

## Derived index and limits

The index lives in `navigation.sqlite` under `DIP_HOME`, separately from the ownership/outbox database. Reindexing cannot hold its task-claim write lock. Each checkout has its own text corpus; worktrees and projects do not share corpus statistics or results. Immutable task event files drive cache refresh; changed file metadata, new events, branch changes and removal invalidate affected rows. Lost text tables or metadata are rebuilt from the ledger. Corrupt tasks are omitted with explicit errors, and activity batches are never indexed. Startup context and task selection also omit activity batches; the dashboard and doctor retain full activity/health views.

Responses default to ten entries and allow up to fifty, with offsets and totals. Queries accept up to 1,000 characters and use the first 24 distinct word tokens. Task search text is capped at 40,000 characters and decision text at 9,000 plus title; source snippets are capped at 800. This is bounded retrieval, not exhaustive inspection of arbitrarily large prose. Large histories still require scanning task file metadata for freshness; no constant-time or model-quality improvement is claimed. The 1,000-item regression verifies update/rebuild correctness, not a controlled AI-quality benchmark.

Existing MCP hosts need a connection reload after an upgrade to discover the new tools. The CLI is available immediately. Index files are derived local data, not canonical Git content.
