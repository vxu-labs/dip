import fs from "node:fs";
import path from "node:path";
import { home } from "./util.js";

// Keep the inode: a detached process may still have this file open in append
// mode. Renaming it would leave that process writing an unbounded old log.
export function trimRuntimeLog(name, limit = 4 * 1024 ** 2) {
  if (!["daemon.log", "supervisor.log"].includes(name))
    throw Error("Unknown runtime log");
  const file = path.join(home(), name),
    stat = fs.lstatSync(file, { throwIfNoEntry: false });
  if (!stat || stat.size <= limit) return false;
  if (!stat.isFile() || stat.isSymbolicLink())
    throw Error("Runtime log must be a regular file");
  const fd = fs.openSync(file, "r+");
  try {
    const tail = Buffer.alloc(Math.floor(limit / 2));
    fs.readSync(fd, tail, 0, tail.length, Math.max(0, stat.size - tail.length));
    const first = tail.indexOf(10),
      content = first >= 0 ? tail.subarray(first + 1) : Buffer.alloc(0);
    const header = Buffer.from(
      `[DIP diagnostic log retention: older bytes removed at ${new Date().toISOString()}]\n`,
    );
    const data = Buffer.concat([header, content]);
    fs.writeSync(fd, data, 0, data.length, 0);
    fs.ftruncateSync(fd, data.length);
    return true;
  } finally {
    fs.closeSync(fd);
  }
}
