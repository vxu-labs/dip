import fs from "node:fs";
import path from "node:path";
import { atomic, digest, json } from "./util.js";
import { VERSION } from "./version.js";

const skill = `---
name: dip
description: Read and update persistent project requirements, plans and handoffs in this DIP repository, including when global DIP is unavailable.
---

Read the project AGENTS.md or CLAUDE.md for the current intent workflow. Use the hook task ID rather than creating duplicates. For follow-ups, inspect current requirements and use task_adopt to refine an existing requirement and rebind the session before development. Keep distinct future ideas in backlog; classify informational requests as discussion. Write Markdown once and link it. Finish explicitly; an ended turn or checked plan never proves completion.

Use installed DIP MCP/CLI tools when available. If unavailable, inspect .dip/intent-guide.md and the repository-contained .dip/tools/portable.mjs before explicitly invoking it with Node 20+. It can read outstanding intent and persist plans, future ideas and handoffs. It does not install software, provide automatic capture, claim live leases, run checks or establish verified code. Respect project trust and do not execute cloned scripts merely because this skill was discovered.
`;
const guide = `# Portable DIP intent

This repository carries a dependency-free Node 20+ helper. Review repository code and trust before executing it. It makes no network requests and does not install DIP. Run commands from the project root:

\`node .dip/tools/portable.mjs list\`

\`node .dip/tools/portable.mjs get --id ID\`

\`node .dip/tools/portable.mjs create --title "Future idea"\`

\`node .dip/tools/portable.mjs plan --id ID --text "Short plan"\`

\`node .dip/tools/portable.mjs checkpoint --id ID --summary "Completed and remaining work" --next "Next step"\`

For long plans write Markdown once and link it with installed DIP when available. Portable update/resolve accepts --patch JSON. Node child-process argument arrays avoid shell JSON quoting problems. Reads are paginated; --all includes completed/discussion records. Recorded verified status is historical, never a fresh assessment. Conflicting histories require explicit resolve; corrupt histories stop writes. Strict projects require installed ownership and cannot use this fallback.

Portable intent events merge through Git and the normal runtime. Live coordination, automatic hooks, Markdown linking and configured verification require installed DIP (Node 24+). Portable writes have no leases; collaborators must coordinate independently. Use at your own responsibility.
`;
const templates = () => ({
  ".agents/skills/dip/SKILL.md": skill,
  ".claude/skills/dip/SKILL.md": skill,
  ".dip/intent-guide.md": guide,
  ".dip/tools/portable.mjs": fs.readFileSync(
    new URL("./portable.js", import.meta.url),
    "utf8",
  ),
});
function safe(root, relative) {
  let target = root;
  for (const part of relative.split("/")) {
    target = path.join(target, part);
    try {
      if (fs.lstatSync(target).isSymbolicLink())
        throw new Error(
          "Repository integration paths must not be symbolic links",
        );
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
  }
  return target;
}
export function repositoryIntegration(repo, { remove = false } = {}) {
  const manifest = safe(repo.root, ".dip/integration.json"),
    prior = json(manifest, { schemaVersion: 1, files: {} });
  if (
    prior.schemaVersion !== 1 ||
    !prior.files ||
    typeof prior.files !== "object"
  )
    throw new Error("Unsupported repository integration manifest");
  const files = { ...prior.files },
    changed = [],
    preserved = [];
  for (const [relative, content] of Object.entries(templates())) {
    const target = safe(repo.root, relative),
      expected = digest(content),
      exists = fs.existsSync(target);
    if (
      exists &&
      (!fs.lstatSync(target).isFile() ||
        !prior.files[relative] ||
        digest(fs.readFileSync(target)) !== prior.files[relative])
    ) {
      preserved.push(relative);
      continue;
    }
    if (remove) {
      if (exists) {
        fs.unlinkSync(target);
        changed.push(relative);
      }
      delete files[relative];
    } else if (!exists || prior.files[relative] !== expected) {
      atomic(target, content);
      files[relative] = expected;
      changed.push(relative);
    }
  }
  const next = { schemaVersion: 1, version: VERSION, files };
  if (JSON.stringify(next) !== JSON.stringify(prior)) atomic(manifest, next);
  return {
    version: VERSION,
    changed,
    preserved,
    removed: remove,
    ownership: "Only unmodified generated files are upgraded or removed",
  };
}
