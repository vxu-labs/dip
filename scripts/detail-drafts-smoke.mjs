import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { chromium } from "@playwright/test";
import { ensure, createTask, append, Runtime } from "../src/core.js";
import { git } from "../src/util.js";
import { createServer } from "../src/server.js";

// Synthetic projects and isolated configuration; never install machine hooks.
const root = fs.mkdtempSync(path.join(os.tmpdir(), "dip-drafts-"));
process.env.DIP_HOME = path.join(root, "runtime");
process.env.DIP_USER_HOME = path.join(root, "user");
process.env.DIP_GIT_CONFIG = path.join(root, "gitconfig");
process.env.GIT_CONFIG_GLOBAL = process.env.DIP_GIT_CONFIG;
const project = path.join(root, "project");
fs.mkdirSync(project);
git(project, ["init", "-b", "main"]);
const repo = ensure(project);
const first = createTask(repo, { title: "First task", kind: "discussion" });
createTask(repo, { title: "Second task", kind: "discussion" });
const otherProject = path.join(root, "other-project");
fs.mkdirSync(otherProject);
git(otherProject, ["init", "-b", "main"]);
fs.cpSync(path.join(project, ".dip"), path.join(otherProject, ".dip"), {
  recursive: true,
});
const otherRepo = ensure(otherProject);
const runtime = new Runtime();
runtime.register(repo);
runtime.register(otherRepo);
runtime.close();
const server = createServer({ root: project, port: 0 });
await new Promise((resolve) => server.on("listening", resolve));
const browser = await chromium.launch({
  headless: true,
  ...(process.env.DIP_BROWSER_EXECUTABLE
    ? { executablePath: process.env.DIP_BROWSER_EXECUTABLE }
    : {}),
});
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const open = async (title) => {
  await page.getByRole("button", { name: title, exact: false }).click();
};
const close = () => page.locator("#detail-dialog .close").click();
const background = async () => {
  await page.locator("#checkpoint").evaluate((el) => (window.oldField = el));
  append(repo, first, "task.checkpoint", {
    summary: "Background " + Date.now(),
  });
  await page.waitForFunction(
    () => document.querySelector("#checkpoint") !== window.oldField,
  );
};
const results = [];
async function check(name, fn) {
  await page.goto(
    `http://127.0.0.1:${server.address().port}/?root=${encodeURIComponent(repo.root)}`,
  );
  await page.locator("#task-kind").selectOption("all");
  await open("First task");
  try {
    await fn();
    results.push({ name, passed: true });
  } catch (e) {
    results.push({ name, passed: false, error: e.message });
  }
}
try {
  await check(
    "drafts, caret, focus, scroll and literal markup survive refresh",
    async () => {
      const literal = '<img src=x onerror="window.draftProbe=true">';
      for (const id of [
        "checkpoint",
        "finish-summary",
        "finish-replacements",
        "document-query",
      ])
        await page.locator("#" + id).fill(literal);
      await page.locator("#checkpoint").focus();
      const scroll = await page.evaluate(() => {
        document
          .querySelector("#checkpoint")
          .setSelectionRange(2, 7, "backward");
        const dialog = document.querySelector("#detail-dialog");
        dialog.scrollTop = 60;
        return dialog.scrollTop;
      });
      await background();
      for (const id of [
        "checkpoint",
        "finish-summary",
        "finish-replacements",
        "document-query",
      ])
        assert.equal(await page.locator("#" + id).inputValue(), literal);
      assert.deepEqual(
        await page.evaluate(() => {
          const field = document.querySelector("#checkpoint");
          return [
            document.activeElement.id,
            field.selectionStart,
            field.selectionEnd,
            field.selectionDirection,
          ];
        }),
        ["checkpoint", 2, 7, "backward"],
      );
      assert.equal(
        await page.locator("#detail-dialog").evaluate((el) => el.scrollTop),
        scroll,
      );
      assert.equal(await page.evaluate(() => !!window.draftProbe), false);
    },
  );
  await check("outcome choice survives alongside its summary", async () => {
    await page.locator("#finish-outcome").selectOption("cancelled");
    await page.locator("#finish-summary").fill("Cancelled by request");
    await background();
    assert.equal(
      await page.locator("#finish-outcome").inputValue(),
      "cancelled",
    );
  });
  for (const action of ["checkpoint", "finish"]) {
    const field = action === "checkpoint" ? "checkpoint" : "finish-summary";
    const button = action === "checkpoint" ? "save-checkpoint" : "finish-task";
    for (const scenario of [
      "unchanged",
      "edited",
      "other task",
      "other project",
      "reopened",
      "failed",
    ]) {
      await check(
        `${action}: delayed response preserves ${scenario} draft correctly`,
        async () => {
          let release;
          let arrived;
          const gate = new Promise((resolve) => (release = resolve));
          const started = new Promise((resolve) => (arrived = resolve));
          const handler = async (route) => {
            if (route.request().postDataJSON()?.action !== action)
              return route.continue();
            const response = scenario === "failed" ? null : await route.fetch();
            arrived();
            await gate;
            if (response) await route.fulfill({ response });
            else
              await route.fulfill({
                status: 409,
                contentType: "application/json",
                body: JSON.stringify({ error: "Synthetic conflict" }),
              });
          };
          await page.route("**/api/action*", handler);
          try {
            await page.locator("#" + field).fill("Submitted draft");
            await page.locator("#" + button).evaluate((node) => {
              const original = node.onclick;
              node.onclick = () => (window.pendingDraftSave = original());
            });
            await page.locator("#" + button).click();
            await started;
            if (
              ["other task", "other project", "reopened"].includes(scenario)
            ) {
              await close();
              if (scenario === "other project") {
                const changed = page.waitForResponse(
                  (r) =>
                    new URL(r.url()).pathname === "/api/state" &&
                    new URL(r.url()).searchParams.get("root") ===
                      otherRepo.root,
                );
                await page.locator("#projects").selectOption(otherRepo.root);
                await changed;
              }
              await open(
                scenario === "other task" ? "Second task" : "First task",
              );
            }
            if (!["unchanged", "failed"].includes(scenario))
              await page
                .locator("#" + field)
                .fill(
                  scenario === "edited"
                    ? "New unsaved draft"
                    : "Submitted draft",
                );
            release();
            // The original click handler includes JSON parsing and refresh.
            await page.evaluate(async () => {
              await window.pendingDraftSave;
            });
            if (scenario === "failed")
              await page
                .getByText("Synthetic conflict", { exact: true })
                .waitFor();
            const expected =
              scenario === "unchanged"
                ? ""
                : scenario === "edited"
                  ? "New unsaved draft"
                  : "Submitted draft";
            assert.equal(
              await page.locator("#" + field).inputValue(),
              expected,
            );
          } finally {
            release();
            await page.unroute("**/api/action*", handler);
          }
        },
      );
    }
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify(results, null, 2));
  if (results.some((r) => !r.passed)) process.exitCode = 1;
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(root, { recursive: true, force: true });
}
