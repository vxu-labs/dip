import fs from "node:fs";
import path from "node:path";

const base = process.argv[2] || "/private/tmp/dip-automatic-pilot-20261028";
const results = JSON.parse(fs.readFileSync(path.join(base, "results.json")));
const parseLines = (file) => fs.existsSync(file) ? fs.readFileSync(file, "utf8").trim().split("\n").flatMap((line) => {
  try { return [JSON.parse(line)]; } catch { return []; }
}) : [];
const bytes = (value) => Buffer.byteLength(typeof value === "string" ? value : JSON.stringify(value ?? null));
const median = (values) => { const s = [...values].sort((a,b)=>a-b); return !s.length ? null : s.length % 2 ? s[Math.floor(s.length/2)] : (s[s.length/2-1]+s[s.length/2])/2; };
const explicit = new Set(["task_create", "task_adopt"]);
const reads = new Set(["project_context", "task_get", "task_requirements", "task_changes", "task_documents", "task_document_read", "project_search", "task_related", "component_owners", "project_requests", "reconcile", "status", "owners", "search"]);
const turns = [];
for (const trial of results.trials) {
  const dir = results.protocol.trials.find((t) => t.index === trial.index && t.arm === trial.arm).dir;
  for (const turn of trial.turns) {
    const items = parseLines(path.join(dir, turn.phase + ".jsonl")).filter(e => e.type === "item.completed").map(e=>e.item);
    const calls = [];
    let cliResultBytes=0, instructionReadBytes=0;
    for (const item of items) {
      if (item.type === "mcp_tool_call" && item.server === "dip") calls.push({ tool:item.tool, transport:"mcp", failed:item.status === "failed", resultBytes:bytes(item.result) });
      if (item.type === "command_execution") {
        const matches = [...(item.command || "").matchAll(/\bdip\s+(?:task\s+([a-z-]+)|(context|reconcile|status|owners|search))/g)];
        if (matches.length) {
          cliResultBytes += bytes(item.aggregated_output || "");
          for (const [index, match] of matches.entries()) calls.push({tool: match[1] ? "task_"+match[1].replaceAll("-","_") : match[2]==="context" ? "project_context" : match[2],transport:"cli",failed:item.exit_code!==0,help:/--help\b/.test(item.command.slice(match.index, matches[index + 1]?.index))});
        } else if (/\bcat\b|\bsed\b/.test(item.command || "") && /AGENTS\.md|CLAUDE\.md|SKILL\.md|intent-guide\.md/.test(item.command || "")) {
          instructionReadBytes += bytes(item.aggregated_output || "");
        }
      }
    }
    const hookFailures = (turn.hookEvents || []).filter(h=>h.exitCode!==0).length;
    const mcpResultBytes = calls.reduce((n,c)=>n+(c.resultBytes||0),0);
    turns.push({scenario:trial.index, arm:trial.arm, phase:turn.phase, completed:turn.completed,
      infrastructureFailure:turn.infrastructureFailure || null, timedOut:turn.timedOut || false,
      wallMs:turn.wallMs, functionalPassed:turn.score?.passed ?? null,functionalTotal:turn.score?.total ?? null,
      memoryPassed:turn.score?.memoryPassed ?? null,memoryTotal:turn.score?.memoryTotal ?? null,
      falseCompletion:turn.falseCompletion ?? null,hookFailures,
      hookCount:turn.hookEvents?.length || 0,hookContextBytes:turn.injectedBytes || 0,mcpResultBytes,cliResultBytes,instructionReadBytes,
      measuredPayloadBytes:(turn.injectedBytes||0)+mcpResultBytes+cliResultBytes+instructionReadBytes,
      calls: calls.map(c=>({...c,category:c.help?"help":explicit.has(c.tool)?"explicit-intent":reads.has(c.tool)?"read":"routine-mutation"})),
    });
  }
}
const arms = Object.fromEntries(["reviewed","automatic"].map(arm=>{
  const rows=turns.filter(t=>t.arm===arm), calls=rows.flatMap(r=>r.calls),times=rows.map(r=>r.wallMs).filter(Number.isFinite);
  return [arm,{turns:rows.length,completed:rows.filter(t=>t.completed).length,infrastructureAffected:rows.filter(t=>t.infrastructureFailure).length,
    medianRecordedWallMs:median(times),recordedWallRangeMs:times.length?[Math.min(...times),Math.max(...times)]:null,
    allCalls:calls.length,routineMutations:calls.filter(c=>c.category==="routine-mutation").length,explicitIntent:calls.filter(c=>c.category==="explicit-intent").length,readCalls:calls.filter(c=>c.category==="read").length,helpCalls:calls.filter(c=>c.category==="help").length,failedCalls:calls.filter(c=>c.failed).length,
    toolCounts:calls.reduce((a,c)=>(a[c.tool]=(a[c.tool]||0)+1,a),{}),measuredPayloadBytes:rows.reduce((n,r)=>n+r.measuredPayloadBytes,0),hookContextBytes:rows.reduce((n,r)=>n+r.hookContextBytes,0),hookFailures:rows.reduce((n,r)=>n+r.hookFailures,0)}];
}));
const recoveryLedger=[];
for(const trial of results.trials){
  const dir=results.protocol.trials.find(t=>t.index===trial.index&&t.arm===trial.arm).dir;
  const file=path.join(dir,"recovery.ledger.json");
  if(!fs.existsSync(file))continue;
  const tasks=JSON.parse(fs.readFileSync(file)).tasks;
  recoveryLedger.push({scenario:trial.index,arm:trial.arm,tasks:tasks.map(t=>({id:t.id,title:t.title,status:t.status,outcome:t.resolution?.outcome,scope:t.scope,remaining:t.checkpoint?.remaining}))});
}
console.log(JSON.stringify({finishedAt:results.finishedAt,turnsStarted:results.turnsStarted,arms,turns,recoveryLedger,
  limits:["Two reviewed queue turns suffered infrastructure failure; one was interrupted. Do not drop them to claim a clean twelve-turn result.","Recorded wall times include bounded post-turn ledger/scoring overhead. Interrupted duration is unknown, not zero.","Payload includes native hook context, MCP replies, DIP CLI output and whole instruction-read command output (which can include other files). It excludes initial host framing and tool schemas; this is not total model-injected bytes.","Explicit intent means create/adopt. Other mutation calls, including failed attempts, count as routine; reads and CLI help are separate. CLI calls are lexical matches in recorded command executions, not an inferred hidden model action. No model-based classification."]},null,2));
