import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { execute } from "../src/actions.js";
import { ensure } from "../src/core.js";
import { projectKnowledge, projectSkillSources } from "../src/knowledge.js";
import {
  exportGlobalSkills,
  readSkillCatalog,
  syncSkills,
} from "../src/skill-catalog.js";
import { git, repoAt } from "../src/util.js";

test("global installations and project skills index separately and retain source versions", async (t) => {
  const sandbox = fs.realpathSync.native(
    fs.mkdtempSync(path.join(os.tmpdir(), "dip-skill-index-")),
  );
  t.after(() => fs.rmSync(sandbox, { recursive: true, force: true }));
  process.env.DIP_HOME = path.join(sandbox, "dip");
  process.env.DIP_GIT_CONFIG = path.join(sandbox, "gitconfig");
  const write = (name, text) => {
    fs.mkdirSync(path.dirname(name), { recursive: true });
    fs.writeFileSync(name, text);
  };
  const skill = (name) =>
    "---\nname: " +
    name +
    "\ndescription: Catalog fixture\n---\nDo not execute.\n";
  const global = path.join(sandbox, ".agents/skills/global");
  const root = path.join(sandbox, "project");
  write(path.join(global, "SKILL.md"), skill("global"));
  write(path.join(root, ".gitignore"), ".agents/\n");
  write(path.join(root, "apps/game/server.js"), "");
  const source = "apps/game/.agents/skills/build/SKILL.md";
  write(path.join(root, source), skill("build"));
  write(
    path.join(root, "apps/game/.agents/skills/build/agents/openai.yaml"),
    "policy:\n  allow_implicit_invocation: false\n",
  );
  git(root, ["init", "-b", "main"]);
  git(global, ["init", "-b", "main"]);
  const project = ensure(root, { instructions: false, hooks: false });
  const unrelated = repoAt(global);
  const index = await syncSkills(
    {
      projects: [project, unrelated].map((repo) => ({
        id: repo.key,
        name: path.basename(repo.root),
        root: repo.root,
        worktrees: [{ path: repo.root }],
      })),
    },
    { user: sandbox, env: {} },
  );
  assert.deepEqual(
    index.projects.map((item) => item.id),
    [project.key],
  );
  assert.equal(index.projects[0].worktrees[0].skills[0].scope, "apps/game");
  assert.equal(
    index.projects[0].worktrees[0].skills[0].activation,
    "explicit-only",
  );
  assert.equal(readSkillCatalog().global[0].name, "global");
  assert.deepEqual(exportGlobalSkills(index), {
    format: "dip-global-skills-v1",
    skills: [{ name: "global", host: "codex", activation: "host-default" }],
  });
  assert.equal(
    projectKnowledge(project, "list", { category: "skill" }).entries[0]
      .currentness,
    "current",
  );
  write(path.join(root, source), skill("build") + "Updated\n");
  assert.equal(
    projectKnowledge(project, "list", { category: "skill" }).entries[0]
      .currentness,
    "stale",
  );
  assert.equal(fs.existsSync(path.join(root, ".dip-knowledge.json")), false);
});

