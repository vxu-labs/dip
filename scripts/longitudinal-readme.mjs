import fs from "node:fs";
import { summarize } from "./longitudinal-analysis.mjs";
const data = JSON.parse(
  fs.readFileSync("docs/benchmarks/2026-10-06-longitudinal.json", "utf8"),
);
const stress = JSON.parse(
  fs.readFileSync(
    "docs/benchmarks/2026-10-06-longitudinal-stress.json",
    "utf8",
  ),
);
if (!data.completedAt || !stress.completedAt)
  throw new Error("Publish only completed measurements");
const s = summarize(data),
  a = s.without,
  b = s.with;
const memory = (arm, prefix) =>
  data.pairs
    .flatMap((p) => p.arms[arm].stages.audit.score.memory)
    .filter((x) => (prefix ? x.name.startsWith(prefix) : !x.name.includes(":")))
    .filter((x) => x.passed).length;
const equal =
  a.fullyCorrect === b.fullyCorrect && a.memoryPassed === b.memoryPassed;
const findings = equal
  ? "**No advantage was observed in the primary code-correctness or intent-recovery outcomes against this capable Markdown baseline.**"
  : `Primary final-code success was **${a.fullyCorrect}/4 without DIP and ${b.fullyCorrect}/4 with DIP**. This is a descriptive four-pair experiment, not a general quality-improvement claim.`;
const block = `A longer controlled quality experiment used **four matched project pairs and 72 scheduled fresh Codex turns**, including actual requirement revisions, abrupt process interruption, two concurrent Git worktree workers, real merges and final audits. Both arms were instructed to preserve repository intent and handoffs; the baseline used ordinary Markdown.\n\n| Final quality measure | Without DIP | With DIP |\n|---|---:|---:|\n| Projects passing every primary code case | ${a.fullyCorrect}/4 | ${b.fullyCorrect}/4 |\n| Primary functional cases | ${a.functionalPassed}/${a.functionalTotal} | ${b.functionalPassed}/${b.functionalTotal} |\n| Current policy fields recovered | ${memory("without", null)}/40 | ${memory("with", null)}/40 |\n| Deferred feature identifiers retained | ${memory("without", "deferred:")}/8 | ${memory("with", "deferred:")}/8 |\n| Cancelled feature identifiers retained | ${memory("without", "cancelled:")}/4 | ${memory("with", "cancelled:")}/4 |\n| False release-ready claims against primary cases | ${a.falseReleaseReady} | ${b.falseReleaseReady} |\n| Supplementary exploratory stress checks | ${stress.summary.without.passed}/${stress.summary.without.total} | ${stress.summary.with.passed}/${stress.summary.with.total} |\n\n${findings} DIP ownership checks produced observable claim refusals; Git integration still required conflict resolution. The stress supplement was specified after the primary run started and was evaluated only after collection finished. Thousands of input checks are clustered within four project pairs, not independent projects. This accelerated synthetic lifecycle does not establish general productivity, maintainability or multi-day reliability. [Longitudinal method, every outcome and replayable evidence](docs/benchmarks/longitudinal.md).\n\n`;
const filename = "README.md";
let readme = fs.readFileSync(filename, "utf8");
readme = readme.replace(
  "## Measured cost and real workflow QA",
  "## Measured quality, cost and real workflow QA",
);
const start = readme.indexOf("## Measured quality, cost and real workflow QA"),
  end = readme.indexOf("A controlled Codex pilot used", start);
if (start < 0 || end < 0)
  throw new Error("Existing measured evidence section missing");
readme =
  readme.slice(0, start) +
  "## Measured quality, cost and real workflow QA\n\n" +
  block +
  readme.slice(end);
fs.writeFileSync(filename, readme);
const qa = "QA_REPORT.md";
let report = fs.readFileSync(qa, "utf8");
const qaBlock = `## Longitudinal controlled quality experiment\n\nFour matched pairs ran 72 scheduled fresh Codex turns with actual requirement changes, eight intentional process interruptions, concurrent worktree workers, real Git merges and final read-only audits. Primary final functional results were ${a.functionalPassed}/${a.functionalTotal} without DIP and ${b.functionalPassed}/${b.functionalTotal} with DIP; exact policy/future/cancellation recovery was ${a.memoryPassed}/${a.memoryTotal} and ${b.memoryPassed}/${b.memoryTotal}. False release-ready claims against primary cases: ${a.falseReleaseReady} and ${b.falseReleaseReady}. ${equal ? "No primary quality advantage was observed against the Markdown-capable baseline." : "Results are descriptive; no general quality advantage is established."}\n\nThe supplementary exploratory seeded contract stress checks passed ${stress.summary.without.passed}/${stress.summary.without.total} without DIP and ${stress.summary.with.passed}/${stress.summary.with.total} with DIP. Main protocol/source hashes were published before model execution; the stress supplement was specified later, before inspecting participant source or evaluating stress outcomes. Original protocols and every stage are retained. Separate Node subprocesses prevent stress-project global-state contamination. The configured quality-benchmark and stress-benchmark checks replay public evidence without model calls. [Full report, limitations and raw data](docs/benchmarks/longitudinal.md).\n\n`;
const old = report.indexOf("## Controlled model-backed benchmark");
if (old < 0) throw new Error("Prior QA evidence missing");
report = "# DIP release validation\n\n" + qaBlock + report.slice(old);
report = report.replace(
  "Concurrent-agent, natural-reminder and long-running evaluations remain future work.",
  "Those dimensions were outside this small pilot; the newer longitudinal experiment adds revisions, interruption and concurrent worktrees. Natural-reminder field evaluation and multi-day reliability remain open.",
);
fs.writeFileSync(qa, report);
const indexFile = "docs/benchmarks/README.md";
let index = fs.readFileSync(indexFile, "utf8");
const marker = index.indexOf("## Controlled model-backed pilot");
if (marker < 0) throw new Error("Prior benchmark index missing");
index =
  "# DIP benchmarks\n\n## Longitudinal controlled quality experiment\n\nFour matched project pairs used 72 scheduled fresh conversations with real revisions, interruption, concurrent workers and final audits. Final primary code cases: " +
  a.functionalPassed +
  "/" +
  a.functionalTotal +
  " without DIP and " +
  b.functionalPassed +
  "/" +
  b.functionalTotal +
  " with DIP. Exact intent checks: " +
  a.memoryPassed +
  "/" +
  a.memoryTotal +
  " and " +
  b.memoryPassed +
  "/" +
  b.memoryTotal +
  ". " +
  (equal
    ? "No primary quality advantage was observed against the Markdown baseline."
    : "These are descriptive four-pair results.") +
  " Supplementary exploratory contract stress is reported separately. [Every result, fixed method, supplement, costs and replay](longitudinal.md).\n\n" +
  index.slice(marker);
fs.writeFileSync(indexFile, index);
console.log(
  "README and QA/index updated from completed primary and supplementary measurements.",
);
