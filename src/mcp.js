import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { execute } from "./actions.js";
import { VERSION } from "./version.js";

export async function runMcp() {
  const server = new McpServer({ name: "dip", version: VERSION });
  const root = {
    root: z
      .string()
      .optional()
      .describe("Git project path; defaults to current working directory"),
  };
  const add = (name, description, shape, action) =>
    server.registerTool(
      name,
      { description, inputSchema: { ...root, ...shape } },
      async ({ root: cwd, ...args }) => {
        try {
          let result = await execute(action, args, cwd || process.cwd());
          if (action === "reconcile") {
            const all = result.tasks.filter(
                (t) => !args.id || t.id === args.id,
              ),
              limit = args.limit || 30,
              offset = args.offset || 0;
            result = {
              repo: result.repo,
              workers: result.activeWorkers.slice(0, 20),
              workerCount: result.activeWorkers.length,
              total: all.length,
              nextOffset: all.length > offset + limit ? offset + limit : null,
              tasks: all.slice(offset, offset + limit).map((t) => ({
                id: t.id,
                title: t.title,
                status: t.status,
                active: t.active,
                interrupted: t.interrupted,
                verification: t.verification,
                integrated: t.integrated,
                blockedBy: t.blockedBy,
                conflicts: t.conflicts,
                checkpoint: t.checkpoints.at(-1)?.summary,
              })),
              errors: result.errors,
              activityRecords: result.activity.length,
            };
          }
          if (action === "get")
            result = {
              id: result.id,
              title: result.title,
              description: result.description,
              acceptance: result.acceptance,
              scope: result.scope,
              dependencies: result.dependencies,
              status: result.status,
              checkpoint: result.checkpoints.at(-1),
              decision: result.decisions.at(-1),
              evidence: result.evidence.at(-1)
                ? {
                    check: result.evidence.at(-1).check,
                    result: result.evidence.at(-1).result,
                    at: result.evidence.at(-1).at,
                  }
                : null,
              conflicts: result.conflicts,
            };
          if (action === "update")
            result = {
              id: result.id,
              title: result.title,
              status: result.status,
              scope: result.scope,
              dependencies: result.dependencies,
              conflicts: result.conflicts,
            };
          return { content: [{ type: "text", text: JSON.stringify(result) }] };
        } catch (e) {
          return {
            isError: true,
            content: [{ type: "text", text: e.message }],
          };
        }
      },
    );
  add(
    "project_context",
    "Compact persistent context. Routine activity capture is automatic: do not call this after each edit.",
    {},
    "context",
  );
  add(
    "task_get",
    "Read the actual requirement, acceptance criteria and latest handoff for one task without activity/history dumps.",
    { id: z.string() },
    "get",
  );
  add(
    "task_next",
    "Find a small set of unowned work whose dependencies are verified against current code.",
    {},
    "next",
  );
  add(
    "task_create",
    "Save a future idea or meaningful task. Use the current model; no separate AI request is made.",
    {
      title: z.string(),
      description: z.string().optional(),
      acceptance: z.array(z.string()).optional(),
      dependencies: z.array(z.string()).optional(),
      scope: z.array(z.string()).optional(),
      priority: z.number().optional(),
      due: z.string().optional(),
      actor: z.string().optional(),
    },
    "create",
  );
  add(
    "task_update",
    "Refine task intent, dependencies or scope; resolve=true explicitly reconciles competing updates.",
    {
      id: z.string(),
      patch: z.object({
        title: z.string().optional(),
        description: z.string().optional(),
        status: z
          .enum([
            "backlog",
            "ready",
            "in_progress",
            "blocked",
            "implemented",
            "cancelled",
            "superseded",
          ])
          .optional(),
        dependencies: z.array(z.string()).optional(),
        scope: z.array(z.string()).optional(),
        acceptance: z.array(z.string()).optional(),
        due: z.string().optional(),
        priority: z.number().optional(),
      }),
      actor: z.string().optional(),
      token: z.string().optional(),
      resolve: z.boolean().optional(),
    },
    "update",
  );
  add(
    "task_claim",
    "Atomically claim meaningful work. Pass the hook session_id and same actor agent:session_id to associate automatic activity. waitMs waits locally for conflicting ownership to release without repeated model calls.",
    {
      id: z.string(),
      actor: z.string(),
      session: z.string().optional(),
      waitMs: z.number().int().min(0).max(30000).optional(),
      scope: z.array(z.string()).optional(),
    },
    "claim",
  );
  add(
    "task_checkpoint",
    "Save a meaningful handoff or decision; do not log individual edits here.",
    {
      id: z.string(),
      summary: z.string(),
      next: z.string().optional(),
      actor: z.string().optional(),
      token: z.string().optional(),
    },
    "checkpoint",
  );
  add(
    "task_heartbeat",
    "Renew ownership for an external unattended worker; ordinary agent tool boundaries renew automatically.",
    { id: z.string(), token: z.string() },
    "heartbeat",
  );
  add(
    "task_release",
    "Release owned work explicitly so another local worker can proceed.",
    { id: z.string(), token: z.string() },
    "release",
  );
  add(
    "task_decision",
    "Persist a meaningful development decision using the current agent.",
    {
      id: z.string(),
      summary: z.string(),
      next: z.string().optional(),
      actor: z.string().optional(),
      token: z.string().optional(),
    },
    "decision",
  );
  add(
    "task_verify",
    "Run a project-configured check and record evidence against the actual code snapshot. A model assertion is insufficient.",
    {
      id: z.string(),
      check: z.string(),
      actor: z.string().optional(),
      token: z.string().optional(),
    },
    "verify",
  );
  add(
    "project_reconcile",
    "Inspect current code evidence, integration and conflicts. Paginated by default to conserve context.",
    {
      id: z.string().optional(),
      limit: z.number().int().min(1).max(100).optional(),
      offset: z.number().int().min(0).optional(),
    },
    "reconcile",
  );
  await server.connect(new StdioServerTransport());
}
