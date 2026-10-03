import { NextResponse } from "next/server";
import { debugGate } from "@/lib/rateLimit";
import { lastDays, summarizeDay } from "@/lib/usage";
import { usageStore, usageStoreKind } from "@/lib/usageServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/usage?code=<DEBUG_CODE>&days=14 — the anonymous daily counts
 * (lib/usage.ts), newest first, with average times and rates worked out.
 * Owner-only: the same rule as the details on /api/health (debugGate: wrong
 * codes count as wrong guesses), and behind the access gate as well. A 404
 * to everyone else, so the route doesn't advertise itself.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const debug = await debugGate(req, url.searchParams.get("code"));
  if (debug.limited) return debug.limited;
  if (!debug.allowed) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const days = Math.min(90, Math.max(1, Number(url.searchParams.get("days")) || 14));
  try {
    const rows = await usageStore().read(lastDays(Date.now(), days));
    return NextResponse.json(
      { store: usageStoreKind(), days: rows.map(summarizeDay) },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (err) {
    console.error("[usage] read failed", err);
    return NextResponse.json({ error: "The usage store didn't answer." }, { status: 503 });
  }
}
