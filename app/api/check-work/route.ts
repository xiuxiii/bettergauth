import { getProvider } from "@/lib/ai/provider";
import { errorResponse } from "@/lib/apiError";
import { rateLimited } from "@/lib/rateLimit";
import { trackUsage, usageScope, type Usage } from "@/lib/usageServer";
import { CLIENT_CLOSED } from "@/lib/usage";
import { CheckWorkRequestSchema, parseBody } from "@/lib/api/schemas";
import type { WorkCheck } from "@/lib/tutor/types";

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
  return usageScope(req, async () => {
    const limited = await rateLimited(req);
    if (limited) return limited;
    const usage = trackUsage(req, "check");
    return usage.done(await handle(req, usage));
  });
}

async function handle(req: Request, usage: Usage): Promise<Response> {
  try {
    const parsed = await parseBody(
      req,
      CheckWorkRequestSchema,
      "A problem and an attempted solution are required.",
    );
    if (!parsed.ok) return parsed.response;
    const body = parsed.data;
    const retryOf = body.retryOf;

    const events = usage.provider(getProvider(req)).checkWorkStream({
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

    // The verdict is only known at the end, so this call is counted there,
    // and a check counts only once one arrives: an early check the cropper
    // aborted (no working after all) must not drag down checksCorrectPct.
    const tally = (e: { type: string; check?: WorkCheck }) => {
      if (e.type !== "done" || !e.check) return;
      usage.add("check");
      if (retryOf) usage.add("check.retry");
      usage.add(`verdict.${e.check.verdict}`);
      if (e.check.firstError) usage.add(`category.${e.check.firstError.category}`);
    };
    usage.stream();
    let failed = false;
    // Once the client has gone, nothing more may be enqueued or closed (both
    // throw on a cancelled stream), and the call counts as cancelled.
    let cancelled = false;

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (e: { type: string; stage?: string; check?: WorkCheck }) => {
          if (cancelled) return;
          tally(e);
          controller.enqueue(frame(e));
        };
        try {
          if (!first.done) send(first.value);
          for await (const event of events) {
            if (cancelled) break;
            send(event);
          }
        } catch (err) {
          if (!cancelled) {
            failed = true;
            console.error("check-work stream failed", err);
            controller.enqueue(
              line({
                t: "error",
                message: "The check stopped partway. Please try again.",
              }),
            );
          }
        } finally {
          // Closed first: the usage write waits for this in `after`.
          if (!cancelled) controller.close();
          usage.end(cancelled ? CLIENT_CLOSED : failed ? 500 : 200);
        }
      },
      cancel() {
        cancelled = true;
        usage.end(CLIENT_CLOSED);
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
