import { test } from "node:test";
import assert from "node:assert/strict";
import { importTs } from "./importTs.mjs";

const { ownerOf, isGuest, needsPush, pushAction, deleteAction, pullAction } = await importTs("lib/sync/merge.ts");

const UID = "u1";
const LINKED = 1000;
const rec = (over = {}) => ({ id: "s", createdAt: 2000, updatedAt: 2000, syncedAt: null, ...over });
const row = (over = {}) => ({ id: "s", updated_at: 2000, deleted_at: null, ...over });

test("ownership: owned, made after linking, or a signed-out guest", () => {
  assert.equal(ownerOf(rec({ ownerId: "u2" }), UID, LINKED), "u2");
  assert.equal(ownerOf(rec({ createdAt: 1500 }), UID, LINKED), UID); // started before sign-in resolved
  assert.equal(ownerOf(rec({ createdAt: 500 }), UID, LINKED), null);
  assert.equal(isGuest(rec({ createdAt: 500 }), LINKED), true);
  assert.equal(isGuest(rec({ createdAt: 500, ownerId: UID }), LINKED), false);
  assert.equal(isGuest(rec({ createdAt: 1500 }), LINKED), false);
});

test("needsPush: only this account's records with unsynced changes", () => {
  assert.equal(needsPush(rec({ ownerId: UID }), UID, LINKED), true); // never synced
  assert.equal(needsPush(rec({ ownerId: UID, syncedAt: 2000 }), UID, LINKED), false);
  assert.equal(needsPush(rec({ ownerId: UID, syncedAt: 1900 }), UID, LINKED), true); // edited since
  assert.equal(needsPush(rec({ createdAt: 500 }), UID, LINKED), false); // guest: only by adopting
  assert.equal(needsPush(rec({ ownerId: "u2" }), UID, LINKED), false); // another account's
});

test("pushAction: last write wins, deletes made later win", () => {
  assert.equal(pushAction(rec(), null), "push");
  assert.equal(pushAction(rec({ updatedAt: 3000 }), row({ updated_at: 2000 })), "push");
  assert.equal(pushAction(rec({ updatedAt: 2000 }), row({ updated_at: 2000 })), "push"); // same: idempotent
  assert.equal(pushAction(rec({ updatedAt: 2000 }), row({ updated_at: 3000 })), "skip");
  assert.equal(pushAction(rec({ updatedAt: 2000 }), row({ deleted_at: 2500 })), "skip");
  assert.equal(pushAction(rec({ updatedAt: 3000 }), row({ updated_at: 2500, deleted_at: 2500 })), "push"); // edited after the delete
});

test("deleteAction: never resurrects, never deletes later work", () => {
  assert.equal(deleteAction(3000, null), "skip");
  assert.equal(deleteAction(3000, row({ updated_at: 2000 })), "delete");
  assert.equal(deleteAction(3000, row({ updated_at: 4000 })), "skip");
  assert.equal(deleteAction(3000, row({ deleted_at: 2500 })), "skip");
});

test("pullAction: new, newer, deleted; signed-out records untouched", () => {
  assert.equal(pullAction(null, row(), UID), "write");
  assert.equal(pullAction(rec({ ownerId: UID, updatedAt: 1000 }), row({ updated_at: 2000 }), UID), "write");
  assert.equal(pullAction(rec({ ownerId: UID, updatedAt: 3000 }), row({ updated_at: 2000 }), UID), "skip");
  assert.equal(pullAction(rec({ ownerId: UID, updatedAt: 2000 }), row({ updated_at: 2000 }), UID), "skip"); // our own push
  assert.equal(pullAction(rec({ ownerId: UID, updatedAt: 2000 }), row({ deleted_at: 2500 }), UID), "delete");
  assert.equal(pullAction(rec({ ownerId: UID, updatedAt: 3000 }), row({ deleted_at: 2500 }), UID), "skip"); // edited here since
  assert.equal(pullAction(null, row({ deleted_at: 2500 }), UID), "skip");
  assert.equal(pullAction(rec(), row({ deleted_at: 2500 }), UID), "skip"); // a guest record is never deleted by sync
  assert.equal(pullAction(rec(), row({ updated_at: 9000 }), UID), "skip"); // nor overwritten
  assert.equal(pullAction(rec({ ownerId: "u2" }), row({ updated_at: 9000 }), UID), "skip");
});
