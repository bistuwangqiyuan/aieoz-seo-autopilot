import { auditTargets, collectGaps } from "@/lib/seo/audit";
import { generateArtifacts } from "@/lib/ai/optimize";
import { applyWriteback } from "@/lib/apply/writeback";
import { saveSnapshot } from "@/lib/store/blob";
import { getTargetUrls } from "@/lib/config";
import type { Snapshot } from "@/lib/types";

/**
 * Full autonomous pipeline: crawl -> audit/score -> AI optimize -> writeback -> persist.
 * The writeback step auto-commits the optimizations back to the source repo so the
 * next scan can verify the score gain (closed loop). Returns the produced snapshot.
 */
export async function runScan(trigger: Snapshot["trigger"]): Promise<Snapshot> {
  const start = Date.now();
  const urls = getTargetUrls();

  const { pages, site, score } = await auditTargets(urls);
  const gaps = collectGaps(pages);
  const artifacts = await generateArtifacts(pages, site, gaps);

  const snapshot: Snapshot = {
    id: new Date().toISOString().replace(/[:.]/g, "-"),
    createdAt: new Date().toISOString(),
    score,
    trigger,
    durationMs: Date.now() - start,
    pages,
    site,
    artifacts,
  };

  try {
    snapshot.writeback = await applyWriteback(snapshot);
  } catch (err) {
    console.error("[writeback] failed:", err);
  }

  snapshot.durationMs = Date.now() - start;
  await saveSnapshot(snapshot);
  return snapshot;
}
