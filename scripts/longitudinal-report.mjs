import fs from "node:fs";
import { summarize } from "./longitudinal-analysis.mjs";
const data = JSON.parse(
  fs.readFileSync(
    process.argv[2] || "docs/benchmarks/2026-10-06-longitudinal.json",
    "utf8",
  ),
);
if (!data.completedAt || data.preflight)
  throw new Error(
    "Only a completed scored experiment can become a results report",
  );
const s = summarize(data),
  a = s.without,
  b = s.with;
const pct = (n, d) => `${n}/${d}`;
const seconds = (n) => (n / 1000).toFixed(1);
const recoveryBreakdown = (arm) => {
  const checks = data.pairs.flatMap(
    (p) => p.arms[arm].stages.audit.score.memory,
  );
  const group = (filter) => {
    const rows = checks.filter(filter);
    return `${rows.filter((x) => x.passed).length}/${rows.length}`;
  };
  return {
    policy: group((x) => !x.name.includes(":")),
    deferred: group((x) => x.name.startsWith("deferred:")),
    cancelled: group((x) => x.name.startsWith("cancelled:")),
  };
};
const ra = recoveryBreakdown("without"),
  rb = recoveryBreakdown("with");
const stressFile = "docs/benchmarks/2026-10-06-longitudinal-stress.json";
let stressSection = "";
if (fs.existsSync(stressFile)) {
  const stress = JSON.parse(fs.readFileSync(stressFile, "utf8"));
  if (!stress.completedAt)
    throw new Error("Supplementary stress evaluation must be complete");
  const groups = Object.keys(stress.pairs[0].arms.without.groups);
  const rows = groups.map((group) => {
    const values = ["without", "with"].map((arm) =>
      stress.pairs.reduce((n, p) => n + p.arms[arm].groups[group].passed, 0),
    );
    return `| ${group} | ${values[0]}/1024 | ${values[1]}/1024 |`;
  });
  const examples = [];
  for (const pair of stress.pairs)
    for (const arm of ["without", "with"]) {
      const r = pair.arms[arm];
      if (r.passed < r.total)
        examples.push(
          `- Pair ${pair.index + 1}, ${arm}: ${r.passed}/${r.total} checks; failing groups ${Object.entries(
            r.groups,
          )
            .filter(([, g]) => g.passed < g.total)
            .map(([name]) => name)
            .join(", ")}.`,
        );
    }
  stressSection = `## Supplementary exploratory contract stress\n\nThis supplement was specified after the primary run began and pair 1 primary outcomes were known, before inspecting participant implementation source or evaluating any stress outcome. It is outside the original preregistered primary endpoint. Version 2 added separate Node.js subprocesses before participant stress evaluation, preventing global/prototype state contamination between projects; the original version 1 protocol is retained. No participant received feedback or code repair.\n\nEach final project received 256 identical seeded input scenarios, checking nine exports and input immutability. Inputs include bounded monetary values, fractional coupons, invalid/duplicate lines, Unicode and punctuation, own stock keys named constructor/__proto__, absent inventory keys, CSV escaping and return-date boundaries. The oracle passed 132 independent primary/dictionary checks; 9216 oracle-equivalence checks and 36 deliberately broken-module checks exercised the evaluator.\n\n| Supplementary check | Without DIP | With DIP |\n|---|---:|---:|\n${rows.join("\n")}\n| All stress checks | ${stress.summary.without.passed}/${stress.summary.without.total} | ${stress.summary.with.passed}/${stress.summary.with.total} |\n| Projects passing every stress check | ${stress.summary.without.allCaseProjects}/4 | ${stress.summary.with.allCaseProjects}/4 |\n\n${examples.length ? examples.join("\n") : "Every supplementary check passed in both arms."}\n\nThese cases are clustered within four project pairs and reuse one domain and oracle, not thousands of independent trials or a general code-quality score. [Supplement protocol](2026-10-06-longitudinal-stress-protocol.json), [all flags and failure examples](2026-10-06-longitudinal-stress.json). Replay without model calls: node scripts/longitudinal-stress-evidence.mjs.\n\n`;
}
const names = [
  "seed",
  "revision",
  "detour",
  "interrupted",
  "workerA",
  "workerB",
  "integration",
  "finalRevision",
  "audit",
];
const deniedClaims = (arm) =>
  data.pairs.reduce(
    (n, p) =>
      n +
      Object.values(p.arms[arm].stages).reduce(
        (a, s) =>
          a +
          s.run.mcpCalls.filter(
            (c) =>
              c.tool === "task_claim" &&
              /Scope owned by |Task owned by /.test(c.result),
          ).length,
        0,
      ),
    0,
  );
