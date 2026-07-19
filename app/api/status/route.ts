import { NextResponse } from "next/server";
import { getGeoState, getLatest, listHistory, storageMode } from "@/lib/store/blob";
import { describeProviderChain } from "@/lib/ai/client";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return true;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

/**
 * Read-only operational status for unattended monitoring / acceptance tests.
 * Protected by CRON_SECRET like the cron endpoint.
 */
export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const [latest, history, geo] = await Promise.all([getLatest(), listHistory(), getGeoState()]);

  const lastCycle = geo.cycles.at(-1) ?? null;
  const publishedArticles = geo.articles
    .map((a) => ({
      slug: a.slug,
      aiGenerated: a.aiGenerated,
      hasReportAnchors: /\bR[1-9]\b/.test(a.markdown) || a.markdown.includes("mingxin-kvcache-bench"),
      hasUtmBacklink: a.markdown.includes("utm_source="),
      published: a.publishResults.filter((r) => r.status === "published").map((r) => ({ platform: r.platform, url: r.url ?? null })),
    }))
    .slice(-10);

  return NextResponse.json({
    ok: true,
    storage: storageMode(),
    aiChain: describeProviderChain(),
    scan: latest
      ? {
          id: latest.id,
          score: latest.score,
          trigger: latest.trigger,
          aiGenerated: latest.artifacts.aiGenerated,
          model: latest.artifacts.model,
          pages: latest.pages.map((p) => ({ url: p.url, ok: p.ok, score: p.score })),
          sitemapOk: latest.site.sitemapXml.present,
          sitemapUrls: latest.site.sitemapXml.urlCount,
          robotsOk: latest.site.robotsTxt.present,
          actions: latest.artifacts.actions.length,
          hasMetadataSnippet: Boolean(latest.artifacts.metadataSnippet),
        }
      : null,
    historyPoints: history.length,
    geo: {
      keywords: {
        total: geo.keywords.length,
        pending: geo.keywords.filter((k) => k.status === "pending").length,
        published: geo.keywords.filter((k) => k.status === "published").length,
      },
      articles: geo.articles.length,
      cycles: geo.cycles.length,
      lastCycle: lastCycle
        ? {
            id: lastCycle.id,
            trigger: lastCycle.trigger,
            articles: lastCycle.articles,
            error: lastCycle.error ?? null,
            signalCheck: lastCycle.signalCheck,
          }
        : null,
      publishedArticles,
    },
  });
}
