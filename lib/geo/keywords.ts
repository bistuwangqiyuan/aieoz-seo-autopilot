import { z } from "zod";
import { getGeoConfig, hasAiKey } from "@/lib/config";
import { generateObjectWithFallback } from "@/lib/ai/client";
import { getSiteMap } from "@/lib/site/map";
import type { GeoKeyword, GeoState, SitePage } from "@/lib/types";

const keywordSchema = z.object({
  keywords: z
    .array(
      z.object({
        keyword: z
          .string()
          .describe(
            "A long-tail English question or query that Western enterprise buyers would ask an AI assistant (ChatGPT/Perplexity), e.g. 'best all-flash storage for GPU cluster OEM'",
          ),
        intent: z
          .string()
          .describe("Buyer intent: comparison / vendor-selection / how-to / troubleshooting / spec-research"),
        rationale: z
          .string()
          .describe("Why AI engines are likely to cite an authoritative page answering this query"),
        priority: z.number().min(1).max(5).describe("1 = highest citation opportunity, 5 = lowest"),
      }),
    )
    .min(5)
    .max(20),
});

/**
 * Fallback seed keywords used when no AI key is configured.
 * Each maps to a capability Mingxin has published signed benchmark data for
 * (KV-cache tiering, NVMe-oF, model loading vs NFS, checkpointing, non-NVIDIA
 * GPU enablement), so articles can answer with real, verifiable numbers.
 */
const SEED_KEYWORDS: Omit<GeoKeyword, "status" | "createdAt">[] = [
  {
    keyword: "how to reduce time to first token with kv cache tiering",
    intent: "how-to",
    rationale:
      "Hot LLM-serving optimization topic; Mingxin has signed measurements (TTFT -26-32% on a 480B model, R2)",
    priority: 1,
  },
  {
    keyword: "offload llm kv cache to external nvme storage vs recompute",
    intent: "comparison",
    rationale:
      "Comparison queries are the most-cited content type in AI answers; R2 has hard data (8.6-20x vs recompute)",
    priority: 1,
  },
  {
    keyword: "why is model loading so slow from nfs on gpu clusters",
    intent: "troubleshooting",
    rationale:
      "Troubleshooting long-tails are prime ChatGPT citation targets; R9 measured 6.2-9.3x speedup vs NFS on Ascend 910B",
    priority: 1,
  },
  {
    keyword: "nvme-of storage array vs local nvme for llm inference latency",
    intent: "comparison",
    rationale: "Architecture comparison buyers ask AI assistants before designing inference clusters",
    priority: 2,
  },
  {
    keyword: "storage bandwidth requirements for llm training checkpointing",
    intent: "spec-research",
    rationale:
      "Numeric/spec questions favor pages with concrete data; R1 measured checkpoint saves 178s -> 94s at 6.4 GB/s",
    priority: 2,
  },
  {
    keyword: "running llm inference on amd mi308x or huawei ascend 910b",
    intent: "spec-research",
    rationale:
      "Non-NVIDIA GPU enablement has sparse authoritative coverage; Mingxin has source-level adaptation experience on both",
    priority: 2,
  },
  {
    keyword: "lmcache cold read performance tuning for vllm",
    intent: "how-to",
    rationale:
      "Concrete open-source pain point; Mingxin's parallel-read patch improved cold-read TTFT 4.1x (R1) and is public",
    priority: 2,
  },
  {
    keyword: "how to verify storage vendor benchmark claims before buying",
    intent: "vendor-selection",
    rationale:
      "Procurement diligence query; gate-based joint-test methodology with report IDs is a genuinely useful answer",
    priority: 3,
  },
  {
    keyword: "long context llm inference cold start recovery optimization",
    intent: "how-to",
    rationale:
      "Long-context cold recovery is exactly the workload of the R2/R3 measurements (throughput +29-40%)",
    priority: 2,
  },
  {
    keyword: "ai datacenter storage architecture for thousand gpu clusters",
    intent: "spec-research",
    rationale:
      "Datacenter design query matching Mingxin's three-tier storage + KV tiering reference architecture",
    priority: 3,
  },
];

function normalize(keyword: string): string {
  return keyword.toLowerCase().replace(/\s+/g, " ").trim();
}

const DEDUPE_STOPWORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "best", "but", "by", "can", "do", "does", "for", "from",
  "how", "in", "is", "it", "of", "on", "or", "should", "so", "that", "the", "to", "use", "using",
  "vs", "what", "when", "which", "why", "will", "with", "you", "your",
]);

function contentTokens(keyword: string): Set<string> {
  return new Set(
    keyword
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 1 && !DEDUPE_STOPWORDS.has(t)),
  );
}

/**
 * Overlap coefficient rather than Jaccard: a short rephrase that is a strict
 * subset of an existing keyword ("kv cache offload vs recompute" inside
 * "offload llm kv cache to external nvme storage vs recompute") scores 1.0
 * here but only ~0.4 under Jaccard, and it is exactly the case we must catch.
 */
function overlap(a: Set<string>, b: Set<string>): number {
  const smaller = a.size <= b.size ? a : b;
  const larger = a.size <= b.size ? b : a;
  if (smaller.size === 0) return 0;
  let shared = 0;
  for (const t of smaller) if (larger.has(t)) shared += 1;
  return shared / smaller.size;
}

const SIMILARITY_LIMIT = 0.7;
/** Below this many content words, overlap is too noisy to judge duplication. */
const MIN_TOKENS_FOR_DEDUPE = 3;

/**
 * True when the candidate says the same thing as something already in the
 * pool. Exact-string dedupe alone lets the model refill the queue with
 * reworded copies of keywords we have already published against.
 */