const invariantNames = new Set([
  "empty cart",
  "trim and drop invalid",
  "stable duplicate consolidation",
  "normalization immutable",
  "discount rounded once",
  "shipping excluded from tax",
  "receipt immutable",
  "csv empty header",
  "inventory success exact",
  "inventory aggregates across prices",
  "inventory atomic failure",
  "inventory absent and zero price",
  "inventory immutable success",
  "return status precedence",
  "return future date",
  "return invalid integer date",
  "fulfill atomic failure",
  "summary aggregate",
  "summary empty",
]);
const stageRows = [],
  exceptions = [],
  paired = [],
  regressionRows = [];
for (const pair of data.pairs) {
  const wa = pair.arms.without,
    wi = pair.arms.with;
  paired.push(
    `| ${pair.index + 1} | ${pct(wa.stages.audit.score.passed, 30)} | ${pct(wi.stages.audit.score.passed, 30)} | ${pct(wa.stages.audit.score.memoryPassed, 13)} | ${pct(wi.stages.audit.score.memoryPassed, 13)} | ${wa.merge.conflictPaths.length} / ${wi.merge.conflictPaths.length} |`,
  );
  for (const arm of ["without", "with"]) {
    const r = pair.arms[arm];
    stageRows.push(
      `| ${pair.index + 1} ${arm} | ${names.map((n) => r.stages[n].score.passed).join(" | ")} |`,
    );
    const seq = [
      "seed",
      "revision",
      "detour",
      "interrupted",
      "integration",
      "finalRevision",
      "audit",
    ];
    for (let k = 1; k < seq.length; k++) {
      const previous = r.stages[seq[k - 1]].score.checks,
        current = r.stages[seq[k]].score.checks;
      const lost = current.filter(
        (c) =>
          invariantNames.has(c.name) &&
          !c.passed &&
          previous.some((p) => p.name === c.name && p.passed),
      );
      if (lost.length)
        regressionRows.push(
          `- Pair ${pair.index + 1}, ${arm}, ${seq[k - 1]} to ${seq[k]}: ${lost.map((x) => x.name).join("; ")}.`,
        );
    }
    for (const name of names) {
      const e = r.stages[name];
      if (
        name !== "interrupted" &&
        (!e.run.completed || e.run.exitCode !== 0 || e.run.timedOut)
      )
        exceptions.push(
          `- Pair ${pair.index + 1}, ${arm}, ${name}: completed=${e.run.completed}, exit=${e.run.exitCode}, timeout=${e.run.timedOut}.`,
        );
    }
    const final = r.stages.audit.score;
    if (!final.allPassed)
      exceptions.push(
        `- Pair ${pair.index + 1}, ${arm}, final functional failures: ${final.checks
          .filter((c) => !c.passed)
          .map((c) => c.name)
          .join("; ")}.`,
      );
    if (final.memoryPassed < 13)
      exceptions.push(
        `- Pair ${pair.index + 1}, ${arm}, final recovery misses: ${final.memory
          .filter((c) => !c.passed)
          .map((c) => c.name)
          .join("; ")}.`,
      );
    if (final.unsupportedClaims.length)
      exceptions.push(
        `- Pair ${pair.index + 1}, ${arm}, claimed exports with failing component tests: ${final.unsupportedClaims.join(", ")}.`,
      );
    if (r.auditProductMutated)
      exceptions.push(
        `- Pair ${pair.index + 1}, ${arm}: audit changed a provided product/test file; see raw artifacts.`,
      );
  }
}
const conclusion =
  a.fullyCorrect === b.fullyCorrect && a.memoryPassed === b.memoryPassed
    ? "This experiment found no difference in final functional correctness or exact recovered intent between the arms."
    : `Final functional project success was ${a.fullyCorrect}/4 without DIP and ${b.fullyCorrect}/4 with DIP. Exact recovered intent was ${a.memoryPassed}/52 without DIP and ${b.memoryPassed}/52 with DIP. These are descriptive results from four paired projects, not a statistical or general-productivity claim.`;
