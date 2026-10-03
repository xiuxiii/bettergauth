import { test } from "node:test";
import assert from "node:assert/strict";
import { importTs } from "./importTs.mjs";

const {
  dayKey, lastDays, MemoryUsageStore, RedisUsageStore, callCounts, summarizeDay, SLOW_MS, KEEP_DAYS, CLIENT_CLOSED,
} = await importTs("lib/usage.ts");

/** Upstash's /pipeline for the commands the usage store sends. */
function fakeRedis() {
  const hashes = new Map();
  const sets = new Map();
  const ttls = new Map();
  const requests = [];
  const run = ([cmd, k, ...a]) => {
    switch (cmd) {
      case "HINCRBY": {
        const h = hashes.get(k) ?? new Map();
        h.set(a[0], (h.get(a[0]) ?? 0) + Number(a[1]));
        hashes.set(k, h);
        return h.get(a[0]);
      }
      case "PFADD": {
        const s = sets.get(k) ?? new Set();
        const before = s.size;
        s.add(a[0]);
        sets.set(k, s);
        return s.size > before ? 1 : 0;
      }
      case "EXPIRE":
        ttls.set(k, Number(a[0]));
        return 1;
      case "HGETALL":
        return [...(hashes.get(k) ?? new Map())].flatMap(([f, v]) => [f, String(v)]);
      case "PFCOUNT":
        return sets.get(k)?.size ?? 0;
      default:
        return { error: `unknown ${cmd}` };
    }
  };
  const fetchImpl = async (url, init) => {
    const commands = JSON.parse(init.body);
    requests.push(commands);
    return new Response(JSON.stringify(commands.map((c) => ({ result: run(c) }))));
  };
  return { fetchImpl, requests, hashes, ttls };
}

test("days are UTC dates and roll over at UTC midnight", () => {
  assert.equal(dayKey(Date.UTC(2026, 9, 1, 23, 59, 59)), "2026-10-01");
  assert.equal(dayKey(Date.UTC(2026, 9, 2, 0, 0, 0)), "2026-10-02");
  assert.deepEqual(lastDays(Date.UTC(2026, 9, 2, 12), 3), ["2026-10-02", "2026-10-01", "2026-09-30"]);
});

test("a call's counters: count, time, provider, slow, error", () => {
  assert.deepEqual(callCounts("check", 7120, 200, "deepseek"), {
    "n.check": 1,
    "ms.check": 7120,
    "provider.deepseek": 1,
  });
  const slowFail = callCounts("tutor", SLOW_MS + 1, 502, "anthropic");
  assert.equal(slowFail["slow.tutor"], 1);
  assert.equal(slowFail["error.tutor.502"], 1);
  assert.equal(callCounts("analyze", 10, 200, "something-else")["provider.something-else"], undefined);
});

test("a stream the client closed is counted as cancelled, not as an error", () => {
  const counts = callCounts("check", 3000, CLIENT_CLOSED, "deepseek");
  assert.equal(counts["cancelled.check"], 1);
  assert.equal(counts["n.check"], 1);
  assert.deepEqual(Object.keys(counts).filter((k) => k.startsWith("error.")), []);
});

for (const [name, make] of [
  ["memory", () => ({ store: new MemoryUsageStore() })],
  ["redis", () => {
    const r = fakeRedis();
    return { store: new RedisUsageStore("https://r.example", "tok", "mg:usage:", r.fetchImpl), r };
  }],
]) {
  test(`${name}: counts add up per day, devices are distinct`, async () => {
    const { store } = make();
    await store.add("2026-10-01", { check: 1, "verdict.correct": 1 }, "dev-a");
    await store.add("2026-10-01", { check: 1, "verdict.error_found": 1 }, "dev-b");
    await store.add("2026-10-01", { check: 1 }, "dev-a");
    await store.add("2026-10-02", { "session.photo": 1 }, "dev-a");
    const [d1, d2, d3] = await store.read(["2026-10-01", "2026-10-02", "2026-10-03"]);
    assert.deepEqual(d1, { date: "2026-10-01", devices: 2, counts: { check: 3, "verdict.correct": 1, "verdict.error_found": 1 } });
    assert.deepEqual(d2, { date: "2026-10-02", devices: 1, counts: { "session.photo": 1 } });
    assert.deepEqual(d3, { date: "2026-10-03", devices: 0, counts: {} });
  });
}

test("redis: one pipeline per add, keys expire after the retention period", async () => {
  const r = fakeRedis();
  const store = new RedisUsageStore("https://r.example", "tok", "mg:usage:", r.fetchImpl);
  await store.add("2026-10-01", { check: 1, "ms.check": 7000 }, "dev-a");
  assert.equal(r.requests.length, 1);
  assert.deepEqual(r.requests[0], [
    ["HINCRBY", "mg:usage:2026-10-01", "check", "1"],
    ["HINCRBY", "mg:usage:2026-10-01", "ms.check", "7000"],
    ["EXPIRE", "mg:usage:2026-10-01", String(KEEP_DAYS * 86400)],
    ["PFADD", "mg:usage:2026-10-01:devices", "dev-a"],
    ["EXPIRE", "mg:usage:2026-10-01:devices", String(KEEP_DAYS * 86400)],
  ]);
});

test("redis: nothing to add sends nothing", async () => {
  const r = fakeRedis();
  await new RedisUsageStore("https://r.example", "tok", "p:", r.fetchImpl).add("2026-10-01", {});
  assert.equal(r.requests.length, 0);
});

test("a day's summary works out averages and rates", () => {
  const s = summarizeDay({
    date: "2026-10-01",
    devices: 3,
    counts: {
      "n.check": 4, "ms.check": 28000, check: 4, "verdict.correct": 1,
      "provider.deepseek": 10, "fallback.analyzeProblem": 1, "fallback.checkWork": 1,
    },
  });
  assert.deepEqual(s.avgMs, { check: 7000 });
  assert.equal(s.checksCorrectPct, 25);
  assert.equal(s.fallbackPctOfDeepseek, 20);
  assert.equal(summarizeDay({ date: "x", devices: 0, counts: {} }).checksCorrectPct, null);
});
