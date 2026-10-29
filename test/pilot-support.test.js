import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { pilotMcpEnvVars, installPilotShims, trialEnvironment, forwardedMcpEnvironment } from "../scripts/pilot-support.mjs";

test("pilot refuses filtered MCP routing instead of falling back to the host", () => {
  const env = Object.fromEntries(pilotMcpEnvVars.map((name) => [name, "isolated"]));
  assert.throws(() => forwardedMcpEnvironment({}, env), /explicitly forward DIP_PILOT_ARM/);
  const forwarded = forwardedMcpEnvironment({ env_vars: pilotMcpEnvVars }, { ...env, SECRET: "must not forward" });
  assert.equal(forwarded.SECRET, undefined);
  assert.deepEqual(forwarded, env);
  assert.throws(() => forwardedMcpEnvironment({ env_vars: pilotMcpEnvVars }, {}), /Missing pilot environment/);
});

test("CLI fallback selects each frozen arm even with spaces and apostrophes in the path", () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "dip pilot's-"));
  try {
    for (const arm of ["reviewed", "automatic"]) {
      fs.mkdirSync(path.join(base, arm, "bin"), { recursive: true });
      fs.writeFileSync(path.join(base, arm, "bin/dip.js"), `console.log(JSON.stringify({arm:${JSON.stringify(arm)}, args:process.argv.slice(2)}))`);
    }
    installPilotShims(base);
    for (const arm of ["reviewed", "automatic"]) {
      const env = trialEnvironment(base, { arm, dir: path.join(base, arm) }, process.env);
      const result = JSON.parse(execFileSync("/bin/sh", ["-c", "dip 'argument with spaces'"], { env, encoding: "utf8" }));
      assert.deepEqual(result, { arm, args: ["argument with spaces"] });
      assert.equal(env.DIP_PILOT_ARM, arm);
      assert.equal(env.DIP_WORKFLOW, arm);
    }
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});
