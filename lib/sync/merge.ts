/**
 * The rules for syncing history with the account (lib/sync/engine.ts), pure
 * so `npm test` checks every case.
 *
 * - Last write wins, by updatedAt (ms). A student rarely edits one problem on
 *   two devices at once, and when they do the later work is the one to keep.
 * - A delete is a tombstone row (deleted_at), so other devices hear of it; it
 *   loses to an edit made after it, and wins over anything older.
 * - A record made signed out belongs to nobody (no ownerId): it is never
 *   pushed, pulled over, or deleted by sync, unless the student brings it into
 *   their account (adopt), or it was made after this device was linked to
 *   the account (the session started before the sign-in was known).
 */

export type LocalMeta = {
  id: string;
  createdAt: number;
  updatedAt: number;
  syncedAt: number | null;
  ownerId?: string | null;
};

export type RemoteMeta = {
  id: string;
  updated_at: number;
  deleted_at: number | null;
};

/** Whose this local record is, given the account and when this device linked to it. */
export function ownerOf(local: LocalMeta, uid: string, linkedAt: number): string | null {
  if (local.ownerId) return local.ownerId;
  return local.createdAt >= linkedAt ? uid : null;
}

/** Made signed out, before this device was linked: offered to bring in, never taken. */
export function isGuest(local: LocalMeta, linkedAt: number): boolean {
  return !local.ownerId && local.createdAt < linkedAt;
}

/** This account's record has changes the account hasn't got. */
export function needsPush(local: LocalMeta, uid: string, linkedAt: number): boolean {
  if (ownerOf(local, uid, linkedAt) !== uid) return false;
  return local.syncedAt === null || local.updatedAt > local.syncedAt;
}

/** Push this local record over the account's row (or there is none)? */
export function pushAction(local: LocalMeta, remote: RemoteMeta | null): "push" | "skip" {
  if (!remote) return "push";
  // Deleted elsewhere after this edit, or edited elsewhere since: the pull
  // that follows brings that version (or the delete) here instead.
  if (remote.deleted_at !== null && remote.deleted_at >= local.updatedAt) return "skip";
  if (remote.updated_at > local.updatedAt) return "skip";
  return "push";
}

/** Send a delete made here at `deletedAt` over the account's row? */
export function deleteAction(deletedAt: number, remote: RemoteMeta | null): "delete" | "skip" {
  if (!remote) return "skip"; // never reached the account: nothing to delete
  if (remote.deleted_at !== null) return "skip"; // already gone
  return remote.updated_at > deletedAt ? "skip" : "delete"; // edited elsewhere after: it lives
}

/** What to do here with a row pulled from the account. */
export function pullAction(
  local: LocalMeta | null,
  remote: RemoteMeta,
  uid: string,
): "write" | "delete" | "skip" {
  if (remote.deleted_at !== null) {
    // Only ever delete this account's own copy, never a signed-out record.
    if (!local || local.ownerId !== uid) return "skip";
    return local.updatedAt > remote.deleted_at ? "skip" : "delete";
  }
  if (!local) return "write";
  if (local.ownerId && local.ownerId !== uid) return "skip";
  if (!local.ownerId) return "skip"; // a signed-out record that happens to share the id
  return remote.updated_at > local.updatedAt ? "write" : "skip";
}
