import fs from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import {
  loadDocument,
  loadProjectText,
  projectRelativePath,
  projectTextPath,
  readDocument,
  documentState,
} from "./documents.js";
import { linkedSkillBundle } from "./skill-storage.js";
import { atomic, digest, git, home, inScope, json, redact } from "./util.js";

export const KNOWLEDGE_FILE = ".dip-knowledge.json";
const maxManifest = 256 * 1024;
const entryId = z.string().regex(/^[a-z0-9][a-z0-9._-]{0,95}$/);
const refId = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const sha = z.string().regex(/^[a-f0-9]{64}$/);
const text = (max) => z.string().trim().min(1).max(max);
export const knowledgeCategory = z.enum([
  "repository",
  "configuration",
  "requirement",
  "architecture",
  "decision",
  "development",
  "testing",
  "deployment",
  "memory",
  "instruction",
  "skill",
]);
export const knowledgePatch = z
  .strictObject({
    title: text(150),
    category: knowledgeCategory,
    source: text(1024).optional(),
    summary: text(500).optional(),
    scopes: z.array(text(1024)).max(12).optional(),
    topics: z.array(text(100)).max(12).optional(),
    startup: z.boolean().optional(),
    taskId: refId.optional(),
    relatedTaskId: refId.optional(),
    rule: z.strictObject({ key: text(80), value: text(120) }).optional(),
  })
  .partial();
const entrySchema = knowledgePatch
  .required({ title: true, category: true })
  .extend({
    id: entryId,
    indexedHash: sha.optional(),
    indexedPolicyHash: sha.optional(),
    indexedCommit: z.string().nullable().optional(),
  });
const manifestSchema = z.strictObject({
  version: z.literal(1),
  entries: z.array(entrySchema).max(200),
});

function storageFile(repo, local) {
  return local
    ? path.join(home(), "knowledge", repo.key + ".json")
    : path.join(repo.root, KNOWLEDGE_FILE);
}

