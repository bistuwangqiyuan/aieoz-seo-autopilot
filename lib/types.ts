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
}

/** AI-generated, ready-to-apply optimization output. */
export interface Artifacts {
  /** True when produced by the LLM; false when produced by the heuristic fallback. */
  aiGenerated: boolean;
  model: string | null;
  summary: string;
  /** A ready-to-paste <head> block. */
  headHtml: string;
  metaTitle: string;
  metaDescription: string;
  keywords: string[];
  jsonLd: { type: string; json: string }[];
  faq: { question: string; answer: string }[];
  contentSuggestions: string[];
  altTextSuggestions: { context: string; alt: string }[];
  sitemapXml: string;
  robotsTxt: string;
  actions: OptimizationAction[];
}

export interface OptimizationAction {
  title: string;
  detail: string;
  category: string;
  impact: "high" | "medium" | "low";
  effort: "high" | "medium" | "low";
}

export interface WritebackChange {
  /** Repo-relative file path. */
  path: string;
  /** Human-readable summary of what was changed in this file. */
  summary: string;
  /** Specific SEO checks/elements that were upserted. */
  edits: string[];
}

/** Result of the auto-commit-to-source step. */
export interface WritebackResult {
  enabled: boolean;
  dryRun: boolean;
  /** True when a real commit was pushed. */
  applied: boolean;
  repo: string;
  branch: string;
  changedFiles: WritebackChange[];
  commitSha?: string;
  commitUrl?: string;
  /** Set when the step was skipped (disabled, no diff, missing token, etc). */
  skippedReason?: string;
  error?: string;
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
  /** Result of the optional auto-writeback step. */
  writeback?: WritebackResult;
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
  | "blog"
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
  /** Canonical URL on goni.top once the blog page is committed. */
  canonicalUrl: string;
  createdAt: string;
  aiGenerated: boolean;
  publishResults: PublishResult[];
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
  error?: string;
}

/** Persistent GEO state stored in Blob (geo/state.json). */
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
}
