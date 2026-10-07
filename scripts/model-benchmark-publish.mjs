import fs from "node:fs";
import os from "node:os";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: { input: { type: "string" }, output: { type: "string" } },
});
if (!values.input || !values.output)
  throw new Error("--input and --output required");
const raw = fs.readFileSync(values.input);
const data = JSON.parse(raw);
assert.ok(data.completedAt);
assert.equal(data.pairs.length, 6);
const home = os.homedir();
const forms = [
  home,
  home.replaceAll("\\", "/"),
  JSON.stringify(home).slice(1, -1),
];
function normalize(value) {
  if (typeof value === "string") {
    for (const form of forms) value = value.replaceAll(form, "<home>");
    return value;
  }
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, normalize(item)]),
    );
  return value;
}
const report = normalize(data);
report.publication = {
  privateReportSha256: createHash("sha256").update(raw).digest("hex"),
  normalization:
    "Machine home paths normalized in all string values, including forward-slash links and nested JSON diagnostics. No trial, failure, score, timing or usage observation omitted. Management byte measurements retain the original transport sizes.",
};
fs.writeFileSync(values.output, JSON.stringify(report, null, 2) + "\n");
console.log(
  JSON.stringify({
    output: values.output,
    pairs: report.pairs.length,
    privateReportSha256: report.publication.privateReportSha256,
  }),
);