test(
  "DIP-backed links keep host scope and reject project boundary crossings",
  {
    skip:
      process.platform === "win32" &&
      "Portable directory-link setup is not part of this pilot",
  },
  async (t) => {
    const sandbox = fs.realpathSync.native(
      fs.mkdtempSync(path.join(os.tmpdir(), "dip-stored-skills-")),
    );
    t.after(() => fs.rmSync(sandbox, { recursive: true, force: true }));
    const user = path.join(sandbox, "home");
    process.env.DIP_HOME = path.join(user, ".dip");
    process.env.DIP_GIT_CONFIG = path.join(sandbox, "gitconfig");
    const root = path.join(sandbox, "project");
    const write = (base, relative, text) => {
      const file = path.join(base, relative);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, text);
    };
    const skill = (name) =>
      `---\nname: ${name}\ndescription: Pilot fixture\n---\nFixture body.\n`;
    const link = (base, relative, target) => {
      const alias = path.join(base, relative);
      fs.mkdirSync(path.dirname(alias), { recursive: true });
      fs.symlinkSync(path.relative(path.dirname(alias), target), alias, "dir");
    };

    const source = "apps/game/.agents/skills/build";
    const canonical = "apps/game/.dip/skills/build";
    write(root, canonical + "/SKILL.md", skill("build"));
    write(
      root,
      canonical + "/agents/openai.yaml",
      "policy: {allow_implicit_invocation: false}\n",
    );
    write(root, canonical + "/references/build.md", "# Build steps");
    write(root, "apps/game/docs/settings.md", "# Scoped settings");
    link(root, source, path.join(root, canonical));

    write(
      root,
      ".dip/skills/review/SKILL.md",
      "---\nname: review\ndescription: Review fixture\ndisable-model-invocation: true\n---\nBody.\n",
    );
    link(root, ".claude/skills/review", path.join(root, ".dip/skills/review"));
    write(root, "apps/editor/skills/internal/SKILL.md", skill("internal"));
    link(root, "apps/editor/skills/internal-alias", path.join(root, canonical));
    write(sandbox, "outside/SKILL.md", skill("outside"));
    link(root, ".agents/skills/outside", path.join(sandbox, "outside"));
    link(root, ".dip/skills/indirect", path.join(sandbox, "outside"));
    link(
      root,
      ".agents/skills/indirect",
      path.join(root, ".dip/skills/indirect"),
    );
    write(user, ".dip/skills/global/SKILL.md", skill("global"));
    link(user, ".agents/skills/global", path.join(user, ".dip/skills/global"));
    write(
      user,
      ".dip/claude-skills/global/SKILL.md",
      skill("global") + "Claude-specific instructions.\n",
    );
    link(
      user,
      ".claude/skills/global",
      path.join(user, ".dip/claude-skills/global"),
    );

    git(root, ["init", "-b", "main"]);
    const repo = ensure(root, { instructions: false, hooks: false });
    const index = await syncSkills(
      {
        projects: [
          {
            id: repo.key,
            name: "project",
            root: repo.root,
            worktrees: [{ path: repo.root }],
          },
        ],
      },
      { user, env: {} },
    );
    const sources = index.projects[0].worktrees[0].skills;
    assert.deepEqual(sources.map((entry) => entry.name).sort(), [
      "build",
      "internal",
      "review",
    ]);
    const build = sources.find((entry) => entry.name === "build");
    assert.equal(build.scope, "apps/game");
    assert.equal(build.source, source + "/SKILL.md");
    assert.equal(build.canonicalSource, canonical + "/SKILL.md");
    assert.equal(build.policySource, canonical + "/agents/openai.yaml");
    assert.equal(build.activation, "explicit-only");
    assert.equal(
      sources.find((entry) => entry.name === "review").activation,
      "explicit-only",
    );
    assert.equal(
      sources.find((entry) => entry.name === "internal").canonicalSource,
      undefined,
    );
    assert.equal(
      index.global.find((entry) => entry.host === "codex").canonicalSource,
      path.join(user, ".dip/skills/global/SKILL.md"),
    );
    assert.equal(
      index.global.find((entry) => entry.host === "claude").canonicalSource,
      path.join(user, ".dip/claude-skills/global/SKILL.md"),
    );
    assert.notEqual(index.global[0].hash, index.global[1].hash);
    assert.doesNotMatch(
      JSON.stringify(exportGlobalSkills(index)),
      /canonicalSource|\.dip/,
    );
    assert.equal(
      fs.readFileSync(path.join(root, source, "references/build.md"), "utf8"),
      "# Build steps",
    );
    const real = fs.realpathSync.native(path.join(root, build.source));
    assert.equal(
      fs.readFileSync(
        path.resolve(path.dirname(real), "../../../docs/settings.md"),
        "utf8",
      ),
      "# Scoped settings",
    );

    const list = (args) =>
      projectKnowledge(repo, "list", { category: "skill", ...args }).entries;
    assert.equal(
      list({ path: "apps/game/file.js", query: "build" })[0].currentness,
      "current",
    );
    assert.deepEqual(
      list({ path: "apps/elsewhere/file.js", query: "build" }),
      [],
    );
    assert.throws(
      () => projectKnowledge(repo, "read", { path: source + "/SKILL.md" }),
      /native host/,
    );
    assert.throws(
      () => projectKnowledge(repo, "read", { path: canonical + "/SKILL.md" }),
      /nonsensitive/,
    );

    write(
      root,
      canonical + "/agents/openai.yaml",
      "policy: {allow_implicit_invocation: true}\n",
    );
    const changed = list({ query: "build" });
    assert.deepEqual(
      changed.map(({ source, currentness }) => [source, currentness]),
      [[build.source, "stale"]],
    );
    await execute(
      "knowledge-set",
      {
        id: "reviewed-build",
        patch: {
          title: "Reviewed build",
          category: "skill",
          source: build.source,
        },
      },
      root,
    );
    assert.equal(list({ query: "reviewed build" })[0].currentness, "current");
  },
);

