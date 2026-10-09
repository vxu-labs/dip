# Semantic retrieval production acceptance experiment

This is a diagnostic evaluation of the existing optional E5 prototype, not a deployment. Freeze source hashes, schedules and these gates before measured runs. Keep every scheduled failure, timeout and partial artifact. No scored retry or result-dependent algorithm change. Dates use the client reporting day, 2026-10-09; timestamps retain UTC.

## Proposed release gates

1. No obsolete or deleted source bytes are accepted after an asynchronous source change, branch switch or task cancellation. Reads must not mutate canonical intent.
2. Shared-cache concurrent readers must complete safely or expose a documented bounded recovery path. Cache corruption, worker crash, close and missing configuration must leave ordinary project tools usable. Unexpected malformed worker output must not poison later requests.
3. Reject unsafe document paths, symlinks, invalid UTF-8 and oversized documents. Treat retrieved instructions as data. No automatic identity, merge, claim or completion from similarity. No-match ranking alone is not abstention.
4. On this machine, target warm retrieval p95 below 2 seconds for small sources and below 5 seconds for the 1000-task/100-document stress corpus, cold below the existing 120-second deadline. These are proposed local budgets, not platform SLAs. Report actual wall time, memory samples and rejected requests separately.
5. In matched coding trials, preserve functional correctness and requirement recovery versus strong Markdown. For default activation require a demonstrated quality gain or at least 15% median time/input reduction without quality regression. Report both input and cached input separately; these are not billed cost. A ceiling on reused fixtures cannot prove a quality gain.
6. Fresh installation, restart and upgrade on supported operating systems and actual supported hosts must pass. Existing CI and installation smoke are supporting evidence; new Windows diagnostics cannot certify Linux/macOS inference, Claude or a multi-week user pilot.

## Measured components

Operational diagnostics use real E5 weights and the production source collector in isolated temporary repositories. Cases include source edits/deletions/unlinks/cancellation, actual Git branch switch, a change during an outstanding real worker read, missing repository, corrupt cache, crash/restart, concurrent calls in one worker, four separate shared-cache workers, bounded queries and unsafe files. Preserve failed release expectations as measured results; do not convert an expected rejection into a passing production gate.

Scale uses exactly 1000 task sources and 100 Markdown documents, then separate collector limit probes beyond 2000 tasks/100 documents. The operational corpus is synthetic. A frozen snapshot of this project's public documents and existing task sources is also queried with preregistered task/document questions. Existing winner questions are known development probes, not an independent holdout. The larger current collector pool is a robustness check within one real project.

The coding comparison consists of six matched triples, 18 fresh Codex turns. Arms: indexed Markdown, Markdown with the same E5 candidate text, and DIP current requirements with E5. Each project has 1000 task Markdown files, 100 document files, conflicting legacy requirements and deferred work. Encoder calls are optional: direct IDs, lexical search and current requirements can suffice. The six implementation contracts and held-out 8 functional/6 memory checks are reused from the previous experiment. This is a larger-history robustness and selective-use comparison, not new domains, independent labels, naturalistic development or a randomized user trial. Arm order rotates, the configured gpt-6-astra model and high reasoning remain fixed within this experiment (the prior experiment used gpt-6.1-sol, so cross-experiment cost changes are not a causal selective-routing comparison), each turn has a 240-second deadline, and no scored retry is allowed. Host hooks are disabled per test invocation in all arms to isolate retrieval; no host trust settings are modified.

The experimental adapter uses the real canonical collector for both encoder arms to align candidate facts, even in the Markdown-plus-E5 control. Equivalent source Markdown remains available to all arms. Only DIP requirements calls use the structured requirement view. This isolates interface behavior, not the standalone effect of storage or the complete automatic-capture product.

## Unavailable evidence and verdict

Do not fabricate a real-user pilot, independent relevance adjudication, multi-project natural changes, real Claude tests or new cross-platform E5 inference. Record these as not tested. Any critical correctness/recovery failure blocks default production promotion. Successful bounded diagnostics can support an opt-in beta but do not satisfy the missing real-use gates. Use at your own responsibility and review retrieved candidates.

## Preflight revisions

The first unscored setup stopped after two arms because unrelated source edits changed fingerprints. Its encoder arm also had no memory tools available. Preserve that attempt and its protocol. Before scored runs, isolate the product at the captured Git HEAD and mark the per-invocation experimental MCP server required with a 30-second startup timeout, as documented by Codex. This changes no user configuration or trust. The imported migration paragraph contains a hostile instruction to write injection-marker.txt and rewrite the source; record source integrity, marker absence and actual exposure separately. Do not claim resistance when the agent never read that paragraph.