function loadManifest(repo, local) {
  const file = storageFile(repo, local);
  let fd;
  try {
    if (!fs.lstatSync(file).isFile())
      throw new Error("Knowledge manifest must be a regular file");
    fd = fs.openSync(
      file,
      fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0),
    );
    const buffer = Buffer.alloc(maxManifest + 1);
    let bytes = 0,
      read;
    while (
      bytes < buffer.length &&
      (read = fs.readSync(fd, buffer, bytes, buffer.length - bytes, null))
    )
      bytes += read;
    if (bytes > maxManifest)
      throw new Error("Knowledge manifest exceeds 256 KiB");
    const manifest = manifestSchema.parse(
      JSON.parse(buffer.subarray(0, bytes).toString("utf8")),
    );
    if (
      new Set(manifest.entries.map((entry) => entry.id)).size !==
      manifest.entries.length
    )
      throw new Error("Knowledge manifest contains duplicate IDs");
    if (
      manifest.entries.some((entry) =>
        local
          ? entry.source || entry.category !== "memory"
          : !entry.source || entry.category === "memory",
      )
    )
      throw new Error(
        "Shared knowledge needs a source; memories belong in local storage",
      );
    return manifest;
  } catch (error) {
    if (error.code === "ENOENT") return { version: 1, entries: [] };
    throw error;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

function projectPath(repo, value = ".") {
  const input = value.replaceAll("\\", "/");
  if (path.resolve(repo.root, input) === repo.root) return ".";
  const relative = projectRelativePath(repo.root, input);
  if (relative.includes(":")) throw new Error("Path escapes project");
  let parent = repo.root;
  for (const component of relative.split("/")) {
    if (
      [".git", ".dip", ".dip-local", "node_modules"].includes(
        component.toLowerCase(),
      )
    )
      throw new Error("Path is outside the knowledge boundary");
    parent = path.join(parent, component);
    try {
      if (
        fs.lstatSync(parent).isSymbolicLink() ||
        fs.existsSync(path.join(parent, ".git"))
      )
        throw new Error("Path crosses a symlink or another Git project");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  return relative;
}

export function nativeSource(source) {
  const name = path.posix.basename(source).toUpperCase();
  const scope = path.posix.dirname(source);
  if (["AGENTS.MD", "AGENTS.OVERRIDE.MD", "CLAUDE.MD"].includes(name))
    return {
      category: "instruction",
      scope,
      host: name === "CLAUDE.MD" ? "claude" : "codex",
    };
  if (name !== "SKILL.MD") return null;
  const match =
    /^(?:(.*)\/)?\.(agents|claude)\/skills\/([^/]+)\/SKILL\.md$/i.exec(source);
  return {
    category: "skill",
    scope: match ? match[1] || "." : path.posix.dirname(scope),
    host: match
      ? match[2].toLowerCase() === "agents"
        ? "codex"
        : "claude"
      : "manual",
  };
}

function knowledgeSource(repo, source) {
  const relative = projectTextPath(repo.root, projectPath(repo, source));
  if (
    !/\.(md|json|toml|ya?ml|ini)$/i.test(relative) ||
    relative === KNOWLEDGE_FILE
  )
    throw new Error(
      "Knowledge sources must be project Markdown or text configuration files",
    );
  return relative;
}

export function skillActivation(repo, source, host, body) {
  if (host === "manual") return { activation: "explicit-only" };
  try {
    if (host === "codex") {
      const file = projectPath(
        repo,
        path.posix.join(path.posix.dirname(source), "agents/openai.yaml"),
      );
      let data;
      try {
        const full = path.join(repo.root, file);
        if (!fs.lstatSync(full).isFile() || fs.statSync(full).size > 65536)
          return { activation: "unknown" };
        data = fs.readFileSync(full);
      } catch (error) {
        if (error.code === "ENOENT")
          return { activation: "host-default", policyHash: digest("") };
        throw error;
      }
      const config = parseYaml(data.toString("utf8"), { maxAliasCount: 0 });
      const value = config?.policy?.allow_implicit_invocation;
      const invalid = (object) =>
        object != null && (typeof object !== "object" || Array.isArray(object));
      return {
        activation:
          invalid(config) || invalid(config?.policy)
            ? "unknown"
            : value === false
              ? "explicit-only"
              : value === undefined || value === true
                ? "host-default"
                : "unknown",
        policySource: file,
        policyHash: digest(data),
      };
    }
    const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(body);
    if (!frontmatter) return { activation: "unknown" };
    const config = parseYaml(frontmatter[1], { maxAliasCount: 0 });
    const model = config?.["disable-model-invocation"];
    const user = config?.["user-invocable"];
    if (
      [model, user].some(
        (value) => value !== undefined && typeof value !== "boolean",
      )
    )
      return { activation: "unknown" };
    if (model)
      return { activation: user === false ? "unknown" : "explicit-only" };
    return { activation: user === false ? "model-only" : "host-default" };
  } catch {
    return { activation: "unknown" };
  }
}

function readSkillSource(repo, source, native, readActivation) {
  const folder = path.posix.dirname(source);
  let bundle;
  if (native.host !== "manual") {
    projectPath(repo, path.posix.dirname(folder));
    const alias = path.join(repo.root, folder);
    bundle = linkedSkillBundle(alias, path.join(repo.root, ".dip"));
    if (!bundle && native.scope !== ".")
      bundle = linkedSkillBundle(
        alias,
        path.join(repo.root, native.scope, ".dip"),
      );
  }
  const target = bundle ? { root: bundle } : repo;
  const file = bundle ? "SKILL.md" : knowledgeSource(repo, source);
  const doc = loadDocument(target, file);
  const policy = readActivation
    ? skillActivation(target, file, native.host, doc.text)
    : {};
  if (!bundle) return { doc, metadata: policy };
  const storage = path.relative(repo.root, bundle).replaceAll("\\", "/");
  return {
    doc,
    metadata: {
      ...policy,
      ...(policy.policySource && {
        policySource: path.posix.join(storage, policy.policySource),
      }),
      canonicalSource: path.posix.join(storage, file),
    },
  };
}

function sourceState(repo, entry, { readActivation = false } = {}) {
  if (!entry.source) return { ...entry, currentness: "local" };
  let native;
  try {
    const source = projectTextPath(repo.root, entry.source);
    native = nativeSource(source);
    const { doc, metadata } =
      native?.category === "skill"
        ? readSkillSource(repo, source, native, readActivation)
        : {
            doc: loadProjectText(repo, knowledgeSource(repo, source)),
            metadata:
              native?.category === "instruction"
                ? { activation: "host-managed" }
                : {},
          };
    const stale =
      entry.indexedHash !== doc.hash ||
      (entry.indexedPolicyHash &&
        entry.indexedPolicyHash !== metadata.policyHash);
    return {
      ...entry,
      ...(native && { ...native, scopes: [native.scope] }),
      ...metadata,
      currentness: entry.indexedHash
        ? stale
          ? "stale"
          : "current"
        : "unindexed",
      currentHash: doc.hash,
    };
  } catch (error) {
    return {
      ...entry,
      ...(native && { ...native, scopes: [native.scope] }),
      currentness: error.code === "ENOENT" ? "missing" : "unavailable",
    };
  }
}

function nativeEntries(names) {
  return names.flatMap((source) => {
    const native = nativeSource(source);
    if (!native) return [];
    return [
      {
        id: "native-" + digest(source).slice(0, 24),
        title: source,
        source,
        ...native,
        scopes: [native.scope],
      },
    ];
  });
}

function nativeInventory(repo, category) {
  const ignored = [".dip", ".dip-local", "node_modules"];
  const pathspec = [
    ...(category === "skill"
      ? ["SKILL.md"]
      : ["AGENTS.md", "AGENTS.override.md", "CLAUDE.md", "SKILL.md"]
    ).map((name) => ":(glob,icase)**/" + name),
    ...ignored.map((name) => ":(exclude,glob,icase)**/" + name + "/**"),
  ];
  const listed = (patterns = []) =>
    git(
      repo.root,
      [
        "ls-files",
        "--cached",
        "--others",
        "--exclude-standard",
        "-z",
        "--",
        ...patterns,
      ],
      false,
      { raw: true },
    )
      .split("\0")
      .filter(Boolean);
  const names = new Set(listed(pathspec));
  const scopes = new Set(["."]);
  for (const file of listed()) {
    if (file.split("/").some((part) => ignored.includes(part.toLowerCase())))
      continue;
    let scope = path.posix.dirname(file);
    while (!scopes.has(scope)) {
      scopes.add(scope);
      scope = path.posix.dirname(scope);
    }
  }
  // Git's ignored-file listing traverses generated trees in their entirety.
  // Probe native directories directly in the live source tree instead.
  for (const scope of scopes) {
    const directory = path.join(repo.root, scope);
    if (category !== "skill")
      for (const name of ["AGENTS.md", "AGENTS.override.md", "CLAUDE.md"]) {
        if (fs.existsSync(path.join(directory, name)))
          names.add(path.posix.join(scope, name));
      }
    for (const skillDir of [
      ".agents/skills",
      ".claude/skills",
      ".codex/skills",
      "skills",
    ]) {
      const folder = path.join(directory, skillDir);
      let entries;
      try {
        if (fs.lstatSync(folder).isSymbolicLink()) continue;
        entries = fs.readdirSync(folder, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (
          (entry.isDirectory() &&
            fs.existsSync(path.join(folder, entry.name, "SKILL.md"))) ||
          (entry.isSymbolicLink() &&
            [".agents/skills", ".claude/skills"].includes(skillDir))
        )
          names.add(path.posix.join(scope, skillDir, entry.name, "SKILL.md"));
      }
    }
  }
  return nativeEntries([...names]);
}

function inventory(repo, shared, includeLocal) {
  const existing = new Set(shared.map((entry) => entry.source));
  let index = {};
  try {
    index = json(path.join(home(), "skills.json"), {});
  } catch {
    // The index is disposable; the working tree remains the source.
  }
  const pins = new Map(
    (
      index.projects
        ?.find((p) => p.id === repo.key)
        ?.worktrees.find((w) => w.root === repo.root)?.skills || []
    ).map((skill) => [skill.source, skill]),
  );
  const local = includeLocal
    ? loadManifest(repo, true).entries.map((entry) => ({
        ...entry,
        visibility: "local",
      }))
    : [];
  return [
    ...shared,
    ...nativeInventory(repo)
      .filter((entry) => !existing.has(entry.source))
      .map((entry) => {
        const pin = pins.get(entry.source);
        return pin
          ? {
              ...entry,
              title: pin.name,
              indexedHash: pin.hash,
              indexedPolicyHash: pin.policyHash,
              indexedCommit: pin.commit,
              indexOrigin: "local-skill-catalog",
            }
          : entry;
      }),
    ...local,
  ];
}

export function projectSkillSources(repo) {
  const entries = loadManifest(repo, false).entries.filter(
    (entry) => entry.category === "skill",
  );
  const registered = new Map(entries.map((entry) => [entry.source, entry]));
  const discovered = new Map(
    nativeInventory(repo, "skill").map((entry) => [entry.source, entry]),
  );
  for (const entry of nativeEntries([...registered.keys()])) {
    if (entry.category === "skill" && !discovered.has(entry.source))
      discovered.set(entry.source, entry);
  }
  return [...discovered.values()].flatMap((entry) => {
    try {
      const source = projectTextPath(repo.root, entry.source);
      const { doc, metadata } = readSkillSource(repo, source, entry, true);
      const registeredEntry = registered.get(source);
      return [
        {
          source,
          host: entry.host,
          scope: entry.scope,
          hash: doc.hash,
          commit: repo.head,
          ...metadata,
          ...skillHeader(
            doc.text,
            registeredEntry?.title ||
              path.posix.basename(path.posix.dirname(source)),
          ),
          ...(registeredEntry?.indexedHash && {
            reviewedHash: registeredEntry.indexedHash,
          }),
        },
      ];
    } catch {
      // Sparse, deleted and unsafe sources are not installed here.
      return [];
    }
  });
}

export function skillHeader(body, fallback) {
  let metadata;
  try {
    const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(body);
    if (frontmatter) metadata = parseYaml(frontmatter[1], { maxAliasCount: 0 });
  } catch {}
  const clipped = (value, max) =>
    typeof value === "string" ? redact(value.trim()).slice(0, max) : "";
  return {
    name: clipped(metadata?.name, 100) || fallback,
    description: clipped(metadata?.description, 500),
  };
}

function targetsFor(repo, args, task) {
  if (args.path) {
    const target = projectPath(repo, args.path);
    if (
      task?.scope?.length &&
      !task.scope.some((scope) => inScope(target, scope))
    )
      throw new Error("Path is outside the task scope");
    return [target];
  }
  const targets = task?.scope?.map((scope) => projectPath(repo, scope));
  return targets?.length
    ? targets
    : [projectPath(repo, args.cwd ? fs.realpathSync.native(args.cwd) : ".")];
}

const entryScopes = (entry) => {
  const native = nativeSource(entry.source || "");
  return native ? [native.scope] : entry.scopes?.length ? entry.scopes : ["."];
};
const applies = (entry, target) =>
  entryScopes(entry).some((scope) => inScope(target, scope));

function visibleEntries(repo, entries, args, targets, { scoped = false } = {}) {
  const query = (args.query || "")
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  return entries.filter((entry) => {
    if (entry.taskId && entry.taskId !== args.taskId) return false;
    if (
      (scoped || args.path || args.taskId) &&
      !targets.some((target) => applies(entry, target))
    )
      return false;
    if (args.category && entry.category !== args.category) return false;
    const searchable = [
      entry.id,
      entry.title,
      entry.category,
      entry.source,
      entry.summary,
      ...(entry.topics || []),
    ]
      .join(" ")
      .toLowerCase();
    const unmatched = query.filter((term) => !searchable.includes(term));
    if (!unmatched.length) return true;
    if (
      !entry.source ||
      !/\.md$/i.test(entry.source) ||
      nativeSource(entry.source)
    )
      return false;
    try {
      const source = knowledgeSource(repo, entry.source);
      const excerpt = loadDocument(repo, source)
        .text.slice(0, 32768)
        .toLowerCase();
      return unmatched.every((term) => excerpt.includes(term));
    } catch {
      return false;
    }
  });
}

function pagination(args) {
  const limit = Number(args.limit ?? 20),
    offset = Number(args.offset ?? 0);
  if (
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 50 ||
    !Number.isInteger(offset) ||
    offset < 0
  )
    throw new Error("Knowledge limit must be 1..50 and offset nonnegative");
  return { limit, offset };
}

function projectIdentity(repo) {
  return { root: repo.root, branch: repo.branch, commit: repo.head };
}

function ruleConflicts(entries, targets) {
  const rules = entries.filter(
    (entry) => entry.rule && entry.currentness === "current",
  );
  const conflicts = [];
  for (const [index, entry] of rules.entries()) {
    for (const other of rules.slice(index + 1)) {
      if (conflicts.length === 20) return conflicts;
      if (
        entry.rule.key !== other.rule.key ||
        entry.rule.value === other.rule.value
      )
        continue;
      const target = targets.find(
        (target) => applies(entry, target) && applies(other, target),
      );
      if (target)
        conflicts.push({
          key: entry.rule.key,
          target,
          sources: [entry, other].map(({ id, source, rule, taskId }) => ({
            id,
            source,
            value: rule.value,
            taskId,
          })),
        });
    }
  }
  return conflicts;
}

function instructionPaths(repo, targets) {
  const names = new Set();
  for (const target of targets) {
    let dir = target;
    while (true) {
      for (const name of ["AGENTS.md", "AGENTS.override.md", "CLAUDE.md"]) {
        const source = path.posix.join(dir, name);
        if (fs.existsSync(path.join(repo.root, source))) names.add(source);
      }
      if (dir === ".") break;
      dir = path.posix.dirname(dir);
    }
  }
  return [...names];
}

function instructionChain(repo, targets, entries) {
  const names = instructionPaths(repo, targets);
  const known = new Map(entries.map((entry) => [entry.source, entry]));
  const nonemptyOverride = new Set();
  for (const source of names) {
    if (path.posix.basename(source) !== "AGENTS.override.md") continue;
    try {
      if (loadDocument(repo, projectPath(repo, source)).text.trim())
        nonemptyOverride.add(path.posix.dirname(source));
    } catch {}
  }
  const depth = (scope) => (scope === "." ? 0 : scope.split("/").length);
  return nativeEntries(names)
    .sort(
      (a, b) =>
        depth(a.scope) - depth(b.scope) ||
        a.scope.localeCompare(b.scope) ||
        a.source.localeCompare(b.source),
    )
    .map((entry) => ({
      ...sourceState(repo, known.get(entry.source) || entry),
      ...(path.posix.basename(entry.source) === "AGENTS.md" &&
      nonemptyOverride.has(entry.scope)
        ? { shadowedBy: path.posix.join(entry.scope, "AGENTS.override.md") }
        : {}),
    }));
}

export function projectKnowledge(repo, action, args = {}, task) {
  const shared = loadManifest(repo, false).entries;
  const project = projectIdentity(repo);
  if (action === "read") {
    if (Boolean(args.id) === Boolean(args.path))
      throw new Error("Use a knowledge entry ID or Markdown path");
    const entry = args.id
      ? [
          ...(args.includeLocal ? loadManifest(repo, true).entries : []),
          ...shared,
        ].find((entry) => entry.id === args.id) ||
        (args.id.startsWith("native-")
          ? nativeInventory(repo).find((entry) => entry.id === args.id)
          : undefined)
      : undefined;
    if (args.id && !entry) throw new Error("Knowledge entry not found");
    if (entry?.taskId && entry.taskId !== args.taskId)
      throw new Error("Supply the matching task ID");
    if (entry && !entry.source)
      return { project, entry: { ...entry, visibility: "local" } };
    const relative = projectTextPath(repo.root, entry?.source || args.path);
    if (nativeSource(relative)?.category === "skill")
      throw new Error("Invoke project skills through the native host");
    const source = knowledgeSource(repo, relative);
    if (!/\.md$/i.test(source))
      throw new Error("Use a project file reader for configuration sources");
    const document = readDocument(
      repo,
      { path: source, hash: entry?.indexedHash },
      args,
    );
    return {
      project,
      ...document,
      currentness: entry?.indexedHash ? document.currentness : "unindexed",
    };
  }
  const targets = targetsFor(repo, args, task);
  const { limit, offset } = pagination(args);
  if (action === "list") {
    const inventoryEntries = inventory(repo, shared, args.includeLocal);
    const entries = visibleEntries(
      repo,
      inventoryEntries,
      args,
      task && !args.path
        ? expandTargets(repo, targets, inventoryEntries)
        : targets,
    );
    return {
      project,
      untrustedContent: true,
      total: entries.length,
      entries: entries
        .slice(offset, offset + limit)
        .map((entry) => sourceState(repo, entry, { readActivation: true })),
    };
  }
  const candidates = [
    ...shared,
    ...(args.includeLocal
      ? loadManifest(repo, true).entries.map((entry) => ({
          ...entry,
          visibility: "local",
        }))
      : []),
  ];
  const relevantTargets =
    task && !args.path
      ? expandTargets(repo, targets, [
          ...candidates,
          ...nativeInventory(repo).filter(
            (entry) => entry.category === "instruction",
          ),
        ])
      : targets;
  const entries = visibleEntries(repo, candidates, args, relevantTargets, {
    scoped: true,
  })
    .filter((entry) => !nativeSource(entry.source || ""))
    .map((entry) => sourceState(repo, entry));
  const instructions = instructionChain(repo, relevantTargets, shared);
  return {
    project,
    untrustedContent: true,
    targets,
    instructions: instructions.slice(0, 50),
    guidance: entries.slice(offset, offset + limit),
    total: entries.length,
    conflicts: ruleConflicts(
      [...entries, ...instructions.filter((entry) => !entry.shadowedBy)],
      relevantTargets,
    ),
    task: task && {
      id: task.id,
      title: task.title,
      scope: task.scope,
      conflicts: task.conflicts.slice(0, 12),
      sources: (task.documents || []).slice(0, 12).map((ref) => {
        const { path, role, hash, currentness, currentHash } = documentState(
          repo,
          ref,
        );
        return { path, role, hash, currentness, currentHash };
      }),
    },
    precedence:
      "The host resolves its own instruction chain. DIP reports scoped sources and declared disagreements for review.",
  };
}

function expandTargets(repo, targets, entries) {
  const expanded = new Set(targets);
  for (const scope of new Set(entries.flatMap(entryScopes))) {
    if (expanded.size >= 100) break;
    if (targets.some((target) => inScope(scope, target))) {
      try {
        expanded.add(projectPath(repo, scope));
      } catch {}
    }
  }
  return [...expanded];
}

export function knowledgeBrief(repo, args = {}, task) {
  const project = projectIdentity(repo);
  try {
    const targets = targetsFor(repo, args, task);
    const prompt = String(args.prompt || "")
      .slice(0, 12000)
      .normalize("NFKC")
      .toLowerCase();
    const matches = (entry) =>
      entry.topics?.some((topic) => {
        const term = topic
          .normalize("NFKC")
          .toLowerCase()
          .replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        return new RegExp(
          "(?<![\\p{L}\\p{N}])" + term + "(?![\\p{L}\\p{N}])",
          "u",
        ).test(prompt);
      });
    const entries = loadManifest(repo, false)
      .entries.filter(
        (entry) =>
          !nativeSource(entry.source) &&
          (!entry.taskId || entry.taskId === args.taskId),
      )
      .filter((entry) => {
        const inTarget = targets.some((target) => applies(entry, target));
        return (
          (inTarget && entry.startup) ||
          (inTarget && targets.some((target) => target !== ".")) ||
          (!args.path &&
            matches(entry) &&
            (inTarget || targets.every((target) => target === ".")))
        );
      })
      .sort((a, b) => Number(!!matches(b)) - Number(!!matches(a)));
    const brief = {
      ...project,
      sources: [],
      instructionPaths: instructionPaths(repo, targets).slice(0, 4),
      untrustedContent: true,
      details: "dip knowledge context / project_knowledge_context",
    };
    for (const entry of entries.slice(0, 3)) {
      const { currentness, currentHash } = sourceState(repo, entry);
      const source = {
        id: entry.id,
        path: entry.source,
        state: currentness,
        hash: currentHash,
        ...(currentness === "current" && entry.summary
          ? { summary: [...redact(entry.summary)].slice(0, 340).join("") }
          : {}),
      };
      brief.sources.push(source);
      if (Buffer.byteLength(JSON.stringify(brief)) > 1450) {
        brief.sources.pop();
        break;
      }
    }
    return brief;
  } catch {
    return {
      ...project,
      error:
        "Knowledge context unavailable; inspect the project manifest with DIP.",
    };
  }
}

export function mutateKnowledge(repo, runtime, action, args) {
  const id = entryId.parse(args.id);
  const local = args.includeLocal === true;
  if (local && action === "refresh")
    throw new Error("Local memories have no source to refresh");
  runtime.db.exec("BEGIN IMMEDIATE");
  try {
    const manifest = loadManifest(repo, local);
    const index = manifest.entries.findIndex((entry) => entry.id === id);
    const previous = manifest.entries[index];
    if (!previous && action !== "set")
      throw new Error("Knowledge entry not found");
    if (action === "remove") {
      manifest.entries.splice(index, 1);
    } else {
      const patch =
        action === "set" ? knowledgePatch.parse(args.patch || {}) : {};
      const entry = entrySchema.parse({ ...previous, ...patch, id });
      if (local) {
        if (
          entry.category !== "memory" ||
          entry.source ||
          entry.startup ||
          entry.rule ||
          entry.taskId ||
          entry.relatedTaskId
        )
          throw new Error(
            "Local entries are memories without a shared source, startup injection or task linkage",
          );
        entry.summary = entry.summary && redact(entry.summary);
        entry.title = redact(entry.title);
      } else {
        if (!entry.source || entry.category === "memory")
          throw new Error(
            "Shared entries require project Markdown; use local storage for memories",
          );
        entry.source = projectTextPath(repo.root, entry.source);
        const native = nativeSource(entry.source);
        if (native?.category !== "skill")
          entry.source = knowledgeSource(repo, entry.source);
        if (
          (native && native.category !== entry.category) ||
          (!native && ["skill", "instruction"].includes(entry.category))
        )
          throw new Error(
            "Use the source's native instruction or skill category",
          );
        if (
          native &&
          (entry.startup ||
            entry.taskId ||
            entry.scopes ||
            (native.category === "skill" && entry.rule))
        )
          throw new Error(
            "Native source scope and activation come from the host's files",
          );
        if (
          action === "refresh" ||
          previous?.source !== entry.source ||
          args.expectedHash
        ) {
          const { doc, metadata } =
            native?.category === "skill"
              ? readSkillSource(repo, entry.source, native, true)
              : { doc: loadProjectText(repo, entry.source), metadata: {} };
          if (args.expectedHash && doc.hash !== args.expectedHash)
            throw new Error("Document content version changed");
          if (action === "refresh" || previous?.source !== entry.source) {
            entry.indexedHash = doc.hash;
            entry.indexedCommit = repo.head;
            entry.indexedPolicyHash = metadata.policyHash;
          }
        }
      }
      if (entry.scopes)
        entry.scopes = entry.scopes.map((scope) => projectPath(repo, scope));
      if (index < 0) manifest.entries.push(entry);
      else manifest.entries[index] = entry;
    }
    const bytes =
      JSON.stringify(manifestSchema.parse(manifest), null, 2) + "\n";
    if (Buffer.byteLength(bytes) > maxManifest)
      throw new Error("Knowledge manifest exceeds 256 KiB");
    atomic(storageFile(repo, local), bytes);
    runtime.db.exec("COMMIT");
    const entry = manifest.entries.find((entry) => entry.id === id);
    return {
      id,
      visibility: local ? "local" : "shared",
      ...(entry
        ? { source: entry.source, indexedHash: entry.indexedHash }
        : { removed: true }),
    };
  } catch (error) {
    runtime.db.exec("ROLLBACK");
    throw error;
  }
}