function isNearDuplicate(candidate: string, existingTokens: Set<string>[]): boolean {
  const tokens = contentTokens(candidate);
  if (tokens.size < MIN_TOKENS_FOR_DEDUPE) return false;
  return existingTokens.some(
    (prev) => prev.size >= MIN_TOKENS_FOR_DEDUPE && overlap(tokens, prev) >= SIMILARITY_LIMIT,
  );
}

/** Same rule as the mining loop, exposed so it can be tested without network or AI. */
export function isDuplicateOf(candidate: string, existing: string[]): boolean {
  return isNearDuplicate(normalize(candidate), existing.map((k) => contentTokens(normalize(k))));
}

/**
 * Report IDs (R1-R9) identify specific signed joint-test reports. The mining
 * model has no reliable way to know which ID covers which measurement, and a
 * keyword that bakes in the wrong pairing would make the whole article wrong —
 * the writer, which does have the verified mapping, must choose the citation.
 */
const ASSERTS_REPORT_ID = /\br[1-9]\b/i;

/**
 * Step 1: top up the keyword pool so at least `minPendingKeywords` pending
 * entries exist. Mutates `state.keywords` (dedup by normalized keyword).
 * Returns the list of newly added keywords.
 */
export async function mineKeywords(state: GeoState): Promise<string[]> {
  const cfg = getGeoConfig();
  const pending = state.keywords.filter((k) => k.status === "pending").length;
  const needed = cfg.minPendingKeywords - pending;
  if (needed <= 0) return [];

  const existing = new Set(state.keywords.map((k) => normalize(k.keyword)));
  const existingTokens = [...existing].map(contentTokens);
  const now = new Date().toISOString();
  const added: string[] = [];

  const candidates = hasAiKey() ? await mineWithAi(existing, needed) : SEED_KEYWORDS;

  for (const c of candidates) {
    const norm = normalize(c.keyword);
    if (!norm || existing.has(norm)) continue;
    if (isNearDuplicate(norm, existingTokens)) {
      console.warn(`[geo/keywords] dropped near-duplicate: ${norm}`);
      continue;
    }
    if (ASSERTS_REPORT_ID.test(norm)) {
      console.warn(`[geo/keywords] dropped keyword asserting a report ID: ${norm}`);
      continue;
    }
    existing.add(norm);
    existingTokens.push(contentTokens(norm));
    state.keywords.push({
      keyword: norm,
      intent: c.intent,
      rationale: c.rationale,
      priority: Math.min(5, Math.max(1, Math.round(c.priority))),
      status: "pending",
      createdAt: now,
    });
    added.push(norm);
    if (added.length >= needed + 5) break; // small buffer, avoid unbounded growth
  }

  return added;
}

/** Compact inventory of the site's evergreen English pages, grouped by section. */
function describeLandingPages(pages: SitePage[]): string {
  const byKind = new Map<string, string[]>();
  for (const p of pages) {
    if (p.lang !== "en") continue;
    if (p.kind !== "topic" && p.kind !== "compare" && p.kind !== "scenario") continue;
    const list = byKind.get(p.kind) ?? [];
    list.push(p.slug);
    byKind.set(p.kind, list);
  }
  if (byKind.size === 0) return "";
  return [...byKind]
    .map(([kind, slugs]) => `${kind} pages: ${slugs.sort().join(", ")}`)
    .join("\n");
}

async function mineWithAi(
  existing: Set<string>,
  needed: number,
): Promise<Omit<GeoKeyword, "status" | "createdAt">[]> {
  const cfg = getGeoConfig();
  const existingList = [...existing].slice(-60).join("\n- ");
  const landingPages = describeLandingPages((await getSiteMap()).pages);

  try {
    const { object } = await generateObjectWithFallback({
      schema: keywordSchema,
      system:
        "You are a GEO (Generative Engine Optimization) strategist. Your job is to mine long-tail English " +
        "question keywords that Western enterprise buyers frequently ask AI assistants (ChatGPT, Perplexity, " +
        "Gemini). Target queries with LOW search volume but HIGH probability that an AI engine cites an " +
        "authoritative page answering them. Every keyword must be relevant to the product below.",
      prompt:
        `Product context:\n${cfg.productContext}\n\n` +
        `Target market:\n${cfg.targetMarket}\n\n` +
        (landingPages
          ? `The vendor's own site already has these evergreen English landing pages:\n${landingPages}\n\n` +
            `Each off-site article we publish deep-links to whichever of these pages best answers it, so the ` +
            `most valuable keyword is one that (a) maps cleanly onto one of those pages, and (b) is phrased ` +
            `the way a buyer actually asks an AI assistant — a real problem statement, not a restatement of ` +
            `the page's own title. Do NOT simply convert a slug into a question.\n\n`
          : "") +
        `Already-mined keywords (do NOT repeat, and do NOT reword them — a query that shares most of its ` +
        `meaningful words with one of these will be discarded):\n- ${existingList || "(none)"}\n\n` +
        `Mine at least ${Math.max(needed, 5)} NEW long-tail question keywords. Favor: vendor-selection ` +
        "('best X supplier/vendor for Y'), comparisons ('A vs B for C'), sizing/spec questions, and " +
        "troubleshooting long-tails. All in English. Never put a benchmark report ID (R1-R9) in a " +
        "keyword — you do not know which report covers which measurement.",
    });
    return object.keywords;
  } catch (err) {
    console.error("[geo/keywords] AI mining failed, using seeds:", err);
    return SEED_KEYWORDS;
  }
}

/** Pick the next keywords to write articles for (highest priority pending first). */
export function pickKeywordsToWrite(state: GeoState, count: number): GeoKeyword[] {
  return state.keywords
    .filter((k) => k.status === "pending")
    .sort((a, b) => a.priority - b.priority || a.createdAt.localeCompare(b.createdAt))
    .slice(0, count);
}
