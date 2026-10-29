# Native pilot infrastructure incident

The human approved all eight isolated hook definitions. The first reviewed
scenario produced 52 native hook events with zero hook exit failures: two starts,
two prompts, 23 pre-tool and 23 post-tool events, one Stop and one SessionEnd.
This verifies that hook approval was effective; it is not a performance result.

The first model turn completed its partial implementation (4/4 fixture checks)
in 65,912 ms. Its MCP server did not initialize. The runner had omitted
`mcp_servers.dip.env_vars`, so Codex did not forward the variables used to select
the frozen arm. The model fell back to `dip` on PATH, which selected the host
installation. That happened to be the baseline version, but would contaminate
the candidate arm. This is a harness failure, not a failed hook approval.

The second reviewed turn had already started when the failure was diagnosed.
The runner and that turn were stopped. Its partial output is retained as an
interrupted infrastructure failure, without inventing a complete duration or
passing score. The first turn's score and timing are retained but marked as
infrastructure-affected. Neither turn is retried or silently discarded.

The harness now explicitly forwards only pilot routing/isolation environment
variables, places arm-specific CLI shims first on PATH, and performs a no-model
MCP handshake, tool-list/version check, context read and CLI resolution check
before starting model turns. Both frozen versions passed this preflight:
0.3.12 exposes 25 tools; 0.3.13-automatic.0 exposes 26. Two regression tests
exercise missing environment rejection, secret exclusion and shell-safe CLI
routing with spaces/apostrophes in paths. A native MCP startup error now stops
subsequent turns automatically.

Only the ten previously unstarted turns continue. The original protocol,
original harness and original failed results are preserved. A versioned
infrastructure amendment fixes transport/routing without changing product
sources, fixtures, model, effort, scenario order or the total twelve-turn
budget. It is not a clean twelve-turn paired comparison: the reviewed queue
pair remains incomplete. Timing or call improvements must not be claimed from
dropping these failures, and this experiment alone cannot pass the full release
gate.

Official configuration reference:
[Codex stdio MCP environment forwarding](https://learn.chatgpt.com/docs/extend/mcp#stdio-servers).
Host settings and hook trust were not modified. The isolated profile retains
the user's reviewed hook definitions; its MCP environment allowlist is repaired.
