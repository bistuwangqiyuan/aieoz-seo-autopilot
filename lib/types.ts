export type CheckStatus = "pass" | "warn" | "fail";

export interface SeoCheck {
  id: string;
  label: string;
  status: CheckStatus;
  /** Points earned by this check. */
  score: number;
  /** Maximum points this check can contribute. */
  max: number;
  /** Human-readable explanation of the result. */
  detail: string;
}

export interface SeoCategory {
  id: string;
  label: string;
  score: number;
  max: number;
  checks: SeoCheck[];
}

export interface PageAudit {
  url: string;
  /** Final HTTP status, or 0 if the fetch failed. */
  httpStatus: number;
  fetchedAt: string;
  ok: boolean;
  error?: string;
  /** 0-100 weighted score for this page. */
  score: number;
  categories: SeoCategory[];
  /** Quick reference of the most important raw signals for the AI engine. */
  signals: PageSignals;
}

export interface PageSignals {
  title: string | null;
  titleLength: number;
  metaDescription: string | null;
  metaDescriptionLength: number;
  metaKeywords: string | null;
  canonical: string | null;
  robots: string | null;
  lang: string | null;
  viewport: string | null;
  hreflang: string[];
  h1: string[];
  headingOutline: { tag: string; text: string }[];
  ogTags: Record<string, string>;
  twitterTags: Record<string, string>;
  jsonLdTypes: string[];
  imageCount: number;
  imagesMissingAlt: number;
  internalLinks: number;
  externalLinks: number;
  genericAnchors: number;
  wordCount: number;
  hasManifest: boolean;
  hasFavicon: boolean;
  hasThemeColor: boolean;
  preloadHints: number;
  /** Trimmed, human-readable text content (used by the AI engine). */
  textExcerpt: string;
}

export interface SiteSignals {
  origin: string;
  robotsTxt: { present: boolean; hasSitemap: boolean; content: string | null };
  sitemapXml: { present: boolean; urlCount: number };
  /** Cross-page checks that a single-page audit cannot see. */
  crossPage?: CrossPageAudit;
}

/**
 * Site-wide structural checks derived from the sitemap + the pages audited in
 * this run. These catch problems (hreflang gaps, dead sitemap entries, wrong
 * canonicals) that are invisible when each page is looked at in isolation.
 */
export interface CrossPageAudit {
  /** Total URLs discovered in the official sitemap. */
  sitemapUrls: number;
  /** URLs audited at least once so far (rotating coverage). */
  auditedUrls: number;
  /** Sampled sitemap URLs that did not return 2xx. */
  deadSitemapUrls: { url: string; status: number }[];
  /** Pages whose zh/en counterpart is missing a reciprocal hreflang link. */
  hreflangIssues: { url: string; detail: string }[];
  /** Pages whose canonical does not point at themselves. */
  canonicalIssues: { url: string; canonical: string | null }[];
}

/* ==================== Official-site page map ==================== */

export type SitePageKind =
  | "core"
  | "topic"
  | "compare"
  | "scenario"
  | "solution"
  | "insight"
  | "other";

/** One URL discovered in the official site's sitemap. */
export interface SitePage {
  url: string;
  /** Path without origin, e.g. "/en/topics/ttft-optimization". */
  path: string;
  lang: "zh" | "en";
  kind: SitePageKind;
  /** Last path segment, e.g. "ttft-optimization" (empty for the home page). */
  slug: string;
}

/** Cached parse of the official sitemap; refreshed automatically. */
export interface SiteMapCache {
  origin: string;
  fetchedAt: string;
  pages: SitePage[];
  /** Set when the last refresh failed and stale pages are being served. */
  error?: string;
}

/**
 * AI-generated audit deliverables: fix recommendations for the site team.
 * The target site is a Next.js app, so fixes land in its source repo —
 * this tool reports and recommends, it never writes to the site.
 */
export interface Artifacts {
  /** True when produced by the LLM; false when produced by the heuristic fallback. */
  aiGenerated: boolean;
  model: string | null;
  summary: string;
  /** Ready-to-paste Next.js `metadata` export snippet for the primary page. */
  metadataSnippet: string;
  metaTitle: string;
  metaDescription: string;
  keywords: string[];
  jsonLd: { type: string; json: string }[];
  faq: { question: string; answer: string }[];
  contentSuggestions: string[];
  altTextSuggestions: { context: string; alt: string }[];
  actions: OptimizationAction[];
}

