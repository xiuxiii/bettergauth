/**
 * Turns a live tutoring session into a stored, re-openable record.
 *
 * Kept out of TutorWorkspace so the component keeps reading as tutoring logic
 * rather than persistence plumbing, and so every write stays failure-tolerant
 * in one place: if storage is unavailable the session simply is not recorded
 * and the app behaves exactly as it did before history existed.
 */

import type { ProblemAnalysis, SessionMemory } from "@/lib/tutor/types";
import { dataUrlToBlob, thumbnailFromDataUrl } from "@/lib/image";
import {
  SCHEMA_VERSION,
  getSession,
  newId,
  putImage,
  requestPersistence,
  saveSession,
  type SessionRecord,
  type StoredMessage,
} from "@/lib/history/db";

/**
 * A message as the workspace holds it, before images are externalised.
 *
 * Structural rather than a concrete type so the workspace's DisplayMessage
 * satisfies it directly: an interface without an index signature is not
 * assignable to Record<string, unknown>, and casting at the call site would
 * just move the problem somewhere less visible.
 */
export interface LiveMessage {
  id: string;
  attemptImage?: string;
  /** A practice card's saved progress; its attempt photo is externalised too. */
  practiceState?: { attempt?: { imageDataUrl?: string } };
}

/**
 * Photos already written this session, keyed by their data URL. Without this,
 * every debounced save would re-encode and re-store the same attempt photo —
 * hundreds of KB per keystroke-ish update, and orphaned Blobs forever.
 */
const imageIds = new Map<string, string>();

async function storeImage(dataUrl: string): Promise<string | null> {
  const existing = imageIds.get(dataUrl);
  if (existing) return existing;
  const blob = dataUrlToBlob(dataUrl);
  if (!blob) return null;
  const id = await putImage(blob);
  if (id) imageIds.set(dataUrl, id);
  return id;
}

/** Strip the inline image data URLs out of the transcript, storing them once. */
async function externalise<T extends LiveMessage>(
  messages: readonly T[],
): Promise<StoredMessage[]> {
  return Promise.all(
    messages.map(async (m) => {
      const { attemptImage, ...rest } = m;
      const stored = { ...rest } as unknown as StoredMessage;
      if (typeof attemptImage === "string") {
        const id = await storeImage(attemptImage);
        if (id) stored.attemptImageId = id;
      }
      // A practice attempt photo, same treatment: an id, never the data URL.
      const practicePhoto = m.practiceState?.attempt?.imageDataUrl;
      if (typeof practicePhoto === "string") {
        const id = await storeImage(practicePhoto);
        const attempt: Record<string, unknown> = { ...m.practiceState!.attempt };
        delete attempt.imageDataUrl;
        if (id) attempt.imageId = id;
        stored.practiceState = { ...m.practiceState, attempt };
      }
      return stored;
    }),
  );
}

/**
 * Begin recording. Returns the record id, or null when storage is unavailable —
 * callers treat null as "history is off" and carry on.
 */
export async function startSession(
  analysis: ProblemAnalysis,
  imageDataUrl: string | null,
): Promise<string | null> {
  imageIds.clear();
  // Ask once per session; without it the browser may evict the history under
  // storage pressure, losing exactly what the student was told was saved.
  void requestPersistence();

  const now = Date.now();
  const imageId = imageDataUrl ? await storeImage(imageDataUrl) : null;
  let thumb: string | null = null;
  if (imageDataUrl) {
    try {
      thumb = await thumbnailFromDataUrl(imageDataUrl);
    } catch {
      thumb = null;
    }
  }

  const record: SessionRecord = {
    id: newId(),
    createdAt: now,
    updatedAt: now,
    schemaVersion: SCHEMA_VERSION,
    syncedAt: null,
    analysis,
    messages: [],
    memory: { demonstrated: [], misconceptions: [], errors: [], bottleneck: "" },
    imageId,
    thumb,
  };
  const ok = await saveSession(record);
  return ok ? record.id : null;
}

/**
 * Persist the transcript and the concept memory.
 *
 * Debounced by the caller: writing the whole record on every streamed chunk
 * would thrash the disk for no benefit, since only the final state of a turn
 * matters.
 */
export async function saveProgress<T extends LiveMessage>(
  id: string,
  messages: readonly T[],
  memory: SessionMemory,
): Promise<void> {
  const existing = await getSession(id);
  if (!existing) return;
  await saveSession({
    ...existing,
    updatedAt: Date.now(),
    messages: await externalise(messages),
    memory,
  });
}
