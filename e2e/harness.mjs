/**
 * Shared helpers for the browser tests (`npm run e2e`, e2e/run.mjs).
 *
 * A spec is an `e2e/<area>.e2e.mjs` file:
 *
 *   export const profile = "default";       // a key of PROFILES
 *   export default async function (t) {
 *     await t.test("what it checks", async () => {
 *       const { p, st } = await t.page();
 *       await p.goto(t.base + "/");
 *       t.ok("the button is there", await p.getByRole("button", { name: "X" }).isVisible());
 *     });
 *   }
 *
 * No test talks to a real AI: every AI route is answered in the browser
 * (`mock`, or the 503 catch-all in `t.page`), and the server's own provider
 * URLs point at a closed port, so a forgotten mock can't spend credits.
 */

import { execSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
export const OUT = path.join(ROOT, "e2e", "out");
/** A real photo of a page of working, for upload paths. */
export const PHOTO = path.join(ROOT, "evals", "images", "correct-energy.jpg");

/** Nothing listens here: provider calls that slip past the mocks fail fast. */
const NOWHERE = "http://127.0.0.1:9";

/**
 * Server environments. Keys are fake; set every variable the app reads, so
 * nothing leaks in from the shell running the tests.
 */
export const PROFILES = {
  /** Production's shape: both providers, no Tutor switch, no gate. */
  default: { DEEPSEEK_API_KEY: "e2e", ANTHROPIC_API_KEY: "e2e" },
  /** The Tutor switch on (TUTOR_SWITCH=on, both keys). */
  switch: { DEEPSEEK_API_KEY: "e2e", ANTHROPIC_API_KEY: "e2e", TUTOR_SWITCH: "on" },
  /** One provider, so there is nothing to switch. */
  claudeOnly: { ANTHROPIC_API_KEY: "e2e" },
  /** The access gate and the owner page. */
  gate: {
    DEEPSEEK_API_KEY: "e2e",
    ANTHROPIC_API_KEY: "e2e",
    ACCESS_CODE: "e2e-access",
    DEBUG_CODE: "e2e-debug",
    ACCESS_SECRET: "e2e-secret",
  },
};

/** Every variable the app reads, cleared before a profile is applied. */
const APP_VARS = [
  "DEEPSEEK_API_KEY", "ANTHROPIC_API_KEY", "ANTHROPIC_MODEL", "DETECTION_MODEL",
  "ACCESS_CODE", "ACCESS_CODES", "ACCESS_SECRET", "RATE_LIMIT_PER_MIN", "RATE_LIMIT_PER_DAY",
  "UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN", "KV_REST_API_URL", "KV_REST_API_TOKEN",
  "EVAL_BYPASS_TOKEN", "DEBUG_CODE", "DEBUG_ERRORS", "DEBUG_TOKENS", "AI_PROVIDER",
  "TUTOR_SWITCH", "DETECT_PROVIDER", "DETECT_GRID", "DEEPSEEK_MODEL", "DEEPSEEK_VISION",
];

/** The environment for `next start` under a profile. */
export function serverEnv(profile) {
  const env = { ...process.env };
  for (const k of APP_VARS) delete env[k];
  return {
    ...env,
    ...PROFILES[profile],
    // High enough that a suite never trips the per-IP limits.
    RATE_LIMIT_PER_MIN: "10000",
    RATE_LIMIT_PER_DAY: "100000",
    DEEPSEEK_BASE_URL: NOWHERE,
    ANTHROPIC_BASE_URL: NOWHERE,
  };
}

/** Playwright from the project if present, else from the global npm root. */
export async function loadPlaywright() {
  try {
    return await import("playwright");
  } catch {
    /* not a project dependency — try the global install */
  }
  try {
    const root = execSync("npm root -g").toString().trim();
    return createRequire(path.join(root, "noop.js"))("playwright");
  } catch {
    return null;
  }
}

export async function launchBrowser(chromium) {
  const args = ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"];
  const pinned = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (pinned) {
    try {
      return await chromium.launch({ executablePath: path.join(pinned, "chromium"), args });
    } catch {
      /* fall through to Playwright's own browser */
    }
  }
  return chromium.launch({ args });
}

/** The AI routes: unmocked calls to these get a 503 and are reported. */
const AI_ROUTES = [
  "analyze", "check-work", "tutor", "detect-questions", "progress",
  "practice/generate", "practice/evaluate",
];

/**
 * A phone-sized page with preferences set (so the welcome tour is skipped).
 * Returns the context, the page and `st`: counts of file choosers and page
 * errors, and the AI calls nothing mocked.
 */
export async function newPage(browser, base, { theme = "light", prefs = true, width = 375, height = 812 } = {}) {
  const c = await browser.newContext({ viewport: { width, height }, permissions: ["camera"] });
  await c.addInitScript(
    ({ theme, prefs }) => {
      try {
        if (prefs) {
          localStorage.setItem(
            "mindgap:preferences",
            JSON.stringify({ grade: null, assistanceStyle: "hint_first", goal: "both" }),
          );
        }
        localStorage.setItem("mindgap:theme", theme);
      } catch {
        /* storage blocked: the app must cope anyway */
      }
    },
    { theme, prefs },
  );
  const p = await c.newPage();
  const st = { choosers: 0, pageErrors: [], unmocked: [] };
  p.on("filechooser", () => st.choosers++);
  p.on("pageerror", (e) => st.pageErrors.push(e.message));
  for (const r of AI_ROUTES) {
    await p.route(`${base}/api/${r}`, (route) => {
      st.unmocked.push(r);
      return route.fulfill({ status: 503, contentType: "application/json", body: '{"error":"e2e: not mocked"}' });
    });
  }
  return { c, p, st };
}

/**
 * Answer an AI route from the test. `handler(body, n)` returns either a value
 * (sent as JSON, 200), `{ status, json }`, or `{ ndjson: [frames] }` for the
 * streaming routes. Bodies are collected in the returned array.
 */
export async function mock(p, base, route, handler) {
  const calls = [];
  await p.route(`${base}/api/${route}`, async (r) => {
    const raw = r.request().postData();
    const body = raw ? JSON.parse(raw) : null;
    calls.push(body);
    const out = await handler(body, calls.length);
    if (out && out.ndjson) {
      return r.fulfill({
        status: 200,
        contentType: "application/x-ndjson",
        body: out.ndjson.map((f) => JSON.stringify(f)).join("\n") + "\n",
      });
    }
    if (out && typeof out.status === "number") {
      return r.fulfill({ status: out.status, contentType: "application/json", body: JSON.stringify(out.json ?? {}) });
    }
    return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(out) });
  });
  return calls;
}

