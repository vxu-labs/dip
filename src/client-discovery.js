import fs from "node:fs";
import path from "node:path";
import { repoAt, redact } from "./util.js";
import { ensure, Runtime } from "./core.js";

// Explicit integration point for clients using Git libraries rather than git.exe.
// Hosts call this from their workspace/open or Git-operation callback.
export function discoverClientProject(
  cwd,
  { client, enabled = true, probe = false } = {},
) {
  if (typeof client !== "string" || !/^[a-zA-Z0-9._-]{1,80}$/.test(client))
    throw new Error(
      "Supply an explicit client identifier (1..80 letters, numbers, dot, underscore or hyphen)",
    );
  if (!enabled)
    return {
      client,
      supported: false,
      adopted: false,
      reason: "adapter_disabled",
    };
  let identity;
  try {
    identity = repoAt(cwd);
  } catch (e) {
    return {
      client,
      supported: false,
      adopted: false,
      reason: "no_local_worktree_context",
      detail: redact(e.message),
    };
  }
  const hadLedger = fs.existsSync(
    path.join(identity.root, ".dip", "config.json"),
  );
  if (probe)
    return {
      client,
      supported: true,
      adopted: false,
      root: identity.root,
      hasLedger: hadLedger,
      mode: "explicit_client_callback",
      nativeTraceRequired: false,
    };
  const repo = ensure(identity.root),
    rt = new Runtime();
  try {
    rt.register(repo);
    rt.enqueue(repo, "client-discovery", {
      at: new Date().toISOString(),
      kind: "client.discovered",
      client,
      branch: repo.branch,
      initialized: !hadLedger,
    });
    rt.flush(repo.root);
    if (rt.lastFlushErrors.length)
      throw new Error(
        "Client capture remains queued; inspect runtime health before assuming durable ledger delivery",
      );
    return {
      client,
      supported: true,
      adopted: true,
      initialized: !hadLedger,
      root: repo.root,
      mode: "explicit_client_callback",
      nativeTraceRequired: false,
    };
  } finally {
    rt.close();
  }
}
