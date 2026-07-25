import { NextResponse } from "next/server";
import { runGeoCycle } from "@/lib/geo/pipeline";
import { writeArticle } from "@/lib/geo/writer";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

/**
 * Manual GEO cycle trigger used by the dashboard button.
 * Body `{"dryRun": true, "keyword"?: "..."}` writes one article and returns it
 * WITHOUT publishing or touching state — used by acceptance tests to validate
 * writer output (incl. the AI fallback chain) with zero side effects.
 */
export async function POST(request: Request) {
  const deadline = Date.now() + (maxDuration - 20) * 1000;
  try {
    const body = await request.json().catch(() => ({}));
    if (body?.dryRun) {
      const article = await writeArticle({
        keyword: typeof body.keyword === "string" && body.keyword ? body.keyword : "how to reduce time to first token with kv cache tiering",
        intent: "how-to",
        rationale: "dry-run acceptance test",
        priority: 1,
        status: "pending",
        createdAt: new Date().toISOString(),
      });
      return NextResponse.json({ ok: true, dryRun: true, article });
    }

    const cycle = await runGeoCycle("manual", deadline);
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
