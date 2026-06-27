import { auditTargets, collectGaps } from "@/lib/seo/audit";
import { generateArtifacts } from "@/lib/ai/optimize";
import { saveSnapshot } from "@/lib/store/blob";
import { getTargetUrls } from "@/lib/config";
import type { Snapshot } from "@/lib/types";

/**
 * Full autonomous pipeline: crawl -> audit/score -> AI optimize -> persist.
 * Returns the produced snapshot.
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

  await saveSnapshot(snapshot);
  return snapshot;
}
