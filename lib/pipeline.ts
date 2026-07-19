import { auditTargets, collectGaps } from "@/lib/seo/audit";
import { generateArtifacts } from "@/lib/ai/optimize";
import { saveSnapshot } from "@/lib/store/blob";
import { getTargetUrls } from "@/lib/config";
import type { Snapshot } from "@/lib/types";

/**
 * Full external-audit pipeline: crawl -> audit/score -> AI fix recommendations -> persist.
 * The tool is a read-only independent auditor of the official site; fixes are
 * applied by the site's own repo, and the next scan verifies the score gain.
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

  snapshot.durationMs = Date.now() - start;
  await saveSnapshot(snapshot);
  return snapshot;
}
