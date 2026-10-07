export function scorePilot(data) {
  const cases = data.protocol.cases,
    rows = new Map(data.rows.map((row) => [row.id, row]));
  const labels = ["same", "overlap", "related", "different"];
  const confusion = Object.fromEntries(
    labels.map((label) => [
      label,
      Object.fromEntries([...labels, "error"].map((x) => [x, 0])),
    ]),
  );
  let correct = 0,
    tp = 0,
    fp = 0,
    fn = 0,
    tn = 0,
    errors = 0,
    brier = 0;
  const languages = {};
  const confident = { covered: 0, correct: 0, falseLinks: 0 };
  const bins = Array.from({ length: 10 }, () => ({
    count: 0,
    confidence: 0,
    correct: 0,
  }));
  for (const item of cases) {
    const row = rows.get(item.id),
      ok = !!row && !row.error;
    const prediction = ok ? row.relation : "error";
    confusion[item.expected][prediction] =
      (confusion[item.expected][prediction] || 0) + 1;
    const language =
      languages[item.language] ||
      (languages[item.language] = {
        total: 0,
        relationCorrect: 0,
        identityCorrect: 0,
        falseLinks: 0,
        missedLinks: 0,
      });
    language.total++;
    if (!ok) {
      errors++;
      continue;
    }
    const right = prediction === item.expected;
    if (right) {
      correct++;
      language.relationCorrect++;
    }
    const identityRight = row.identity === item.identity;
    if (identityRight) language.identityCorrect++;
    if (row.identity && item.identity) tp++;
    else if (row.identity && !item.identity) {
      fp++;
      language.falseLinks++;
    } else if (!row.identity && item.identity) {
      fn++;
      language.missedLinks++;
    } else tn++;
    const answer = row.prediction.answers.identity;
    const key = Object.keys(row.identityMap).find(
      (key) => row.identityMap[key] === "yes",
    );
    const probability = answer.probabilities[key];
    brier += (probability - (item.identity ? 1 : 0)) ** 2;
    const confidence = Math.max(...Object.values(answer.probabilities));
    const bin = bins[Math.min(9, Math.floor(confidence * 10))];
    bin.count++;
    bin.confidence += confidence;
    bin.correct += identityRight ? 1 : 0;
    if (confidence >= 0.8) {
      confident.covered++;
      confident.correct += identityRight ? 1 : 0;
      if (row.identity && !item.identity) confident.falseLinks++;
    }
  }
  const usable = cases.length - errors;
  const ordered = data.rows.map((row) => row.wallSeconds).sort((a, b) => a - b);
  const median = ordered.length
    ? ordered.length % 2
      ? ordered[Math.floor(ordered.length / 2)]
      : (ordered[ordered.length / 2 - 1] + ordered[ordered.length / 2]) / 2
    : null;
  const ece = usable
    ? bins.reduce(
        (total, bin) =>
          total +
          (bin.count
            ? (Math.abs(bin.confidence / bin.count - bin.correct / bin.count) *
                bin.count) /
              usable
            : 0),
        0,
      )
    : null;
  return {
    total: cases.length,
    scored: usable,
    errors,
    relationCorrect: correct,
    relationAccuracy: correct / cases.length,
    identityCorrect: tp + tn,
    identityAccuracy: (tp + tn) / cases.length,
    identity: {
      tp,
      fp,
      fn,
      tn,
      precision: tp + fp ? tp / (tp + fp) : null,
      recall: tp + fn ? tp / (tp + fn) : null,
    },
    confusion,
    languages,
    confidenceAtLeast08: confident,
    binaryBrier: usable ? brier / usable : null,
    binaryEce10: ece,
    medianSecondsPerPairTwoQuestions: median,
    p95SecondsPerPairTwoQuestions: ordered.length
      ? ordered[Math.ceil(ordered.length * 0.95) - 1]
      : null,
  };
}
