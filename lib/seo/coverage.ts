import { getSiteMap } from "@/lib/site/map";
import { readKv, writeKv } from "@/lib/store/blob";
import { getTargetUrls } from "@/lib/config";
import type { SitePage } from "@/lib/types";

const COVERAGE_KEY = "site/audit-coverage.json";

interface CoverageRecord {
  /** url -> ISO timestamp of the most recent audit. */
  lastAuditedAt: Record<string, string>;
  /**
   * url -> cross-page faults found the last time that page was audited.
   *
   * Kept per URL rather than per run because the audit rotates: a run that
   * reports "0 hreflang issues" has only looked at its own 38 pages, so a
   * standing problem elsewhere on the site would appear to have been fixed. The
   * site team needs the list of pages that are actually broken, not a sample.
   */
  crossPageIssues?: Record<string, { hreflang?: string; canonical?: string | null }>;
}

/**
 * Pages audited on every run regardless of rotation: the commercial core of
 * the site, where a regression costs the most and would otherwise go unseen
 * for a day or more.
 */
const ALWAYS_AUDIT_PATHS = [
  "/",
  "/en",
  "/en/products",
  "/en/evidence",
  "/en/roi",
  "/products",
  "/evidence",
  "/roi",
];

/**
 * How many additional pages to audit per run.
 *
 * Time is not the binding constraint — measured, 38 pages crawl in ~3.5s, so
 * all 225 would fit inside the 300s function budget. The constraint is the
 * stored snapshot: every audited page carries its full signal set, and each
 * scan writes the snapshot three times (latest, history, by-id). Rotating at
 * this size keeps a snapshot near 100 KB while still sweeping the entire site
 * in about six runs — roughly one day at the 4-hour cadence.
 */
const ROTATION_BATCH = 30;

export interface AuditPlan {
  /** URLs to audit this run (core pages first). */
  urls: string[];
  /** Total URLs known from the sitemap. */
  totalUrls: number;
  /** URLs audited at least once. */
  everAudited: number;
  /** True when the plan fell back to the static list (sitemap unavailable). */
  degraded: boolean;
}

async function readCoverage(): Promise<CoverageRecord> {
  const raw = await readKv<CoverageRecord>(COVERAGE_KEY).catch(() => null);
  return {
    lastAuditedAt: raw?.lastAuditedAt ?? {},
    crossPageIssues: raw?.crossPageIssues ?? {},
  };
}

/**
 * Choose this run's audit set: every core page, plus the longest-unaudited
 * remainder. Pages never audited sort first (epoch timestamp), so a newly
 * published page is picked up on the next run rather than waiting a full
 * rotation.
 */
export async function planAudit(): Promise<AuditPlan> {
  const map = await getSiteMap();
  if (map.pages.length === 0) {
    // Sitemap unreachable — fall back to the configured core URLs so the audit
    // still runs (degraded) instead of silently auditing nothing.
    const urls = getTargetUrls();
    return { urls, totalUrls: urls.length, everAudited: 0, degraded: true };
  }

  const coverage = await readCoverage();
  const byPath = new Map(map.pages.map((p) => [p.path, p] as const));

  const core: SitePage[] = [];
  for (const path of ALWAYS_AUDIT_PATHS) {
    const page = byPath.get(path);
    if (page) core.push(page);
  }
  const coreUrls = new Set(core.map((p) => p.url));

  const rotation = map.pages
    .filter((p) => !coreUrls.has(p.url))
    .sort((a, b) => {
      const at = coverage.lastAuditedAt[a.url] ?? "";
      const bt = coverage.lastAuditedAt[b.url] ?? "";
      return at.localeCompare(bt) || a.url.localeCompare(b.url);
    })
    .slice(0, ROTATION_BATCH);

  return {
    urls: [...core.map((p) => p.url), ...rotation.map((p) => p.url)],
    totalUrls: map.pages.length,
    everAudited: map.pages.filter((p) => coverage.lastAuditedAt[p.url]).length,
    degraded: false,
  };
}

