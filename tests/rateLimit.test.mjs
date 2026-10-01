import { test } from "node:test";
import assert from "node:assert/strict";
import { importTs } from "./importTs.mjs";

const {
  MemoryStore,
  RedisRestStore,
  FallbackStore,
  admit,
  unlockLockedUntil,
  noteUnlockFail,
  clearUnlockFails,
  UNLOCK_MAX_FAILS,
  UNLOCK_WINDOW_MS,
  MINUTE_MS,
  DAY_MS,
} = await importTs("lib/limitStore.ts");

/**
 * A stand-in for Upstash's REST /pipeline: the five commands the store sends,
 * with expiry against a clock the test controls (real Redis uses its own).
 */
function fakeRedis(clock) {
  const data = new Map(); // key -> { value, expiresAt }
  const live = (k) => {
    const e = data.get(k);
    if (e && e.expiresAt !== null && clock.now >= e.expiresAt) data.delete(k);
    return data.get(k);
  };
  const run = ([cmd, k, ...args]) => {
    switch (cmd) {
      case "SET": {
        const nx = args.includes("NX");
        if (nx && live(k)) return null;
        const px = args.indexOf("PX");
        data.set(k, { value: String(args[0]), expiresAt: px >= 0 ? clock.now + Number(args[px + 1]) : null });
        return "OK";
      }
      case "INCR": {
        const e = live(k) ?? { value: "0", expiresAt: null };
        e.value = String(Number(e.value) + 1);
        data.set(k, e);
        return Number(e.value);
      }
      case "PTTL": {
        const e = live(k);
        if (!e) return -2;
        return e.expiresAt === null ? -1 : e.expiresAt - clock.now;
      }
      case "GET":
        return live(k)?.value ?? null;
      case "DEL":
        return data.delete(k) ? 1 : 0;
      default:
        return { error: `unknown command ${cmd}` };
    }
  };
  const requests = [];
  const fetchImpl = async (url, init) => {
    const commands = JSON.parse(init.body);
    requests.push({ url, auth: init.headers.Authorization, commands });
    return new Response(JSON.stringify(commands.map((c) => ({ result: run(c) }))), { status: 200 });
  };
  return { fetchImpl, requests, data };
}

const LIMITS = { perMin: 3, perDay: 5 };

function stores() {
  const clock = { now: 1_000_000 };
  const redis = fakeRedis(clock);
  return [
    ["memory", new MemoryStore(), clock],
    ["redis", new RedisRestStore("https://example.upstash.io/", "tok", "mg:rl:", redis.fetchImpl), clock, redis],
  ];
}

for (const [name, store, clock] of stores()) {
  test(`${name}: the minute brake stops the (perMin+1)th request`, async () => {
    for (let i = 0; i < LIMITS.perMin; i++) {
      assert.deepEqual(await admit(store, "a", LIMITS, clock.now), { ok: true });
    }
    const v = await admit(store, "a", LIMITS, clock.now);
    assert.equal(v.ok, false);
    assert.equal(v.reason, "minute");
    assert.equal(v.resetAt, clock.now + MINUTE_MS);
  });

  test(`${name}: a minute rejection never counts toward the day`, async () => {
    // "a" was admitted 3 times and rejected once above; the day holds 3.
    const day = await store.peek("day:a", clock.now);
    assert.equal(day.count, LIMITS.perMin);
  });

  test(`${name}: the day cap holds across minutes, then resets`, async () => {
    clock.now += MINUTE_MS; // new minute
    assert.equal((await admit(store, "a", LIMITS, clock.now)).ok, true); // day 4
    assert.equal((await admit(store, "a", LIMITS, clock.now)).ok, true); // day 5
    const v = await admit(store, "a", LIMITS, clock.now);
    assert.equal(v.ok, false);
    assert.equal(v.reason, "day");
    clock.now += DAY_MS;
    assert.equal((await admit(store, "a", LIMITS, clock.now)).ok, true);
  });

  test(`${name}: clients are counted separately`, async () => {
    assert.equal((await admit(store, "b", LIMITS, clock.now)).ok, true);
  });

  test(`${name}: unlock locks after ${UNLOCK_MAX_FAILS} fails; a right code clears it`, async () => {
    for (let i = 0; i < UNLOCK_MAX_FAILS - 1; i++) await noteUnlockFail(store, "u", clock.now);
    assert.equal(await unlockLockedUntil(store, "u", clock.now), null);
    await noteUnlockFail(store, "u", clock.now);
    assert.equal(await unlockLockedUntil(store, "u", clock.now), clock.now + UNLOCK_WINDOW_MS);
    await clearUnlockFails(store, "u");
    assert.equal(await unlockLockedUntil(store, "u", clock.now), null);
  });

  test(`${name}: an unlock lock ends with its window`, async () => {
    for (let i = 0; i < UNLOCK_MAX_FAILS; i++) await noteUnlockFail(store, "v", clock.now);
    clock.now += UNLOCK_WINDOW_MS;
    assert.equal(await unlockLockedUntil(store, "v", clock.now), null);
  });
}

test("redis: requests are prefixed pipelines with the token", async () => {
  const clock = { now: 0 };
  const redis = fakeRedis(clock);
  const store = new RedisRestStore("https://example.upstash.io/", "tok", "mg:rl:", redis.fetchImpl);
  await store.incr("min:x", MINUTE_MS, clock.now);
  const [req] = redis.requests;
  assert.equal(req.url, "https://example.upstash.io/pipeline");
  assert.equal(req.auth, "Bearer tok");
  assert.deepEqual(req.commands, [
    ["SET", "mg:rl:min:x", "0", "PX", String(MINUTE_MS), "NX"],
    ["INCR", "mg:rl:min:x"],
    ["PTTL", "mg:rl:min:x"],
  ]);
});

test("redis: the window doesn't slide on later hits", async () => {
  const clock = { now: 0 };
  const redis = fakeRedis(clock);
  const store = new RedisRestStore("https://r", "t", "p:", redis.fetchImpl);
  const first = await store.incr("k", 1000, clock.now);
  clock.now = 600;
  const second = await store.incr("k", 1000, clock.now);
  assert.equal(second.count, 2);
  assert.equal(second.resetAt, first.resetAt);
});

test("fallback: a failing or slow primary drops to the secondary and reports", async () => {
  const errors = [];
  const broken = { incr: async () => { throw new Error("down"); }, peek: async () => null, clear: async () => {} };
  const slow = { incr: () => new Promise(() => {}), peek: () => new Promise(() => {}), clear: () => new Promise(() => {}) };
  const memory = new MemoryStore();

  const a = new FallbackStore(broken, memory, 50, (e) => errors.push(e.message));
  assert.equal((await a.incr("k", 1000, 0)).count, 1);
  assert.deepEqual(errors, ["down"]);

  const b = new FallbackStore(slow, memory, 20, (e) => errors.push(e.message));
  assert.equal((await b.incr("k", 1000, 0)).count, 2);
  assert.match(errors[1], /timed out/);
});

test("fallback: a healthy primary is used and the secondary untouched", async () => {
  const primary = new MemoryStore();
  const secondary = new MemoryStore();
  const store = new FallbackStore(primary, secondary, 50, () => assert.fail("no error expected"));
  await store.incr("k", 1000, 0);
  assert.equal((await primary.peek("k", 0)).count, 1);
  assert.equal(await secondary.peek("k", 0), null);
});
