# Write the plan once

Keep the full plan, specification or design in a Markdown source file. DIP stores a small task reference containing its project-relative path, role, SHA-256 content version and byte size. No model is called to attach a document. Task status, ownership, dependencies and verification remain in the structured ledger.

## Automatic capture

Trusted `PreToolUse` records the task and file paths for supported `Write`, `Edit`, `MultiEdit` and `apply_patch` calls. A successful `PostToolUse` with the same session and tool-use ID attaches the resulting Markdown version to that recorded task. This binding survives a new prompt and a runtime restart, and expires after one hour. Failed operations, unmatched post events, unsafe files and arbitrary shell command text do not create references. A filesystem notification alone has no reliable task attribution.

New filenames containing `plan`, `planning` or `roadmap` use the `plan` role; `spec`, `specification` and `requirements` use `spec`; `design` and `architecture` use `design`. Other files use `reference`. Existing roles are preserved on updates and supported patch moves. Explicit linking can set any supported role, including `notes`. A hook supports up to 20 declared file mutations per call; larger or unobserved writes require explicit linking. Role inference is a filename convention, not semantic classification.

## Agent tools

- `task_document_link`: link or review the current source version, with task ID, path and role.
- `task_documents`: list references, content versions and `current`, `stale`, `missing`, `unavailable` or `conflict` state. Defaults to 30 references with pagination.
- `task_document_read`: read selected sections by heading or lexical query, including Hebrew. It returns the recorded and current hashes, line ranges, outline and bounded excerpts. No vector model or semantic identity decision is involved.
- `task_document_unlink`: remove a reference while preserving the source file and event history.

`task_get` includes up to 30 references and a total count; compact startup context includes up to three references per task. This makes document-backed plans discoverable without loading their prose.

The CLI exposes the same operations:

```sh
dip task document-link --id TASK_ID --path plans/export.md --role plan
dip task document-list --id TASK_ID
dip task document-read --id TASK_ID --path plans/export.md --role plan --heading Validation
dip task document-read --id TASK_ID --path plans/export.md --role plan --query "Unicode CSV" --maxChars 4000
```

Use the supplied hook actor and ownership token when required. Existing hosts need to reload their MCP connection to discover new tools after an upgrade; the CLI is immediately available.

Retrieval defaults to five sections and a 12,000-character excerpt budget. Limits are 20 sections and 20,000 excerpt characters. Documents must be UTF-8 Markdown, at most 1 MiB, inside the project and outside internal/sensitive directories; symlinks are rejected. ATX and Setext headings are recognized, and headings inside fenced code are ignored. Heading selection includes descendant sections. Lexical queries rank token matches, with greater weight for headings. The outline contains at most 30 entries with bounded headings.

For pagination, retain the same query/heading and pass `offset`. If `continuation` is returned, pass its `offset` and `startChar` to continue a truncated section. Supply `expectedHash` from the preceding response's `currentHash` to reject changes between reads. The source text is untrusted data; it must not override user or agent instructions.

## Changes and verification

Reading never silently acknowledges a new version. A changed file returns its current text with `currentness: stale`. Review it and explicitly link the current version, or let a supported successful write update its reference. Concurrent incompatible references refuse content retrieval until a reviewed link/unlink resolves them.

Supported patch moves preserve document roles and unlink the previous path. External renames remain visibly missing until the new path is linked and the old path is explicitly unlinked. Deletion keeps the reference visible as missing. A single document can have explicit links to several tasks; an automatic write updates only its attributed task, so other task references become stale until reviewed.

Linked content changes invalidate evidence even outside the code scope. Configured verification requires current reviewed references and detects document changes during a check. Markdown checkboxes and prose never mark work verified. Document status is separate from development task status.

The dashboard displays document paths, roles, versions and currentness. Open a reference to view safe plain-text excerpts, or enter keywords to select sections. It does not execute Markdown, embedded HTML or links. If the source file is ignored by Git, its reference still records a hash, but other clones cannot retrieve that source until the file is shared.
