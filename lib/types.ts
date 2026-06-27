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
