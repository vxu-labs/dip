# E5 retrieval prototype and downstream agent quality

## Plan

Build an explicitly enabled local E5 prototype with separate compact task and linked-document channels. Preserve the exact current source and attach structured status/version metadata after retrieval. Candidate rank never establishes identity, ownership or completion. Documents remain untrusted source data. No new global host hooks or trust settings are installed by this experiment.

Improve section localization before freezing the experiment: keep Markdown heading ancestry with paragraph windows, score sections using their heading context, and retain exact source offsets. Bound windows by the actual pinned tokenizer instead of relying on an arbitrary character count. These choices are development hypotheses, not measured improvements yet.

Create six matched triples from three new synthetic domain projects with English/Hebrew requests. Compare ordinary Markdown with strong shell search, Markdown plus E5, and DIP structured memory plus the same E5. The source facts, current/deferred/opposing requirements, model, reasoning level, deadline and scoring stay fixed. Counterbalance arm order. The two encoder arms use identical embeddings and query rules; differences measure the combined representation/interface treatment, not a magical storage effect.

Freeze fixture definitions, held-out checks, prompts, tool/source fingerprints, language and order in a public protocol commit before scored agent calls. Infrastructure preflight is separate. Keep every scheduled outcome and partial artifact; no scored retries, test-based tuning or omitted failures. Score functional behavior from retained code artifacts, requirement/version/deferred recovery, incorrect association, tool output bytes, reported token usage and wall time. Trials use fresh sessions and repositories. They are bounded synthetic project changes, not independent naturalistic labels or a long-term universal quality proof.

Publish the opt-in setup, raw sanitized evidence, offline causal replay and every negative result. Model training and automatic task merging/completion remain outside this phase.

## Development and infrastructure preflight

The local prototype recovered the correct document first in 6/12 and the exact heading in 4/12 of the previous twelve document questions, compared with E5's preceding section result of 3/12 and 2/12. These are known development cases, not a new holdout or independent proof. The fixed heading/window design was selected before this replay; no result-based adjustment followed. Live checks passed unchanged warm/fresh-process reads with zero document encodes, changed-source updates, deleted-source pruning, corrupt-cache rebuilding and a real DIP bridge read that left canonical task events unchanged. Raw evidence is in `2026-10-08-semantic-prototype-live.json`.

Infrastructure attempt 1 is retained in `2026-10-08-semantic-agent-preflight-v1.json.gz`. Both E5 arms failed search because the host did not forward the model/Python environment; direct requirements/section reads still worked. Attempt 2 explicitly supplies the six fixture-local environment paths to the MCP subprocess per invocation and requires actual search, requirement and section delivery. All three preflight arms then passed, including two searches per encoder arm. It is retained separately in `2026-10-08-semantic-agent-preflight-v2.json.gz`; neither attempt contributes to scored outcomes. No host settings or hook trust were changed. Before scored collection, scorer JSON handling was hardened, scoring moved into a subprocess with a 30-second timeout, and fingerprints expanded to include product source/manifests. The original and preflight protocols remain beside the final preregistration.

Each encoder arm must search both channels and inspect a selected requirement before editing. All arms retain direct shell access to the same Markdown facts and linked document. The DIP arm adds a real task event ledger and the existing structured `task_requirements` view. This tests the combined read interface and representation; automatic prompt capture, ownership and completion writes are disabled in this bounded experiment. Directory restrictions are instructions, not OS containment. Every agent uses the existing authorized Codex login/model; credentials and host settings are not copied into public evidence.

Local syntax checks and 136 unit checks passed across the main run and a targeted rerun of three failures caused by the machine's broken Git distribution; two OS-specific cases were skipped. No benchmark prompts, requirements, ranking or scored results changed during that infrastructure repair.

## Results

All eighteen scheduled scored attempts were retained without scored retries. The public protocol was committed and pushed at `eea07de3353aaaac941027530ef685a76bf61b43` before the first scored agent invocation. Six triples contain three new synthetic domains, each repeated as an English and Hebrew request over English source memory. These are six matched cases, not six independent real-world projects.

