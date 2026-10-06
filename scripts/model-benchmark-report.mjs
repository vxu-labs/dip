import fs from "node:fs";
import assert from "node:assert/strict";

const raw = "docs/benchmarks/2026-10-06-model-controlled-v3.json";
const data = JSON.parse(fs.readFileSync(raw, "utf8"));
assert.ok(data.completedAt, "Wait for all scheduled trials before reporting");
assert.equal(data.pairs.length, 6);
const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return (sorted[2] + sorted[3]) / 2;
};
const seconds = (n) => (n / 1000).toFixed(2);
const number = (n) => n.toLocaleString("en-US");
const fence = String.fromCharCode(96).repeat(3);
const info = (arm) => {
  const rows = data.pairs.map((p) => p.arms[arm]);
  const memory = rows.flatMap((x) => x.score.memory);
  return {
    ...data.summary[arm],
    functionalSuccess: rows.filter((x) => x.score.allPassed).length,
    contractPassed: memory.filter(
      (x) =>
        !["future deferred", "completion report"].includes(x.name) && x.passed,
    ).length,
    futurePassed: memory.filter((x) => x.name === "future deferred" && x.passed)
      .length,
    completionPassed: memory.filter(
      (x) => x.name === "completion report" && x.passed,
    ).length,
    uncachedInput:
      data.summary[arm].inputTokens - data.summary[arm].cachedInputTokens,
    mcpCalls: rows.reduce(
      (n, x) =>
        n +
        (x.seed.itemCounts.mcp_tool_call || 0) +
        (x.recovery.itemCounts.mcp_tool_call || 0),
      0,
    ),
  };
};
const a = info("without"),
  b = info("with");
const delta = median(data.pairedDifferences.map((x) => x.totalWallMs));
const latencyRatio = b.medianTotalWallMs / a.medianTotalWallMs;
const quality =
  a.functionalSuccess === b.functionalSuccess
    ? "Both arms passed the same number of complete functional suites. No functional-success advantage for DIP was observed in this pilot."
    : `Complete functional suites passed: ${a.functionalSuccess}/6 without DIP and ${b.functionalSuccess}/6 with DIP. These six pairs are too small to establish a general success-rate effect.`;
const speed =
  latencyRatio >= 1
    ? `DIP's total-workflow median was ${latencyRatio.toFixed(2)} times the baseline median. This run demonstrates added time cost rather than a speedup for these tasks.`
    : `DIP's total-workflow median was ${latencyRatio.toFixed(2)} times the baseline median. This descriptive result is not a general productivity guarantee.`;
const pairs = data.pairs
  .map((p) => {
    const x = p.arms.without,
      y = p.arms.with;
    return `| ${p.index + 1}: ${p.scenario}, variant ${p.repeat + 1} | ${p.order.join(" then ")} | ${seconds(x.seed.wallMs + x.recovery.wallMs)} | ${seconds(y.seed.wallMs + y.recovery.wallMs)} | ${x.score.passed}/8 | ${y.score.passed}/8 |`;
  })
  .join("\n");
const completionFailures =
  data.pairs
    .flatMap((p) =>
      ["without", "with"].flatMap((arm) => {
        const x = p.arms[arm];
        return x.score.memory
          .filter((c) => !c.passed)
          .map(
            (c) =>
              `- Pair ${p.index + 1}, ${arm}: strict ${c.name} check failed. Recovery artifact: \`${JSON.stringify(x.score.recovery)}\`.`,
          );
      }),
    )
    .join("\n") || "All strict recovery checks passed.";