export async function recordAudited(urls: string[]): Promise<void> {
  const coverage = await readCoverage();
  const now = new Date().toISOString();
  for (const url of urls) coverage.lastAuditedAt[url] = now;

  // Drop entries for URLs the site no longer publishes so the record cannot
  // grow without bound as /insights posts come and go.
  const map = await getSiteMap();
  if (map.pages.length > 0) {
    const live = new Set(map.pages.map((p) => p.url));
    for (const url of Object.keys(coverage.lastAuditedAt)) {
      if (!live.has(url)) delete coverage.lastAuditedAt[url];
    }
  }

  await writeKv(COVERAGE_KEY, coverage).catch((err) => {
    console.error("[seo/coverage] write failed:", err);
  });
}

/** The site-wide standing fault list, as opposed to this run's sample. */
export interface StandingIssues {
  hreflang: { url: string; detail: string }[];
  canonical: { url: string; canonical: string | null }[];
  hreflangTotal: number;
  canonicalTotal: number;
}

/** Cap on the examples carried in the snapshot; the totals stay exact. */
const SAMPLE_CAP = 25;

/**
 * Merge this run's findings into the standing list: pages audited this run have
 * their entry rewritten (or cleared, when the page comes back clean, so a fix on
 * the official site shows up as fixed), and pages not audited this run keep
 * whatever was last known about them.
 */
export async function recordCrossPageIssues(
  auditedUrls: string[],
  hreflang: { url: string; detail: string }[],
  canonical: { url: string; canonical: string | null }[],
): Promise<StandingIssues> {
  const coverage = await readCoverage();
  const issues = coverage.crossPageIssues ?? {};

  const hreflangByUrl = new Map(hreflang.map((h) => [h.url, h.detail] as const));
  const canonicalByUrl = new Map(canonical.map((c) => [c.url, c.canonical] as const));

  for (const url of auditedUrls) {
    const entry: { hreflang?: string; canonical?: string | null } = {};
    if (hreflangByUrl.has(url)) entry.hreflang = hreflangByUrl.get(url);
    if (canonicalByUrl.has(url)) entry.canonical = canonicalByUrl.get(url) ?? null;
    if (Object.keys(entry).length > 0) issues[url] = entry;
    else delete issues[url];
  }

  // Forget pages the site no longer publishes, as the coverage record does.
  const map = await getSiteMap();
  if (map.pages.length > 0) {
    const live = new Set(map.pages.map((p) => p.url));
    for (const url of Object.keys(issues)) if (!live.has(url)) delete issues[url];
  }

  coverage.crossPageIssues = issues;
  await writeKv(COVERAGE_KEY, coverage).catch((err) => {
    console.error("[seo/coverage] cross-page write failed:", err);
  });

  return summarize(issues);
}

function summarize(issues: Record<string, { hreflang?: string; canonical?: string | null }>): StandingIssues {
  const hreflang: StandingIssues["hreflang"] = [];
  const canonical: StandingIssues["canonical"] = [];

  for (const [url, entry] of Object.entries(issues)) {
    if (entry.hreflang) hreflang.push({ url, detail: entry.hreflang });
    if (entry.canonical !== undefined) canonical.push({ url, canonical: entry.canonical });
  }

  return {
    hreflang: hreflang.slice(0, SAMPLE_CAP),
    canonical: canonical.slice(0, SAMPLE_CAP),
    hreflangTotal: hreflang.length,
    canonicalTotal: canonical.length,
  };
}

export interface CoverageStats {
  totalUrls: number;
  everAudited: number;
  /** Audited within the last 7 days. */
  freshlyAudited: number;
  oldestAuditAt: string | null;
}

export async function getCoverageStats(): Promise<CoverageStats> {
  const [map, coverage] = await Promise.all([getSiteMap(), readCoverage()]);
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;

  let everAudited = 0;
  let freshlyAudited = 0;
  let oldest: string | null = null;

  for (const page of map.pages) {
    const at = coverage.lastAuditedAt[page.url];
    if (!at) continue;
    everAudited += 1;
    if (new Date(at).getTime() >= cutoff) freshlyAudited += 1;
    if (!oldest || at < oldest) oldest = at;
  }

  return { totalUrls: map.pages.length, everAudited, freshlyAudited, oldestAuditAt: oldest };
}
