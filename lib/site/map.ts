import { getTargetOrigin, USER_AGENT } from "@/lib/config";
import { readKv, writeKv } from "@/lib/store/blob";
import type { SiteMapCache, SitePage, SitePageKind } from "@/lib/types";

const SITE_MAP_KEY = "site/map.json";

/**
 * How long a cached parse stays fresh. The official site publishes new
 * /insights posts most days but its structural pages change rarely, so half a
 * day keeps us current without spending a sitemap fetch on every cycle.
 */
const TTL_MS = 12 * 60 * 60 * 1000;

const FETCH_TIMEOUT_MS = 20_000;

/**
 * Path segments that are section indexes rather than leaf content. They are
 * strong landing pages in their own right, so they count as "core".
 */
const SECTION_INDEXES = new Set([
  "topics",
  "compare",
  "scenarios",
  "solutions",
  "insights",
  "products",
  "evidence",
  "faq",
  "roi",
  "videos",
  "contact",
  "privacy",
  "terms",
]);

const SECTION_KINDS: Record<string, SitePageKind> = {
  topics: "topic",
  compare: "compare",
  scenarios: "scenario",
  solutions: "solution",
  insights: "insight",
};

function classify(path: string): { lang: "zh" | "en"; kind: SitePageKind; slug: string } {
  const segments = path.split("/").filter(Boolean);
  const lang = segments[0] === "en" ? "en" : "zh";
  const rest = lang === "en" ? segments.slice(1) : segments;

  if (rest.length === 0) return { lang, kind: "core", slug: "" };
  if (rest.length === 1) {
    return { lang, kind: SECTION_INDEXES.has(rest[0]) ? "core" : "other", slug: rest[0] };
  }
  return {
    lang,
    kind: SECTION_KINDS[rest[0]] ?? "other",
    slug: rest[rest.length - 1],
  };
}

/** Extract `<loc>` values. Deliberately regex-based: no XML parser dependency. */
function parseLocs(xml: string): string[] {
  return [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1]);
}

async function fetchSitemap(origin: string): Promise<SitePage[]> {
  const res = await fetch(`${origin}/sitemap.xml`, {
    headers: { "user-agent": USER_AGENT },
    cache: "no-store",
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`sitemap.xml returned HTTP ${res.status}`);

  const xml = await res.text();
  const seen = new Set<string>();
  const pages: SitePage[] = [];

  for (const loc of parseLocs(xml)) {
    let url: URL;
    try {
      url = new URL(loc);
    } catch {
      continue;
    }
    if (url.origin !== origin) continue;

    // Normalize: drop the trailing slash so "/en/" and "/en" are one page.
    const path = url.pathname.replace(/\/+$/, "") || "/";
    const normalized = `${origin}${path === "/" ? "/" : path}`;
    if (seen.has(normalized)) continue;
    seen.add(normalized);

    pages.push({ url: normalized, path, ...classify(path) });
  }

  if (pages.length === 0) throw new Error("sitemap.xml contained no usable <loc> entries");
  return pages;
}

function isFresh(cache: SiteMapCache | null, origin: string): cache is SiteMapCache {
  if (!cache || cache.origin !== origin || cache.pages.length === 0) return false;
  return Date.now() - new Date(cache.fetchedAt).getTime() < TTL_MS;
}

/**
 * Per-process memo so a single run (which resolves a landing page, rotates the
 * audit set and runs cross-page checks) parses the sitemap once, not per call.
 */
let inProcess: SiteMapCache | null = null;

/**
 * The official site's page inventory, refreshed from its sitemap at most twice
 * a day. New pages the site publishes are picked up automatically — nothing
 * here is hard-coded, so the autopilot never needs manual retargeting.
 *
 * A failed refresh never throws: the previous (stale) parse is returned with
 * `error` set, because operating on slightly old data beats halting the loop.
 */
export async function getSiteMap(force = false): Promise<SiteMapCache> {
  const origin = getTargetOrigin();
  if (!force && isFresh(inProcess, origin)) return inProcess;

  const cached = await readKv<SiteMapCache>(SITE_MAP_KEY).catch(() => null);
  if (!force && isFresh(cached, origin)) {
    inProcess = cached;
    return cached;
  }

  let fresh: SiteMapCache;
  try {
    fresh = { origin, fetchedAt: new Date().toISOString(), pages: await fetchSitemap(origin) };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error("[site/map] fetch failed:", detail);
    if (cached?.pages.length) return { ...cached, error: detail };
    return { origin, fetchedAt: new Date().toISOString(), pages: [], error: detail };
  }

  // A persistence failure must never invalidate a good parse — losing the page
  // map would silently downgrade every article back to a home-page backlink.
  await writeKv(SITE_MAP_KEY, fresh).catch((err) => {
    console.error("[site/map] cache write failed (continuing with fresh data):", err);
  });

  inProcess = fresh;
  return fresh;
}

/** English pages that make good backlink targets (leaf content + section hubs). */
export function englishLandingPages(map: SiteMapCache): SitePage[] {
  return map.pages.filter((p) => p.lang === "en" && p.kind !== "other");
}

/** Group pages by kind — used for dashboard breakdowns and audit rotation. */
export function countByKind(pages: SitePage[]): Record<SitePageKind, number> {
  const counts: Record<SitePageKind, number> = {
    core: 0,
    topic: 0,
    compare: 0,
    scenario: 0,
    solution: 0,
    insight: 0,
    other: 0,
  };
  for (const p of pages) counts[p.kind] += 1;
  return counts;
}
