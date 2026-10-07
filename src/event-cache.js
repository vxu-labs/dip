// Disposable process-local JSON cache. Every access still checks filesystem
// identity; ownership/outbox data never depend on this cache.
const entries = new Map(),
  budget = 32 * 1024 * 1024;
let bytes = 0,
  hits = 0,
  reads = 0;
export function eventRecord(file, stat, load) {
  const signature = [
      stat.size,
      stat.mtimeMs,
      stat.ctimeMs,
      stat.ino,
      stat.mode,
    ].join(":"),
    cached = entries.get(file);
  if (cached?.signature === signature) {
    hits++;
    entries.delete(file);
    entries.set(file, cached);
    return structuredClone(cached.value);
  }
  if (cached) {
    bytes -= cached.bytes;
    entries.delete(file);
  }
  reads++;
  const value = load();
  const cost = stat.size * 3; // conservative accounting for text/object overhead
  if (cost <= budget) {
    while (entries.size && (bytes + cost > budget || entries.size >= 20000)) {
      const key = entries.keys().next().value;
      bytes -= entries.get(key).bytes;
      entries.delete(key);
    }
    entries.set(file, { signature, value, bytes: cost });
    bytes += cost;
  }
  return structuredClone(value);
}
export function eventCacheStats() {
  return {
    entries: entries.size,
    estimatedBytes: bytes,
    budgetBytes: budget,
    hits,
    reads,
  };
}
export function clearEventCache() {
  entries.clear();
  bytes = 0;
  hits = 0;
  reads = 0;
}
