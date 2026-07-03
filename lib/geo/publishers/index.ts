import type { GeoArticle, GeoDraft, GeoState, PublishResult } from "@/lib/types";
import { publishToBlog } from "@/lib/geo/publishers/blog";
import { publishToDevto } from "@/lib/geo/publishers/devto";
import { publishToHashnode } from "@/lib/geo/publishers/hashnode";
import { publishToTelegraph } from "@/lib/geo/publishers/telegraph";
import { publishToReddit } from "@/lib/geo/publishers/reddit";

/**
 * Step 3: distribute one article to every configured platform.
 * Each publisher is independent — failures/missing keys never block the others.
 * Also enqueues Medium/Quora ready-to-paste drafts into the state.
 */
export async function distributeArticle(
  article: GeoArticle,
  state: GeoState,
): Promise<PublishResult[]> {
  const results: PublishResult[] = [];

  // Blog first: it establishes the canonical URL every other platform points at.
  results.push(await publishToBlog(article, state.articles));

  const [devto, hashnode, telegraph, reddit] = await Promise.all([
    publishToDevto(article),
    publishToHashnode(article),
    publishToTelegraph(article, state),
    publishToReddit(article),
  ]);
  results.push(devto, hashnode, telegraph, reddit);

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
        `*Originally published at [${article.canonicalUrl}](${article.canonicalUrl}` +
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
