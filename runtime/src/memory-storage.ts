import { StorageAdapter } from "./types";

/**
 * In-memory StorageAdapter. Used by the validation harness and tests; the
 * production web host uses an IndexedDB-backed adapter with the same interface.
 * A backing store may be shared across tools ONLY if each tool is handed a
 * separately-scoped instance — see `scoped()`.
 */
export function memoryStorage(
  backing: Map<string, unknown> = new Map()
): StorageAdapter {
  return {
    async get(key) {
      return backing.has(key) ? backing.get(key) : null;
    },
    async set(key, value) {
      backing.set(key, value);
    },
    async remove(key) {
      backing.delete(key);
    },
    async keys() {
      return [...backing.keys()];
    },
  };
}

/**
 * Returns a StorageAdapter scoped to a single appId over a shared backing map,
 * proving the isolation guarantee (REQ-RUN-002): two scopes over the same map
 * cannot read each other's keys.
 */
export function scopedMemoryStorage(
  appId: string,
  shared: Map<string, unknown>
): StorageAdapter {
  const prefix = `${appId}::`;
  return {
    async get(key) {
      const k = prefix + key;
      return shared.has(k) ? shared.get(k) : null;
    },
    async set(key, value) {
      shared.set(prefix + key, value);
    },
    async remove(key) {
      shared.delete(prefix + key);
    },
    async keys() {
      return [...shared.keys()]
        .filter((k) => k.startsWith(prefix))
        .map((k) => k.slice(prefix.length));
    },
  };
}
