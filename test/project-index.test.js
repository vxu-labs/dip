import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Runtime, ensure } from "../src/core.js";
import { handleHook, stopDaemon, scan } from "../src/automation.js";
import { discoverClientProject } from "../src/client-discovery.js";
import { atomic, git, json } from "../src/util.js";
import { projectIndexStatus } from "../src/project-index.js";

const sandbox = fs.realpathSync.native(
  fs.mkdtempSync(path.join(os.tmpdir(), "dip-project-index-")),
);
Object.assign(process.env, {
  DIP_HOME: path.join(sandbox, "runtime"),
  DIP_USER_HOME: path.join(sandbox, "user"),
  DIP_GIT_CONFIG: path.join(sandbox, "gitconfig"),
  GIT_CONFIG_GLOBAL: path.join(sandbox, "gitconfig"),
  GIT_TRACE2_EVENT: "0",
});
const cli = fileURLToPath(new URL("../bin/dip.js", import.meta.url));
const core = new URL("../src/core.js", import.meta.url).href;
const util = new URL("../src/util.js", import.meta.url).href;
const indexFile = path.join(process.env.DIP_HOME, "projects.json");
let serial = 0;
function fixture(name = `project-${++serial}`, initialize = true) {
  const root = path.join(sandbox, name);
  fs.mkdirSync(root, { recursive: true });
  git(root, ["init", "-b", "main"]);
  git(root, ["config", "user.email", "test@example.invalid"]);
  git(root, ["config", "user.name", "Test"]);
  return initialize ? ensure(root) : { root };
}
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(predicate) {
  const deadline = Date.now() + 12000;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await pause(100);
  }
  throw Error("Project index did not converge");
}
test.after(() => {
  stopDaemon();
  fs.rmSync(sandbox, { recursive: true, force: true });
});

test("one project entry groups linked worktrees but keeps unrelated same-name repositories separate", () => {
  const first = fixture("one/app"),
    second = fixture("two/app"),
    rt = new Runtime();
  try {
    git(first.root, ["add", "."]);
    git(first.root, ["commit", "-m", "initial"]);
    const linked = path.join(sandbox, "linked");
    git(first.root, ["worktree", "add", "-b", "other", linked]);
    rt.register(first);
    rt.register(second);
    const index = json(indexFile),
      families = index.projects.filter((p) => p.name === "app");
    assert.equal(families.length, 2);
    assert.notEqual(families[0].id, families[1].id);
    const family = families.find((p) => p.root === first.root);
    assert.equal(family.worktrees.length, 2);
    assert.ok(family.worktrees.some((w) => w.path === linked));
    assert.ok(rt.repositories().some((r) => r.root === linked));
    assert.equal(family.gitCommonDir, first.common);
    assert.equal(index.worktreeCount, index.projectCount + 1);
    const before = fs.readFileSync(indexFile, "utf8"),
      mtime = fs.statSync(indexFile).mtimeMs;
    rt.register(first);
    assert.equal(fs.readFileSync(indexFile, "utf8"), before);
    assert.equal(fs.statSync(indexFile).mtimeMs, mtime);
    if (process.platform !== "win32")
      assert.equal(fs.statSync(indexFile).mode & 0o777, 0o600);
  } finally {
    rt.close();
  }
});

test("removing a checkout or its DIP config removes only its active entry and preserves pending records", () => {
  const repo = fixture(),
    rt = new Runtime();
  try {
    rt.register(repo);
    rt.enqueue(repo, "index-test", {
      kind: "retained.pending",
      at: new Date().toISOString(),
    });
    const pending = rt.db
      .prepare("SELECT count(*) AS n FROM queue WHERE root=?")
      .get(repo.root).n;
    fs.renameSync(
      path.join(repo.root, ".dip/config.json"),
      path.join(repo.root, ".dip/config.saved"),
    );
    assert.equal(
      rt.refreshProjects().projects.some((p) => p.root === repo.root),
      false,
    );
    fs.renameSync(
      path.join(repo.root, ".dip/config.saved"),
      path.join(repo.root, ".dip/config.json"),
    );
    assert.ok(rt.refreshProjects().projects.some((p) => p.root === repo.root));
    fs.rmSync(repo.root, { recursive: true });
    assert.equal(
      rt.refreshProjects().projects.some((p) => p.root === repo.root),
      false,
    );
    assert.ok(rt.repositories().some((r) => r.root === repo.root));
    assert.equal(
      rt.db
        .prepare("SELECT count(*) AS n FROM queue WHERE root=?")
        .get(repo.root).n,
      pending,
    );
  } finally {
    rt.close();
  }
});

test("init, trusted hooks and library-client discovery publish without a recorder or manual registration", () => {
  const fresh = fixture("cli-init", false);
  execFileSync(process.execPath, [cli, "init", "--root", fresh.root], {
    env: process.env,
    stdio: "pipe",
  });
  assert.ok(
    json(indexFile).projects.some((p) => p.root === fresh.root && p.projectId),
  );
  const hooked = fixture("hooked", false);
  handleHook(
    {
      cwd: hooked.root,
      hook_event_name: "UserPromptSubmit",
      session_id: "index",
      prompt: "Investigate project",
    },
    "codex",
  );
  assert.ok(json(indexFile).projects.some((p) => p.root === hooked.root));
  const library = fixture("library", false);
  discoverClientProject(library.root, { client: "test-library" });
  assert.ok(json(indexFile).projects.some((p) => p.root === library.root));
  const output = JSON.parse(
    execFileSync(process.execPath, [cli, "projects"], {
      env: process.env,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }),
  );
  assert.equal(output.file, indexFile);
  assert.equal(output.projectCount, json(indexFile).projectCount);
});

