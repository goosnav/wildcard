// Tiny promise-based IndexedDB layer — the device-local store (REQ-DATA-001).
// Two object stores:
//   - "tools": saved tool bundles, keyed by manifest id.
//   - "kv":    per-app WC.storage, keyed by "appId::key" so one tool can never
//              read another's data (REQ-RUN-002) and data survives relaunch
//              and reload (REQ-RUN-003), fully offline (REQ-RUN-001).

import type { Bundle, StorageAdapter } from "@wildcard/runtime";

/** A prior snapshot of a tool's files, kept so an edit can be reverted. */
export interface ToolVersion {
  files: Bundle["files"];
  savedAt: number;
  note?: string;
}

export interface SavedTool extends Bundle {
  createdAt: number;
  /** Previous versions, newest first. Capped — see HISTORY_LIMIT. */
  history?: ToolVersion[];
}

export const HISTORY_LIMIT = 10;

/** Return a copy of `tool` with `files` replaced and the PREVIOUS files pushed
 *  onto history (newest first, capped). Pure — callers persist the result. */
export function withNewVersion(
  tool: SavedTool,
  files: Bundle["files"],
  note: string
): SavedTool {
  const prior: ToolVersion = { files: tool.files, savedAt: Date.now(), note };
  const history = [prior, ...(tool.history ?? [])].slice(0, HISTORY_LIMIT);
  return { ...tool, files, history };
}

const DB_NAME = "wildcard";
const DB_VERSION = 1;
const TOOLS = "tools";
const KV = "kv";

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(TOOLS))
        db.createObjectStore(TOOLS, { keyPath: "id" });
      if (!db.objectStoreNames.contains(KV))
        db.createObjectStore(KV, { keyPath: "k" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx<T>(
  store: string,
  mode: IDBTransactionMode,
  run: (s: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(store, mode);
        const req = run(t.objectStore(store));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      })
  );
}

// --- tools ---

interface ToolRecord extends SavedTool {
  id: string;
}

export async function getAllTools(): Promise<SavedTool[]> {
  const records = await tx<ToolRecord[]>(TOOLS, "readonly", (s) => s.getAll());
  return records
    .sort((a, b) => b.createdAt - a.createdAt)
    .map(({ id: _id, ...tool }) => tool);
}

export async function putTool(tool: SavedTool): Promise<void> {
  await tx(TOOLS, "readwrite", (s) =>
    s.put({ id: tool.manifest.id, ...tool })
  );
}

export async function deleteTool(id: string): Promise<void> {
  await tx(TOOLS, "readwrite", (s) => s.delete(id));
}

/** Wipe ALL local data — every saved tool and every tool's WC.storage. Used on
 *  account deletion so nothing is left on the device. */
export async function clearAllLocalData(): Promise<void> {
  await tx(TOOLS, "readwrite", (s) => s.clear());
  await tx(KV, "readwrite", (s) => s.clear());
}

// --- per-app key-value (WC.storage backing) ---

interface KvRecord {
  k: string;
  v: unknown;
}

/** An IndexedDB-backed StorageAdapter scoped to one app id. */
export function idbStorageForTool(appId: string): StorageAdapter {
  const prefix = `${appId}::`;
  return {
    async get(key) {
      const rec = await tx<KvRecord | undefined>(KV, "readonly", (s) =>
        s.get(prefix + key)
      );
      return rec ? rec.v : null;
    },
    async set(key, value) {
      await tx(KV, "readwrite", (s) => s.put({ k: prefix + key, v: value }));
    },
    async remove(key) {
      await tx(KV, "readwrite", (s) => s.delete(prefix + key));
    },
    async keys() {
      const allKeys = await tx<IDBValidKey[]>(KV, "readonly", (s) => s.getAllKeys());
      return allKeys
        .map(String)
        .filter((k) => k.startsWith(prefix))
        .map((k) => k.slice(prefix.length));
    },
  };
}
