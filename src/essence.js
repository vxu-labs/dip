// Project essence: DIP's own README for a project. One Git-tracked Markdown
// file that keeps the vision, principles and ideas that do not belong in a
// single task, so the agent and the developer can follow the project's intent
// across sessions and workstations. Concrete work still lives in tasks.
import fs from "node:fs";
import path from "node:path";
import { atomic, digest, git } from "./util.js";

export const ESSENCE_FILE = ".dip-essence.md";
export const ESSENCE_MAX_BYTES = 256 * 1024;
const MAX_READ_CHARS = 60000;

export const essenceTemplate = (name) => `# ${name} — Project essence

> DIP's internal README for this project: the vision and ideas behind the work. Concrete,
> deliverable work belongs in DIP tasks; this file keeps the intent those tasks serve.

## Vision

## Core experience

## Principles

## Systems

## Open ideas

## Glossary
`;

function essencePath(repo) {
  const file = path.join(repo.root, ESSENCE_FILE);
  if (fs.existsSync(file) && fs.lstatSync(file).isSymbolicLink())
    throw Error("The project essence cannot be a symbolic link");
  return file;
}

/** Headings of a Markdown document with their level and the size of their section. */
export function essenceSections(markdown) {
  const lines = markdown.split("\n"),
    sections = [];
  let fence = false;
  lines.forEach((line, index) => {
    if (/^\s*(```|~~~)/.test(line)) fence = !fence;
    const match = !fence && /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (match)
      sections.push({ heading: match[2], level: match[1].length, line: index });
  });
  return sections.map((section, index) => {
    const end =
      sections.slice(index + 1).find((next) => next.level <= section.level)
        ?.line ?? lines.length;
    return {
      heading: section.heading,
      level: section.level,
      chars: lines.slice(section.line + 1, end).join("\n").trim().length,
    };
  });
}

/** The text under one heading, up to the next heading of the same or higher level. */
export function essenceSection(markdown, heading) {
  const lines = markdown.split("\n"),
    wanted = heading.trim().toLowerCase();
  let start = -1,
    level = 0,
    fence = false;
  for (let index = 0; index < lines.length; index++) {
    if (/^\s*(```|~~~)/.test(lines[index])) fence = !fence;
    const match = !fence && /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(lines[index]);
    if (!match) continue;
    if (start >= 0 && match[1].length <= level)
      return lines.slice(start, index).join("\n").trim();
    if (start < 0 && match[2].trim().toLowerCase() === wanted) {
      start = index;
      level = match[1].length;
    }
  }
  return start >= 0 ? lines.slice(start).join("\n").trim() : null;
}

export function readEssence(repo, { heading, maxChars } = {}) {
  const file = essencePath(repo);
  if (!fs.existsSync(file))
    return {
      path: ESSENCE_FILE,
      exists: false,
      hint: "Create it with `dip essence init` or project_essence_set.",
    };
  const content = fs.readFileSync(file, "utf8");
  const limit = Math.min(
    MAX_READ_CHARS,
    Math.max(200, Number(maxChars) || MAX_READ_CHARS),
  );
  const selected = heading ? essenceSection(content, String(heading)) : content;
  if (heading && selected === null)
    throw Error("No essence section named " + JSON.stringify(heading));
  const commit = git(
    repo.root,
    ["log", "-1", "--format=%h %cI", "--", ESSENCE_FILE],
    true,
  );
  return {
    path: ESSENCE_FILE,
    exists: true,
    hash: digest(content),
    bytes: Buffer.byteLength(content),
    lastCommit: commit || null,
    sections: essenceSections(content),
    content: selected.slice(0, limit),
    truncated: selected.length > limit,
  };
}

function validEssence(content) {
  if (typeof content !== "string" || !content.trim())
    throw Error("The project essence needs Markdown content");
  if (Buffer.byteLength(content) > ESSENCE_MAX_BYTES)
    throw Error("The project essence is limited to 256 KB");
  if (content.includes("\0")) throw Error("The project essence must be text");
  return content.endsWith("\n") ? content : content + "\n";
}

/**
 * Replaces the essence, or one section of it when `heading` is given (the
 * section is appended when it does not exist yet). `expectedHash` guards
 * against overwriting an edit made in the meantime.
 */
export function writeEssence(repo, { content, heading, expectedHash } = {}) {
  const file = essencePath(repo),
    current = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
  if (expectedHash && expectedHash !== (current === null ? "absent" : digest(current)))
    throw Error("The project essence changed since it was read; read it again");
  let next;
  if (heading) {
    if (current === null)
      throw Error("Create the project essence before editing one section");
    const body = validEssence(content).trimEnd();
    const existing = essenceSection(current, String(heading));
    if (existing === null) next = current.trimEnd() + "\n\n" + body + "\n";
    else next = current.replace(existing, body);
  } else next = validEssence(content);
  validEssence(next);
  atomic(file, next);
  return readEssence(repo, { maxChars: 200 });
}

export function initEssence(repo, name = path.basename(repo.root)) {
  if (fs.existsSync(essencePath(repo)))
    return { ...readEssence(repo, { maxChars: 200 }), created: false };
  atomic(essencePath(repo), essenceTemplate(name));
  return { ...readEssence(repo, { maxChars: 200 }), created: true };
}

/** A pointer for hook context: never the content, only where it is and what it covers. */
export function essenceBrief(repo) {
  try {
    const file = essencePath(repo);
    if (!fs.existsSync(file)) return undefined;
    const content = fs.readFileSync(file, "utf8");
    return {
      path: ESSENCE_FILE,
      sections: essenceSections(content)
        .filter((section) => section.level === 2)
        .map((section) => section.heading)
        .slice(0, 16),
      read: "project_essence_read (or dip essence read) when a request touches the project's direction or vision",
    };
  } catch {
    return undefined;
  }
}