export interface OptimizationAction {
  title: string;
  detail: string;
  category: string;
  impact: "high" | "medium" | "low";
  effort: "high" | "medium" | "low";
}

export interface Snapshot {
  id: string;
  createdAt: string;
  /** Aggregate score across all audited pages (0-100). */
  score: number;
  trigger: "cron" | "manual";
  durationMs: number;
  pages: PageAudit[];
  site: SiteSignals;
  artifacts: Artifacts;
}

/** Compact representation used for the trend chart. */
export interface HistoryPoint {
  id: string;
  createdAt: string;
  score: number;
  trigger: Snapshot["trigger"];
}

/* ==================== GEO (Generative Engine Optimization) ==================== */

export type GeoKeywordStatus = "pending" | "written" | "published";

/** A long-tail question keyword mined by the AI for Western buyers. */
export interface GeoKeyword {
  /** Normalized (lowercase, trimmed) keyword — also the dedupe key. */
  keyword: string;
  /** Buyer intent, e.g. "comparison", "vendor-selection", "how-to". */
  intent: string;
  /** Why AI engines are likely to cite an authoritative answer for this. */
  rationale: string;
  /** 1 (highest) .. 5 (lowest). */
  priority: number;
  status: GeoKeywordStatus;
  createdAt: string;
  /** Set when an article has been produced for this keyword. */
  articleSlug?: string;
}

export type PublishPlatform =
  | "devto"
  | "hashnode"
  | "telegraph"
  | "reddit";

export type PublishStatus = "published" | "skipped" | "failed";

export interface PublishResult {
  platform: PublishPlatform;
  status: PublishStatus;
  /** Public URL of the published post (when published). */
  url?: string;
  /** Reason for skip / error message for failure. */
  detail?: string;
}

/** A produced article and everything needed to distribute it. */
export interface GeoArticle {
  slug: string;
  keyword: string;
  title: string;
  /** One-paragraph SEO description. */
  description: string;
  tags: string[];
  /** Markdown body (Dev.to / Hashnode / Telegraph / Medium). */
  markdown: string;
  /** Quora-style Q&A rewrite. */
  quoraAnswer: string;
  /** Reddit post body (text post). */
  redditPost: string;
  /**
   * Primary backlink target: the official-site English page most relevant to
   * this keyword (a /en/topics, /en/compare or /en/scenarios page when one
   * exists, otherwise /en). Articles live only on the platforms themselves —
   * nothing is written on-site, so there is no cross-platform canonical.
   */
  referenceUrl: string;
  /** Kind of page `referenceUrl` resolved to — surfaced on the dashboard. */
  landingKind?: SitePageKind;
  /** Secondary link to the signed-report evidence library (/en/evidence). */
  evidenceUrl?: string;
  createdAt: string;
  aiGenerated: boolean;
  publishResults: PublishResult[];
  /**
   * Set once the article's backlinks have been repointed from the /en home
   * page to a deep landing page. Recorded even when the keyword legitimately
   * resolves to /en, so the one-off migration does not re-resolve it forever.
   */
  linkBackfilledAt?: string;
  /** Last automated integrity sweep over this article's published text. */
  integrityCheckedAt?: string;
  /** Unrepaired integrity violations, empty when the article is clean. */
  integrityFlags?: string[];
  /**
   * Which rule set the article was last found clean against. A mismatch with
   * the current version means new rules exist that this text has never faced,
   * so it re-enters the sweep queue without anyone having to notice.
   */
  integrityRulesVersion?: string;
}

/* ==================== Content integrity ==================== */

/** A claim in a published article that the verified product context cannot support. */
export interface IntegrityViolation {
  /** Rule id, e.g. "invented-model". */
  rule: string;
  /** The offending text as it appears in the article. */
  matched: string;
  reason: string;
  excerpt: string;
}

export interface IntegritySweep {
  checkedAt: string;
  checked: number;
  flagged: number;
  repaired: number;
  /** Articles still carrying violations after an attempted rewrite. */
  unrepaired: { slug: string; violations: IntegrityViolation[] }[];
  /** Rule set this sweep enforced. */
  rulesVersion?: string;
  /** Articles awaiting a check against that rule set when the sweep started. */
  staleBefore?: number;
}

