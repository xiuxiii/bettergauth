"use client";

/**
 * Keeps this device's history (IndexedDB, lib/history/db.ts) in step with the
 * signed-in student's account (Supabase). The device copy stays the one every
 * screen reads, so history is instant and works offline; this runs behind it.
 *
 * One pass (`syncNow`, single-flight, re-run if asked again mid-pass):
 *   1. deletes made here → tombstones in the account, photos removed;
 *   2. this account's changed records → pushed, with their photos;
 *   3. rows changed in the account since the last pull (by the server's
 *      clock, `changed_at`) → written or deleted here;
 *   4. preferences: the account's copy wins on the first pass after
 *      signing in; after that a change made on another device is taken, and
 *      one made here is pushed (syncPrefs).
 * The rules for every conflict are in lib/sync/merge.ts (unit-tested).
 *
 * Passes run when the account is known, after local writes (debounced), on
 * reconnect and when the app comes back into view. Signing out removes this
 * account's synced records from the device (they're safe in the account);
 * anything made signed out, or not yet synced, stays.
 */

import { useSyncExternalStore } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { browserSupabase } from "@/lib/supabase/client";
import { currentAccount, onAccountChange } from "@/lib/account/useAccount";
import {
  collectImageIds,
  deleteSession,
  getImage,
  getSession,
  listSessions,
  putImageAt,
  saveSession,
  setWriteHooks,
  type SessionRecord,
} from "@/lib/history/db";
import { deleteAction, isGuest, needsPush, ownerOf, pullAction, pushAction, type RemoteMeta } from "@/lib/sync/merge";
import { DEFAULT_PREFERENCES, PREFS_SAVED_EVENT, loadPreferences, savePreferences } from "@/lib/preferences";
import type { TutorPreferences } from "@/lib/tutor/types";

import { HISTORY_SYNCED_EVENT } from "@/lib/sync/events";

// --- Status, for the account page and the import prompt ----------------------

export type SyncStatus = {
  state: "off" | "syncing" | "idle" | "offline" | "error";
  lastSyncAt: number | null;
  /** Records made signed out on this device, not yet brought into the account. */
  guestCount: number;
};

let status: SyncStatus = { state: "off", lastSyncAt: null, guestCount: 0 };
const listeners = new Set<() => void>();
function setStatus(patch: Partial<SyncStatus>) {
  status = { ...status, ...patch };
  for (const l of listeners) l();
}

export function useSyncStatus(): SyncStatus {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      startSync();
      return () => listeners.delete(l);
    },
    () => status,
    () => status,
  );
}

// --- Per-account bookkeeping in localStorage ----------------------------------

const KEY = {
  uid: "mindgap:sync:uid",
  linked: (u: string) => `mindgap:sync:${u}:linked`,
  cursor: (u: string) => `mindgap:sync:${u}:cursor`,
  deletes: (u: string) => `mindgap:sync:${u}:deletes`,
  uploaded: (u: string) => `mindgap:sync:${u}:uploaded`,
  prefsSeen: (u: string) => `mindgap:sync:${u}:prefs-seen`,
  importDeclined: (u: string) => `mindgap:sync:${u}:import-declined`,
};

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}
function write(key: string, value: unknown) {
  try {
    if (value === undefined) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage blocked: sync just redoes work next time */
  }
}

/** When this device was linked to the account: records made after are its own. */
function linkedAt(uid: string): number {
  const at = read<number | null>(KEY.linked(uid), null);
  if (at) return at;
  const now = Date.now();
  write(KEY.linked(uid), now);
  return now;
}

type PendingDelete = { id: string; at: number; images: string[] };
/** The pull cursor: the last row seen, by the server's clock then id. */
type Cursor = { at: string; id: string } | null;

// --- The pass -------------------------------------------------------------------

const PHOTOS = "photos";
const photoPath = (uid: string, imageId: string) => `${uid}/${imageId}.jpg`;
/** The account's copy of a record: everything but the device's own bookkeeping. */
function forAccount(r: SessionRecord): Record<string, unknown> {
  const rest: Record<string, unknown> = { ...r };
  delete rest.syncedAt;
  delete rest.ownerId;
  return rest;
}

