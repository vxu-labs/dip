# Markdown document references

## Objective

Keep long plans in their Markdown source. DIP stores task-bound path, role and SHA-256 metadata, while status, ownership and verification remain structured events.

## Implementation

1. Add safe bounded Markdown reads, heading sections and lexical query selection.
2. Persist document link/unlink events with causal conflict detection. Include linked content versions in verification intent.
3. Attribute successful supported Write/Edit/apply_patch hooks to their recorded task context. Do not infer ownership from filesystem timing or parse arbitrary shell scripts.
4. Expose document link/list/read/unlink through MCP and CLI. Show references and safe plain-text excerpts in the dashboard.
5. Update agent instructions to write prose once and use document references. Keep native structured plan capture compatible.

## Validation

Test hook provenance and failures, event retries and concurrent versions, stale/missing/unsafe documents, rename operations, heading selection, Unicode queries, output limits and verification invalidation. Run existing unit, browser and package checks.

## Boundaries

No semantic model, automatic task completion or arbitrary Markdown instruction execution. Unattributed writes require an explicit link. Unsupported external renames surface as missing references until explicitly relinked.
