/**
 * Runs ONE eval case against a running app and scores it. Shared by the CLI
 * (evals/run.mjs) and the owner page's route (app/api/owner/eval), so a run
 * from the phone measures exactly what `npm run eval` measures.
 *
 * Environment-neutral on purpose: no node:fs, no node:path, no process. The
 * caller hands in how to reach the app and how to read a photo:
 *
 *   post(path, body)   → Promise<Response-like>  ({ ok, status, text() })
 *                        e.g. fetch(`${BASE}${path}`, { method: "POST", ... })
 *   readImage(relPath) → Promise<string>  data URL of a repo-relative image
 *                        ("evals/images/x.jpg")
 *   grid               → detect only: send the case's gridImage (when it has
 *                        one) and ask the route for grid mode
 *
 * Never throws: a case that fails to run comes back as
 * { id, kind, failed: true, error }, which summarize() counts, not scores.
 * See evals/score.mjs for the case format and the scored shapes.
 */

import { scoreCase, scoreDetect, scoreNotStem, scoreTutor } from "./score.mjs";

export const KINDS = ["check", "notStem", "tutor", "detect"];
export const kindOf = (c) => c.kind ?? "check";

/** POST, and the body as text; a non-2xx status is an error. */
async function postText(post, route, body) {
  const res = await post(route, body);
  const text = await res.text();
  if (!res.ok) throw new Error(`${route} ${res.status}: ${text.slice(0, 200)}`);
  return text;
}

/** /api/check-work streams NDJSON: stage frames, then one done (or error). */
function lastCheck(ndjson) {
  for (const line of ndjson.split("\n").filter(Boolean)) {
    const f = JSON.parse(line);
    if (f.t === "done") return f.check;
    if (f.t === "error") throw new Error(`check-work: ${f.message}`);
  }
  throw new Error("check-work: stream ended without a result");
}

/** /api/tutor streams NDJSON for conversational turns: deltas, then done. */
function lastTurn(ndjson) {
  for (const line of ndjson.split("\n").filter(Boolean)) {
    const f = JSON.parse(line);
    if (f.t === "done") return f.turn;
    if (f.t === "error") throw new Error(`tutor: ${f.message}`);
  }
  throw new Error("tutor: stream ended without a result");
}

/**
 * One case, any kind: the scored result plus `ms` and the raw response
 * (`check`, `detection` or `reply`), or the failed-run shape.
 */
export async function runCase(c, { post, readImage, grid = false }) {
  try {
    return await run(c, post, readImage, grid);
  } catch (err) {
    return { id: c.id, kind: kindOf(c), failed: true, error: String(err?.message ?? err) };
  }
}

async function run(c, post, readImage, grid) {
  const t0 = Date.now();
  if (c.kind === "detect") {
    const rel = grid && c.gridImage ? c.gridImage : c.image;
    const detection = JSON.parse(
      await postText(post, "/api/detect-questions", {
        image: await readImage(rel),
        width: c.width,
        height: c.height,
        ...(grid ? { grid: true } : {}),
      }),
    );
    return { ...scoreDetect(c, detection), ms: Date.now() - t0, detection };
  }
  if (c.kind === "tutor") {
    const turn = lastTurn(
      await postText(post, "/api/tutor", {
        problem: c.problem,
        history: c.history.map((m, i) => ({ id: `h${i}`, createdAt: i, ...m })),
        action: c.action ?? "ask",
        studentText: c.studentText,
      }),
    );
    return { ...scoreTutor(c, turn.message), ms: Date.now() - t0, reply: turn.message };
  }
  // check / notStem: analyze, the way the app does, then (check) check-work.
  const photo = c.image ? await readImage(c.image) : null;
  const analysis = JSON.parse(
    await postText(post, "/api/analyze", photo ? { image: photo } : { text: c.text ?? c.problem }),
  );
  if (c.kind === "notStem") {
    return { ...scoreNotStem(c, analysis), ms: Date.now() - t0 };
  }
  const attempt = photo
    ? { imageDataUrl: photo }
    : c.attempt.image
      ? { imageDataUrl: await readImage(c.attempt.image) }
      : { text: c.attempt.text };
  const check = lastCheck(await postText(post, "/api/check-work", { problem: analysis, attempt }));
  return { ...scoreCase(c, check, analysis), ms: Date.now() - t0, check, label: analysis.concept };
}
