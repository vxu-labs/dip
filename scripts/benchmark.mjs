import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { performance } from "node:perf_hooks";
import { execFileSync } from "node:child_process";
import { ensure } from "../src/core.js";
import { handleHook } from "../src/automation.js";
import { git } from "../src/util.js";
const folder = fs.mkdtempSync(path.join(os.tmpdir(), "dip-bench-"));
process.env.DIP_HOME = path.join(folder, "runtime");
process.env.GIT_CONFIG_GLOBAL = path.join(folder, "global.gitconfig");
git(folder, ["init"]);
ensure(folder);
const sample = {
  cwd: folder,
  session_id: "benchmark",
  hook_event_name: "PostToolUse",
  tool_name: "Bash",
  tool_input: { command: "npm test" },
};
const times = [];
try {
  for (let n = 0; n < 30; n++) {
    const start = performance.now();
    handleHook({ ...sample, tool_use_id: String(n) }, "fixture");
    times.push(performance.now() - start);
  }
  const subprocess = [];
  for (let n = 0; n < 10; n++) {
    const start = performance.now();
    execFileSync(
      process.execPath,
      ["bin/dip.js", "hook", "--agent", "fixture"],
      {
        input: JSON.stringify({ ...sample, tool_use_id: "process-" + n }),
        stdio: ["pipe", "ignore", "pipe"],
        windowsHide: true,
        env: process.env,
      },
    );
    subprocess.push(performance.now() - start);
  }
  const percentile = (values, p) =>
    [...values].sort((a, b) => a - b)[Math.floor(values.length * p)];
  console.log(
    JSON.stringify(
      {
        node: process.version,
        platform: process.platform,
        samples: times.length,
        hookInProcessMedianMs: percentile(times, 0.5),
        hookInProcessP95Ms: percentile(times, 0.95),
        hookProcessMedianMs: percentile(subprocess, 0.5),
        hookProcessP95Ms: percentile(subprocess, 0.9),
        modelCalls: 0,
      },
      null,
      2,
    ),
  );
} finally {
  fs.rmSync(folder, { recursive: true, force: true });
}
