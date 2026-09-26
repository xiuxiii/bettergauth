import { NextResponse } from "next/server";
import { getProvider } from "@/lib/ai/provider";
import { errorResponse } from "@/lib/apiError";
import { rateLimited } from "@/lib/rateLimit";
import { CheckWorkRequestSchema, parseBody } from "@/lib/api/schemas";

export const runtime = "nodejs";

/**
 * POST /api/check-work
 * Body: CheckWorkRequest
 * Returns: NDJSON — `{t:"stage", stage}` frames while the model reasons, then
 * one `{t:"done", check}`, or `{t:"error", message}` if it fails mid-stream.
 *
 * Streamed because the diagnosis now thinks before it answers, and a silent
 * multi-second wait reads as broken. The stages come from the model's own
 * stream, so they report real progress rather than a timer's guess.
 */
export async function POST(req: Request) {
  const limited = rateLimited(req);
  if (limited) return limited;

  try {
    const parsed = await parseBody(
      req,
      CheckWorkRequestSchema,
      "A problem and an attempted solution are required.",
    );
    if (!parsed.ok) return parsed.response;
    const body = parsed.data;
    const retryOf = body.retryOf;

    const events = getProvider().checkWorkStream({
      problem: body.problem,
      attempt: {
        text: body.attempt.text,
        imageDataUrl: body.attempt.imageDataUrl,
      },
      retryOf,
    });

    // Pull the first event BEFORE committing to a 200. The first stage frame
    // only exists once the model has accepted the request, so an auth, rate or
    // spend-limit rejection throws here and still gets its proper status from
    // errorResponse, instead of vanishing into a generic in-stream error.
    const first = await events.next();

    const encoder = new TextEncoder();
    const line = (o: unknown) => encoder.encode(`${JSON.stringify(o)}\n`);
    const frame = (e: { type: string; stage?: string; check?: unknown }) =>
      e.type === "stage"
        ? line({ t: "stage", stage: e.stage })
        : line({ t: "done", check: e.check });

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          if (!first.done) controller.enqueue(frame(first.value));
          for await (const event of events) controller.enqueue(frame(event));
        } catch (err) {
          console.error("check-work stream failed", err);
          controller.enqueue(
            line({
              t: "error",
              message: "The check stopped partway. Please try again.",
            }),
          );
        } finally {
          controller.close();
        }
      },
      cancel() {
        void events.return?.(undefined);
      },
    });

    return new Response(stream, {
      headers: {
        "content-type": "application/x-ndjson; charset=utf-8",
        "cache-control": "no-store",
        // Any buffering intermediary would hold the stages until the end.
        "x-accel-buffering": "no",
      },
    });
  } catch (err) {
    return errorResponse(err, "Could not check the work. Please try again.");
  }
}