test("parallel hook processes cannot publish an older project snapshot over a newer registration", async () => {
  const repos = Array.from({ length: 8 }, (_, i) => fixture(`concurrent-${i}`));
  const children = repos.map(
    (repo) =>
      new Promise((resolve, reject) => {
        const code = `import {Runtime} from ${JSON.stringify(core)};import {repoAt} from ${JSON.stringify(util)};const rt=new Runtime();try{rt.register(repoAt(process.argv[1]));}finally{rt.close();}`;
        const child = spawn(
          process.execPath,
          ["--input-type=module", "-e", code, repo.root],
          { env: process.env, stdio: ["ignore", "ignore", "pipe"] },
        );
        let error = "";
        child.stderr.on("data", (data) => (error += data));
        child.on("error", reject);
        child.on("exit", (code) =>
          code === 0 ? resolve() : reject(Error(error)),
        );
      }),
  );
  await Promise.all(children);
  for (const repo of repos)
    assert.ok(json(indexFile).projects.some((p) => p.root === repo.root));
});

test("a corrupt projection is rebuilt, invalid project config is reported and custom runtime directories stay isolated", () => {
  const repo = fixture(),
    directory = path.join(sandbox, "custom-runtime"),
    rt = new Runtime(directory);
  try {
    rt.register(repo);
    const file = path.join(directory, "projects.json");
    fs.writeFileSync(file, "broken JSON");
    assert.equal(projectIndexStatus(directory).available, false);
    assert.equal(rt.refreshProjects().projectCount, 1);
    fs.writeFileSync(path.join(repo.root, ".dip/config.json"), "broken config");
    const index = rt.refreshProjects();
    assert.equal(index.projectCount, 0);
    assert.equal(index.errors.length, 1);
    assert.equal(index.errors[0].root, repo.root);
  } finally {
    rt.close();
  }
});

test(
  "discovery catalogs existing DIP projects even when linked instructions prevent integration repair",
  { skip: process.platform === "win32" },
  () => {
    const repo = fixture("custom-instructions"),
      target = path.join(sandbox, "user-instructions.md");
    fs.writeFileSync(target, "User-owned instructions\n");
    fs.rmSync(path.join(repo.root, "AGENTS.md"));
    fs.symlinkSync(target, path.join(repo.root, "AGENTS.md"));
    const result = scan([repo.root]);
    assert.ok(result.errors.some((e) => e.root === repo.root));
    assert.ok(json(indexFile).projects.some((p) => p.root === repo.root));
    assert.equal(fs.readFileSync(target, "utf8"), "User-owned instructions\n");
    assert.ok(fs.lstatSync(path.join(repo.root, "AGENTS.md")).isSymbolicLink());
  },
);

test("a live recorder discovers, renames and removes projects and rebuilds a deleted index", async () => {
  const watched = path.join(sandbox, "watched");
  fs.mkdirSync(watched);
  atomic(path.join(process.env.DIP_HOME, "install.json"), {
    active: true,
    roots: [watched],
    port: 0,
  });
  const child = spawn(process.execPath, [cli, "daemon"], {
    env: process.env,
    stdio: ["ignore", "ignore", "pipe"],
  });
  let errors = "";
  child.stderr.on("data", (data) => (errors += data));
  const exited = new Promise((resolve) => child.on("exit", resolve));
  try {
    await until(
      () => json(path.join(process.env.DIP_HOME, "daemon.json"))?.dashboard,
    );
    const repo = fixture("watched/new-project", false);
    await until(() =>
      json(indexFile)?.projects.some((p) => p.root === repo.root),
    );
    const moved = path.join(watched, "renamed-project");
    fs.renameSync(repo.root, moved);
    await until(() => {
      const index = json(indexFile);
      return (
        index?.projects.some((p) => p.root === moved) &&
        !index.projects.some((p) => p.root === repo.root)
      );
    });
    fs.rmSync(moved, { recursive: true });
    await until(() => !json(indexFile)?.projects.some((p) => p.root === moved));
    const outside = fixture("outside-watched-roots"),
      rt = new Runtime();
    try {
      rt.register(outside);
    } finally {
      rt.close();
    }
    await until(() =>
      json(
        path.join(process.env.DIP_HOME, "daemon.json"),
      )?.watchedRepositories.includes(outside.root),
    );
    fs.rmSync(outside.root, { recursive: true });
    await until(
      () => !json(indexFile)?.projects.some((p) => p.root === outside.root),
    );
    fs.rmSync(indexFile);
    await until(() => fs.existsSync(indexFile));
    assert.equal(
      json(indexFile).projects.some((p) => p.root === moved),
      false,
    );
  } catch (error) {
    throw Error(error.message + "\n" + errors);
  } finally {
    stopDaemon();
    let timeout;
    await Promise.race([
      exited,
      new Promise((resolve) => {
        timeout = setTimeout(resolve, 6000);
      }),
    ]);
    clearTimeout(timeout);
    if (child.exitCode === null) child.kill();
  }
});