async function remoteMetas(sb: SupabaseClient, uid: string, ids: string[]): Promise<Map<string, RemoteMeta>> {
  const out = new Map<string, RemoteMeta>();
  for (let i = 0; i < ids.length; i += 100) {
    const { data, error } = await sb
      .from("sessions")
      .select("id, updated_at, deleted_at")
      .eq("user_id", uid)
      .in("id", ids.slice(i, i + 100));
    if (error) throw error;
    for (const r of data ?? []) out.set(r.id, { id: r.id, updated_at: Number(r.updated_at), deleted_at: r.deleted_at === null ? null : Number(r.deleted_at) });
  }
  return out;
}

async function pushDeletes(sb: SupabaseClient, uid: string) {
  const pending = read<PendingDelete[]>(KEY.deletes(uid), []);
  if (!pending.length) return;
  const metas = await remoteMetas(sb, uid, pending.map((p) => p.id));
  for (const p of pending) {
    if (deleteAction(p.at, metas.get(p.id) ?? null) === "delete") {
      const { error } = await sb
        .from("sessions")
        .update({ deleted_at: p.at, updated_at: p.at, record: null })
        .eq("user_id", uid)
        .eq("id", p.id);
      if (error) throw error;
    }
    if (p.images.length) await sb.storage.from(PHOTOS).remove(p.images.map((i) => photoPath(uid, i)));
    // Done with this one: drop it now, so a failure later doesn't redo it.
    write(KEY.deletes(uid), read<PendingDelete[]>(KEY.deletes(uid), []).filter((d) => d.id !== p.id));
  }
}

async function uploadPhotos(sb: SupabaseClient, uid: string, r: SessionRecord) {
  const done = new Set(read<string[]>(KEY.uploaded(uid), []));
  for (const id of collectImageIds(r)) {
    if (done.has(id)) continue;
    const blob = await getImage(id);
    if (!blob) continue; // already gone here; nothing to send
    const { error } = await sb.storage
      .from(PHOTOS)
      .upload(photoPath(uid, id), blob, { upsert: true, contentType: blob.type || "image/jpeg" });
    if (error) throw error;
    done.add(id);
    write(KEY.uploaded(uid), [...done]);
  }
}

async function pushRecords(sb: SupabaseClient, uid: string) {
  const at = linkedAt(uid);
  const changed = (await listSessions(100_000)).filter((r) => needsPush(r, uid, at));
  if (!changed.length) return;
  const metas = await remoteMetas(sb, uid, changed.map((r) => r.id));
  for (const r of changed) {
    if (pushAction(r, metas.get(r.id) ?? null) === "push") {
      await uploadPhotos(sb, uid, r);
      const { error } = await sb.from("sessions").upsert(
        {
          user_id: uid,
          id: r.id,
          created_at: r.createdAt,
          updated_at: r.updatedAt,
          deleted_at: null,
          record: forAccount(r),
        },
        { onConflict: "user_id,id" },
      );
      if (error) throw error;
    }
    // Mark it synced, unless it changed while we were sending it.
    const now = await getSession(r.id);
    if (now && now.updatedAt === r.updatedAt) {
      await saveSession({ ...now, ownerId: uid, syncedAt: r.updatedAt }, { quiet: true });
    }
  }
}

