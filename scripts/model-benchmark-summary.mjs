import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: { input: { type: "string" }, output: { type: "string" } },
});
if (!values.input)
  throw new Error("--input must name a complete retained model report");
const data = JSON.parse(fs.readFileSync(values.input));
assert.ok(data.completedAt);
assert.equal(data.pairs.length, 6);
const median = (values) => {
  const rows = [...values].sort((a, b) => a - b);
  return (rows[2] + rows[3]) / 2;
};
const arms = Object.fromEntries(
  ["without", "with"].map((arm) => {
    const rows = data.pairs.map((pair) => pair.arms[arm]);
    const turns = rows.flatMap((row) => [row.seed, row.recovery]);
    const calls = turns.flatMap((turn) => turn.managementCalls || []);
    return [
      arm,
      {
        functional: rows.reduce((n, row) => n + row.score.passed, 0),
        functionalTotal: 48,
        memory: rows.reduce((n, row) => n + row.score.memoryPassed, 0),
        memoryTotal: 36,
        successfulPairs: rows.filter((row) => row.success).length,
        completedTurns: turns.filter((turn) => turn.completed).length,
        timeouts: turns.filter((turn) => turn.timedOut).length,
        medianObservedWallSeconds: +(
          median(rows.map((row) => row.seed.wallMs + row.recovery.wallMs)) /
          1000
        ).toFixed(2),
        mcpCalls: calls.length,
        mcpResultBytes: calls.reduce((n, call) => n + call.resultBytes, 0),
        usageReportedTurns: turns.filter((turn) => turn.usage).length,
        knownInputTokens: turns.reduce(
          (n, turn) => n + (turn.usage?.input_tokens || 0),
          0,
        ),
        knownOutputTokens: turns.reduce(
          (n, turn) => n + (turn.usage?.output_tokens || 0),
          0,
        ),
        tools: calls.reduce(
          (counts, call) => ({
            ...counts,
            [call.tool]: (counts[call.tool] || 0) + 1,
          }),
          {},
        ),
      },
    ];
  }),
);
const jsonFile =
  values.output ||
  `.dip-local/model-summary-v${data.protocol.protocolVersion}.json`;
fs.writeFileSync(
  jsonFile,
  JSON.stringify(
    {
      protocolVersion: data.protocol.protocolVersion,
      dipVersion: data.dipVersion,
      arms,
    },
    null,
    2,
  ) + "\n",
);
console.log(
  JSON.stringify(
    {
      protocolVersion: data.protocol.protocolVersion,
      dipVersion: data.dipVersion,
      arms,
    },
    null,
    2,
  ),
);
