import { NextResponse } from "next/server";
import { getProvider } from "@/lib/ai/provider";
import { errorResponse } from "@/lib/apiError";
import { rateLimited } from "@/lib/rateLimit";
import { trackUsage, type Usage } from "@/lib/usageServer";
import { TutorRequestSchema, parseBody } from "@/lib/api/schemas";
import type { TutorAction, TutorRequest } from "@/lib/tutor/types";

export const runtime = "nodejs";

/**
 * The conceptual moves stream; the other two don't. `show_solution` and
 * `similar_problem` deliver cards that only make sense complete, so they keep
 * returning one JSON body.
 */
const STREAMING_ACTIONS: TutorAction[] = [
  "ask",
  "question",
  "continue",
  "hint",
  "explain",
  "go_deeper",
];

/**
 * POST /api/tutor
 * Body: TutorRequest
 *
 * Returns either:
 *   - a TutorTurn as JSON (show_solution / similar_problem), or
 *   - newline-delimited JSON for the conceptual moves:
 *       {"t":"delta","v":"…"}   zero or more, display-only
 *       {"t":"done","turn":{…}} exactly one, authoritative
 *       {"t":"error","message":"…"}  if generation fails mid-stream
 *
 * Note the asymmetry: a failure BEFORE the first byte still goes through
 * errorResponse with a real status code, so the client's readApiError (and its
 * 402 spend-limit handling) works as before. Once the response has started
 * there is no status code left to send, hence the error frame.
 */
export async function POST(req: Request) {
  const limited = await rateLimited(req);
  if (limited) return limited;
  const usage = trackUsage(req, "tutor");
  return usage.done(await handle(req, usage));
}

async function handle(req: Request, usage: Usage): Promise<Response> {
  try {
    // Shape and size are checked before any model is called: this is client
    // text on its way into a prompt (lib/api/schemas.ts).
    const parsed = await parseBody(
      req,
      TutorRequestSchema,
      "A valid problem, history and action are required.",
    );
    if (!parsed.ok) return parsed.response;
    const body = parsed.data;

    const request: TutorRequest = {
      problem: body.problem,
      history: body.history,
      action: body.action,
      studentText: body.studentText,
      preferences: body.preferences,
      memory: body.memory,
    };

    usage.add(`turn.${body.action}`);
    if (!STREAMING_ACTIONS.includes(body.action)) {
      const turn = await usage.provider(getProvider(req)).tutor(request);
      if (turn.resolved) usage.add("resolved");
      return NextResponse.json(turn);
    }

    const events = usage.provider(getProvider(req)).tutorStream(request);
    usage.stream();
    let failed = false;
    const encoder = new TextEncoder();
    const line = (o: unknown) => encoder.encode(`${JSON.stringify(o)}\n`);

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          for await (const event of events) {
            if (event.type !== "delta" && event.turn.resolved) usage.add("resolved");
            controller.enqueue(
              event.type === "delta"
                ? line({ t: "delta", v: event.text })
                : line({ t: "done", turn: event.turn }),
            );
          }
        } catch (err) {
          failed = true;
          // Headers are long gone, so the status code can't carry this.
          console.error("tutor stream failed", err);
          controller.enqueue(
            line({
              t: "error",
              message: "The tutor stopped mid-answer. Please try again.",
            }),
          );
        } finally {
          await usage.flush(failed ? 500 : 200);
          controller.close();
        }
      },
      cancel() {
        // The student navigated away or started another turn; stop generating.
        void events.return?.(undefined);
      },
    });

    return new Response(stream, {
      headers: {
        "content-type": "application/x-ndjson; charset=utf-8",
        "cache-control": "no-store",
        // Tell any intermediary not to buffer, or the whole point is lost.
        "x-accel-buffering": "no",
      },
    });
  } catch (err) {
    return errorResponse(err, "The tutor could not respond. Please try again.");
  }
}
