export const DEFAULT_TARGET_URLS = [
  "https://goni.top/zh/index.html",
  "https://goni.top/en/index.html",
];

export const DEFAULT_TARGET_ORIGIN = "https://goni.top";

export function getTargetUrls(): string[] {
  const raw = process.env.TARGET_URLS;
  if (!raw) return DEFAULT_TARGET_URLS;
  const urls = raw
    .split(",")
    .map((u) => u.trim())
    .filter(Boolean);
  return urls.length ? urls : DEFAULT_TARGET_URLS;
}

export function getTargetOrigin(): string {
  const raw = process.env.TARGET_ORIGIN;
  if (raw && raw.trim()) return raw.trim().replace(/\/+$/, "");
  try {
    return new URL(getTargetUrls()[0]).origin;
  } catch {
    return DEFAULT_TARGET_ORIGIN;
  }
}

export function getModelId(): string {
  return process.env.AI_MODEL?.trim() || "openai/gpt-4o-mini";
}

export function hasAiKey(): boolean {
  return Boolean(process.env.AI_GATEWAY_API_KEY?.trim());
}

export const USER_AGENT =
  "AI-SEO-Autopilot/1.0 (+https://goni.top; autonomous SEO auditor)";

/** GA4 measurement id (G-XXXXXXXX) used for frontend tagging of published pages. */
export function getGa4MeasurementId(): string {
  return process.env.GA4_MEASUREMENT_ID?.trim() || "G-SZCSMKM793";
}

/** Ready-to-inject gtag.js snippet for the configured measurement id. */
export function buildGtagSnippet(): string {
  const id = getGa4MeasurementId();
  return (
    `<script async src="https://www.googletagmanager.com/gtag/js?id=${id}"></script>\n` +
    `<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}` +
    `gtag('js',new Date());gtag('config','${id}');</script>`
  );
}

/* -------------------- Writeback (auto-commit to source repo) -------------------- */

export interface WritebackConfig {
  /** Master switch. When false, applyWriteback is a no-op. */
  enabled: boolean;
  /** When true, compute the diff but do not push a real commit. */
  dryRun: boolean;
  /** GitHub PAT with contents:write on the target repo. Empty disables writeback. */
  token: string;
  /** owner/name of the goni.top source repository. */
  repo: string;
  /** Branch to commit to. */
  branch: string;
  /** Netlify publish dir relative to repo root ("." for root). */
  publishDir: string;
  /** Brand theme color injected when a page lacks <meta name="theme-color">. */
  themeColor: string;
  /** Map of live URL -> repo file path (relative to repo root). */
  pageFiles: { url: string; path: string }[];
}

function envBool(name: string, fallback: boolean): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  if (raw === undefined || raw === "") return fallback;
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

/**
 * Derive the repo file path for a live URL using the publish dir.
 * e.g. publishDir="." + https://goni.top/zh/index.html -> "zh/index.html".
 */
function deriveRepoPath(url: string, publishDir: string): string | null {
  try {
    let pathname = new URL(url).pathname.replace(/^\/+/, "");
    if (!pathname || pathname.endsWith("/")) pathname += "index.html";
    const dir = publishDir.replace(/^\.?\/*/, "").replace(/\/+$/, "");
    return dir ? `${dir}/${pathname}` : pathname;
  } catch {
    return null;
  }
}

/** Parse GONI_PAGE_FILES="url=path,url=path". Falls back to URL-derived mapping. */
function getPageFiles(publishDir: string): { url: string; path: string }[] {
  const raw = process.env.GONI_PAGE_FILES?.trim();
  if (raw) {
    const pairs = raw
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => {
        const idx = entry.indexOf("=");
        if (idx === -1) return null;
        const url = entry.slice(0, idx).trim();
        const path = entry.slice(idx + 1).trim().replace(/^\/+/, "");
        return url && path ? { url, path } : null;
      })
      .filter((v): v is { url: string; path: string } => v !== null);
    if (pairs.length) return pairs;
  }
  return getTargetUrls()
    .map((url) => {
      const path = deriveRepoPath(url, publishDir);
      return path ? { url, path } : null;
    })
    .filter((v): v is { url: string; path: string } => v !== null);
}

/* -------------------- GEO (Generative Engine Optimization) -------------------- */

export interface GeoConfig {
  /** Master switch for the GEO cycle. */
  enabled: boolean;
  /** Articles produced per cycle. */
  articlesPerRun: number;
  /** Minimum number of pending keywords kept in the pool. */
  minPendingKeywords: number;
  /** Product/category context fed to the keyword miner. */
  productContext: string;
  targetMarket: string;
  devtoApiKey: string;
  hashnodePat: string;
  hashnodePublicationId: string;
  reddit: {
    clientId: string;
    clientSecret: string;
    username: string;
    password: string;
  };
  ga4PropertyId: string;
  /** Base64-encoded GA4 service-account JSON. */
  ga4ServiceAccountJson: string;
}

export function getGeoConfig(): GeoConfig {
  return {
    enabled: envBool("GEO_ENABLED", true),
    articlesPerRun: Math.max(1, Number(process.env.GEO_ARTICLES_PER_RUN?.trim() || "1") || 1),
    minPendingKeywords: 10,
    productContext:
      process.env.GEO_PRODUCT_CONTEXT?.trim() ||
      "ZK-Storage WS5000: all-flash ultra-high-speed storage appliance for AI training and inference clusters. Key capabilities: KV Cache offloading, maximizing GPU utilization, ultra-high bandwidth and low latency, validated by CAS (Chinese Academy of Sciences) Institute of Information Engineering labs. Website: https://goni.top",
    targetMarket:
      process.env.GEO_TARGET_MARKET?.trim() ||
      "Enterprise infrastructure buyers in the US and Europe: AI/ML platform teams, HPC architects, OEM system integrators, data-center procurement leads",
    devtoApiKey: process.env.DEVTO_API_KEY?.trim() || "",
    hashnodePat: process.env.HASHNODE_PAT?.trim() || "",
    hashnodePublicationId: process.env.HASHNODE_PUBLICATION_ID?.trim() || "",
    reddit: {
      clientId: process.env.REDDIT_CLIENT_ID?.trim() || "",
      clientSecret: process.env.REDDIT_CLIENT_SECRET?.trim() || "",
      username: process.env.REDDIT_USERNAME?.trim() || "",
      password: process.env.REDDIT_PASSWORD?.trim() || "",
    },
    ga4PropertyId: process.env.GA4_PROPERTY_ID?.trim() || "",
    ga4ServiceAccountJson: process.env.GA4_SERVICE_ACCOUNT_JSON?.trim() || "",
  };
}

export function getWritebackConfig(): WritebackConfig {
  const token = process.env.GITHUB_TOKEN?.trim() || "";
  const repo = process.env.GONI_REPO?.trim() || "bistuwangqiyuan/zhongke-dpu-official";
  const branch = process.env.GONI_BRANCH?.trim() || "main";
  const publishDir = process.env.GONI_PUBLISH_DIR?.trim() || ".";
  const themeColor = process.env.GONI_THEME_COLOR?.trim() || "#0a1a2f";

  return {
    enabled: envBool("SEO_WRITEBACK_ENABLED", false),
    dryRun: envBool("SEO_WRITEBACK_DRYRUN", true),
    token,
    repo,
    branch,
    publishDir,
    themeColor,
    pageFiles: getPageFiles(publishDir),
  };
}
