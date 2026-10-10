/**
 * On-device history store.
 *
 * IndexedDB rather than localStorage, and Blobs rather than data URLs, for a
 * measured reason: a normalized worksheet photo is ~367KB as a JPEG and ~489KB
 * once base64-encoded. localStorage's ~5MB quota therefore holds about ten of
 * them — the entire quota, shared with preferences. As Blobs in IndexedDB the
 * same 50 problems take ~18MB and 200 take ~72MB, with no base64 tax.
 *
 * Photos live in their own object store so that listing the history reads only
 * small metadata records instead of pulling tens of megabytes into memory.
 *
 * Every record carries `syncedAt`, unused today. It is the hook for the "device
 * now, sync later" plan: adding a backend becomes "walk the records where
 * syncedAt is null and upload them" rather than a schema migration.
 *
 * Every entry point is guarded. Private windows, blocked site data and browsers
 * that refuse IndexedDB must degrade to "no history" with the app still fully
 * working — never to an exception surfacing in the UI.
 */

import type { ProblemAnalysis, SessionMemory } from "@/lib/tutor/types";

const DB_NAME = "mindgap";
const DB_VERSION = 1;
const SESSIONS = "sessions";
const IMAGES = "images";

export const SCHEMA_VERSION = 1;

/** A tutor turn as stored: inline image data URLs are swapped for image ids. */
export type StoredMessage = Record<string, unknown> & {
  id: string;
  role: string;
  content: string;
  createdAt: number;
  /** Replaces DisplayMessage.attemptImage, which is a multi-hundred-KB data URL. */
  attemptImageId?: string;
};

export interface SessionRecord {
  id: string;
  createdAt: number;
  updatedAt: number;
  schemaVersion: number;
  /** The updatedAt last saved to the account (lib/sync), or null if never. */
  syncedAt: number | null;
  /**
   * The account this record belongs to (lib/sync). Absent on a record made
   * signed out: it stays on this device unless the student brings it into
   * their account.
   */
  ownerId?: string | null;
  analysis: ProblemAnalysis;
  messages: StoredMessage[];
  /** The concept signal this whole feature exists to accumulate. */
  memory: SessionMemory;
  /** Key into the images store for the problem photo. */
  imageId: string | null;
  /** Tiny inline JPEG for the history list, so listing never reads the photos. */
  thumb: string | null;
}

function hasIndexedDB(): boolean {
  try {
    return typeof indexedDB !== "undefined";
  } catch {
    return false;
  }
}

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (!hasIndexedDB()) return Promise.resolve(null);
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      resolve(null);
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(SESSIONS)) {
        const store = db.createObjectStore(SESSIONS, { keyPath: "id" });
        // The list is always newest-first, so the sort key gets an index.
        store.createIndex("createdAt", "createdAt");
      }
      if (!db.objectStoreNames.contains(IMAGES)) {
        db.createObjectStore(IMAGES);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  });
  return dbPromise;
}

function tx<T>(
  store: string | string[],
  mode: IDBTransactionMode,
  run: (t: IDBTransaction) => Promise<T> | T,
): Promise<T | null> {
  return openDb().then((db) => {
    if (!db) return null;
    try {
      const t = db.transaction(store, mode);
      return Promise.resolve(run(t)).catch(() => null);
    } catch {
      return null;
    }
  });
}

function wrap<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Ask the browser not to evict this data under storage pressure. Without it a
 * student can be promised their work is saved and silently lose it. Best
 * effort: most browsers grant it once the app has been used a little.
 */
