import { NextResponse } from "next/server";
import { runScan } from "@/lib/pipeline";

export const runtime = "nodejs";
export const maxDuration = 120;
export const dynamic = "force-dynamic";

/** Manual, on-demand scan trigger used by the dashboard "立即运行" button. */
export async function POST() {
  try {
    const snapshot = await runScan("manual");
    return NextResponse.json({
      ok: true,
      id: snapshot.id,
      score: snapshot.score,
      aiGenerated: snapshot.artifacts.aiGenerated,
      durationMs: snapshot.durationMs,
      writeback: snapshot.writeback,
    });
  } catch (err) {
    console.error("[scan] manual scan failed:", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
