import { auditTargets, collectGaps } from "@/lib/seo/audit";
import { generateArtifacts } from "@/lib/ai/optimize";
import { saveSnapshot } from "@/lib/store/blob";
import { getCoverageStats, planAudit, recordAudited } from "@/lib/seo/coverage";
import { runCrossPageChecks } from "@/lib/seo/cross-page";
import type { PageAudit, Snapshot } from "@/lib/types";

/**
 * Full external-audit pipeline: plan coverage -> crawl -> audit/score ->
 * cross-page checks -> AI fix recommendations -> persist.
 *
 * The tool is a read-only independent auditor of the official site; fixes are
 * applied by the site's own repo, and the next scan verifies the score gain.
 */
export async function runScan(trigger: Snapshot["trigger"]): Promise<Snapshot> {
  const start = Date.now();

  // Audit targets come from the site's own sitemap (core pages every run,
  // the rest on an oldest-first rotation) rather than a hard-coded list, so
  // coverage tracks whatever the site actually publishes.
  const plan = await planAudit();

  const { pages, site, score } = await auditTargets(plan.urls);
  const gaps = collectGaps(pages);

  // Record before reading the coverage total: the other order reports the
  // previous run's figure, and 0 on the first run.
  await recordAudited(pages.filter((p) => p.ok).map((p) => p.url));
  site.crossPage = await runCrossPageChecks(pages, (await getCoverageStats()).everAudited);

  // The AI only needs full text for the primary pages; keeping 4 KB of body
  // text for every rotated page would bloat each stored snapshot several-fold.
  const trimmed = trimExcerpts(pages);
  const artifacts = await generateArtifacts(pages, site, gaps);

  const snapshot: Snapshot = {
    id: new Date().toISOString().replace(/[:.]/g, "-"),
    createdAt: new Date().toISOString(),
    score,
    trigger,
    durationMs: Date.now() - start,
    pages: trimmed,
    site,
    artifacts,
  };

  snapshot.durationMs = Date.now() - start;
  await saveSnapshot(snapshot);
  return snapshot;
}

/** Pages whose full text stays in the snapshot (shown on the dashboard). */
const FULL_TEXT_PAGES = 4;
const TRIMMED_EXCERPT_CHARS = 400;

function trimExcerpts(pages: PageAudit[]): PageAudit[] {
  return pages.map((page, index) =>
    index < FULL_TEXT_PAGES
      ? page
      : {
          ...page,
          signals: { ...page.signals, textExcerpt: page.signals.textExcerpt.slice(0, TRIMMED_EXCERPT_CHARS) },
        },
  );
}
