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
 *
 * Dev.to goes first and alone: it is the highest-authority destination, so it
 * is the primary publication, and the other copies declare it as their origin
 * rather than competing with it as anonymous duplicates.
 */
export async function distributeArticle(
  article: GeoArticle,
  state: GeoState,
): Promise<PublishResult[]> {
  const devto = await publishToDevto(article);
  const originUrl = devto.status === "published" ? devto.url : undefined;

  const [hashnode, telegraph, reddit] = await Promise.all([
    publishToHashnode(article, originUrl),
    publishToTelegraph(article, state, originUrl),
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
        `*More on this topic: [${article.referenceUrl}](${article.referenceUrl}` +
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
