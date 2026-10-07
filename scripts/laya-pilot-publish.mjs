import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import assert from "node:assert/strict";
import { scorePilot } from "./laya-pilot-analysis.mjs";
const file = "docs/benchmarks/2026-10-07-laya.json";
const privateDir = ".dip-local/laya-originals";
fs.mkdirSync(privateDir, { recursive: true });
const source = JSON.parse(fs.readFileSync(file, "utf8"));
assert.ok(
  source.completedAt &&
    source.rows.length === 96 &&
    !source.infrastructureError &&
    !source.resourceAbort,
);
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const home = os.homedir(),
  homePattern = new RegExp(
    home
      .split(/[\\/]/)
      .map(escape)
      .join(String.raw`(?:\\+|/)`),
    "g",
  );
function redact(x) {
  if (typeof x === "string")
    return x
      .replace(homePattern, "<home>")
      .replace(
        /([?&](?:sig|token|access_token|key|signature)=)[^&\s"<>]+/gi,
        "$1[REDACTED]",
      );
  if (Array.isArray(x)) return x.map(redact);
  if (x && typeof x === "object")
    return Object.fromEntries(
      Object.entries(x).map(([k, v]) => [k, redact(v)]),
    );
  return x;
}
for (const [name, input] of [
  ["2026-10-07-laya.json", file],
  [
    "2026-10-07-laya-setup-attempt1.json",
    ".dip-local/laya-setup-attempt1.json",
  ],
  ["2026-10-07-laya-preflight.json", ".dip-local/laya-preflight-v2.json"],
]) {
  if (!fs.existsSync(input)) continue;
  const backup = path.join(privateDir, name);
  if (!fs.existsSync(backup)) fs.copyFileSync(input, backup);
  const original = JSON.parse(fs.readFileSync(input, "utf8")),
    data = redact(original);
  assert.deepEqual(data.protocol, original.protocol);
  if (name === "2026-10-07-laya.json") {
    data.summary = scorePilot(data);
    assert.deepEqual(data.summary, scorePilot(original));
  }
  data.publicRedaction =
    "Owner paths and signed URL query credentials redacted; original inputs/predictions/probabilities unchanged. No credentials or model weights published.";
  fs.writeFileSync(
    path.join("docs/benchmarks", name),
    JSON.stringify(data, null, 2) + "\n",
  );
}
fs.copyFileSync(
  ".dip-local/laya-requirements-lock.txt",
  "docs/benchmarks/2026-10-07-laya-requirements.txt",
);
const data = JSON.parse(fs.readFileSync(file)),
  s = data.summary;
const percent = (x) =>
  x === null ? "unavailable" : (100 * x).toFixed(1) + "%";
const languages = Object.entries(s.languages)
  .map(
    ([name, x]) =>
      `| ${name} | ${x.relationCorrect}/${x.total} | ${x.identityCorrect}/${x.total} | ${x.falseLinks} | ${x.missedLinks} |`,
  )
  .join("\n");
const confusion = Object.entries(s.confusion)
  .map(
    ([name, x]) =>
      `| ${name} | ${x.same} | ${x.overlap} | ${x.related} | ${x.different} | ${x.error} |`,
  )
  .join("\n");
const report = `# Laya task-matching zero-shot pilot

**This checkpoint/prompt is not ready to merge DIP tasks automatically.** It found ${s.identity.tp}/24 true identity pairs but also labeled ${s.identity.fp}/72 non-identical pairs as identical. The precision of its identical-task suggestions was ${percent(s.identity.precision)}. This is an initial author-defined synthetic pilot, not a proof that all Laya variants fail or that fine-tuning will fix it.

## Results

| Measure | Result |
|---|---:|
| Four-way relationship accuracy | ${s.relationCorrect}/96 (${percent(s.relationAccuracy)}) |
| Binary exact-identity accuracy | ${s.identityCorrect}/96 (${percent(s.identityAccuracy)}) |
| Constant not-identical binary baseline | 72/96 (75.0%) |
| Constant single-class four-way baseline | 24/96 (25.0%) |
| Exact-identity precision | ${s.identity.tp}/${s.identity.tp + s.identity.fp} (${percent(s.identity.precision)}) |
| Exact-identity recall | ${s.identity.tp}/24 (${percent(s.identity.recall)}) |
| False exact-identity decisions | ${s.identity.fp}/72 non-identical pairs |
| Missed true identities | ${s.identity.fn}/24 identical pairs |
| Errors / truncated inputs | ${s.errors} / ${data.rows.filter((r) => r.prediction?.usage?.truncated).length} |
| Binary Brier score | ${s.binaryBrier.toFixed(4)} |
| Binary confidence ECE, 10 bins | ${s.binaryEce10.toFixed(4)} |

The always-not-identical baseline has no useful recall; its 75% accuracy shows why accuracy alone is insufficient. False identity combines partial overlap, related work and different work. These may still be useful candidate links, but do not justify treating the requirements as equivalent or closing an old task. No real DIP task status was changed by this model.

## Language breakdown

| Inputs | Relationship correct | Identity correct | False identities | Missed identities |
|---|---:|---:|---:|---:|
${languages}

Four-way confusion matrix, rows = expected relationship, columns = prediction:

| Expected | same | overlap | related | different | error |
|---|---:|---:|---:|---:|---:|
${confusion}

The four-way and binary questions are separate heads/requests within one predict call and can disagree. Both outputs are retained; no more favorable question is substituted after observing results.

## Confidence and resource cost

At the predefined 0.8 top-answer-probability threshold, ${s.confidenceAtLeast08.covered}/96 pairs were covered and ${s.confidenceAtLeast08.correct} were correct; ${s.confidenceAtLeast08.falseLinks} false identities remained. The cutoff was not fitted on these outcomes. Reported probability is not a guarantee of correctness on DIP data. The SDK's entropy confidence and act_probability are not used as truth gates.

| Resource measure | Observed |
|---|---:|
| Parameter count | ${data.parameterCount.toLocaleString("en-US")} |
| CPU dtype / threads | ${data.dtype} / ${data.threads} |
| Process load, including cached Hub lookup | ${data.loadSeconds.toFixed(2)} s |
| Separate non-task warmup | ${data.warmupSeconds.toFixed(3)} s |
| Median pair latency, two questions | ${s.medianSecondsPerPairTwoQuestions.toFixed(3)} s |
| p95 pair latency, two questions | ${s.p95SecondsPerPairTwoQuestions.toFixed(3)} s |
| Peak sampled process RSS | ${(data.peakRssBytes / 2 ** 30).toFixed(2)} GiB |

Measured on this Windows laptop, four CPU threads, eager FP32, single pair per call. Latency includes two questions; it is not comparable to upstream single-question GPU latency. Peak RSS was sampled every 100ms and can miss shorter peaks. Model downloads and Python installation are excluded from scored-pair timing. The weights/cache/venv are local ignored artifacts, not a new product dependency or always-running service.

## Fixed method

- Model: convaiinnovations/laya, multilingual subfolder, pinned revision ${data.loadedRevision}. Runtime Laya ${data.packages.laya}, PyTorch ${data.packages.torch}, Transformers ${data.packages.transformers}, Python ${data.python}.
- [Protocol v2](2026-10-07-laya-protocol.json) and source hashes were published in 786dc04 before any task-pair prediction. [Original protocol v1](2026-10-07-laya-protocol-v1.json) remains available. Model execution started ${data.startedAt}, ended ${data.completedAt}.
- 32 authored task families, each rendered in English, Hebrew and Hebrew-to-English: 96 cases, four balanced labels. Status alternates backlog/verified across families and is explicitly irrelevant to identity. Language variants cluster by family; they are not 96 independent projects. No independently blinded label adjudication has been done.
- Labels distinguish equivalent work, overlapping requirements, a related but separate capability, and unrelated/opposite/disjoint-target work. Changed constraints are overlap; opposite actions or disjoint API versions/tenants are different. This operational definition may differ from an organization's policy for updating an existing task.
- Neutral answer keys and balanced family rotations reduce fixed-option-position cues. The two schemas are fixed in the protocol. Only case.state is passed to inference; expected labels are never provided to the model. No prompt edits, scored retries, threshold fitting, calibration fitting, fine-tuning or distillation followed outcomes. Checkpoint-provided defaults remain active.
- Multilingual is forced for all languages to isolate one checkpoint. The English checkpoint and automatic Router were not compared. A different schema, trained checkpoint, reranker or deployment could perform differently.
- The first load attempt failed with Windows symlink privileges during concurrent Hub downloads. Its [setup outcome](2026-10-07-laya-setup-attempt1.json) is retained and excluded from accuracy. Sequential pinned downloads solved setup without administrator rights. [Successful infrastructure preflight](2026-10-07-laya-preflight.json) used a non-domain color question, excluded from all scores.
- No host-memory or process-RSS guard fired in the scored run. The published protocol records resource caps and safeguards. Inputs are synthetic; no user project source or chat credentials were sent to an inference service. Weights were downloaded from the public Hub.

## Interpretation and next work

The model runs without additional training and finds many relevant candidate identities, but it is too permissive for exact-equivalence decisions under this schema. A domain fine-tune or a different pretrained model is warranted for evaluation; this pilot does not prove training is necessary or sufficient. Current adoption should keep model output as candidate evidence reviewed by the existing agent, with real code checks deciding verified completion.

The open-source alternatives task is recorded in DIP as task_8b4318ef-b13d-4420-988f-5266db4cd215. Candidate selection must check weight/code licenses and compare identical held-out inputs plus false-merge rates and CPU/RAM cost. Future training needs independently reviewed labels, more domains, and project/time splits that keep paraphrases out of both training and test. Retrieval over large histories, real code completion and live Git-agent triggers were not evaluated here.

## Reproduce and audit

- [All inputs, schemas and pinned settings](2026-10-07-laya-protocol.json)
- [Every prediction, probability and score](2026-10-07-laya.json)
- [Dependency lock](2026-10-07-laya-requirements.txt)
- Offline score validation without installing/downloading a model: node scripts/laya-pilot-evidence.mjs.
- To rerun the model, create a separate Python 3.12 venv, install the CPU torch 2.8.0 build from the PyTorch CPU index and then the dependency lock. Run scripts/laya-pilot.py with --protocol docs/benchmarks/2026-10-07-laya-protocol.json --output a-new-results.json --cache a-local-model-cache. Do not overwrite the published outcome file.
- Official model/runtime references: [model card](https://huggingface.co/convaiinnovations/laya), [runtime release](https://pypi.org/project/laya/0.3.28/).
`;
fs.writeFileSync("docs/benchmarks/laya-pilot.md", report);
console.log(JSON.stringify({ published: true, summary: s }));
