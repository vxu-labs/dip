import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { execute } from "./actions.js";
import { ensure, Runtime } from "./core.js";
import { automationHealth } from "./health.js";
import { VERSION } from "./version.js";
import { catalogForOrigin } from "./project-index.js";
import { openProjectFolder } from "./open-folder.js";
import { setProjectFavorite } from "./project-preferences.js";

const publicDir = fileURLToPath(new URL("../public/", import.meta.url));
export function createServer({
  root = process.cwd(),
  port = 4317,
  openFolder = openProjectFolder,
} = {}) {
  try {
    const repo = ensure(root, { instructions: false });
    root = repo.root;
    const runtime = new Runtime();
    try {
      runtime.register(repo);
    } finally {
      runtime.close();
    }
  } catch {
    root = null;
  }
  const token = crypto.randomBytes(32).toString("hex");
  const clients = new Set();
  const server = http.createServer(async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    try {
      const url = new URL(req.url, "http://127.0.0.1");
      if (
        req.headers.origin &&
        ![
          `http://127.0.0.1:${server.address()?.port}`,
          `http://localhost:${server.address()?.port}`,
        ].includes(req.headers.origin)
      ) {
        res.writeHead(403);
        res.end("Origin rejected");
        return;
      }
      if (
        req.headers.host &&
        !["127.0.0.1", "localhost"].includes(req.headers.host.split(":")[0])
      ) {
        res.writeHead(403);
        res.end("Host rejected");
        return;
      }
      if (!url.pathname.startsWith("/api/")) {
        const routes = {
          "/": "index.html",
          "/local": "local.html",
          "/app.js": "app.js",
          "/style.css": "style.css",
        };
        const file = routes[url.pathname];
        if (!file) {
          res.writeHead(404);
          res.end("Not found");
          return;
        }
        res.setHeader(
          "Content-Type",
          file.endsWith(".js")
            ? "text/javascript"
            : file.endsWith(".css")
              ? "text/css"
              : "text/html",
        );
        res.setHeader(
          "Content-Security-Policy",
          "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'",
        );
        res.end(fs.readFileSync(path.join(publicDir, file)));
        return;
      }
      const runtime = new Runtime();
      let catalog;
      try {
        catalog = catalogForOrigin(
          runtime.refreshProjects(),
          `http://127.0.0.1:${server.address().port}`,
        );
      } finally {
        runtime.close();
      }
      const repos = catalog.projects.flatMap((p) =>
        p.worktrees.map((w) => w.path),
      );
      const selected =
        url.searchParams.get("root") ||
        (repos.includes(root) ? root : repos[0]);
      if (selected && !repos.includes(selected))
        throw new Error("Project is not registered");
      if (url.pathname === "/api/projects") {
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify(repos));
        return;
      }
      if (url.pathname === "/api/catalog") {
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ ...catalog, version: VERSION }));
        return;
      }
      if (url.pathname === "/api/project-favorite" && req.method === "POST") {
        if (req.headers["x-dip-token"] !== token) {
          res.writeHead(403);
          res.end("Token required");
          return;
        }
        let body = "";
        for await (const chunk of req) {
          body += chunk;
          if (body.length > 4096) {
            res.writeHead(413);
            res.end();
            return;
          }
        }
        const { id, favorite } = JSON.parse(body);
        const preferences = new Runtime();
        try {
          const result = setProjectFavorite(preferences, id, favorite);
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ id: result.id, favorite: result.favorite }));
        } finally {
          preferences.close();
        }
        return;
      }
      if (url.pathname === "/api/open-project" && req.method === "POST") {
        if (req.headers["x-dip-token"] !== token) {
          res.writeHead(403);
          res.end("Token required");
          return;
        }
        if (!selected) throw Error("Choose a registered project first");
        await openFolder(selected);
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ opened: true, root: selected }));
        return;
      }
      if (url.pathname === "/api/health") {
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify(automationHealth(selected)));
        return;
      }
      if (url.pathname === "/api/state") {
        res.setHeader("Content-Type", "application/json");
        const data = selected
          ? {
              ...(await execute("reconcile", { full: true }, selected)),
              checks: Object.keys(
                ensure(selected, { instructions: false }).config.verification ||
                  {},
              ),
            }
          : { tasks: [], activity: [], errors: [], repo: null, checks: [] };
        data.activityTotal = data.activity.length;
        data.version = VERSION;
        data.activity = data.activity.slice(0, 200).map((a) => ({
          ...a,
          ...(a.plan
            ? {
                plan: a.plan.slice(0, 1500),
                planTruncated: a.plan.length > 1500,
              }
            : {}),
        }));
        data.tasks = data.tasks.map((t) => ({
          ...t,
          history: t.history.slice(-50).map((e) => ({
            type: e.type,
            actor: e.actor,
            createdAt: e.createdAt,
          })),
          evidence: t.evidence.slice(-10).map((e) => ({
            check: e.check,
            result: e.result,
            at: e.at,
            summary: e.summary,
          })),
          checkpoints: t.checkpoints.slice(-5),
          decisions: t.decisions.slice(-5),
        }));
        res.end(JSON.stringify(data));
        return;
      }
      if (url.pathname === "/api/events") {
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        });
        res.write("data: ready\n\n");
        clients.add(res);
        req.on("close", () => clients.delete(res));
        return;
      }
      if (url.pathname === "/api/action" && req.method === "POST") {
        if (req.headers["x-dip-token"] !== token) {
          res.writeHead(403);
          res.end("Token required");
          return;
        }
        let body = "";
        for await (const chunk of req) {
          body += chunk;
          if (body.length > 65536) {
            res.writeHead(413);
            res.end();
            return;
          }
        }
        const { action, args } = JSON.parse(body);
        if (
          ![
            "create",
            "update",
            "resolve",
            "checkpoint",
            "finish",
            "decision",
            "verify",
            "claim",
            "release",
            "document-list",
            "document-read",
          ].includes(action)
        )
          throw new Error("Unsupported dashboard action");
        if (!selected) throw new Error("Choose a registered project first");
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify(await execute(action, args, selected)));
        return;
      }
      if (url.pathname === "/api/session") {
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ token }));
        return;
      }
      res.writeHead(404);
      res.end("Not found");
    } catch (e) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: e.message }));
    }
  });
  const ticker = setInterval(() => {
    for (const c of clients) c.write(`data: update\n\n`);
  }, 1000);
  server.on("close", () => {
    clearInterval(ticker);
    for (const c of clients) c.end();
  });
  server.listen(port, "127.0.0.1");
  return server;
}