export async function requestPersistence(): Promise<boolean> {
  try {
    if (!navigator.storage?.persist) return false;
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

export async function putImage(blob: Blob): Promise<string | null> {
  const id = newId();
  const ok = await tx(IMAGES, "readwrite", (t) =>
    wrap(t.objectStore(IMAGES).put(blob, id)),
  );
  return ok === null ? null : id;
}

export async function getImage(id: string): Promise<Blob | null> {
  const blob = await tx(IMAGES, "readonly", (t) =>
    wrap<Blob | undefined>(t.objectStore(IMAGES).get(id)),
  );
  return blob ?? null;
}

/**
 * What sync (lib/sync/engine.ts) hears about: a save to push, a delete or a
 * clear to pass on to the account. Sync's own writes pass `quiet` so they
 * don't echo back.
 */
type WriteHooks = {
  saved?: (record: SessionRecord) => void;
  deleted?: (record: SessionRecord) => void;
  /** Before a clear, while the records can still be read. */
  clearing?: (records: SessionRecord[]) => Promise<void>;
};
let hooks: WriteHooks = {};
export function setWriteHooks(next: WriteHooks): void {
  hooks = next;
}
type Quiet = { quiet?: boolean };

export async function saveSession(record: SessionRecord, opts: Quiet = {}): Promise<boolean> {
  const ok = await tx(SESSIONS, "readwrite", (t) =>
    wrap(t.objectStore(SESSIONS).put(record)),
  );
  if (ok !== null && !opts.quiet) hooks.saved?.(record);
  return ok !== null;
}

/** Store a photo under a known id: one fetched back from the account. */
export async function putImageAt(id: string, blob: Blob): Promise<boolean> {
  const ok = await tx(IMAGES, "readwrite", (t) => wrap(t.objectStore(IMAGES).put(blob, id)));
  return ok !== null;
}

export async function getSession(id: string): Promise<SessionRecord | null> {
  const rec = await tx(SESSIONS, "readonly", (t) =>
    wrap<SessionRecord | undefined>(t.objectStore(SESSIONS).get(id)),
  );
  return rec ?? null;
}

/** Newest first. Reads whole records but not the photo store. */
export async function listSessions(limit = 200): Promise<SessionRecord[]> {
  const out = await tx(SESSIONS, "readonly", (t) => {
    const index = t.objectStore(SESSIONS).index("createdAt");
    return new Promise<SessionRecord[]>((resolve, reject) => {
      const acc: SessionRecord[] = [];
      const cursorReq = index.openCursor(null, "prev");
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result;
        if (!cursor || acc.length >= limit) return resolve(acc);
        acc.push(cursor.value as SessionRecord);
        cursor.continue();
      };
      cursorReq.onerror = () => reject(cursorReq.error);
    });
  });
  return out ?? [];
}

/** Deletes the record AND its photos — otherwise the Blobs leak forever. */
export async function deleteSession(id: string, opts: Quiet = {}): Promise<boolean> {
  const rec = await getSession(id);
  if (!rec) return false;
  const imageIds = collectImageIds(rec);
  const ok = await tx([SESSIONS, IMAGES], "readwrite", async (t) => {
    await wrap(t.objectStore(SESSIONS).delete(id));
    const images = t.objectStore(IMAGES);
    await Promise.all(imageIds.map((i) => wrap(images.delete(i))));
    return true;
  });
  if (ok !== null && !opts.quiet) hooks.deleted?.(rec);
  return ok !== null;
}

export async function clearAll(): Promise<boolean> {
  if (hooks.clearing) await hooks.clearing(await listSessions(100_000));
  const ok = await tx([SESSIONS, IMAGES], "readwrite", async (t) => {
    await wrap(t.objectStore(SESSIONS).clear());
    await wrap(t.objectStore(IMAGES).clear());
    return true;
  });
  return ok !== null;
}

/**
 * Every image this record owns: the problem photo, attempt photos, and
 * practice-answer photos (lib/history/record.ts externalise).
 */
export function collectImageIds(rec: SessionRecord): string[] {
  const ids = rec.imageId ? [rec.imageId] : [];
  for (const m of rec.messages) {
    if (typeof m.attemptImageId === "string") ids.push(m.attemptImageId);
    const practice = (m as { practiceState?: { attempt?: { imageId?: unknown } } }).practiceState;
    if (typeof practice?.attempt?.imageId === "string") ids.push(practice.attempt.imageId);
  }
  return ids;
}

export function newId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
}