async function pullRecords(sb: SupabaseClient, uid: string): Promise<boolean> {
  const PAGE = 200;
  let changed = false;
  let cursor = read<Cursor>(KEY.cursor(uid), null);
  for (;;) {
    let q = sb
      .from("sessions")
      .select("id, created_at, updated_at, deleted_at, record, changed_at")
      .eq("user_id", uid)
      .order("changed_at", { ascending: true })
      .order("id", { ascending: true })
      .limit(PAGE);
    if (cursor) q = q.or(`changed_at.gt."${cursor.at}",and(changed_at.eq."${cursor.at}",id.gt."${cursor.id}")`);
    const { data, error } = await q;
    if (error) throw error;
    for (const row of data ?? []) {
      const remote: RemoteMeta = {
        id: row.id,
        updated_at: Number(row.updated_at),
        deleted_at: row.deleted_at === null ? null : Number(row.deleted_at),
      };
      const action = pullAction(await getSession(row.id), remote, uid);
      if (action === "write" && row.record) {
        await saveSession(
          {
            ...(row.record as SessionRecord),
            id: row.id,
            createdAt: Number(row.created_at),
            updatedAt: remote.updated_at,
            syncedAt: remote.updated_at,
            ownerId: uid,
          },
          { quiet: true },
        );
        changed = true;
      } else if (action === "delete") {
        await deleteSession(row.id, { quiet: true });
        changed = true;
      }
      cursor = { at: row.changed_at, id: row.id };
      write(KEY.cursor(uid), cursor);
    }
    if (!data || data.length < PAGE) return changed;
  }
}

let applyingPrefs = false;
let prefsDirty = false;

/**
 * Preferences, both ways. The account's `updated_at` as last seen here tells
 * whether another device changed them since: if so they are taken, unless
 * this device has its own unsent change, which is sent instead (last write
 * wins). On the first pass for an account nothing has been seen, so the
 * account's copy wins. Compared for equality only, so device clocks don't
 * matter.
 */
async function syncPrefs(sb: SupabaseClient, uid: string) {
  const seen = read<string | null>(KEY.prefsSeen(uid), null);
  if (!prefsDirty || seen === null) {
    const { data, error } = await sb.from("profiles").select("preferences, updated_at").eq("id", uid).maybeSingle();
    if (error) throw error;
    if (!data?.preferences) {
      prefsDirty = true; // the account has none yet: send this device's
    } else if (data.updated_at !== seen) {
      applyingPrefs = true;
      try {
        savePreferences({ ...DEFAULT_PREFERENCES, ...(data.preferences as Partial<TutorPreferences>) });
      } finally {
        applyingPrefs = false;
      }
      prefsDirty = false;
      write(KEY.prefsSeen(uid), data.updated_at);
      return;
    }
  }
  if (!prefsDirty) return;
  const local = loadPreferences();
  if (local) {
    const stamp = new Date().toISOString();
    const { data, error } = await sb
      .from("profiles")
      .update({ preferences: local, updated_at: stamp })
      .eq("id", uid)
      .select("updated_at")
      .maybeSingle();
    if (error) throw error;
    // As the database stores it, so the next pass sees it as this device's own.
    write(KEY.prefsSeen(uid), data?.updated_at ?? stamp);
  }
  prefsDirty = false;
}

async function countGuests(uid: string): Promise<number> {
  if (read<boolean>(KEY.importDeclined(uid), false)) return 0;
  const at = linkedAt(uid);
  return (await listSessions(100_000)).filter((r) => isGuest(r, at)).length;
}

/** The signed-in, 13+ account sync may act for, else null. */
function syncingUid(): string | null {
  const a = currentAccount();
  return a.status === "signedIn" && a.ageOk ? a.id : null;
}

let running: Promise<void> | null = null;
let again = false;

/** Run a pass now (or right after the one in flight). */
export function syncNow(): Promise<void> {
  if (running) {
    again = true;
    return running;
  }
  running = (async () => {
    do {
      again = false;
      const uid = syncingUid();
      const sb = uid ? await browserSupabase() : null;
      if (!uid || !sb) {
        setStatus({ state: "off" });
        break;
      }
      if (typeof navigator !== "undefined" && navigator.onLine === false) {
        setStatus({ state: "offline" });
        break;
      }
      setStatus({ state: "syncing" });
      try {
        await pushDeletes(sb, uid);
        await pushRecords(sb, uid);
        if (await pullRecords(sb, uid)) window.dispatchEvent(new Event(HISTORY_SYNCED_EVENT));
        await syncPrefs(sb, uid);
        setStatus({ state: "idle", lastSyncAt: Date.now(), guestCount: await countGuests(uid) });
      } catch (err) {
        console.error("[sync] pass failed:", err);
        setStatus({ state: navigator.onLine === false ? "offline" : "error" });
      }
    } while (again);
  })().finally(() => {
    running = null;
  });
  return running;
}

