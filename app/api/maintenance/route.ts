import { NextResponse } from "next/server";
import { getGeoState, saveGeoState } from "@/lib/store/blob";
import { writeArticle } from "@/lib/geo/writer";
import { markdownToTelegraphNodes } from "@/lib/geo/publishers/telegraph";
import { USER_AGENT } from "@/lib/config";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

// Temporary one-shot route: rewrite an already-published Telegraph article whose
// first generation violated the data-integrity rules (invented competitor
// figures). Will be removed right after use.
const ONE_SHOT_KEY = "mx-fix-2026-07-20-c1d7f3a9";

export async function POST(request: Request) {
  const { searchParams } = new URL(request.url);
  if (searchParams.get("key") !== ONE_SHOT_KEY) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const slug = searchParams.get("slug") ?? "";

  const state = await getGeoState();
  const article = state.articles.find((a) => a.slug === slug);
  const tg = article?.publishResults.find((r) => r.platform === "telegraph" && r.url);
  if (!article || !tg?.url || !state.telegraphToken) {
    return NextResponse.json(
      { ok: false, error: "article/telegraph url/token not found" },
      { status: 404 },
    );
  }
  const keyword = state.keywords.find((k) => k.articleSlug === slug);

  // Regenerate with the hardened integrity prompt.
  const rewritten = await writeArticle(
    keyword ?? {
      keyword: article.keyword,
      intent: "vendor-selection",
      rationale: "regeneration",
      priority: 1,
      status: "written",
      createdAt: article.createdAt,
    },
  );

  const path = new URL(tg.url).pathname.replace(/^\//, "");
  const content = markdownToTelegraphNodes(rewritten.markdown, rewritten.referenceUrl);
  const res = await fetch(`https://api.telegra.ph/editPage/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": USER_AGENT },
    body: JSON.stringify({
      access_token: state.telegraphToken,
      title: rewritten.title.slice(0, 250),
      author_name: "Mingxin Technology Engineering",
      author_url: "https://mingxinstorage.xyz/en",
      content: JSON.stringify(content),
      return_content: false,
    }),
    cache: "no-store",
  });
  const data = (await res.json()) as { ok: boolean; error?: string; result?: { url: string } };
  if (!data.ok) {
    return NextResponse.json({ ok: false, error: data.error }, { status: 500 });
  }

  article.title = rewritten.title;
  article.description = rewritten.description;
  article.markdown = rewritten.markdown;
  article.quoraAnswer = rewritten.quoraAnswer;
  article.redditPost = rewritten.redditPost;
  article.aiGenerated = rewritten.aiGenerated;
  // Refresh the Medium/Quora drafts for this article too.
  state.draftQueue = state.draftQueue.filter((d) => d.articleSlug !== slug);
  const { buildDrafts } = await import("@/lib/geo/publishers");
  state.draftQueue.push(...buildDrafts(article));
  await saveGeoState(state);

  return NextResponse.json({ ok: true, url: data.result?.url, aiGenerated: rewritten.aiGenerated });
}