const report = `# Longitudinal controlled quality experiment

${conclusion}

The run used 72 scheduled fresh Codex conversations across eight repositories: four matched pairs with and without DIP. It added actual mid-development changes, cancelled and future ideas, abrupt process interruption, concurrent isolated Git worktree workers, real merges, a final revision and a fresh read-only audit. No evaluator feedback or result-dependent retries were provided.

| Quality measure | Without DIP | With DIP |
|---|---:|---:|
| Final projects passing every external functional case | ${pct(a.fullyCorrect, 4)} | ${pct(b.fullyCorrect, 4)} |
| Final external functional cases | ${pct(a.functionalPassed, a.functionalTotal)} | ${pct(b.functionalPassed, b.functionalTotal)} |
| Exact recovered policy/future/cancellation checks | ${pct(a.memoryPassed, a.memoryTotal)} | ${pct(b.memoryPassed, b.memoryTotal)} |
| Of those: current policy fields | ${ra.policy} | ${rb.policy} |
| Of those: deferred feature identifiers | ${ra.deferred} | ${rb.deferred} |
| Of those: cancelled feature identifiers | ${ra.cancelled} | ${rb.cancelled} |
| False release-ready claims against external tests | ${a.falseReleaseReady} | ${b.falseReleaseReady} |
| Claimed exports with failing component tests | ${a.unsupportedCompletionClaims} | ${b.unsupportedCompletionClaims} |
| Fully correct code with a complete release report | ${pct(a.accurateCompleteReports, 4)} | ${pct(b.accurateCompleteReports, 4)} |
| Product merge-conflict paths | ${a.productMergeConflicts} | ${b.productMergeConflicts} |
| All merge-conflict paths, including management notes | ${a.observedMergeConflicts} | ${b.observedMergeConflicts} |
| Audit changed a provided product/test file | ${a.auditProductMutations} | ${b.auditProductMutations} |

## Paired final results

| Pair | Without: functional | With: functional | Without: recovered intent | With: recovered intent | Merge paths without / with |
|---|---:|---:|---:|---:|---:|
${paired.join("\n")}

## Intermediate functional snapshots

Each cell is passed cases out of 30, evaluated against the policy current at that stage. Partial implementations are expected in early stages; these cells are observations, not failures to complete a stage. The two parallel workers are scored independently in their worktrees, so each can lack the other worker's exports. Integration is evaluated before the final change request; finalRevision and audit use the final policy.

| Pair / arm | Seed | Revision | Detour | Interrupted | Worker A | Worker B | Integration | Final revision | Audit |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
${stageRows.join("\n")}

Exploratory diagnostic: loss of previously passing policy-invariant cases on the mainline snapshots:

${regressionRows.length ? regressionRows.join("\n") : "No pass-to-fail transitions were observed for the selected invariant cases. This does not establish absence of all regressions."}

## Operational outcomes and secondary cost

| Measure | Without DIP | With DIP |
|---|---:|---:|
| Scheduled turns | ${a.scheduledTurns} | ${b.scheduledTurns} |
| Completed turns | ${a.completedTurns} | ${b.completedTurns} |
| Intentional interruption triggers | ${a.intentionalInterruptions} | ${b.intentionalInterruptions} |
| Unexpected timeout turns | ${a.unexpectedTimeouts} | ${b.unexpectedTimeouts} |
| Turns reporting usage | ${a.usageReportedTurns} | ${b.usageReportedTurns} |
| Median sum of per-project turn durations, seconds | ${seconds(a.medianSummedTurnWallMs)} | ${seconds(b.medianSummedTurnWallMs)} |
| Reported input tokens | ${a.inputTokens} | ${b.inputTokens} |
| Reported cached input tokens | ${a.cachedInputTokens} | ${b.cachedInputTokens} |
| Reported output tokens | ${a.outputTokens} | ${b.outputTokens} |
| Completed DIP MCP calls | ${a.mcpCalls} | ${b.mcpCalls} |
| Unique captured coordination-denial records | ${a.coordinationDenials} | ${b.coordinationDenials} |
| Claim replies denying an already-owned task/scope, exploratory diagnostic | ${deniedClaims("without")} | ${deniedClaims("with")} |

Intentional interruption can prevent turn.completed and its usage report. Reported token totals therefore exclude missing interrupted-turn usage, not zero-cost interrupted work. Summed turn duration includes simultaneous worker time twice and is work exposure, not elapsed project completion time. MCP calls and CLI item counts are not model-request counts. Captured coordination-denial records cover hook events; explicit MCP claim rejections can appear only in tool replies and are counted separately as an exploratory diagnostic. A denial is an observed event, not by itself proof of an avoided collision or better final code. File-scope ownership across isolated worktrees does not update the waiting worker's branch base or automatically resolve a later Git merge. Merge paths are Git conflict paths, not automatically lost work or duplicated effort.

## Exceptions and observed limitations

${exceptions.length ? exceptions.join("\n") : "All non-interrupted turns completed successfully; no final functional/recovery miss or audit mutation was observed."}

${stressSection}## Fixed method and reproducibility

- Model: ${data.protocol.model}; reasoning effort: ${data.protocol.effort}; CLI: ${data.codexVersion}; DIP: ${data.dipVersion}; platform: ${data.platform}.
- The [protocol, prompts, fixture files and source hashes](2026-10-06-longitudinal-protocol.json) were published in commit f1bd593 before scored execution. Collection started ${data.startedAt} and completed ${data.completedAt}.
- Four policy variants of one order-processing project were paired. Arm launch order and merge order alternated by pair. Arms ran concurrently on the same host; each arm's two workers ran concurrently in separate standard Git worktrees forked from the same checkpoint.
- The baseline was allowed ordinary Markdown plans, decisions and handoffs. Both arms received the same task prompts and repository-memory rules. No resumed chat context was available.
- Treatment used generated DIP instructions, real Codex hooks and reviewed approved MCP tools in private per-arm config/runtime. No resident DIP recorder was running. Local shared-runtime coordination spans worktrees; distributed clones were not tested.
- Only generated reviewed fixture hooks used hook-trust bypass. Ordinary-user shell execution was identical in both arms. Directory/config boundaries were instructions, not an OS security sandbox. Authentication copies were private and removed; no credentials are in public evidence.
- The receipt worker was forcibly terminated 2000ms after its first observed receipt.mjs content mutation, polled every 100ms, with a 180-second no-mutation cap. Other turns had a fixed 360-second cap. Partial files were retained. The same event-based interruption rule can leave different amounts of work in different arms.
- The harness made fixture-only Git checkpoints. Both workers forked the same checkpoint; their commits were made after both turns ended, and the harness then attempted actual merges. Workers were not offered continuous integration of the other branch while working. The integrator saw factual branch/conflict state, not evaluator feedback, and could resolve/commit/merge remaining work. Both workers deliberately modify pipeline.mjs, so this is an induced overlap test, not an estimate of normal conflict frequency.
- Thirty fixed external cases cover normalization, monetary calculation, CSV, stock atomicity, return boundaries and cross-module integration. Thirteen exact report checks cover the current ten policy fields, two future features and one cancellation. All-case project success is the primary unit; 120 final cases per arm are clustered, not 120 independent experiments.
- A false release-ready claim means releaseReady=true with at least one failed external case. Unsupported export claims use component test groups: one failed receipt/pipeline component case can flag both exports in that component. This is a conservative diagnostic, not a semantic proof about each individual export.
- Fixture calibration passed 360 reference checks and caught 60 deliberate mutations. [Infrastructure preflight](2026-10-06-longitudinal-preflight.json) confirmed shell writes, DIP plan persistence and actual worktree merge conflicts. Preflight turns are excluded.
- Replay public snapshots without model calls: node scripts/longitudinal-evidence.mjs. Calibrate the scorer: node scripts/longitudinal-calibrate.mjs. The complete [raw data](2026-10-06-longitudinal.json) retain every scheduled stage, artifact, score, answer, usage report and captured task metadata. Full raw CLI transcripts remain local.

## Interpretation boundaries

This is a longer and harsher accelerated synthetic lifecycle than the [earlier two-session pilot](model-controlled.md), but it is not a multi-day real-project field trial. It repeats one domain four times. Backend model weights, network load and random seeds were not pinned; concurrent arms share host/API capacity. Functional checks do not measure readability, architecture, security, maintainability or arbitrary requirements. We did not independently score all duplicate tasks, duplicated effort, future-feature implementation or stale task semantics. Missing fields in the fixed JSON report are exact-recovery misses, not proof that the information was absent everywhere in the repository. No statistical significance or general quality/productivity improvement is claimed.
`;
fs.writeFileSync("docs/benchmarks/longitudinal.md", report);
console.log("Longitudinal report generated from completed evidence.");
