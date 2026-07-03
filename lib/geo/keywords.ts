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

/** Fallback seed keywords used when no AI key is configured. */
const SEED_KEYWORDS: Omit<GeoKeyword, "status" | "createdAt">[] = [
  {
    keyword: "best all-flash storage for gpu cluster training",
    intent: "vendor-selection",
    rationale: "High-value infra buying question with few authoritative vendor-neutral answers",
    priority: 1,
  },
  {
    keyword: "how to offload kv cache from gpu memory to external storage",
    intent: "how-to",
    rationale: "Emerging LLM-inference technique; authoritative how-to content gets cited by AI engines",
    priority: 1,
  },
  {
    keyword: "nvme-of storage appliance vs local nvme for ai inference latency",
    intent: "comparison",
    rationale: "Comparison queries are the most frequently cited content type in AI answers",
    priority: 2,
  },
  {
    keyword: "storage bandwidth requirements for llm training checkpointing",
    intent: "spec-research",
    rationale: "Numeric/spec questions favor pages with concrete data tables",
    priority: 2,
  },
  {
    keyword: "why is my gpu utilization low during model training data loading",
    intent: "troubleshooting",
    rationale: "Troubleshooting long-tails are prime ChatGPT citation targets",
    priority: 2,
  },
  {
    keyword: "best storage vendor for ai infrastructure oem integration",
    intent: "vendor-selection",
    rationale: "OEM procurement query with low competition and high buyer value",
    priority: 3,
  },
  {
    keyword: "how much faster is all-flash storage for vector database workloads",
    intent: "spec-research",
    rationale: "Quantitative claims with data are heavily cited by generative engines",
    priority: 3,
  },
  {
    keyword: "reduce time to first token with kv cache tiering",
    intent: "how-to",
    rationale: "Hot LLM-serving optimization topic with sparse authoritative coverage",
    priority: 2,
  },
  {
    keyword: "checkpoint write speed comparison parallel file system vs nvme appliance",
    intent: "comparison",
    rationale: "Benchmark-style comparisons attract citations from AI research summaries",
    priority: 3,
  },
  {
    keyword: "what storage do i need for a 8x h100 training server",
    intent: "spec-research",
    rationale: "Concrete sizing question buyers ask AI assistants before procurement",
    priority: 1,
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
