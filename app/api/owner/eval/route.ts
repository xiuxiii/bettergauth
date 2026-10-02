import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { debugAllowed } from "@/lib/debugAccess";
import { formatResult } from "@/evals/format.mjs";
import { runCase } from "@/evals/runCase.mjs";
import { loadCases } from "../evalCases";
import { NO_STORE, notFound } from "../shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// One case is up to two model calls (analyze, then check-work with thinking).
export const maxDuration = 60;

/** Each run stops waiting a little before maxDuration, so it reports instead of dying. */
const DEADLINE_MS = 55_000;

/**
 * A case's photo as a data URL, the way evals/run.mjs reads it. Only from
 * evals/images: the path comes from a case file, and nothing else on the
 * server is any of the page's business. (Here, not in a shared module, so
 * only this route ships the photos.)
 */
async function readEvalImage(rel: string): Promise<string> {
  const root = path.join(process.cwd(), "evals", "images");
  const file = path.resolve(process.cwd(), rel);
  if (!file.startsWith(root + path.sep)) throw new Error(`${rel}: not under evals/images`);
  let buf: Buffer;
  try {
    buf = await readFile(file);
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") throw new Error(`${rel}: no such image`);
    throw err;
  }
  const type = rel.endsWith(".png") ? "image/png" : "image/jpeg";
  return `data:${type};base64,${buf.toString("base64")}`;
}

/**
 * POST /api/owner/eval — run ONE eval case against this very deploy, the way
 * `npm run eval` does (evals/runCase.mjs, shared with the CLI), so the owner
 * can run the evals from a phone, one case per request.
 *
 * Body: { code, caseId, provider?: "anthropic" | "deepseek", grid?: boolean }
 * Returns: { result, lines } — runCase's result (scored, or { failed: true,
 *   error } when the case didn't run) and the lines the CLI prints for it
 *   (evals/format.mjs).
 *
 * The case calls this app's own routes over HTTP, with the caller's cookie
 * (the access gate) and, when EVAL_BYPASS_TOKEN is set, the bypass header, so
 * eval runs skip the rate limiter and aren't counted as student usage.
 * 404 without the code; 400 for an unknown case or provider.
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  if (!debugAllowed(body?.code)) return notFound();

  const provider = body?.provider ?? undefined;
  if (provider !== undefined && provider !== "anthropic" && provider !== "deepseek") {
    return NextResponse.json(
      { error: 'provider must be "anthropic" or "deepseek".' },
      { status: 400, headers: NO_STORE },
    );
  }
  const grid = body?.grid === true;

  try {
    // The id must name a case file's case: it is matched, never used as a path.
    const caseId = body?.caseId;
    const c =
      typeof caseId === "string" ? (await loadCases()).find((x) => x.id === caseId) : undefined;
    if (!c) {
      return NextResponse.json({ error: "Unknown case." }, { status: 400, headers: NO_STORE });
    }

    const origin = new URL(req.url).origin;
    const cookie = req.headers.get("cookie");
    const bypass = process.env.EVAL_BYPASS_TOKEN?.trim();
    const signal = AbortSignal.timeout(DEADLINE_MS);
    const post = (path: string, payload: unknown) =>
      fetch(new URL(path, origin), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(cookie ? { cookie } : {}),
          ...(provider ? { "x-ai-provider": provider } : {}),
          ...(bypass ? { "x-eval-bypass": bypass } : {}),
        },
        body: JSON.stringify(payload),
        signal,
      });

    const result = await runCase(c, { post, readImage: readEvalImage, grid });
    if (result.failed) console.warn(`[owner/eval] ${c.id} failed: ${result.error}`);
    return NextResponse.json({ result, lines: formatResult(result) }, { headers: NO_STORE });
  } catch (err) {
    console.error("[owner/eval] run failed", err);
    return NextResponse.json(
      { error: "The eval couldn't run. See the server log." },
      { status: 500, headers: NO_STORE },
    );
  }
}
