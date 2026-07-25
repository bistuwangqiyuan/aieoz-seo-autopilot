import { getReferenceUrl } from "@/lib/config";
import { getEvidenceUrl, resolveLandingTarget } from "@/lib/site/landing";
import { ensureEvidenceLink, ensureUtmBacklink, withUtm } from "@/lib/geo/writer";
import { editTelegraphPage } from "@/lib/geo/publishers/telegraph";
import type { GeoArticle, GeoState } from "@/lib/types";

/**
 * One-off migration for articles published before deep linking existed: every
 * one of them points at the /en home page, wasting the ~40 purpose-built
 * landing pages the site already has. Telegraph's editPage lets us repoint
 * them in place using the access token already stored in GeoState, so the
 * existing corpus gains the same relevance signal as new articles.
 *
 * Runs a few articles per cycle rather than all at once: each one costs a
 * landing resolution (potentially an AI call) plus an edit request, and the
 * GEO cycle shares a 300s function budget with writing and publishing.
 */
const PER_CYCLE = 3;

export interface BackfillResult {
  attempted: number;
  repointed: number;
  failures: { slug: string; detail: string }[];
  remaining: number;
}

/**
 * Legacy articles awaiting migration, oldest first.
 *
 * Only articles predating deep linking qualify: they are the ones with neither
 * a resolved landing kind nor a backfill marker. Queueing every unmarked
 * article would enqueue each newly published one too — they are born pointing
 * at a deep page — and the backlog would grow by one per cycle as fast as it
 * drained by three, so the migration could never report itself finished.
 */
function pending(state: GeoState): GeoArticle[] {
  return state.articles
    .filter((a) => !a.linkBackfilledAt && !a.landingKind)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function backfillArticleLinks(state: GeoState): Promise<BackfillResult> {
  const queue = pending(state);
  const batch = queue.slice(0, PER_CYCLE);
  const result: BackfillResult = {
    attempted: batch.length,
    repointed: 0,
    failures: [],
    remaining: queue.length,
  };
  if (batch.length === 0) return result;

  const home = getReferenceUrl();
  const evidenceUrl = getEvidenceUrl();

  for (const article of batch) {
    try {
      const landing = await resolveLandingTarget(article.keyword);

      // Nothing better than the home page exists for this keyword; mark it
      // done so we stop paying to re-resolve it every cycle.
      if (landing.url === home) {
        article.linkBackfilledAt = new Date().toISOString();
        article.evidenceUrl = evidenceUrl;
        continue;
      }

      const markdown = repointLinks(article.markdown, home, landing.url, "geo-article", evidenceUrl);

      // The live page is the thing that matters; updating only our copy of the
      // markdown would report success while the published backlink stays stale.
      const telegraph = article.publishResults.find(
        (r) => r.platform === "telegraph" && r.status === "published" && r.url,
      );
      if (telegraph?.url) {
        if (!state.telegraphToken) {
          throw new Error("telegraph page needs repointing but no access token is stored");
        }
        await editTelegraphPage(
          state.telegraphToken,
          telegraph.url,
          article.title,
          markdown,
          landing.url,
        );
      }

      article.markdown = markdown;
      article.quoraAnswer = repointLinks(article.quoraAnswer, home, landing.url, "quora", evidenceUrl);
      article.redditPost = repointLinks(article.redditPost, home, landing.url, "reddit", evidenceUrl);
      article.referenceUrl = landing.url;
      article.landingKind = landing.kind;
      article.evidenceUrl = evidenceUrl;
      article.linkBackfilledAt = new Date().toISOString();
      result.repointed += 1;
    } catch (err) {
      result.failures.push({
        slug: article.slug,
        detail: err instanceof Error ? err.message.slice(0, 200) : String(err),
      });
    }
  }

  result.remaining = pending(state).length;
  return result;
}

/**
 * Swap home-page backlinks for the deep landing page, then re-apply the same
 * link guarantees new articles get. Only exact home-page URLs are rewritten:
 * a link to /en/products must survive untouched.
 */
export function repointLinks(
  text: string,
  home: string,
  landingUrl: string,
  source: string,
  evidenceUrl: string,
): string {
  const escaped = home.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
  // Matches the bare home URL and any query string on it, but not a longer path.
  const homeLink = new RegExp(`${escaped}(\\?[^\\s)\\]"']*)?(?![\\w/-])`, "g");
  const replaced = text.replace(homeLink, withUtm(landingUrl, source));
  return ensureEvidenceLink(ensureUtmBacklink(replaced, landingUrl, source), evidenceUrl, source);
}