let timer: ReturnType<typeof setTimeout> | null = null;
function schedule(ms = 1500) {
  if (!syncingUid()) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void syncNow();
  }, ms);
}

// --- Bringing signed-out problems in, and leaving ----------------------------

/** Make this device's signed-out problems part of the account, then sync. */
export async function importGuestRecords(): Promise<void> {
  const uid = syncingUid();
  if (!uid) return;
  const at = linkedAt(uid);
  for (const r of await listSessions(100_000)) {
    if (isGuest(r, at)) await saveSession({ ...r, ownerId: uid, syncedAt: null }, { quiet: true });
  }
  await syncNow();
}

/** Keep them on this device only; don't ask again for this account. */
export function declineImport(): void {
  const uid = syncingUid();
  if (uid) write(KEY.importDeclined(uid), true);
  setStatus({ guestCount: 0 });
}

/**
 * After signing out (or deleting the account): remove that account's synced
 * records from this device. Unsynced ones stay, to be sent on the next
 * sign-in; signed-out records were never the account's.
 */
async function leave(uid: string) {
  for (const r of await listSessions(100_000)) {
    if (r.ownerId === uid && r.syncedAt !== null && r.updatedAt <= r.syncedAt) {
      await deleteSession(r.id, { quiet: true });
    }
  }
  write(KEY.cursor(uid), undefined);
  write(KEY.uploaded(uid), undefined);
  write(KEY.prefsSeen(uid), undefined);
  write(KEY.uid, undefined);
  setStatus({ state: "off", lastSyncAt: null, guestCount: 0 });
  window.dispatchEvent(new Event(HISTORY_SYNCED_EVENT));
}

// --- Wiring ---------------------------------------------------------------------

let started = false;

/** Idempotent; called by SyncAgent on every page and by the status hook. */
export function startSync(): void {
  if (started || typeof window === "undefined") return;
  started = true;

  setWriteHooks({
    saved: () => schedule(),
    deleted: (r) => {
      const uid = syncingUid();
      // Only what the account has a copy of needs a tombstone.
      if (!uid || r.syncedAt === null || ownerOf(r, uid, linkedAt(uid)) !== uid) return;
      write(KEY.deletes(uid), [
        ...read<PendingDelete[]>(KEY.deletes(uid), []),
        { id: r.id, at: Date.now(), images: collectImageIds(r) },
      ]);
      schedule(300);
    },
    clearing: async (records) => {
      const uid = syncingUid();
      if (!uid) return;
      const at = linkedAt(uid);
      const now = Date.now();
      const owned = records.filter((r) => r.syncedAt !== null && ownerOf(r, uid, at) === uid);
      write(KEY.deletes(uid), [
        ...read<PendingDelete[]>(KEY.deletes(uid), []),
        ...owned.map((r) => ({ id: r.id, at: now, images: collectImageIds(r) })),
      ]);
      schedule(300);
    },
  });

  window.addEventListener(PREFS_SAVED_EVENT, () => {
    if (applyingPrefs) return;
    prefsDirty = true;
    schedule();
  });
  window.addEventListener("online", () => schedule(0));
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") schedule(0);
  });

  onAccountChange(() => {
    const a = currentAccount();
    const previous = read<string | null>(KEY.uid, null);
    if (a.status === "signedIn" && a.ageOk) {
      if (previous && previous !== a.id) void leave(previous).then(() => syncNow());
      else void syncNow();
      write(KEY.uid, a.id);
    } else if ((a.status === "signedOut" || a.status === "disabled") && previous) {
      void leave(previous);
    }
  });
}

/** A photo by id, fetched back from the account when this device lacks it. */
export async function getImageSynced(id: string): Promise<Blob | null> {
  const local = await getImage(id);
  if (local) return local;
  const uid = syncingUid();
  const sb = uid ? await browserSupabase() : null;
  if (!uid || !sb) return null;
  const { data, error } = await sb.storage.from(PHOTOS).download(photoPath(uid, id));
  if (error || !data) return null;
  await putImageAt(id, data);
  return data;
}
