import assert from "node:assert/strict";

export const commonInstructions = `Work only in this repository. Do not inspect sibling directories, user settings, credentials, previous sessions or external projects. Do not use the network, browse, install dependencies, spawn agents, commit or change machine settings. Use the repository's provided tools and state. Ordinary Markdown planning/handoff notes are allowed. Use Node.js built-ins. Run PowerShell without a profile. Keep future features deferred. A stopped turn is not completed development.`;

export const recoveryPrompt = `This is a new conversation without the previous chat. Recover the latest v1 requirements and deferred feature from repository state. Finish the pending v1 functions in lib.mjs, honor the latest revision, and do not implement the deferred feature. Check your work with local Node.js checks. Create recovery.json with {"contract":{the recovered contract fields and values},"deferred":[feature identifiers],"completed":[implemented function names],"unresolved":[remaining work]}. State uncertainty instead of inventing lost requirements. Do not access anything outside this repository.`;

export function fixture(index) {
  const kind = ["queue", "csv", "search"][index % 3];
  const repeat = Math.floor(index / 3);
  let contract, spec, first, later, future, tests;
  if (kind === "queue") {
    const capacity = repeat ? 3 : 2;
    contract = { capacity, order: "input", invalid: "drop", mutate: false };
    first = "normalizeJobs";
    later = "scheduleJobs";
    future = "PRIORITY_SCHEDULING";
    spec = `Export normalizeJobs(jobs) and scheduleJobs(jobs) from lib.mjs. normalizeJobs returns new {id,duration} objects for jobs whose id is a nonempty string and duration is a positive integer; drop other jobs, preserve input order and duplicate ids, and do not mutate input. scheduleJobs consumes the normalized jobs and returns {id,start,end,slot} entries in input order. Maintain ${capacity} slots initially free at time 0, assigning each next job to the earliest available slot, with ties going to the lowest zero-based slot. Ignore all priority fields. The early proposal was to sort by priority; the FINAL revision explicitly requires input order. PRIORITY_SCHEDULING is a distinct deferred future feature and must not be implemented in v1.`;
    tests = (m) => [
      [
        "normalization",
        () =>
          assert.deepEqual(
            m.normalizeJobs([{ id: "a", duration: 2, extra: 9 }]),
            [{ id: "a", duration: 2 }],
          ),
      ],
      [
        "invalid input",
        () =>
          assert.deepEqual(
            m.normalizeJobs([
              { id: "", duration: 2 },
              { id: "a", duration: 0 },
              { id: "b", duration: 1.5 },
              null,
              { id: 3, duration: 2 },
            ]),
            [],
          ),
      ],
      [
        "duplicates",
        () =>
          assert.equal(
            m.normalizeJobs([
              { id: "a", duration: 1 },
              { id: "a", duration: 2 },
            ]).length,
            2,
          ),
      ],
      [
        "immutable",
        () => {
          const input = [{ id: "a", duration: 2, priority: 9 }];
          const before = JSON.stringify(input);
          m.scheduleJobs(input);
          assert.equal(JSON.stringify(input), before);
        },
      ],
      [
        "capacity and tie",
        () =>
          assert.deepEqual(
            m.scheduleJobs(
              Array.from({ length: capacity + 1 }, (_, i) => ({
                id: String(i),
                duration: 2,
              })),
            ),
            Array.from({ length: capacity + 1 }, (_, i) => ({
              id: String(i),
              start: i < capacity ? 0 : 2,
              end: i < capacity ? 2 : 4,
              slot: i < capacity ? i : 0,
            })),
          ),
      ],
      [
        "latest order",
        () =>
          assert.deepEqual(
            m
              .scheduleJobs([
                { id: "low", duration: 3, priority: 0 },
                { id: "high", duration: 1, priority: 100 },
              ])
              .map((x) => x.id),
            ["low", "high"],
          ),
      ],
      [
        "earliest slot",
        () => {
          const jobs = Array.from({ length: capacity }, (_, i) => ({
            id: String(i),
            duration: i === 1 ? 1 : 5,
          }));
          jobs.push({ id: "next", duration: 3 });
          assert.deepEqual(m.scheduleJobs(jobs).at(-1), {
            id: "next",
            start: 1,
            end: 4,
            slot: 1,
          });
        },
      ],
      ["empty", () => assert.deepEqual(m.scheduleJobs([]), [])],
    ];
  } else if (kind === "csv") {
    const separator = repeat ? "\t" : ",";
    contract = {
      separator,
      newline: "CRLF",
      nullValue: "",
      trailingNewline: false,
    };
    first = "encodeCell";
    later = "encodeTable";
    future = "CSV_IMPORT";
    spec = `Export encodeCell(value) and encodeTable(rows) from lib.mjs. The delimiter is ${JSON.stringify(separator)}. encodeCell converts null/undefined to an empty string, otherwise uses String(value). If a cell contains the delimiter, a double quote, CR or LF, quote the cell and double embedded quotes; otherwise leave it unquoted. encodeTable accepts an array of array rows, joins encoded cells with the delimiter, joins rows with CRLF, and has no final newline. Empty rows are empty records; an empty table is an empty string. Do not mutate rows. The early proposal used LF; the FINAL revision is CRLF. CSV_IMPORT is deferred, with no parser or import feature in v1.`;
    tests = (m) => [
      ["ordinary cell", () => assert.equal(m.encodeCell("alpha"), "alpha")],
      [
        "null conversion",
        () => {
          assert.equal(m.encodeCell(null), "");
          assert.equal(m.encodeCell(undefined), "");
          assert.equal(m.encodeCell(0), "0");
        },
      ],
      [
        "delimiter escape",
        () => assert.equal(m.encodeCell(`a${separator}b`), `"a${separator}b"`),
      ],
      ["quote escape", () => assert.equal(m.encodeCell('a"b'), '"a""b"')],
      [
        "line escape",
        () => {
          assert.equal(m.encodeCell("a\nb"), '"a\nb"');
          assert.equal(m.encodeCell("a\rb"), '"a\rb"');
        },
      ],
      [
        "latest newline",
        () =>
          assert.equal(
            m.encodeTable([
              ["a", "b"],
              ["c", "d"],
            ]),
            `a${separator}b\r\nc${separator}d`,
          ),
      ],
      [
        "empty and unicode",
        () => {
          assert.equal(m.encodeTable([]), "");
          assert.equal(m.encodeTable([[], ["שלום"]]), "\r\nשלום");
        },
      ],
      [
        "immutable",
        () => {
          const rows = [
            [null, 'a"b'],
            [1, "x"],
          ];
          const before = JSON.stringify(rows);
          m.encodeTable(rows);
          assert.equal(JSON.stringify(rows), before);
        },
      ],
    ];
  } else {
    const limit = repeat ? 2 : 3;
    contract = {
      limit,
      order: "input",
      query: "trim-lowercase",
      empty: "no-results",
    };
    first = "normalizeQuery";
    later = "findMatches";
    future = "FUZZY_SEARCH";
    spec = `Export normalizeQuery(query) and findMatches(items,query) from lib.mjs. normalizeQuery returns query.trim().toLowerCase() for string input and an empty string otherwise. findMatches returns up to ${limit} original item objects whose string label contains the normalized query, case-insensitively; skip non-string labels, preserve input order, do not mutate input. An empty normalized query returns []. Do not strip accents or normalize Unicode. The early proposal sorted alphabetically; the FINAL revision preserves input order. FUZZY_SEARCH is deferred and must not be implemented in v1.`;
    tests = (m) => [
      [
        "query normalization",
        () => assert.equal(m.normalizeQuery("  HeLLo  "), "hello"),
      ],
      [
        "invalid query",
        () => {
          assert.equal(m.normalizeQuery(null), "");
          assert.equal(m.normalizeQuery(9), "");
        },
      ],
      [
        "latest order",
        () =>
          assert.deepEqual(
            m
              .findMatches(
                [{ label: "Zulu cat" }, { label: "Alpha cat" }],
                "CAT",
              )
              .map((x) => x.label),
            ["Zulu cat", "Alpha cat"],
          ),
      ],
      [
        "limit",
        () =>
          assert.equal(
            m.findMatches(
              Array.from({ length: 6 }, (_, i) => ({ label: `cat ${i}` })),
              "cat",
            ).length,
            limit,
          ),
      ],
      [
        "empty",
        () =>
          assert.deepEqual(m.findMatches([{ label: "anything" }], "  "), []),
      ],
      [
        "invalid labels",
        () =>
          assert.deepEqual(
            m.findMatches([{ label: 3 }, null, { label: "cat" }], "cat"),
            [{ label: "cat" }],
          ),
      ],
      [
        "accents and unicode",
        () => {
          assert.deepEqual(m.findMatches([{ label: "café" }], "cafe"), []);
          assert.deepEqual(m.findMatches([{ label: "שלום" }], "שלום"), [
            { label: "שלום" },
          ]);
        },
      ],
      [
        "identity and immutable",
        () => {
          const item = { label: "cat" };
          const items = [item];
          assert.equal(m.findMatches(items, "cat")[0], item);
          assert.deepEqual(items, [item]);
        },
      ],
    ];
  }
  const seedPrompt = `Plan a small v1 module, remember the final constraints and a separate future feature, and start only part of the work. ${spec}\nThe latest contract is ${JSON.stringify(contract)}. Implement ONLY ${first} now. Leave ${later} unfinished for another conversation. Keep the plan, revised requirements, deferred idea and handoff durably in this repository using whatever local mechanism is appropriate. You may create Markdown notes. Do not create recovery.json yet, do not implement ${later}, and do not implement ${future}.`;
  return { kind, repeat, contract, first, later, future, seedPrompt, tests };
}

