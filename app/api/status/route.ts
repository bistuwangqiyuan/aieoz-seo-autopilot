import { NextResponse } from "next/server";
import { getGeoState, getLatest, listHistory, storageMode } from "@/lib/store/blob";
import { describeProviderChain } from "@/lib/ai/client";
import { staleForRules } from "@/lib/geo/integrity";
import { currentRulesVersion } from "@/lib/geo/rules";

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
      landingUrl: a.referenceUrl,
      landingKind: a.landingKind ?? null,
      deepLinked: !/\/en\/?$/.test(a.referenceUrl),
      linkBackfilledAt: a.linkBackfilledAt ?? null,
      published: a.publishResults.filter((r) => r.status === "published").map((r) => ({ platform: r.platform, url: r.url ?? null })),
    }))
    .slice(-10);

  // Backfill works oldest-first while publishedArticles shows the newest, so
  // progress is invisible there until the migration is nearly done.
  const deepLinked = geo.articles.filter((a) => !/\/en\/?$/.test(a.referenceUrl)).length;

  const rulesVersion = currentRulesVersion();
  const citation = geo.citationHistory.at(-1) ?? null;
  const liveness = geo.livenessHistory.at(-1) ?? null;
  const cross = latest?.site.crossPage ?? null;

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
          auditedThisRun: latest.pages.length,
        }
      : null,
    coverage: cross
      ? {
          sitemapUrls: cross.sitemapUrls,
          everAudited: cross.auditedUrls,
          percent: cross.sitemapUrls > 0 ? Math.round((cross.auditedUrls / cross.sitemapUrls) * 100) : 0,
          canonicalIssues: cross.canonicalIssues.length,
          hreflangIssues: cross.hreflangIssues.length,
          deadSitemapUrls: cross.deadSitemapUrls.length,
        }
      : null,
    // Effect metrics carry real caveats; see components/effect-panel.tsx and
    // the README for the full statement of what each can and cannot show.
    effect: {
      citation: citation
        ? {
            checkedAt: citation.checkedAt,
            memoryRate: citation.memoryRate,
            retrievalRate: citation.retrievalRate,
            probes: citation.probes.length,
            caveat: "所有 provider 均不联网检索，测的是模型已有认知，属长期滞后指标",
          }
        : null,
      liveness: liveness
        ? {
            checkedAt: liveness.checkedAt,
            liveCount: liveness.liveCount,
            totalCount: liveness.totalCount,
            backlinkPresent: liveness.probes.filter((p) => p.backlinkPresent).length,
            caveat: "只证明文章与外链仍然存在，不证明已被搜索引擎收录",
          }
        : null,
      integrity: {
        lastSweep: [...geo.cycles].reverse().find((c) => c.integrity)?.integrity ?? null,
        articlesChecked: geo.articles.filter((a) => a.integrityCheckedAt).length,
        articlesFlagged: geo.articles.filter((a) => (a.integrityFlags?.length ?? 0) > 0).length,
        rulesVersion,
        // Articles never checked against the rules as they stand now. Non-zero
        // right after a rule change is expected; it should return to zero.
        staleForRules: staleForRules(geo, rulesVersion).length,
      },
      indexNow: {
        available: false,
        reason:
          "IndexNow 要求在被提交 URL 所属域名根目录托管密钥文件；文章发布在第三方平台域名下，官网密钥需官网侧部署，故不可行",
      },
    },
    historyPoints: history.length,
    geo: {
      keywords: {
        total: geo.keywords.length,
        pending: geo.keywords.filter((k) => k.status === "pending").length,
        published: geo.keywords.filter((k) => k.status === "published").length,
      },
      keywordList: geo.keywords.map((k) => k.keyword),
      articles: geo.articles.length,
      cycles: geo.cycles.length,
      backlinks: {
        total: geo.articles.length,
        deepLinked,
        pendingBackfill: geo.articles.filter((a) => !a.linkBackfilledAt && !a.landingKind).length,
        lastRun: [...geo.cycles].reverse().find((c) => c.backfill)?.backfill ?? null,
      },
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
