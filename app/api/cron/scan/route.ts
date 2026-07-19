import { NextResponse } from "next/server";
import { runScan } from "@/lib/pipeline";
import { runGeoCycle } from "@/lib/geo/pipeline";
import type { GeoCycle, Snapshot } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  // If no secret is configured, only allow Vercel's own cron invocations.
  if (!secret) return true;
  const auth = request.headers.get("authorization");
  return auth === `Bearer ${secret}`;
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  // SEO scan and GEO cycle are independent: one failing never blocks the other.
  let snapshot: Snapshot | null = null;
  let scanError: string | null = null;
  try {
    snapshot = await runScan("cron");
  } catch (err) {
    scanError = err instanceof Error ? err.message : String(err);
    console.error("[cron] scan failed:", err);
  }

  let geo: GeoCycle | null = null;
  let geoError: string | null = null;
  try {
    geo = await runGeoCycle("cron");
  } catch (err) {
    geoError = err instanceof Error ? err.message : String(err);
    console.error("[cron] geo cycle failed:", err);
  }

  const ok = snapshot !== null || geo !== null;
  return NextResponse.json(
    {
      ok,
      scan: snapshot
        ? {
            id: snapshot.id,
            score: snapshot.score,
            aiGenerated: snapshot.artifacts.aiGenerated,
            durationMs: snapshot.durationMs,
          }
        : { error: scanError },
      geo: geo
        ? {
            id: geo.id,
            newKeywords: geo.newKeywords.length,
            articles: geo.articles,
            published: geo.publishResults.filter((r) => r.status === "published").length,
            durationMs: geo.durationMs,
            error: geo.error,
          }
        : { error: geoError },
    },
    { status: ok ? 200 : 500 },
  );
}
