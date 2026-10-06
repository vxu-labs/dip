import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { summarize } from "./longitudinal-analysis.mjs";
const filename = process.argv[2];
if (!filename)
  throw new Error("Pass the completed public evidence file to redact");
const data = JSON.parse(fs.readFileSync(filename, "utf8"));
if (!data.completedAt)
  throw new Error("Never rewrite evidence while collection is still running");
const privateDir = path.resolve(".dip-local/longitudinal-originals");
fs.mkdirSync(privateDir, { recursive: true });
const backup = path.join(privateDir, path.basename(filename));
if (!fs.existsSync(backup)) fs.copyFileSync(filename, backup);
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const home = os.homedir();
const variants = [
  home,
  home.replaceAll("\\", "/"),
  home.replaceAll("\\", "\\\\"),
].sort((a, b) => b.length - a.length);
function redact(value) {
  if (typeof value === "string") {
    let out = value;
    for (const variant of variants) out = out.replaceAll(variant, "<home>");
    out = out.replace(
      new RegExp(
        home
          .split(/[\\/]/)
          .map(escape)
          .join(String.raw`(?:\\+|/)`),
        "g",
      ),
      "<home>",
    );
    out = out.replace(
      /([?&](?:sig|token|access_token|key|signature)=)[^&\s"<>]+/gi,
      "$1[REDACTED]",
    );
    out = out.replace(
      /\b(?:gh[pousr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+|sk-[A-Za-z0-9_-]{12,})\b/g,
      "[REDACTED]",
    );
    return out;
  }
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, redact(v)]),
    );
  return value;
}
const sanitized = redact(data);
assert.deepEqual(
  sanitized.protocol,
  data.protocol,
  "Redaction must not change registered prompts or contracts",
);
if (!data.preflight)
  assert.deepEqual(
    summarize(sanitized),
    summarize(data),
    "Redaction must not change measured results",
  );
for (const pair of sanitized.pairs || [])
  for (const row of Object.values(pair.arms || {}))
    for (const stage of Object.values(row.stages || {}))
      for (const artifact of Object.values(stage.artifacts))
        artifact.sha256 = createHash("sha256")
          .update(artifact.text)
          .digest("hex");
sanitized.publicRedaction =
  "Local owner paths and signed URL query credentials redacted. Private original retained locally. Artifact hashes cover sanitized public text; prompts, contracts, numeric metrics and pass/fail outcomes unchanged.";
fs.writeFileSync(filename, JSON.stringify(sanitized, null, 2) + "\n");
console.log("Public evidence redacted; private original preserved.");