test("the CLI creates scoped and global skills in DIP with native discovery aliases", async (t) => {
  const sandbox = fs.realpathSync.native(
    fs.mkdtempSync(path.join(os.tmpdir(), "dip-create-skill-")),
  );
  t.after(() => fs.rmSync(sandbox, { recursive: true, force: true }));
  const project = path.join(sandbox, "project");
  const user = path.join(sandbox, "user");
  const dip = path.join(user, ".dip");
  const claude = path.join(user, "claude-config");
  const env = {
    ...process.env,
    HOME: user,
    USERPROFILE: user,
    CLAUDE_CONFIG_DIR: claude,
    DIP_HOME: dip,
    DIP_GIT_CONFIG: path.join(sandbox, "gitconfig"),
    GIT_TRACE2_EVENT: "0",
  };
  fs.mkdirSync(path.join(project, "apps", "web"), { recursive: true });
  git(project, ["init", "-b", "main"]);
  const cli = fileURLToPath(new URL("../bin/dip.js", import.meta.url));
  const run = (...args) =>
    JSON.parse(
      execFileSync(process.execPath, [cli, "skills", "create", ...args], {
        env,
        cwd: project,
        encoding: "utf8",
      }),
    );
  const external = run(
    "ship-app",
    "--scope",
    "apps/web",
    "--description",
    "Ship a tested release: web only",
  );
  assert.equal(
    external.canonicalSource,
    path.join(project, "apps/web/.dip/skills/ship-app/SKILL.md"),
  );
  assert.equal(
    external.source,
    path.join(project, "apps/web/.agents/skills/ship-app/SKILL.md"),
  );
  assert.equal(
    fs.realpathSync.native(external.source),
    external.canonicalSource,
  );
  const repo = ensure(project, { instructions: false, hooks: false });
  const [indexed] = projectSkillSources(repo);
  assert.equal(indexed.scope, "apps/web");
  assert.equal(indexed.description, "Ship a tested release: web only");
  assert.equal(
    indexed.canonicalSource,
    "apps/web/.dip/skills/ship-app/SKILL.md",
  );

  const wide = run(
    "weekly-review",
    "--global",
    "--host",
    "claude",
    "--description",
    "Review local project changes",
  );
  assert.equal(
    wide.canonicalSource,
    path.join(dip, "claude-skills/weekly-review/SKILL.md"),
  );
  assert.equal(wide.source, path.join(claude, "skills/weekly-review/SKILL.md"));
  assert.equal(fs.realpathSync.native(wide.source), wide.canonicalSource);

  const collision = path.join(project, ".agents/skills/existing");
  fs.mkdirSync(collision, { recursive: true });
  fs.writeFileSync(path.join(collision, "SKILL.md"), "Keep existing skill.");
  assert.throws(
    () => run("existing", "--description", "Replacement"),
    /EEXIST/,
  );
  assert.equal(
    fs.readFileSync(path.join(collision, "SKILL.md"), "utf8"),
    "Keep existing skill.",
  );
  assert.equal(
    fs.existsSync(path.join(project, ".dip/skills/existing")),
    false,
  );
  assert.throws(
    () => run("unsafe", "--scope", "../outside", "--description", "Invalid"),
    /project-relative/,
  );
});
