import fs from "node:fs";
import { createHash } from "node:crypto";
import {
  corpus,
  relationQuestion,
  identityQuestion,
} from "./laya-pilot-corpus.mjs";
const sha = (file) =>
  createHash("sha256")
    .update(fs.readFileSync(file, "utf8").replaceAll("\r\n", "\n"))
    .digest("hex");
const protocol = {
  schemaVersion: 1,
  protocolVersion: 1,
  createdAt: new Date().toISOString(),
  design:
    "Zero-shot single-checkpoint CPU pilot: 32 author-labeled synthetic task families, each repeated in English, Hebrew and Hebrew-to-English (96 cases). Four-way relationship and independent binary exact identity asked together. No fine-tuning, post-hoc prompt edits, retries, calibration fitting or training.",
  modelRepo: "convaiinnovations/laya",
  subfolder: "multilingual",
  modelRevision: "7b928d828b7b0e022f929d9bd2e44165aa270148",
  packages: {
    laya: "0.3.28",
    torch: "2.8.0+cpu",
    transformers: "4.57.6",
    psutil: "7.2.2",
  },
  device: "cpu",
  threads: 4,
  interopThreads: 1,
  seed: 41729,
  maxLen: 1024,
  headMaxLen: 256,
  labelPolicy:
    "same=equivalent full intended work and target, independent of status; overlap=subset/superset/changed constraint sharing work; related=same target but independent capability; different=unrelated/opposite actions/disjoint versions/components/tenants. Labels authored before inference, not independently adjudicated.",
  baselines:
    "four-way constant-label accuracy 25%; binary always-not-identical accuracy 75%. Language variants cluster by family; not 96 independent projects.",
  ordering:
    "Family order fixed, language order English/Hebrew/cross. Neutral option keys and balanced family rotations; binary positive position alternates by family.",
  safety:
    "Local model inference only, public weights and synthetic inputs. No DIP/Git lifecycle integration. Isolated venv/cache; no implicit HF token. Abort at >4 GiB process RSS or sustained <128 MiB host available RAM. Resource failures are infrastructure outcomes, not classification quality.",
  metrics:
    "Four-way confusion/accuracy by label and language; binary identity precision/recall/false links/misses; raw probability calibration diagnostics, predefined 0.8 answer-probability abstention slice; cold load, warm per-case CPU latency and peak RSS. No automatic task-state mutation or completion assertion.",
  sources: {
    corpus: sha("scripts/laya-pilot-corpus.mjs"),
    runner: sha("scripts/laya-pilot.py"),
  },
  relationQuestion,
  identityQuestion,
  cases: corpus(),
};
fs.writeFileSync(
  "docs/benchmarks/2026-10-07-laya-protocol.json",
  JSON.stringify(protocol, null, 2) + "\n",
);
console.log("Laya pilot protocol saved before task-pair inference.");