export async function score(root, index, { seedOnly = false } = {}) {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const { pathToFileURL } = await import("node:url");
  const f = fixture(index);
  const checks = [];
  let module;
  try {
    module = await import(
      pathToFileURL(path.join(root, "lib.mjs")).href + "?" + Date.now()
    );
  } catch (e) {
    if (seedOnly)
      checks.push({ name: "module loads", passed: false, error: e.message });
    else
      for (const [name] of f.tests({}))
        checks.push({
          name,
          passed: false,
          error: "Module failed to load: " + e.message,
        });
  }
  if (module) {
    for (const [name, check] of f.tests(module)) {
      if (
        seedOnly &&
        [
          "capacity and tie",
          "latest order",
          "earliest slot",
          "empty",
          "immutable",
          "latest newline",
          "empty and unicode",
          "limit",
          "invalid labels",
          "accents and unicode",
          "identity and immutable",
        ].includes(name)
      )
        continue;
      try {
        check();
        checks.push({ name, passed: true });
      } catch (e) {
        checks.push({ name, passed: false, error: e.message });
      }
    }
    if (seedOnly)
      checks.push({
        name: "later function unfinished",
        passed: typeof module[f.later] !== "function",
      });
  }
  let recovery = null;
  const memory = [];
  if (!seedOnly) {
    try {
      recovery = JSON.parse(
        fs.readFileSync(path.join(root, "recovery.json"), "utf8"),
      );
    } catch {}
    for (const [key, value] of Object.entries(f.contract))
      memory.push({ name: key, passed: recovery?.contract?.[key] === value });
    memory.push({
      name: "future deferred",
      passed:
        Array.isArray(recovery?.deferred) &&
        recovery.deferred.includes(f.future),
    });
    memory.push({
      name: "completion report",
      passed:
        Array.isArray(recovery?.completed) &&
        [f.first, f.later].every((x) => recovery.completed.includes(x)) &&
        Array.isArray(recovery?.unresolved) &&
        recovery.unresolved.length === 0,
    });
  }
  return {
    checks,
    passed: checks.filter((x) => x.passed).length,
    total: checks.length,
    allPassed: checks.length > 0 && checks.every((x) => x.passed),
    memory,
    memoryPassed: memory.filter((x) => x.passed).length,
    memoryTotal: memory.length,
    recovery,
  };
}
