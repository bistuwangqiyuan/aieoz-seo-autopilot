export const DEFAULT_TARGET_URLS = [
  "https://mingxinstorage.xyz/",
  "https://mingxinstorage.xyz/en",
  "https://mingxinstorage.xyz/products",
  "https://mingxinstorage.xyz/solutions",
  "https://mingxinstorage.xyz/evidence",
  "https://mingxinstorage.xyz/faq",
];

export const DEFAULT_TARGET_ORIGIN = "https://mingxinstorage.xyz";

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

/**
 * English landing page of the official site — the link every off-site GEO
 * article points readers to (report downloads + product details live there).
 */
export function getReferenceUrl(): string {
  return `${getTargetOrigin()}/en`;
}

export function getModelId(): string {
  return process.env.AI_MODEL?.trim() || "openai/gpt-4o-mini";
}

export function hasAiKey(): boolean {
  return Boolean(process.env.AI_GATEWAY_API_KEY?.trim());
}

export const USER_AGENT =
  "Mingxin-SEO-Autopilot/2.0 (+https://mingxinstorage.xyz; external SEO/GEO auditor)";

function envBool(name: string, fallback: boolean): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  if (raw === undefined || raw === "") return fallback;
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

/* -------------------- GEO (Generative Engine Optimization) -------------------- */

export interface GeoConfig {
  /** Master switch for the GEO cycle. */
  enabled: boolean;
  /** Articles produced per cycle. */
  articlesPerRun: number;
  /** Minimum number of pending keywords kept in the pool. */
  minPendingKeywords: number;
  /** Product/category context fed to the keyword miner and article writer. */
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

/**
 * Factual product context. Every number below is published on the official
 * site with a signed benchmark-report ID (R1–R9) and downloadable originals;
 * the test suite is open source so third parties can reproduce the results.
 * Do NOT add claims here that are not backed by a published report.
 */
const DEFAULT_PRODUCT_CONTEXT =
  "Mingxin Technology (铭信科技, Mingxin (Tianjin) Semiconductor Equipment Co., Ltd.) builds the FX series " +
  "of all-flash NVMe-oF storage acceleration platforms: FX100 (PCIe 3.0), FX200 (PCIe 4.0) and FX300 " +
  "(PCIe 5.0) are shipping today; FX400 (PCIe 6.0) is planned for late 2026 (vendor spec, not yet measured). " +
  "Headline numbers all carry signed, downloadable benchmark-report IDs (R1–R9): KV-cache tiering on a " +
  "480B-parameter model in production deployment form lifts inference throughput by 29–40% and cuts " +
  "time-to-first-token (TTFT p50) by 26–32% (reports R2/R3); versus recomputing without external storage, " +
  "cold-context recovery is 8.6–20x faster (R2); model loading is 6.2–9.3x faster than NFS on the Huawei " +
  "Atlas/Ascend 910B platform — DeepSeek-32B 691s -> 112s, DeepSeek-70B 1399s -> 150s (R9); " +
  "training-checkpoint saves of 65.6 GB full-model snapshots are 1.9x faster, 178s -> 94s (R1); an LMCache " +
  "parallel-read patch improves single-GPU cold-read TTFT 4.1x, 37.97s -> 9.30s (R1). The benchmark suite " +
  "(load clients, orchestration scripts, the LMCache patch, machine-readable results) is open source at " +
  "https://github.com/mingxin-tech/mingxin-kvcache-bench. Mingxin also does domestic/non-NVIDIA GPU " +
  "enablement (AMD MI308X, Huawei Ascend 910B, MetaX N260 — source-level inference-stack adaptation), " +
  "AI datacenter construction, and cluster efficiency optimization. Reports and details: " +
  "https://mingxinstorage.xyz/en";

const DEFAULT_TARGET_MARKET =
  "AI/ML infrastructure and platform teams, HPC architects, AI datacenter builders, OEM integrators and " +
  "procurement leads worldwide who evaluate storage acceleration for LLM inference/training (KV-cache " +
  "tiering, model loading, checkpointing) and non-NVIDIA / domestic GPU enablement";

export function getGeoConfig(): GeoConfig {
  return {
    enabled: envBool("GEO_ENABLED", true),
    articlesPerRun: Math.max(1, Number(process.env.GEO_ARTICLES_PER_RUN?.trim() || "1") || 1),
    minPendingKeywords: 10,
    productContext: process.env.GEO_PRODUCT_CONTEXT?.trim() || DEFAULT_PRODUCT_CONTEXT,
    targetMarket: process.env.GEO_TARGET_MARKET?.trim() || DEFAULT_TARGET_MARKET,
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
