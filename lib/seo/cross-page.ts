import { USER_AGENT } from "@/lib/config";
import { recordCrossPageIssues } from "@/lib/seo/coverage";
import { getSiteMap } from "@/lib/site/map";
import type { CrossPageAudit, PageAudit } from "@/lib/types";

/**
 * Structural checks that are invisible when pages are audited one at a time:
 * a page can score perfectly on its own and still be unreachable, point its
 * canonical at a different URL, or claim a translation that does not exist.
 */

/** Sitemap URLs probed for reachability per run (bounded for runtime). */
const REACHABILITY_SAMPLE = 12;
const PROBE_TIMEOUT_MS = 12_000;

function counterpartPath(path: string): string {
  return path.startsWith("/en") ? path.slice(3) || "/" : `/en${path === "/" ? "" : path}`;
}

/** Compare URLs ignoring trailing slash and query, which are not meaningful here. */
function sameUrl(a: string, b: string): boolean {
  const norm = (u: string) => {
    try {
      const parsed = new URL(u);
      return `${parsed.origin}${parsed.pathname.replace(/\/+$/, "")}`;
    } catch {
      return u.replace(/\/+$/, "");
    }
  };
  return norm(a) === norm(b);
}

export async function runCrossPageChecks(
  pages: PageAudit[],
  auditedUrls: number,
): Promise<CrossPageAudit> {
  const map = await getSiteMap();
  const knownPaths = new Set(map.pages.map((p) => p.path));

  const canonicalIssues: CrossPageAudit["canonicalIssues"] = [];
  const hreflangIssues: CrossPageAudit["hreflangIssues"] = [];

  for (const page of pages) {
    if (!page.ok) continue;

    // Canonical must be self-referential. A canonical pointing elsewhere tells
    // search engines to drop this page from the index entirely.
    const canonical = page.signals.canonical;
    if (!canonical || !sameUrl(canonical, page.url)) {
      canonicalIssues.push({ url: page.url, canonical });
    }

    // A bilingual site must declare the counterpart in both directions; a
    // one-sided hreflang is ignored by Google and the translation is treated
    // as a duplicate.
    let path: string;
    try {
      path = new URL(page.url).pathname.replace(/\/+$/, "") || "/";
    } catch {
      continue;
    }
    const counterpart = counterpartPath(path);
    if (!knownPaths.has(counterpart)) continue;

    if (page.signals.hreflang.length === 0) {
      hreflangIssues.push({
        url: page.url,
        detail: `声明缺失：该页有对应译文 ${counterpart}，但未输出任何 hreflang`,
      });
    } else if (!page.signals.hreflang.includes("x-default")) {
      hreflangIssues.push({
        url: page.url,
        detail: `已声明 hreflang（${page.signals.hreflang.join(", ")}），缺少 x-default 兜底`,
      });
    }
  }

  // The per-run lists above only cover this run's rotation slice. Merged into
  // the standing record they become the site-wide list the official site's
  // developers can actually work from.
  const standing = await recordCrossPageIssues(
    pages.filter((p) => p.ok).map((p) => p.url),
    hreflangIssues,
    canonicalIssues,
  ).catch((err) => {
    console.error("[seo/cross-page] standing-issue merge failed:", err);
    return null;
  });

  return {
    sitemapUrls: map.pages.length,
    auditedUrls,
    deadSitemapUrls: await sampleReachability(map.pages.map((p) => p.url)),
    hreflangIssues: hreflangIssues.slice(0, 25),
    canonicalIssues: canonicalIssues.slice(0, 25),
    standing: standing ?? undefined,
  };
}

/**
 * Spot-check a rotating sample of sitemap URLs. A sitemap advertising dead
 * URLs wastes crawl budget and erodes trust in the whole file, but probing all
 * 225 every run would be both slow and rude to the origin.
 */
async function sampleReachability(urls: string[]): Promise<{ url: string; status: number }[]> {
  if (urls.length === 0) return [];
  const offset = Math.floor(Date.now() / (4 * 60 * 60 * 1000)) % urls.length;
  const sample = [...urls.slice(offset), ...urls.slice(0, offset)].slice(0, REACHABILITY_SAMPLE);

  const results = await Promise.all(
    sample.map(async (url) => {
      try {
        const res = await fetch(url, {
          method: "HEAD",
          headers: { "user-agent": USER_AGENT },
          cache: "no-store",
          signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
        });
        return { url, status: res.status };
      } catch {
        return { url, status: 0 };
      }
    }),
  );

  return results.filter((r) => r.status < 200 || r.status >= 300);
}
