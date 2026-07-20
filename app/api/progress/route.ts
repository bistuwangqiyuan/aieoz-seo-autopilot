import { NextResponse } from "next/server";
import { getGeoState, getLatest } from "@/lib/store/blob";

export const runtime = "nodejs";
export const maxDuration = 30;
export const dynamic = "force-dynamic";

/**
 * Lightweight public progress fingerprint (same data the public dashboard
 * shows). The manual-run buttons poll this when their long POST is cut off
 * mid-flight (unstable networks kill 30-120s connections while the serverless
 * job keeps running) so they can detect completion instead of failing.
 */
export async function GET() {
  const [latest, geo] = await Promise.all([getLatest(), getGeoState()]);
  return NextResponse.json(
    {
      latestSnapshotId: latest?.id ?? null,
      geoCycles: geo.cycles.length,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
