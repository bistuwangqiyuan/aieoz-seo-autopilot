import type { GeoArticle, GeoDraft, GeoState, PublishResult } from "@/lib/types";
import { publishToDevto } from "@/lib/geo/publishers/devto";
import { publishToHashnode } from "@/lib/geo/publishers/hashnode";
import { publishToTelegraph } from "@/lib/geo/publishers/telegraph";
import { publishToReddit } from "@/lib/geo/publishers/reddit";

/**
 * Step 3: distribute one article to every configured off-site platform.
 * Each publisher is independent — failures/missing keys never block the others.
 * Also enqueues Medium/Quora ready-to-paste drafts into the state.
 * Nothing is written to the official site itself; every variant links back to
 * it (with per-platform UTM) instead.
 */
export async function distributeArticle(
  article: GeoArticle,
  state: GeoState,
): Promise<PublishResult[]> {
  const [devto, hashnode, telegraph, reddit] = await Promise.all([
    publishToDevto(article),
    publishToHashnode(article),
    publishToTelegraph(article, state),
    publishToReddit(article),
  ]);
  const results: PublishResult[] = [devto, hashnode, telegraph, reddit];

  state.draftQueue.push(...buildDrafts(article));

  return results;
}

/** Medium/Quora have no publish API — produce ready-to-paste drafts instead. */
export function buildDrafts(article: GeoArticle): GeoDraft[] {
  const now = new Date().toISOString();
  return [
    {
      platform: "medium",
      articleSlug: article.slug,
      title: article.title,
      content:
        `${article.markdown}\n\n---\n\n` +
        `*Benchmark reports (R1–R9) and product details: [${article.referenceUrl}](${article.referenceUrl}` +
        `?utm_source=medium&utm_medium=referral&utm_campaign=geo).*`,
      createdAt: now,
    },
    {
      platform: "quora",
      articleSlug: article.slug,
      title: article.keyword.endsWith("?")
        ? article.keyword[0].toUpperCase() + article.keyword.slice(1)
        : `${article.keyword[0].toUpperCase() + article.keyword.slice(1)}?`,
      content: article.quoraAnswer,
      createdAt: now,
    },
  ];
}
