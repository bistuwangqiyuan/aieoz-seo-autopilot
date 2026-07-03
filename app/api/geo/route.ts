import { NextResponse } from "next/server";
import { runGeoCycle } from "@/lib/geo/pipeline";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

/** Manual GEO cycle trigger used by the dashboard button. */
export async function POST() {
  try {
    const cycle = await runGeoCycle("manual");
    return NextResponse.json({
      ok: !cycle.error,
      id: cycle.id,
      newKeywords: cycle.newKeywords,
      articles: cycle.articles,
      publishResults: cycle.publishResults,
      signalCheck: cycle.signalCheck,
      durationMs: cycle.durationMs,
      error: cycle.error,
    });
  } catch (err) {
    console.error("[geo] manual cycle failed:", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