/** Ready-to-paste draft for platforms without a publish API. */
export interface GeoDraft {
  platform: "medium" | "quora";
  articleSlug: string;
  title: string;
  content: string;
  createdAt: string;
}

export type GeoSignalKind = "reddit" | "perplexity" | "chatgpt";

export interface GeoSignal {
  kind: GeoSignalKind;
  /** GA4 sessionSource value that matched. */
  source: string;
  sessions: number;
  detectedAt: string;
}

/** Result of one GA4 signal check. */
export interface GeoSignalCheck {
  checkedAt: string;
  /** false when GA4 credentials are not configured. */
  configured: boolean;
  error?: string;
  signals: GeoSignal[];
}

/** One full run of the 4-step GEO loop. */
export interface GeoCycle {
  id: string;
  createdAt: string;
  trigger: "cron" | "manual";
  durationMs: number;
  /** New keywords mined this cycle. */
  newKeywords: string[];
  /** Slugs of articles written this cycle. */
  articles: string[];
  /** Flattened publish results from this cycle. */
  publishResults: PublishResult[];
  signalCheck: GeoSignalCheck | null;
  /** Effect measurement collected this cycle (citation / liveness). */
  effect?: EffectSnapshot;
  /** Automated fact-integrity sweep over already-published articles. */
  integrity?: IntegritySweep;
  /** Progress of the one-off migration from home-page to deep backlinks. */
  backfill?: { attempted: number; repointed: number; remaining: number };
  /** Maintenance steps deferred to the next cycle to stay inside the function budget. */
  skippedForBudget?: string[];
  error?: string;
}

/* ==================== Effect measurement ==================== */

/**
 * Whether one LLM mentions Mingxin when asked a target buyer question.
 *
 * IMPORTANT CAVEAT (surfaced verbatim on the dashboard): most providers in the
 * fallback chain answer from parametric memory with no live retrieval, so this
 * measures "does the model already know Mingxin", not "did it just read our
 * article". It is a slow-moving lagging indicator, not a weekly KPI. Providers
 * that do retrieve are flagged with `retrieval: true` and reported separately.
 */
export interface CitationProbe {
  question: string;
  model: string;
  retrieval: boolean;
  /** Brand / domain / product / report-ID mentioned anywhere in the answer. */
  mentioned: boolean;
  /** Which markers matched, e.g. ["mingxin", "fx100", "R2"]. */
  matches: string[];
  error?: string;
}

export interface CitationCheck {
  checkedAt: string;
  probes: CitationProbe[];
  /** Share of probes that mentioned Mingxin (0-1), retrieval models excluded. */
  memoryRate: number;
  /** Share of retrieval-capable probes that mentioned Mingxin (0-1), or null. */
  retrievalRate: number | null;
}

/** Is a published article still live, and does it still carry our backlink? */
export interface LivenessProbe {
  platform: PublishPlatform;
  url: string;
  httpStatus: number;
  live: boolean;
  /** True when the official-site backlink is still present in the page body. */
  backlinkPresent: boolean;
}

export interface LivenessCheck {
  checkedAt: string;
  probes: LivenessProbe[];
  liveCount: number;
  totalCount: number;
}

/**
 * All effect signals collected in one cycle.
 *
 * Deliberately excludes IndexNow submission: IndexNow requires the key file to
 * be hosted on the same host as the submitted URLs. Our articles live on
 * telegra.ph / dev.to and the official site is mingxinstorage.xyz — we control
 * neither, and the official site does not host our key (verified 404). Adding
 * a submission step would produce a metric that either always fails or claims
 * a success it cannot have, so it is left out and explained on the dashboard.
 */
export interface EffectSnapshot {
  citation: CitationCheck | null;
  liveness: LivenessCheck | null;
}

/** Persistent GEO state stored in Postgres/Blob (geo/state.json). */
export interface GeoState {
  keywords: GeoKeyword[];
  articles: GeoArticle[];
  draftQueue: GeoDraft[];
  /** Latest first-seen timestamp per signal kind. */
  signalFirstSeen: Partial<Record<GeoSignalKind, string>>;
  signalHistory: GeoSignalCheck[];
  cycles: GeoCycle[];
  /** Telegraph anonymous account token (created once, reused). */
  telegraphToken?: string;
  /** Rolling history of AI-engine citation probes. */
  citationHistory: CitationCheck[];
  /** Rolling history of published-article liveness checks. */
  livenessHistory: LivenessCheck[];
}
