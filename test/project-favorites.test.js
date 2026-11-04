import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { Runtime, ensure } from "../src/core.js";
import { createServer } from "../src/server.js";
import {
  setProjectFavorite,
  projectPreferencesPath,
} from "../src/project-preferences.js";
import { git } from "../src/util.js";

const sandbox = fs.realpathSync.native(
  fs.mkdtempSync(path.join(os.tmpdir(), "dip-favorites-")),
);
Object.assign(process.env, {
  DIP_HOME: path.join(sandbox, "runtime"),
  DIP_USER_HOME: path.join(sandbox, "user"),
  DIP_GIT_CONFIG: path.join(sandbox, "gitconfig"),
  GIT_CONFIG_GLOBAL: path.join(sandbox, "gitconfig"),
  GIT_TRACE2_EVENT: "0",
});
let serial = 0;
function fixture() {
  const root = path.join(sandbox, `project-${++serial}`);
  fs.mkdirSync(root);
  git(root, ["init", "-b", "main"]);
  return ensure(root);
}
test.after(() => fs.rmSync(sandbox, { recursive: true, force: true }));

test("favorites apply to a Git family, sort first, survive absence and catalog/runtime-cache rebuilds", () => {
  const first = fixture(),
    favorite = fixture();
  let rt = new Runtime();
  try {
    git(favorite.root, ["config", "user.name", "Test"]);
    git(favorite.root, ["config", "user.email", "test@example.invalid"]);
    git(favorite.root, ["add", "."]);
    git(favorite.root, ["commit", "-m", "initial"]);
    const linked = path.join(sandbox, "linked");
    git(favorite.root, ["worktree", "add", "-b", "other", linked]);
    rt.register(first);
    rt.register(favorite);
    const before = git(favorite.root, ["status", "--porcelain=v1"]);
    const result = setProjectFavorite(rt, favorite.key, true);
    assert.equal(result.catalog.favoriteCount, 1);
    assert.equal(result.catalog.projects[0].id, favorite.key);
    assert.equal(result.catalog.projects[0].worktrees.length, 2);
    assert.equal(git(favorite.root, ["status", "--porcelain=v1"]), before);
    rt.close();
    for (const name of [
      "runtime.sqlite",
      "runtime.sqlite-wal",
      "runtime.sqlite-shm",
      "projects.json",
    ])
      fs.rmSync(path.join(process.env.DIP_HOME, name), { force: true });
    rt = new Runtime();
    rt.register(favorite);
    assert.equal(rt.refreshProjects().projects[0].favorite, true);
    const configs = [favorite.root, linked].map((root) =>
      path.join(root, ".dip/config.json"),
    );
    for (const config of configs) fs.renameSync(config, config + ".saved");
    assert.equal(rt.refreshProjects().favoriteCount, 0);
    for (const config of configs) fs.renameSync(config + ".saved", config);
    assert.equal(rt.refreshProjects().favoriteCount, 1);
    assert.equal(
      setProjectFavorite(rt, favorite.key, false).catalog.favoriteCount,
      0,
    );
    if (process.platform !== "win32")
      assert.equal(
        fs.statSync(projectPreferencesPath(rt.directory)).mode & 0o777,
        0o600,
      );
  } finally {
    rt.close();
  }
});

test("concurrent clients retain both favorites and corrupt preferences never block project registration or get overwritten", async () => {
  const repos = [fixture(), fixture()],
    rt = new Runtime();
  try {
    repos.forEach((repo) => rt.register(repo));
    await Promise.all(
      repos.map(
        (repo) =>
          new Promise((resolve, reject) => {
            const code = `import {Runtime} from ${JSON.stringify(new URL("../src/core.js", import.meta.url).href)};import {setProjectFavorite} from ${JSON.stringify(new URL("../src/project-preferences.js", import.meta.url).href)};const rt=new Runtime();try{setProjectFavorite(rt,process.argv[1],true);}finally{rt.close();}`;
            const child = spawn(
              process.execPath,
              ["--input-type=module", "-e", code, repo.key],
              { env: process.env, stdio: ["ignore", "ignore", "pipe"] },
            );
            let error = "";
            child.stderr.on("data", (data) => (error += data));
            child.on("error", reject);
            child.on("exit", (status) =>
              status === 0 ? resolve() : reject(Error(error)),
            );
          }),
      ),
    );
    let catalog = rt.refreshProjects();
    for (const repo of repos)
      assert.equal(
        catalog.projects.find((p) => p.id === repo.key).favorite,
        true,
      );
    const file = projectPreferencesPath(rt.directory),
      saved = fs.readFileSync(file);
    try {
      fs.writeFileSync(file, "broken preference JSON");
      assert.doesNotThrow(() => rt.register(repos[0]));
      assert.ok(rt.refreshProjects().errors.some((e) => e.root === file));
      assert.throws(
        () => setProjectFavorite(rt, repos[0].key, false),
        /Invalid JSON/,
      );
      assert.equal(fs.readFileSync(file, "utf8"), "broken preference JSON");
    } finally {
      fs.writeFileSync(file, saved);
    }
    assert.equal(rt.refreshProjects().errors.length, 0);
  } finally {
    rt.close();
  }
});

test("favorite API requires a session token, same origin, registered family and explicit boolean", async () => {
  const repo = fixture(),
    server = createServer({ root: repo.root, port: 0 });
  await new Promise((resolve) => server.once("listening", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const body = JSON.stringify({ id: repo.key, favorite: true });
  try {
    assert.equal(
      (await fetch(origin + "/api/project-favorite", { method: "POST", body }))
        .status,
      403,
    );
    const { token } = await (await fetch(origin + "/api/session")).json();
    const headers = {
      "Content-Type": "application/json",
      "x-dip-token": token,
    };
    assert.equal(
      (
        await fetch(origin + "/api/project-favorite", {
          method: "POST",
          headers: { ...headers, origin: "https://attacker.example" },
          body,
        })
      ).status,
      403,
    );
    for (const invalid of [
      { id: "a".repeat(24), favorite: true },
      { id: repo.key, favorite: "true" },
    ])
      assert.equal(
        (
          await fetch(origin + "/api/project-favorite", {
            method: "POST",
            headers,
            body: JSON.stringify(invalid),
          })
        ).status,
        400,
      );
    assert.equal(
      (
        await fetch(origin + "/api/project-favorite", {
          method: "POST",
          headers,
          body,
        })
      ).status,
      200,
    );
    const catalog = await (await fetch(origin + "/api/catalog")).json();
    assert.equal(
      catalog.projects.find((p) => p.id === repo.key).favorite,
      true,
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
