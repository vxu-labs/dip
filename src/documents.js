import fs from "node:fs";
import path from "node:path";
import { digest, sensitive, canonicalScope, redact } from "./util.js";

export const DOCUMENT_ROLES = ["plan", "spec", "design", "reference", "notes"];
const MAX_BYTES = 1024 * 1024;

export function projectRelativePath(root, value) {
  if (
    typeof value !== "string" ||
    !value ||
    value.length > 1024 ||
    /[\x00-\x1f]/.test(value)
  )
    throw new Error("Document path is required");
  let absolute = path.resolve(root, value);
  let relative = path.relative(root, absolute).replaceAll("\\", "/");
  if (relative.startsWith("../") || path.isAbsolute(relative)) {
    // Permit an alias of the checkout root (e.g. macOS /var), preserving
    // every component below it so loadDocument still rejects document symlinks.
    let parent = path.dirname(absolute);
    for (;;) {
      try {
        if (
          canonicalScope(fs.realpathSync.native(parent)) ===
          canonicalScope(root)
        ) {
          absolute = path.resolve(root, path.relative(parent, absolute));
          relative = path.relative(root, absolute).replaceAll("\\", "/");
          break;
        }
      } catch {}
      const next = path.dirname(parent);
      if (next === parent) break;
      parent = next;
    }
  }
  if (!relative || relative.startsWith("../") || path.isAbsolute(relative))
    throw new Error("Document path escapes project");
  return relative;
}

export function documentPath(root, value) {
  const relative = projectRelativePath(root, value);
  if (
    !relative ||
    relative.includes(":") ||
    relative.startsWith("../") ||
    path.isAbsolute(relative) ||
    !/\.md$/i.test(relative) ||
    relative
      .split("/")
      .some((p) =>
        [".git", ".dip", ".dip-local", "node_modules"].includes(
          p.toLowerCase(),
        ),
      ) ||
    sensitive(relative)
  )
    throw new Error("Document must be a nonsensitive project Markdown file");
  return relative;
}

export function loadDocument(repo, value) {
  const relative = documentPath(repo.root, value);
  let target = repo.root;
  for (const component of relative.split("/")) {
    target = path.join(target, component);
    if (fs.lstatSync(target).isSymbolicLink())
      throw new Error("Document symlinks are not supported");
  }
  const fd = fs.openSync(
    target,
    fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0),
  );
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size > MAX_BYTES)
      throw new Error("Document must be a regular file of at most 1 MiB");
    const buffer = Buffer.alloc(MAX_BYTES + 1);
    let bytes = 0,
      n;
    while (
      bytes < buffer.length &&
      (n = fs.readSync(fd, buffer, bytes, buffer.length - bytes, null))
    )
      bytes += n;
    if (bytes > MAX_BYTES) throw new Error("Document exceeds 1 MiB");
    const data = buffer.subarray(0, bytes);
    const text = new TextDecoder("utf-8", { fatal: true }).decode(data);
    if (text.includes("\0")) throw new Error("Document must be UTF-8 text");
    return { path: relative, hash: digest(data), bytes, text };
  } finally {
    fs.closeSync(fd);
  }
}

export function validateDocument(payload) {
  if (
    !payload ||
    typeof payload.path !== "string" ||
    payload.path.length > 1024 ||
    /[:\\\x00-\x1f]/.test(payload.path) ||
    path.posix.isAbsolute(payload.path) ||
    payload.path.split("/").some((p) => !p || p === "." || p === "..") ||
    !/\.md$/i.test(payload.path) ||
    !DOCUMENT_ROLES.includes(payload.role) ||
    (payload.removed !== true &&
      (!/^[a-f0-9]{64}$/.test(payload.hash) ||
        !Number.isInteger(payload.bytes) ||
        payload.bytes < 0 ||
        payload.bytes > MAX_BYTES))
  )
    throw new Error("Invalid document reference");
}

export const documentKey = (d) => canonicalScope(d.path) + ":" + d.role;

export function documentState(repo, reference) {
  if (reference.conflict) return { ...reference, currentness: "conflict" };
  try {
    const current = loadDocument(repo, reference.path);
    return {
      ...reference,
      currentness: current.hash === reference.hash ? "current" : "stale",
      currentHash: current.hash,
    };
  } catch (e) {
    return {
      ...reference,
      currentness: e.code === "ENOENT" ? "missing" : "unavailable",
      reason:
        e.code === "ENOENT"
          ? "Document no longer exists at this path"
          : "Document is not a safe readable Markdown file",
    };
  }
}

