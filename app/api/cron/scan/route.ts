import { NextResponse } from "next/server";
import { runScan } from "@/lib/pipeline";

export const runtime = "nodejs";
export const maxDuration = 120;
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

  try {
    const snapshot = await runScan("cron");
    return NextResponse.json({
      ok: true,
      id: snapshot.id,
      score: snapshot.score,
      aiGenerated: snapshot.artifacts.aiGenerated,
      durationMs: snapshot.durationMs,
    });
  } catch (err) {
    console.error("[cron] scan failed:", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
