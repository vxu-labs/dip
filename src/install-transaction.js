import fs from "node:fs";
import path from "node:path";
import { atomic, json } from "./util.js";

// Journal only machine configuration. Project ledgers are never rolled back.
export function installTransaction(directory, files, operation) {
  const lock = path.join(directory, "install.lock");
  const journal = path.join(directory, "install-journal.json");
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const restore = (entries) => {
    const allowed = new Set(files.map((f) => path.resolve(f)));
    if (entries.some((e) => !allowed.has(path.resolve(e.file))))
      throw new Error(
        "Installation recovery references a configuration outside this installation; inspect the local journal",
      );
    for (const entry of [...entries].reverse()) {
      if (entry.bytes !== null) {
        fs.mkdirSync(path.dirname(entry.file), { recursive: true });
        atomic(entry.file, Buffer.from(entry.bytes, "base64"));
        fs.chmodSync(entry.file, entry.mode);
      } else if (fs.existsSync(entry.file)) fs.unlinkSync(entry.file);
    }
  };
  if (fs.existsSync(lock)) {
    const owner = json(path.join(lock, "owner.json"), null);
    if (!owner && Date.now() - fs.statSync(lock).mtimeMs < 60000)
      throw new Error("Another DIP installer is starting");
    let alive = false;
    if (owner?.pid)
      try {
        process.kill(owner.pid, 0);
        alive = true;
      } catch {}
    if (alive) throw new Error("Another DIP installer is running");
    const pending = json(journal, null);
    if (pending?.entries) restore(pending.entries);
    if (fs.existsSync(journal)) fs.unlinkSync(journal);
    if (fs.existsSync(path.join(lock, "owner.json")))
      fs.unlinkSync(path.join(lock, "owner.json"));
    fs.rmdirSync(lock);
  }
  if (fs.existsSync(journal)) {
    restore(json(journal).entries);
    fs.unlinkSync(journal);
  }
  fs.mkdirSync(lock);
  atomic(path.join(lock, "owner.json"), { pid: process.pid });
  let entries;
  try {
    entries = [...new Set(files)].map((file) => {
      if (!fs.existsSync(file)) return { file, bytes: null };
      const stat = fs.lstatSync(file);
      if (!stat.isFile() || stat.isSymbolicLink())
        throw new Error(
          `Integration configuration must be a regular file: ${file}`,
        );
      return {
        file,
        bytes: fs.readFileSync(file).toString("base64"),
        mode: stat.mode & 0o777,
      };
    });
    atomic(journal, { entries, startedAt: Date.now() });
    const result = operation();
    fs.unlinkSync(journal);
    return result;
  } catch (e) {
    if (entries) restore(entries);
    if (fs.existsSync(journal)) fs.unlinkSync(journal);
    throw e;
  } finally {
    fs.unlinkSync(path.join(lock, "owner.json"));
    fs.rmdirSync(lock);
  }
}
