import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    input: { type: "string" },
    output: { type: "string" },
  },
});
if (!values.input)
  throw new Error("--input must name a retained experiment directory");
const result = {
  schemaVersion: 1,
  calls: 0,
  resultBytes: 0,
  tools: {},
  toolPayloads: {},
  transitions: {},
  adjacentSameRead: 0,
  transcripts: [],
};
for (let pair = 0; pair < 6; pair++)
  for (const phase of ["seed", "recovery"]) {
    const file = path.join(
      values.input,
      `pair-${pair}`,
      "with",
      `${phase}.jsonl`,
    );
    const raw = fs.readFileSync(file);
    const events = raw
      .toString()
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    const calls = events
      .filter(
        (e) => e.type === "item.completed" && e.item.type === "mcp_tool_call",
      )
      .map((e) => e.item);
    const sequence = calls.map((c) => c.tool);
    result.transcripts.push({
      pair,
      phase,
      sha256: createHash("sha256").update(raw).digest("hex"),
      sequence,
    });
    for (let i = 0; i < calls.length; i++) {
      const c = calls[i];
      result.calls++;
      result.tools[c.tool] = (result.tools[c.tool] || 0) + 1;
      const bytes = Buffer.byteLength(JSON.stringify(c.result ?? null));
      result.resultBytes += bytes;
      const payload = (result.toolPayloads[c.tool] ||= {
        calls: 0,
        bytes: 0,
        maxBytes: 0,
      });
      payload.calls++;
      payload.bytes += bytes;
      payload.maxBytes = Math.max(payload.maxBytes, bytes);
      if (i) {
        const prev = calls[i - 1],
          transition = `${prev.tool} -> ${c.tool}`;
        result.transitions[transition] =
          (result.transitions[transition] || 0) + 1;
        if (
          prev.tool === "task_get" &&
          c.tool === "task_get" &&
          JSON.stringify(prev.arguments) === JSON.stringify(c.arguments)
        )
          result.adjacentSameRead++;
      }
    }
  }
result.notes =
  "Adjacent reads are a diagnostic, not proof of wasted work. Serialized result bytes include MCP envelope. Transcript hashes identify retained original evidence; arguments, lease tokens and machine paths are excluded.";
fs.writeFileSync(
  values.output || ".dip-local/management-profile.json",
  JSON.stringify(result, null, 2) + "\n",
);
console.log(
  JSON.stringify({
    calls: result.calls,
    resultBytes: result.resultBytes,
    tools: result.tools,
    adjacentSameRead: result.adjacentSameRead,
  }),
);
