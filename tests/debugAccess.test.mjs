import { test } from "node:test";
import assert from "node:assert/strict";
import { importTs } from "./importTs.mjs";

const { checkDebugCode } = await importTs("lib/debugAccess.ts");
const { MemoryStore, unlockLockedUntil, noteUnlockFail, UNLOCK_MAX_FAILS, UNLOCK_WINDOW_MS } =
  await importTs("lib/limitStore.ts");

/** The guess limit as lib/rateLimit.ts debugGate wires it, on a store and clock the test owns. */
function guesses(clock) {
  const store = new MemoryStore();
  let fails = 0;
  return {
    get fails() {
      return fails;
    },
    locked: async () => (await unlockLockedUntil(store, "ip", clock.now)) !== null,
    fail: async () => {
      fails++;
      await noteUnlockFail(store, "ip", clock.now);
    },
  };
}

function withEnv(env, fn) {
  return async () => {
    const saved = { NODE_ENV: process.env.NODE_ENV, DEBUG_CODE: process.env.DEBUG_CODE };
    Object.assign(process.env, env);
    for (const [k, v] of Object.entries(env)) if (v === undefined) delete process.env[k];
    try {
      await fn();
    } finally {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  };
}

test(
  "debug code: always allowed outside production, nothing counted",
  withEnv({ NODE_ENV: "development", DEBUG_CODE: "s3cret" }, async () => {
    const g = guesses({ now: 0 });
    assert.equal(await checkDebugCode("wrong", g), "allowed");
    assert.equal(await checkDebugCode(null, g), "allowed");
    assert.equal(g.fails, 0);
  }),
);

test(
  "debug code: no code presented is an ordinary visitor, never a guess",
  withEnv({ NODE_ENV: "production", DEBUG_CODE: "s3cret" }, async () => {
    const g = guesses({ now: 0 });
    for (const presented of [null, undefined, "", 42, {}]) {
      assert.equal(await checkDebugCode(presented, g), "denied");
    }
    assert.equal(g.fails, 0);
  }),
);

test(
  "debug code: the right code is allowed, a wrong one denied and counted",
  withEnv({ NODE_ENV: "production", DEBUG_CODE: "s3cret" }, async () => {
    const g = guesses({ now: 0 });
    assert.equal(await checkDebugCode("s3cret", g), "allowed");
    assert.equal(await checkDebugCode("guess", g), "denied");
    assert.equal(g.fails, 1);
  }),
);

test(
  "debug code: after the limit every code is locked, the right one too, until the window ends",
  withEnv({ NODE_ENV: "production", DEBUG_CODE: "s3cret" }, async () => {
    const clock = { now: 0 };
    const g = guesses(clock);
    for (let i = 0; i < UNLOCK_MAX_FAILS; i++) assert.equal(await checkDebugCode(`g${i}`, g), "denied");
    assert.equal(await checkDebugCode("another", g), "locked");
    assert.equal(await checkDebugCode("s3cret", g), "locked");
    assert.equal(g.fails, UNLOCK_MAX_FAILS, "locked attempts aren't counted again");
    clock.now += UNLOCK_WINDOW_MS;
    assert.equal(await checkDebugCode("s3cret", g), "allowed");
  }),
);

test(
  "debug code: with DEBUG_CODE unset nothing is allowed and nothing counted",
  withEnv({ NODE_ENV: "production", DEBUG_CODE: undefined }, async () => {
    const g = guesses({ now: 0 });
    assert.equal(await checkDebugCode("anything", g), "denied");
    assert.equal(g.fails, 0);
  }),
);
