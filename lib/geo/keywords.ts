import { generateObject } from "ai";
import { z } from "zod";
import { getGeoConfig, getModelId, hasAiKey } from "@/lib/config";
import type { GeoKeyword, GeoState } from "@/lib/types";

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
  const now = new Date().toISOString();
  const added: string[] = [];

  const candidates = hasAiKey()
    ? await mineWithAi(existing, needed)
    : SEED_KEYWORDS;

  for (const c of candidates) {
    const norm = normalize(c.keyword);
    if (!norm || existing.has(norm)) continue;
    existing.add(norm);
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

async function mineWithAi(
  existing: Set<string>,
  needed: number,
): Promise<Omit<GeoKeyword, "status" | "createdAt">[]> {
  const cfg = getGeoConfig();
  const existingList = [...existing].slice(-60).join("\n- ");

  try {
    const { object } = await generateObject({
      model: getModelId(),
      schema: keywordSchema,
      system:
        "You are a GEO (Generative Engine Optimization) strategist. Your job is to mine long-tail English " +
        "question keywords that Western enterprise buyers frequently ask AI assistants (ChatGPT, Perplexity, " +
        "Gemini). Target queries with LOW search volume but HIGH probability that an AI engine cites an " +
        "authoritative page answering them. Every keyword must be relevant to the product below.",
      prompt:
        `Product context:\n${cfg.productContext}\n\n` +
        `Target market:\n${cfg.targetMarket}\n\n` +
        `Already-mined keywords (do NOT repeat or trivially rephrase):\n- ${existingList || "(none)"}\n\n` +
        `Mine at least ${Math.max(needed, 5)} NEW long-tail question keywords. Favor: vendor-selection ` +
        "('best X supplier/vendor for Y'), comparisons ('A vs B for C'), sizing/spec questions, and " +
        "troubleshooting long-tails. All in English.",
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