const report = `# Controlled model-backed Codex pilot

Run date: 6 October 2026. DIP ${data.dipVersion}, ${data.codexVersion}, ${data.node}, Windows. Six matched pairs used the same gpt-6.1-sol model ID and High reasoning. Each arm had a partial-development session and a fresh recovery session: 24 scored Codex turns in total.

${quality} ${speed} Both arms were explicitly told to preserve a durable handoff, and the baseline could use ordinary Markdown notes. The result tests DIP against a capable note-taking baseline.

## Results

| Measure | Without DIP | With DIP |
| --- | ---: | ---: |
| Complete functional suites | ${a.functionalSuccess}/6 | ${b.functionalSuccess}/6 |
| Held-out functional cases | ${a.functionalPassed}/48 | ${b.functionalPassed}/48 |
| Exact recovered contract fields | ${a.contractPassed}/24 | ${b.contractPassed}/24 |
| Deferred feature identifier retained | ${a.futurePassed}/6 | ${b.futurePassed}/6 |
| Complete function list and empty unresolved list | ${a.completionPassed}/6 | ${b.completionPassed}/6 |
| Turns with reported completion | ${a.completedTurns}/12 | ${b.completedTurns}/12 |
| Seed plus recovery time, median | ${seconds(a.medianTotalWallMs)} s | ${seconds(b.medianTotalWallMs)} s |
| Recovery time, median | ${seconds(a.medianRecoveryWallMs)} s | ${seconds(b.medianRecoveryWallMs)} s |
| Reported input tokens, all completed turns | ${number(a.inputTokens)} | ${number(b.inputTokens)} |
| Of those, cached input tokens | ${number(a.cachedInputTokens)} | ${number(b.cachedInputTokens)} |
| Input less cached input | ${number(a.uncachedInput)} | ${number(b.uncachedInput)} |
| Reported output tokens | ${number(a.outputTokens)} | ${number(b.outputTokens)} |
| MCP tool calls | ${a.mcpCalls} | ${b.mcpCalls} |

The median within-pair added total time was ${seconds(delta)} seconds. This differs from subtracting the two arm medians. Token usage was available for ${a.usageReportedTurns}/12 baseline turns and ${b.usageReportedTurns}/12 DIP turns. Missing usage is unknown, not zero. These are the CLI's reported usage fields, not invoice amounts or measured model-request counts. Cached input and output have different cost characteristics.

| Pair | Execution order | Without DIP, total seconds | With DIP, total seconds | Without DIP code | With DIP code |
| --- | --- | ---: | ---: | ---: | ---: |
${pairs}

## Exact recovery checks

Contract replay, future deferral and completion reporting are separate outcomes. A missing function name in the completion list is a reporting defect; it does not demonstrate that its requirements or code were lost. Literal JSON checks can also reject alternative representations of a correctly implemented rule.

${completionFailures}

## Task-management observations

The DIP arm retained three task records in five fixtures and four in the first scheduling fixture. Each included two captured user turns and one separate deferred feature; the first fixture also had a normalization-verification subtask. At the final projection, the original handoff requests were superseded, the recovered v1 requests were verified and all six deferred features remained in backlog. These are observed task-state outcomes, not an independent semantic duplicate-task score.

DIP used 134 MCP calls across the 12 scored turns. The baseline and treatment each emitted 72 completed command items; their completed file-change items numbered 27 and 22 respectively. Together with MCP items, the counts were 99 without DIP and 228 with DIP. These item counts are not model-request counts. They provide starting points for reducing management friction; the experiment does not isolate the cause of every latency difference.

## Prespecified method

The [version 3 protocol](2026-10-06-model-protocol-v3.json) and source hashes were published before the valid scored run at commit 05ee687. The three scenarios were scheduling, delimited-table encoding and substring search; each repeated with a different capacity, separator or result limit. Within every pair the task prompts were identical. Arm order alternated, including within each scenario's two repetitions.

Session one implemented only the first function, preserved the latest contract and left the second function and a separate future feature pending. Session two was a new ephemeral Codex process with no previous chat history. It recovered requirements from repository state, completed v1 and wrote recovery.json. No evaluator feedback was given to participants. Both arms could create Markdown notes and their own tests.

Eight fixed external functional cases per task evaluated the resulting module. Four exact contract fields, a deferred identifier and a completion report supplied six secondary checks. Evaluator calibration accepted all six reference variants and rejected broken pending-function implementations. [Replay validation](../../scripts/model-benchmark-evidence.mjs) reconstructs the saved code and scores both stages without another model call. The 48 cases per arm are clustered within six tasks, not 48 independent experiments.

The strict seed diagnostic flagged one baseline export because scheduleJobs existed as a callable function. Inspection confirmed it was a throwing unimplemented stub, so the intended partial-work condition was honored. The diagnostic flag and original scoring were retained; it is not evidence of premature implementation or a functional outcome difference.

Each arm used separate repositories, Codex configuration, Git configuration and runtime directories. Native Git trace and shell profiles were disabled; the baseline had no DIP hooks, MCP registration or .dip directory. The treatment added DIP instructions, actual Codex lifecycle hooks and the DIP MCP server. The isolated runtime used immediate durable fallback with no resident recorder. Setup was excluded from timed turns; model requests, tool use, checks, hook delivery, MCP startup and process completion were included.

All reviewed fixture-local MCP tools were explicitly authorized for unattended execution. Both arms used ordinary local-user execution with danger-full-access to avoid interactive Windows sandbox setup. Directory boundaries were instructions, not OS containment. Only generated DIP hooks were enabled; the vetted automation used --dangerously-bypass-hook-trust. This is separate from the normal installation's user review flow. The successful preflight checked real shell writes in both arms and actual MCP plan persistence/readback in the treatment.

## Retained infrastructure attempts

Two earlier attempts were stopped for failed infrastructure conditions, and all available outcomes remain public. They are not pooled with the valid comparison and are not evidence of a product success-rate difference.

- [Attempt 1](2026-10-06-model-attempt1.json): noninteractive MCP approvals blocked DIP intent calls. One matched pair completed and another partial arm was retained. Hook delivery worked. The original capture helper also checked the wrong checkpoint property; its checkpointPresent field must not be interpreted.
- [Attempt 2](2026-10-06-model-attempt2.json): fresh elevated Windows sandbox initialization failed with helper cancellation 1223. Shell access failed in the baseline. Available partial results and the stop reason were retained.

Task prompts and functional scoring remained fixed through the infrastructure corrections. All arms restarted from fresh repositories for version 3. Known CLI hook-trust banner items were classified as warnings, with their text retained. Preflight calls and terminated incomplete calls are outside the scored usage totals; usage for forcibly stopped active turns was unavailable. Local synthetic transcripts were retained and authentication copies were removed.

## Interpretation and limits

This small pilot covers solo microtasks and repository-based recovery after an explicit durable-handoff request. It does not measure implicit reminders, actual mid-development plan revisions, parallel-agent collisions, long-running development, distributed clones, Git merging, Claude Code or operation without DIP installed. The earlier proposal and final revision were both stated in the initial seed prompt. Runtime retention stayed on one machine.

Network/server load, model sampling and prompt caching were not fixed. The model ID and reasoning setting were the same; server weights and random seeds were not pinned. Both stages started new CLI processes, and the treatment used durable fallback rather than a running daemon. These conditions limit latency generalization. There are no statistical-significance, code-quality-beyond-these-tests or monetary-saving claims.

DIP supplied structured requests, plans, task status, ownership and lifecycle history. The measured workflow cost includes the agent's semantic management calls. Routine capture invokes no model by itself; that does not imply zero agent-loop, token or time overhead. Coordination and history benefits need separate controlled evaluation. The evidence supports optimizing management friction before claiming a productivity gain.

## Raw evidence and reproduction

- [All valid outcomes, artifacts, usage and timings](2026-10-06-model-controlled-v3.json)
- [Successful infrastructure preflight](2026-10-06-model-preflight.json)
- [Initial protocol](2026-10-06-model-protocol.json) and [version 2](2026-10-06-model-protocol-v2.json)
- [Task prompts and evaluator](../../scripts/model-benchmark-fixtures.mjs)
- [Model runner](../../scripts/model-benchmark.mjs)

Public artifacts replace personal path prefixes with placeholders; artifact hashes refer to original text before path redaction. No credentials, authentication files or unrelated project content are included.

${fence}sh
node scripts/model-benchmark.mjs --preflight --output preflight.json
node scripts/model-benchmark.mjs --output results.json
node scripts/model-benchmark-evidence.mjs
${fence}

The runner consumes the existing Codex login and model quota. It creates synthetic repositories and private configuration, leaves synthetic fixtures for audit, and removes its authentication copies. It does not modify installed global integrations. Reproducing a new run should save a fresh protocol before data collection; new model outcomes are not expected to match these values exactly.
`;
fs.writeFileSync("docs/benchmarks/model-controlled.md", report);
console.log(
  JSON.stringify({
    report: "docs/benchmarks/model-controlled.md",
    without: a,
    with: b,
    pairedMedianAddedMs: delta,
    medianTimeRatio: latencyRatio,
  }),
);