/** Write history records straight into IndexedDB (lib/history/db.ts, v1). */
export function seed(p, records) {
  return p.evaluate(
    (records) =>
      new Promise((resolve, reject) => {
        const req = indexedDB.open("mindgap", 1);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains("sessions")) {
            db.createObjectStore("sessions", { keyPath: "id" }).createIndex("createdAt", "createdAt");
          }
          if (!db.objectStoreNames.contains("images")) db.createObjectStore("images");
        };
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const tx = req.result.transaction("sessions", "readwrite");
          for (const r of records) tx.objectStore("sessions").put(r);
          tx.oncomplete = () => resolve(true);
          tx.onerror = () => reject(tx.error);
        };
      }),
    records,
  );
}

/** Every history record, read back. */
export function allSessions(p) {
  return p.evaluate(
    () =>
      new Promise((resolve) => {
        const req = indexedDB.open("mindgap");
        req.onsuccess = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains("sessions")) return resolve([]);
          const all = db.transaction("sessions").objectStore("sessions").getAll();
          all.onsuccess = () => resolve(all.result);
        };
      }),
  );
}

// --- Fixtures ---------------------------------------------------------------

/** The final answer: must never show before "Show the rest". */
export const ANSWER = "FINALANSWER 19.8 m/s";
export const KEY_IDEA = "KEYIDEA energy is conserved";

export function analysis(over = {}) {
  return {
    hasStemContent: true,
    problemText: "A ball is dropped from 20 m. Find its speed at the ground.",
    subject: "Physics",
    topic: "Free fall",
    concept: "Free fall",
    keyIdea: KEY_IDEA,
    confidence: 0.9,
    openingHint: "OPENER which quantity is conserved here?",
    ...over,
  };
}

export const FIRST_ERROR = {
  category: "conceptual",
  severity: "significant",
  line: "v = gh",
  locate: "LOCATE line 2, where you found v",
  nudge: "NUDGE which energy does the ball start with?",
  diagnosis: "DIAGNOSIS you set speed equal to g times h",
  fix: "FIXTEXT use mgh = ½mv²",
};

export function check(over = {}) {
  return {
    verdict: "error_found",
    headline: "HEADLINE right up to line 2.",
    strength: "STRENGTH clear diagram.",
    firstError: FIRST_ERROR,
    continueFrom: ANSWER,
    ...over,
  };
}

export function practiceProblem(over = {}) {
  return {
    problemText: "PRACTICE-Q A stone is dropped from 45 m.",
    subject: "Physics",
    topic: "Free fall",
    concept: "Free fall",
    difficulty: "same",
    ...over,
  };
}

/** A stored session, as lib/history/db.ts writes it. */
export function record(id, over = {}) {
  const now = Date.now();
  return {
    id,
    createdAt: now,
    updatedAt: now,
    schemaVersion: 1,
    syncedAt: null,
    imageId: null,
    thumb: null,
    analysis: analysis(),
    messages: [],
    memory: { demonstrated: [], misconceptions: [], errors: [], bottleneck: "" },
    ...over,
  };
}

/** NDJSON frames /api/check-work streams for a finished check. */
export function checkFrames(c = check()) {
  return [{ t: "stage", stage: "thinking" }, { t: "done", check: c }];
}

/** NDJSON frames /api/tutor streams for a turn (hint, explain, a reply…). */
export function turnFrames(turn) {
  return [{ t: "delta", v: turn.message ?? "" }, { t: "done", turn }];
}
