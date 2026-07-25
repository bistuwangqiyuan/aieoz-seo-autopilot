import { probeAllProviders } from "@/lib/ai/client";
import { USER_AGENT } from "@/lib/config";
import type { CitationCheck, CitationProbe, GeoState, LivenessCheck, LivenessProbe } from "@/lib/types";

/**
 * Effect measurement for the off-site GEO loop.
 *
 * The official site has no GA4, and we deliberately do not touch it, so the
 * usual "did traffic go up" answer is unavailable. These two signals are the
 * honest substitutes: both are collected from systems we control or can query
 * anonymously, and both state their own limits on the dashboard rather than
 * implying more than they measure.
 */

/* ==================== 1. AI-engine citation ==================== */

/**
 * Buyer questions our articles are written to answer. Kept stable over time —
 * changing them would break comparability of the time series.
 */
const CITATION_QUESTIONS = [
  "Which vendors sell NVMe-oF storage arrays designed for LLM inference KV-cache offload? Name specific companies.",
  "What storage products have published signed benchmark reports for KV-cache tiering on large language models?",
  "Which storage vendors support Huawei Ascend 910B and AMD MI308X for AI inference workloads? Name specific companies.",
  "Who publishes reproducible open-source benchmarks for LLM KV-cache storage performance?",
  "What are the options for accelerating model loading on GPU clusters instead of NFS? Name specific products.",
];

/** Case-insensitive markers that count as Mingxin being surfaced. */
const BRAND_MARKERS: [string, RegExp][] = [
  ["mingxin", /\bmingxin\b/i],
  ["mingxinstorage.xyz", /mingxinstorage\.xyz/i],
  ["铭信", /铭信/],
  ["fx-series", /\bFX\s?[1-4]00\b/i],
  ["kvcache-bench", /mingxin-kvcache-bench/i],
];

/** Questions probed per cycle — rotated so the whole set is covered over a day. */
const QUESTIONS_PER_CYCLE = 2;

function detectMarkers(answer: string): string[] {
  return BRAND_MARKERS.filter(([, re]) => re.test(answer)).map(([label]) => label);
}

/**
 * Ask the configured model panel a rotating slice of the question set and
 * record whether Mingxin comes up.
 *
 * LIMITATION (stated verbatim on the dashboard): every provider in the chain
 * answers from parametric memory with no live web retrieval, so this measures
 * "has Mingxin entered these models' training data", not "did an engine just
 * read our article". Expect it to sit at zero for months — it is a lagging
 * indicator of brand presence, and treating a flat line as failure would be
 * misreading it.
 */
export async function runCitationCheck(cycleIndex: number): Promise<CitationCheck> {
  const start = (cycleIndex * QUESTIONS_PER_CYCLE) % CITATION_QUESTIONS.length;
  const questions = Array.from(
    { length: QUESTIONS_PER_CYCLE },
    (_, i) => CITATION_QUESTIONS[(start + i) % CITATION_QUESTIONS.length],
  );

  const probes: CitationProbe[] = [];
  for (const question of questions) {
    const answers = await probeAllProviders(
      "You are a knowledgeable infrastructure analyst. Answer concisely and name specific real " +
        "vendors or products you know of. If you do not know of any, say so plainly.",
      question,
    );
    for (const answer of answers) {
      const matches = answer.text ? detectMarkers(answer.text) : [];
      probes.push({
        question,
        model: answer.model,
        // No provider in the chain performs live web retrieval today. This is
        // set per-probe so a retrieval-capable model can be reported apart
        // from the memory-only ones the moment one is added.
        retrieval: false,
        mentioned: matches.length > 0,
        matches,
        ...(answer.error ? { error: answer.error } : {}),
      });
    }
  }

  const rate = (subset: CitationProbe[]) =>
    subset.length === 0 ? null : subset.filter((p) => p.mentioned).length / subset.length;

  const usable = probes.filter((p) => !p.error);
  return {
    checkedAt: new Date().toISOString(),
    probes,
    memoryRate: rate(usable.filter((p) => !p.retrieval)) ?? 0,
    retrievalRate: rate(usable.filter((p) => p.retrieval)),
  };
}

/* ==================== 2. Article liveness + backlink ==================== */

const LIVENESS_TIMEOUT_MS = 15_000;
/** Bounded per cycle so the check cannot blow the serverless time limit. */
const LIVENESS_BATCH = 12;

/**
 * Verify published articles are still up and still carry the official-site
 * backlink. Platforms delete posts without notice, which would silently void
 * the whole distribution effort — this is the only way we would find out.
 *
 * Articles are checked oldest-first in a rotating batch so the full corpus is
 * covered over a handful of cycles.
 */
export async function runLivenessCheck(state: GeoState, cycleIndex: number): Promise<LivenessCheck> {
  const targets = state.articles.flatMap((article) =>
    article.publishResults
      .filter((r) => r.status === "published" && r.url)
      .map((r) => ({ platform: r.platform, url: r.url!, origin: originOf(article.referenceUrl) })),
  );

  if (targets.length === 0) {
    return { checkedAt: new Date().toISOString(), probes: [], liveCount: 0, totalCount: 0 };
  }

  const offset = (cycleIndex * LIVENESS_BATCH) % targets.length;
  const batch = [...targets.slice(offset), ...targets.slice(0, offset)].slice(0, LIVENESS_BATCH);

  const probes = await Promise.all(batch.map(probeOne));
  return {
    checkedAt: new Date().toISOString(),
    probes,
    liveCount: probes.filter((p) => p.live).length,
    totalCount: probes.length,
  };
}

function originOf(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return "";
  }
}

async function probeOne(target: { platform: LivenessProbe["platform"]; url: string; origin: string }): Promise<LivenessProbe> {
  try {
    const res = await fetch(target.url, {
      headers: { "user-agent": USER_AGENT },
      cache: "no-store",
      signal: AbortSignal.timeout(LIVENESS_TIMEOUT_MS),
    });
    const body = res.ok ? await res.text() : "";
    return {
      platform: target.platform,
      url: target.url,
      httpStatus: res.status,
      live: res.ok,
      // Any link back to the official site counts: the exact landing page may
      // have been repointed since publication.
      backlinkPresent: Boolean(target.origin) && body.includes(target.origin),
    };
  } catch {
    return {
      platform: target.platform,
      url: target.url,
      httpStatus: 0,
      live: false,
      backlinkPresent: false,
    };
  }
}