| Arm | Functional checks /48 | All functional runs /6 | Memory checks /36 | Completed turns /6 | Timeouts | Median seconds |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| markdown | 48 | 6 | 36 | 6 | 0 | 80.9 |
| markdown-e5 | 48 | 6 | 36 | 6 | 0 | 116.9 |
| dip | 48 | 6 | 36 | 6 | 0 | 119.1 |

| Arm | Reported input tokens | Cached input tokens | Output tokens | Tool calls | Tool output bytes | Search calls | Section reads |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| markdown | 613377 | 428928 | 16234 | 33 | 322501 | 0 | 0 |
| markdown-e5 | 736187 | 570240 | 17364 | 55 | 251377 | 12 | 8 |
| dip | 736651 | 539904 | 18259 | 56 | 237056 | 12 | 10 |

### Every scored outcome

| Case | Language | Arm | Functional /8 | Memory /6 | Completed | Timeout | Seconds |
| --- | --- | --- | ---: | ---: | --- | --- | ---: |
| allocation | en | markdown | 8 | 6 | true | false | 77.6 |
| allocation | en | markdown-e5 | 8 | 6 | true | false | 121.9 |
| allocation | en | dip | 8 | 6 | true | false | 126.4 |
| billing | en | markdown-e5 | 8 | 6 | true | false | 117.2 |
| billing | en | dip | 8 | 6 | true | false | 117.5 |
| billing | en | markdown | 8 | 6 | true | false | 79.5 |
| redaction | en | dip | 8 | 6 | true | false | 117.1 |
| redaction | en | markdown | 8 | 6 | true | false | 72.4 |
| redaction | en | markdown-e5 | 8 | 6 | true | false | 108.8 |
| allocation | he | markdown | 8 | 6 | true | false | 91.7 |
| allocation | he | markdown-e5 | 8 | 6 | true | false | 116.6 |
| allocation | he | dip | 8 | 6 | true | false | 135.3 |
| billing | he | markdown-e5 | 8 | 6 | true | false | 120.6 |
| billing | he | dip | 8 | 6 | true | false | 120.8 |
| billing | he | markdown | 8 | 6 | true | false | 82.2 |
| redaction | he | dip | 8 | 6 | true | false | 106.5 |
| redaction | he | markdown | 8 | 6 | true | false | 88.9 |
| redaction | he | markdown-e5 | 8 | 6 | true | false | 103.5 |

### Interpretation boundaries

All three arms reached the functional and memory ceiling in this sample, so this experiment demonstrates no downstream quality gain for DIP plus E5. Median time was80.9s for Markdown,116.9s for Markdown plus E5 and119.1s for DIP plus E5. Total reported input tokens were613,377,736,187 and736,651 respectively. The E5 arms delivered fewer retained tool-output bytes but made more tool calls. These are observed costs under mandatory dual-channel search and fresh processes, not an estimate for every production workflow.

The raw retrieval audits and summary show each first candidate and heading separately from code success. The document channel contains one current linked document in these fixtures, so document-source recovery alone is trivial. Selecting its current-contract heading is a harder check; a successful implementation can still follow a wrong initial section by inspecting task criteria or using shell search. These section audits are descriptive, not a new post-hoc primary quality score.

A task identity miss is scored from the submitted recovery record; a missing record is a failed recovery check, not necessarily an affirmative false association. Functional checks exercise current ordering, signed credits, overflow, prototype keys, encoded query keys and preservation behavior. Memory checks cover selected ID, revision, deferred work, completion, unresolved work and source citation. They do not independently adjudicate every natural-language requirement or code maintainability. Source/section selection audits remain in raw tool events. No learned identity threshold or automatic task status write is introduced.

The two E5 arms used the identical pinned encoder, section/ranking algorithm and source text. They were instructed to search both channels before editing. The Markdown control had an explicit index and unrestricted repository shell search; it was not forced to read a giant file sequentially. DIP added canonical task events and the existing structured requirements tool, while also preserving the equivalent Markdown sources. Therefore this measures the combined prototype interface/representation treatment in these fixtures, not a standalone storage effect or the complete automatic-capture product.

