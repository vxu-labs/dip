import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import assert from "node:assert/strict";
import { chromium } from "@playwright/test";
import { ensure, createTask, append, Runtime } from "../src/core.js";
import { git } from "../src/util.js";
import { createServer } from "../src/server.js";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "dip-browser-"));
process.env.DIP_HOME = path.join(root, ".runtime");
git(root, ["init", "-b", "main"]);
const repo = ensure(root);
const parser = createTask(repo, {
  title: "Add CSV export",
  description: "Export project records in a portable format.",
  scope: ["src/export"],
  acceptance: [
    "Rows preserve UTF-8 text",
    "Large exports stream without blocking",
  ],
});
append(
  repo,
  parser,
  "task.update",
  { status: "in_progress" },
  { actor: "codex:export" },
);
append(
  repo,
  parser,
  "task.checkpoint",
  {
    summary:
      "CSV writer is complete. Wire up the dashboard action and cover Unicode edge cases.",
  },
  { actor: "codex:export" },
);
createTask(repo, {
  title: "Remember Slack notifications",
  description:
    "A future idea: notify only when work needs attention or is verified.",
  priority: 2,
});
createTask(repo, {
  title: "Resolve ownership across machines",
  description:
    "Introduce shared coordination after the local workflow is stable.",
  scope: ["src/coordination"],
});
const checks = createTask(repo, {
  title: "Integrate verification evidence",
  description: "Make completion reflect the current code snapshot.",
  scope: ["src/verification"],
});
append(repo, checks, "task.update", { status: "implemented" });
git(root, ["config", "user.name", "Browser QA"]);
git(root, ["config", "user.email", "qa@example.invalid"]);
git(root, ["add", ".dip", "AGENTS.md", "CLAUDE.md"]);
git(root, ["commit", "-m", "Browser fixture"]);
const workerRoot = root + "-worker";
git(root, ["worktree", "add", workerRoot, "-b", "agent-export"]);
const workerRepo = ensure(workerRoot);
const workerTask = createTask(workerRepo, {
  title: "Branch-only Unicode tests",
  scope: ["src/unicode"],
});
const runtime = new Runtime();
runtime.register(repo);
runtime.register(workerRepo);
runtime.claim(workerRepo, workerTask, "claude:unicode", 120000, [
  "src/unicode",
]);
runtime.close();
const server = createServer({ root, port: 0 });
await new Promise((resolve) => server.on("listening", resolve));
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.getByRole("heading", { name: "Project overview" }).waitFor();
  await page
    .getByRole("button", { name: "Add CSV export", exact: false })
    .waitFor();
  await page.getByRole("button", { name: "New task" }).click();
  await page
    .getByPlaceholder("What should we build or remember?")
    .fill("Browser-created task");
  await page.getByRole("button", { name: "Save to project" }).click();
  await page
    .getByRole("button", { name: "Browser-created task", exact: false })
    .waitFor();
  await page
    .getByRole("button", { name: "Add CSV export", exact: false })
    .click();
  await page.locator("#detail-title").waitFor();
  assert.ok(
    (await page.locator("#detail").innerText()).includes(
      "CSV writer is complete",
    ),
  );
  await page.locator("#detail-dialog .close").click();
  await page.getByRole("button", { name: "Work board" }).click();
  await page.getByRole("heading", { name: "Work board" }).waitFor();
  await page.getByRole("button", { name: "Overview", exact: false }).click();
  const workerButton = page.locator("[data-worker-root]");
  await workerButton.waitFor();
  const workerText = await workerButton.textContent();
  assert.ok(workerText.includes("Branch-only Unicode tests"), workerText);
  await workerButton.click();
  await page.waitForFunction(
    () => document.querySelector("#branch").textContent === "agent-export",
  );
  assert.ok(
    (await page.locator("#content").textContent()).includes(
      "Branch-only Unicode tests",
    ),
  );
  await page.locator("#projects").selectOption(repo.root);
  await page.waitForFunction(
    () => document.querySelector("#branch").textContent === "main",
  );
  fs.mkdirSync("docs/images", { recursive: true });
  await page.screenshot({
    path: path.resolve("docs/images/dashboard.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: path.resolve("docs/images/dashboard-mobile.png"),
    fullPage: true,
  });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    ),
    false,
  );
  assert.deepEqual(errors, []);
  console.log(
    "Browser smoke passed: task creation, handoff, board, cross-worktree workers/navigation and mobile layout; no JavaScript errors.",
  );
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
  assert.ok(root.startsWith(path.join(os.tmpdir(), "dip-browser-")));
  assert.equal(workerRoot, root + "-worker");
  fs.rmSync(workerRoot, { recursive: true, force: true });
  fs.rmSync(root, { recursive: true, force: true });
}
