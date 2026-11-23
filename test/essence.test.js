import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "dip-essence-"));
process.env.DIP_HOME = path.join(sandbox, "runtime");
process.env.DIP_USER_HOME = path.join(sandbox, "user");
process.env.DIP_GIT_CONFIG = path.join(sandbox, "global.gitconfig");
process.env.GIT_CONFIG_GLOBAL = process.env.DIP_GIT_CONFIG;
process.env.GIT_CONFIG_NOSYSTEM = "1";

const { ensure } = await import("../src/core.js");
const { git } = await import("../src/util.js");
const {
  ESSENCE_FILE,
  essenceBrief,
  essenceSection,
  essenceSections,
  initEssence,
  readEssence,
  writeEssence,
} = await import("../src/essence.js");
const { execute } = await import("../src/actions.js");
const { cliHelp } = await import("../src/cli-help.js");

let serial = 0;
function fixture() {
  const root = path.join(sandbox, "repo-" + ++serial);
  fs.mkdirSync(root);
  git(root, ["init", "-b", "main"]);
  git(root, ["config", "user.name", "Essence Test"]);
  git(root, ["config", "user.email", "test@invalid"]);
  return ensure(root);
}
test.after(() => fs.rmSync(sandbox, { recursive: true, force: true }));

const sample = `# Game — Project essence

## Vision
Everything has real value.

## Systems
### Bank
Mint coins, tokens and NFTs.

\`\`\`
## not a heading inside code
\`\`\`

## Open ideas
- Jump game that drops eggs
`;

test("sections are read by heading, ignoring fenced code", () => {
  const sections = essenceSections(sample);
  assert.deepEqual(
    sections.map((s) => [s.level, s.heading]),
    [
      [1, "Game — Project essence"],
      [2, "Vision"],
      [2, "Systems"],
      [3, "Bank"],
      [2, "Open ideas"],
    ],
  );
  assert.match(essenceSection(sample, "systems"), /### Bank[\s\S]*not a heading inside code/);
  assert.doesNotMatch(essenceSection(sample, "Systems"), /Open ideas/);
  assert.equal(essenceSection(sample, "Missing"), null);
});

test("init writes a template once; read reports hash, sections and absence", () => {
  const repo = fixture();
  assert.equal(readEssence(repo).exists, false);
  assert.equal(essenceBrief(repo), undefined, "no pointer before the essence exists");
  const created = initEssence(repo, "CodeIP");
  assert.equal(created.created, true);
  assert.ok(fs.existsSync(path.join(repo.root, ESSENCE_FILE)));
  assert.equal(initEssence(repo, "Other").created, false, "init never overwrites");
  const read = readEssence(repo);
  assert.match(read.content, /^# CodeIP — Project essence/);
  assert.ok(read.sections.some((s) => s.heading === "Vision"));
  assert.match(read.hash, /^[a-f0-9]{64}$/);
});

test("set replaces the document or one section and refuses a stale hash", () => {
  const repo = fixture();
  const first = writeEssence(repo, { content: sample, expectedHash: "absent" });
  assert.equal(first.exists, true);
  assert.throws(
    () => writeEssence(repo, { content: "# x", expectedHash: "absent" }),
    /changed since it was read/,
  );
  const hash = readEssence(repo).hash;
  writeEssence(repo, {
    heading: "Vision",
    content: "## Vision\nScarcity creates value.",
    expectedHash: hash,
  });
  const after = readEssence(repo);
  assert.match(after.content, /Scarcity creates value/);
  assert.doesNotMatch(after.content, /Everything has real value/);
  assert.match(after.content, /## Systems/, "other sections stay");
  writeEssence(repo, { heading: "Glossary", content: "## Glossary\n- Soul: a converted item" });
  assert.match(readEssence(repo, { heading: "Glossary" }).content, /Soul: a converted item/);
  assert.throws(() => writeEssence(repo, { content: "   " }), /needs Markdown content/);
  assert.throws(() => writeEssence(repo, { content: "x".repeat(300 * 1024) }), /256 KB/);
  assert.throws(() => readEssence(repo, { heading: "Nope" }), /No essence section/);
});

test("a symbolic link is never followed", () => {
  const repo = fixture();
  fs.writeFileSync(path.join(sandbox, "outside.md"), "# outside\n");
  fs.symlinkSync(path.join(sandbox, "outside.md"), path.join(repo.root, ESSENCE_FILE));
  assert.throws(() => readEssence(repo), /symbolic link/);
  assert.throws(() => writeEssence(repo, { content: "# x" }), /symbolic link/);
});

test("hooks get a pointer with section names, not the content", () => {
  const repo = fixture();
  writeEssence(repo, { content: sample });
  const brief = essenceBrief(repo);
  assert.equal(brief.path, ESSENCE_FILE);
  assert.deepEqual(brief.sections, ["Vision", "Systems", "Open ideas"]);
  assert.doesNotMatch(JSON.stringify(brief), /real value/);
});

test("actions and CLI help expose the essence", async () => {
  const repo = fixture();
  await execute("essence-init", { name: "CodeIP" }, repo.root);
  const read = await execute("essence-read", { heading: "Vision" }, repo.root);
  assert.match(JSON.stringify(read), /Vision/);
  assert.match(cliHelp("essence"), /dip essence set/);
  assert.match(cliHelp(), /dip essence/);
});