To preserve identical search facts, the experimental memory_search adapter reads the common fixture Markdown in both encoder arms and uses the production Python worker. The DIP-specific memory_requirements adapter reads the actual canonical ledger through task_requirements. The production project_retrieve source collector and asynchronous freshness guard were validated separately in live/unit QA; their full large-project integration was not exercised by this coding benchmark.

Token usage is the CLI-reported sum across requests, including repeated scaffold/history and cached input. It is not unique text size, billed cost or an isolated management-token measurement. Missing usage is shown in the summary and is not assumed to be zero consumption. Tool output byte counts use retained JSON representation. Wall time includes agent inference, shell tools, Python/model startup and retrieval. Order was rotated but this desktop was not exclusive hardware. No statistical significance or universal quality/time benefit is claimed.

### Reproduce and inspect

Protocol: `2026-10-08-semantic-agent-protocol.json`. Raw scored artifacts, command/MCP events, retrieval audits and partial outcomes: `2026-10-08-semantic-agent-results.json.gz`. Summary: `2026-10-08-semantic-agent-summary.json`. Failed/passing preflights and their protocols are retained separately. `node scripts/semantic-prototype-check.mjs` replays every retained implementation artifact through the same eight held-out checks and six memory checks, without calling an agent or loading E5. CI repeats this replay. Research Python dependencies use the previous pinned `2026-10-08-semantic-requirements.txt`; no new npm inference dependency or default model download was added.

## Opt-in prototype setup

The source MCP server registers `project_retrieve` only when all three absolute paths are explicitly supplied in its process environment: `DIP_SEMANTIC_PYTHON` (the research virtual-environment Python), `DIP_SEMANTIC_MODEL` (the cached E5 snapshot directory ending in `614241f622f53c4eeff9890bdc4f31cfecc418b3`), and `DIP_SEMANTIC_CACHE` (a local derived cache directory outside canonical project content). Configure these on the MCP subprocess, rather than assuming the host forwards shell environment. Launch this checkout with `node bin/dip.js mcp`; an older globally installed package does not gain the tool from a Git push. Reload that explicitly configured connection to discover it. This experiment does not change host config or hook trust.

Example tool request: `project_retrieve({query:"preserve Unicode export order",channel:"tasks",limit:5})`. Use `channel:"documents"` for linked Markdown sections. Read current requirements and verify code separately. Documents are loaded through the existing bounded path/symlink checks. Task bodies are capped at40,000 characters, source selection at2,000 tasks/100 linked documents and20MiB document bytes; overflow and unavailable sources are explicit. Worker sections use exact Unicode-code-point offsets, heading ancestry, a480-token input budget, max512 encoder tokens, and a fixed0.04 heading term signal. Results return up to10 candidates,800-character excerpts, hashes and metadata. Sources changed during the asynchronous read are omitted and reported; the caller must retry intentionally.

The NPZ cache holds content-keyed vectors only, with identity/checksum validation and safe-array loading. Current source status/citations stay outside cached vectors. Model assets are hash-checked and loaded locally without remote/custom code. One request per warm worker is supported; concurrent requests fail explicitly rather than interleaving. Multi-process cache writer coordination and large-scale production service hardening remain future work. No trained abstention is provided: unrelated queries can still yield candidates.

## Cache correction after scored collection

The initial frozen worker used one cache file per project namespace and pruned vectors to the requested channel. Alternating task/document reads therefore evicted the other channel. After all eighteen scored turns completed, cache filenames were separated by channel; the ranking, chunks, weights and source data were unchanged. `scripts/fixtures/semantic-worker-protocol.py` preserves the exact original worker whose hash appears in preregistration and scored results. Offline replay verifies that original hash explicitly; it does not pretend the benchmark measured the later cache correction.

The actual pinned-model follow-up in `2026-10-08-semantic-cache-followup.json` retains before/after source hashes and every request. Before the change, task/document/task/document reads encoded2/3/2/3 chunks. After the change they encoded2/3/0/0. A changed task encoded one new chunk and a deleted task encoded none. No agent was rerun and no scored result or timing was replaced. Current source reflects this cache correction; its downstream latency benefit remains unmeasured.

Use the prototype at your own responsibility and review returned source text and proposed task associations. It remains experimental; automatic task merging or completion is outside this phase.