function sections(text) {
  const lines = text.replaceAll("\r\n", "\n").split("\n"),
    starts = [{ line: 0, title: "Introduction", level: 0 }];
  let fence = null;
  for (let i = 0; i < lines.length; i++) {
    const f = lines[i].match(/^ {0,3}(`{3,}|~{3,})/);
    if (f) {
      if (!fence) fence = { char: f[1][0], length: f[1].length };
      else if (
        f[1][0] === fence.char &&
        f[1].length >= fence.length &&
        /^ {0,3}(`+|~+)\s*$/.test(lines[i])
      )
        fence = null;
      continue;
    }
    if (fence) continue;
    const atx = lines[i].match(/^ {0,3}(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (atx)
      starts.push({
        line: i,
        title: redact(atx[2]).slice(0, 160),
        level: atx[1].length,
      });
    else if (i && /^ {0,3}(=+|-+)\s*$/.test(lines[i]) && lines[i - 1].trim())
      starts.push({
        line: i - 1,
        title: redact(lines[i - 1].trim()).slice(0, 160),
        level: lines[i].trim()[0] === "=" ? 1 : 2,
      });
  }
  const result = [],
    ancestry = [];
  for (let i = 0; i < starts.length; i++) {
    const s = starts[i],
      end = starts[i + 1]?.line ?? lines.length;
    if (end <= s.line) continue;
    while (ancestry.length && ancestry.at(-1).level >= s.level) ancestry.pop();
    if (s.level) ancestry.push(s);
    result.push({
      index: result.length,
      heading: s.title,
      headings: ancestry.map((a) => a.title),
      startLine: s.line + 1,
      endLine: end,
      text: lines.slice(s.line, end).join("\n"),
    });
  }
  return result;
}
const terms = (text) => [
  ...new Set(
    String(text)
      .toLocaleLowerCase()
      .match(/[\p{L}\p{N}_]+/gu) || [],
  ),
];

export function readDocument(repo, reference, args = {}) {
  if (reference.conflict)
    throw new Error(
      "Resolve competing document versions by explicitly linking the reviewed current file",
    );
  const current = loadDocument(repo, reference.path);
  if (args.expectedHash && current.hash !== args.expectedHash)
    throw new Error("Document content version changed");
  const maxChars = Number(args.maxChars ?? 12000),
    limit = Number(args.limit ?? 5),
    offset = Number(args.offset ?? 0),
    startChar = Number(args.startChar ?? 0);
  if (
    !Number.isInteger(maxChars) ||
    maxChars < 200 ||
    maxChars > 20000 ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 20 ||
    !Number.isInteger(offset) ||
    offset < 0
  )
    throw new Error(
      "maxChars must be 200..20000, limit 1..20 and offset nonnegative",
    );
  if (!Number.isInteger(startChar) || startChar < 0 || startChar > MAX_BYTES)
    throw new Error("startChar must be 0..1048576");
  if (
    [args.query, args.heading].some(
      (v) => v !== undefined && (typeof v !== "string" || v.length > 1000),
    )
  )
    throw new Error(
      "Query and heading must be strings of at most 1000 characters",
    );
  const all = sections(current.text),
    words = terms(args.query || "");
  let matches = all.filter(
    (s) =>
      !args.heading ||
      s.headings.some((h) =>
        h.toLocaleLowerCase().includes(args.heading.toLocaleLowerCase()),
      ) ||
      s.heading.toLocaleLowerCase().includes(args.heading.toLocaleLowerCase()),
  );
  if (words.length)
    matches = matches
      .map((s) => {
        const heading = new Set(terms(s.headings.join(" ") + " " + s.heading)),
          body = new Set(terms(s.text));
        return {
          ...s,
          score: words.reduce(
            (sum, w) => sum + (heading.has(w) ? 3 : body.has(w) ? 1 : 0),
            0,
          ),
        };
      })
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score || a.index - b.index);
  const selected = [],
    candidates = matches.slice(offset, offset + limit);
  let remaining = maxChars,
    continuation = null;
  for (const s of candidates) {
    if (!remaining) break;
    const begin = selected.length ? 0 : startChar,
      content = redact(s.text);
    const text = content.slice(begin, begin + remaining),
      truncated = begin + text.length < content.length;
    selected.push({ ...s, text, startChar: begin, truncated });
    remaining -= text.length;
    if (truncated) {
      continuation = {
        offset: offset + selected.length - 1,
        startChar: begin + text.length,
      };
      break;
    }
  }
  return {
    path: current.path,
    role: reference.role,
    recordedHash: reference.hash,
    currentHash: current.hash,
    currentness: current.hash === reference.hash ? "current" : "stale",
    untrustedContent: true,
    selection: words.length
      ? "lexical"
      : args.heading
        ? "heading"
        : "document-order",
    totalSections: all.length,
    matchingSections: matches.length,
    outline: all.slice(0, 30).map(({ text, ...s }) => s),
    outlineTruncated: all.length > 30,
    sections: selected,
    continuation,
    nextOffset:
      continuation?.offset ??
      (offset + selected.length < matches.length
        ? offset + selected.length
        : null),
  };
}

export function inferredRole(value) {
  const name = path.basename(value, path.extname(value)).toLowerCase();
  return /(^|[-_])(plan|planning|roadmap)([-_]|$)/.test(name)
    ? "plan"
    : /(^|[-_])(spec|specification|requirements)([-_]|$)/.test(name)
      ? "spec"
      : /(^|[-_])(design|architecture)([-_]|$)/.test(name)
        ? "design"
        : "reference";
}

// Deliberately only inspect supported file mutation schemas, never shell text.
export function documentMutations(tool, input) {
  if (!/(?:^|[.:])(?:apply_patch|Write|Edit|MultiEdit)$/i.test(tool)) return [];
  if (!/apply_patch$/i.test(tool)) {
    const value = input?.file_path || input?.path;
    return typeof value === "string" ? [{ path: value }] : [];
  }
  const patch =
    typeof input === "string"
      ? input
      : input?.patch || input?.input || input?.command || input?.cmd || "";
  const result = [];
  let current;
  for (const line of String(patch).split(/\r?\n/)) {
    const match = line.match(/^\*\*\* (Add|Update|Delete) File: (.+)$/);
    if (match) {
      current = { path: match[2], removed: match[1] === "Delete" };
      result.push(current);
    }
    const move = line.match(/^\*\*\* Move to: (.+)$/);
    if (move && current && !current.removed) {
      current.oldPath = current.path;
      current.path = move[1];
    }
  }
  return result;
}
