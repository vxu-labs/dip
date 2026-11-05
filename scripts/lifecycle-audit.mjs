// Read-only audit: projection changes no historical status, evidence or events.
import fs from "node:fs";
import path from "node:path";
import { openProject, project, Runtime } from "../src/core.js";
import { capturedKind } from "../src/workflow.js";
const args = process.argv.slice(2);
if (args.length !== 2 || !["--root", "--catalog"].includes(args[0]))
  throw Error("Use --root PATH or --catalog PATH");
const roots =
  args[0] === "--root"
    ? [path.resolve(args[1])]
    : JSON.parse(fs.readFileSync(args[1], "utf8")).projects.map((p) => p.root);
const totals = {
  projects: 0,
  tasks: 0,
  inactive: 0,
  responseRecorded: 0,
  explicitInterruption: 0,
  legacyUnclosed: 0,
  generatedWorkCandidates: 0,
};
const errors = [];
const runtime = new Runtime();
try {
  for (const root of new Set(roots))
    try {
      const state = project(openProject(root), runtime, null, {
        includeActivity: false,
      });
      if (state.errors.length) {
        errors.push({
          root,
          error: "Invalid history: " + state.errors.length + " records",
        });
        continue;
      }
      totals.projects++;
      totals.tasks += state.tasks.length;
      for (const t of state.tasks) {
        if (t.inactive) totals.inactive++;
        if (t.activityState === "responded") totals.responseRecorded++;
        if (t.interrupted) totals.explicitInterruption++;
        if (t.inactive && !t.lifecycle) totals.legacyUnclosed++;
        if (
          t.kind === "work" &&
          t.history[0]?.payload.source === "prompt" &&
          capturedKind(t.description) === "discussion"
        )
          totals.generatedWorkCandidates++;
      }
    } catch (e) {
      errors.push({ root, error: e.message });
    }
} finally {
  runtime.close();
}
console.log(
  JSON.stringify(
    { readOnly: true, changedHistoricalStatuses: 0, totals, errors },
    null,
    2,
  ),
);
