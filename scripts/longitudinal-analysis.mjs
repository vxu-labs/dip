export const median = (values) => {
  const v = [...values].sort((a, b) => a - b);
  return v.length % 2
    ? v[Math.floor(v.length / 2)]
    : (v[v.length / 2 - 1] + v[v.length / 2]) / 2;
};
export function summarize(data) {
  const summary = {};
  for (const arm of ["without", "with"]) {
    const rows = data.pairs.map((p) => p.arms[arm]).filter(Boolean);
    const final = rows.map((r) => r.stages.audit?.score).filter(Boolean);
    const turns = rows.flatMap((r) =>
      Object.values(r.stages).map((s) => s.run),
    );
    const totals = rows.map((r) =>
      Object.values(r.stages).reduce((n, s) => n + s.run.wallMs, 0),
    );
    summary[arm] = {
      projects: rows.length,
      finalScored: final.length,
      fullyCorrect: final.filter((s) => s.allPassed).length,
      functionalPassed: final.reduce((n, s) => n + s.passed, 0),
      functionalTotal: final.reduce((n, s) => n + s.total, 0),
      memoryPassed: final.reduce((n, s) => n + s.memoryPassed, 0),
      memoryTotal: final.reduce((n, s) => n + s.memoryTotal, 0),
      falseReleaseReady: final.filter((s) => s.releaseFalsePositive).length,
      unsupportedCompletionClaims: final.reduce(
        (n, s) => n + s.unsupportedClaims.length,
        0,
      ),
      accurateCompleteReports: final.filter(
        (s) => s.allPassed && s.completeReport,
      ).length,
      observedMergeConflicts: rows.reduce(
        (n, r) => n + (r.merge?.conflictPaths?.length || 0),
        0,
      ),
      productMergeConflicts: rows.reduce(
        (n, r) =>
          n +
          (r.merge?.conflictPaths || []).filter((x) => x.endsWith(".mjs"))
            .length,
        0,
      ),
      coordinationDenials: rows.reduce(
        (n, r) =>
          n +
          Object.values(r.stages).reduce(
            (a, s) => a + (s.capture?.kinds?.["coordination.denied"] || 0),
            0,
          ),
        0,
      ),
      intentionalInterruptions: turns.filter((t) => t.interruption).length,
      unexpectedTimeouts: turns.filter((t) => t.timedOut && !t.interruption)
        .length,
      completedTurns: turns.filter((t) => t.completed).length,
      scheduledTurns: turns.length,
      usageReportedTurns: turns.filter((t) => t.usage).length,
      medianSummedTurnWallMs: median(totals),
      inputTokens: turns.reduce((n, t) => n + (t.usage?.input_tokens || 0), 0),
      cachedInputTokens: turns.reduce(
        (n, t) => n + (t.usage?.cached_input_tokens || 0),
        0,
      ),
      outputTokens: turns.reduce(
        (n, t) => n + (t.usage?.output_tokens || 0),
        0,
      ),
      mcpCalls: turns.reduce(
        (n, t) => n + (t.itemCounts?.mcp_tool_call || 0),
        0,
      ),
    };
    summary[arm].coordinationDenials = rows.reduce(
      (n, r) =>
        n +
        new Set(
          Object.values(r.stages).flatMap((s) => s.capture?.denialIds || []),
        ).size,
      0,
    );
    summary[arm].auditProductMutations = rows.filter(
      (r) => r.auditProductMutated,
    ).length;
    summary[arm].contaminatedProjects = rows.filter(
      (r) => r.contamination,
    ).length;
  }
  return summary;
}
