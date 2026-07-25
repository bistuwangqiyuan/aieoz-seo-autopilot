import { z } from "zod";
import { getTargetOrigin, hasAiKey } from "@/lib/config";
import { generateObjectWithFallback } from "@/lib/ai/client";
import { getSiteMap } from "@/lib/site/map";
import type { SitePage, SitePageKind } from "@/lib/types";

/**
 * Resolve the official-site page a GEO article should link to.
 *
 * The site publishes ~40 evergreen English landing pages (/en/topics/*,
 * /en/compare/*, /en/scenarios/*, /en/solutions/*) whose slugs are descriptive
 * English. Sending every off-site article to the /en home page wastes that:
 * a reader arriving from "how to reduce time to first token" is far better
 * served by /en/topics/ttft-optimization, and the link is far more relevant.
 *
 * Matching is lexical first (deterministic, free, no latency) and only falls
 * back to the LLM when no candidate is clearly best. Nothing about the site
 * structure is hard-coded — candidates come from the live sitemap, so pages
 * the site adds later are picked up automatically.
 */

const STOPWORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "best", "but", "by", "can", "do", "does", "for", "from",
  "how", "in", "is", "it", "my", "no", "not", "of", "on", "or", "should", "so", "that", "the", "to",
  "use", "using", "vs", "was", "what", "when", "which", "why", "will", "with", "you", "your",
]);

/**
 * Acronym expansions that pure token overlap cannot bridge. Kept deliberately
 * small: the site's slugs are already descriptive English, so this only covers
 * genuine jargon shorthand, not a mirror of the site structure.
 */
const ALIASES: [RegExp, string[]][] = [
  [/\bttft\b/, ["time", "first", "token"]],
  [/\btime\s+to\s+first\s+token\b/, ["ttft"]],
  [/\bnvme-?of\b/, ["nvme", "of", "fabrics"]],
  [/\bnvme\s+over\s+fabrics\b/, ["nvmeof"]],
  [/\bmoe\b/, ["mixture", "experts"]],
  [/\bmixture\s+of\s+experts\b/, ["moe"]],
  [/\bpd\s+disaggregation\b/, ["prefill", "decode"]],
  [/\bprefill\b/, ["pd", "disaggregation"]],
  [/\brecompute|recomputation\b/, ["offload"]],
  [/\bnfs\b/, ["model", "load", "loading"]],
  [/\bcheckpoint(ing)?\b/, ["training", "checkpoint"]],
  [/\bcold\s+start\b/, ["cold", "recovery"]],
  [/\bsizing|capacity\b/, ["capacity", "planning"]],
  [/\btco|total\s+cost\b/, ["roi"]],
  [/\bmi308x?\b/, ["rocm", "amd", "mi308x"]],
  [/\bascend|910b\b/, ["ascend", "910b"]],
  [/\bmetax|muxi|n260\b/, ["muxi", "metax"]],
];

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

function expand(keyword: string): Set<string> {
  const lower = keyword.toLowerCase();
  const tokens = new Set(tokenize(lower));
  for (const [pattern, extra] of ALIASES) {
    if (pattern.test(lower)) for (const t of extra) tokens.add(t);
  }
  return tokens;
}

/**
 * Evergreen pages worth linking to. Dated /en/insights posts are excluded:
 * they age out, while topics/compare/scenarios pages are maintained hubs.
 */
const CANDIDATE_KINDS: SitePageKind[] = ["topic", "compare", "scenario", "solution", "core"];

/** Section hubs and legal pages that make poor article destinations. */
const EXCLUDED_SLUGS = new Set(["privacy", "terms", "contact", "videos", "insights"]);

function candidates(pages: SitePage[]): SitePage[] {
  return pages.filter(
    (p) => p.lang === "en" && CANDIDATE_KINDS.includes(p.kind) && !EXCLUDED_SLUGS.has(p.slug),
  );
}

/** Leaf pages beat section hubs when both match equally well. */
const KIND_WEIGHT: Record<SitePageKind, number> = {
  topic: 1.0,
  compare: 1.0,
  scenario: 1.0,
  solution: 0.95,
  core: 0.8,
  insight: 0.6,
  other: 0.5,
};

interface Scored {
  page: SitePage;
  score: number;
}

/**
 * "vs" marks a comparison page but carries no matching signal itself, so score
 * the competitor name instead of the prefix.
 */
function slugTokens(page: SitePage): string[] {
  return tokenize(page.slug.replace(/^vs-/, ""));
}

/**
 * Inverse document frequency over the candidate slugs. Without it, matching
 * "nvme" (which appears in several slugs) counts as much as matching "vast"
 * (which appears in exactly one), and a query naming a competitor loses to a
 * generic topic page on a coin flip.
 */
function buildIdf(pages: SitePage[]): Map<string, number> {
  const df = new Map<string, number>();
  for (const page of pages) {
    for (const token of new Set(slugTokens(page))) {
      df.set(token, (df.get(token) ?? 0) + 1);
    }
  }
  const idf = new Map<string, number>();
  for (const [token, count] of df) idf.set(token, Math.log(pages.length / (1 + count)) + 1);
  return idf;
}

/**
 * A query naming a specific product or vendor ("weka", "mooncake", "sglang")
 * has an unambiguous destination: the page whose slug is built from that exact
 * name. Proper-noun evidence is far stronger than generic token overlap, and
 * asking an LLM to weigh it only invites it to prefer a broader topic page —
 * which is what it did for "weka filesystem alternative for kv cache".
 */
function decisiveMatch(keyword: string, pages: SitePage[]): SitePage | null {
  const kw = expand(keyword);
  const df = new Map<string, number>();
  for (const page of pages) {
    for (const token of new Set(slugTokens(page))) df.set(token, (df.get(token) ?? 0) + 1);
  }

  for (const page of pages) {
    const tokens = slugTokens(page);
    if (tokens.length === 0 || tokens.length > 2) continue;
    // Every slug token present, and at least one is unique to this page.
    if (!tokens.every((t) => kw.has(t))) continue;
    if (tokens.some((t) => df.get(t) === 1)) return page;
  }
  return null;
}

function scoreCandidates(keyword: string, pages: SitePage[]): Scored[] {
  const kw = expand(keyword);
  if (kw.size === 0) return [];
  const idf = buildIdf(pages);
  const weight = (t: string) => idf.get(t) ?? 1;

  const raw = pages.map((page) => {
    const tokens = slugTokens(page);
    if (tokens.length === 0) return { page, matched: 0, coverage: 0, relevance: 0 };

    const hits = tokens.filter((t) => kw.has(t));
    const matched = hits.reduce((sum, t) => sum + weight(t), 0);
    const total = tokens.reduce((sum, t) => sum + weight(t), 0);
    return { page, matched, coverage: total > 0 ? matched / total : 0, relevance: hits.length / kw.size };
  });

  // Normalize the absolute matched mass against the best candidate so that
  // "matched a rare, highly specific term" outranks "matched a common one".
  const peak = Math.max(...raw.map((r) => r.matched), 0);

  return raw
    .map(({ page, matched, coverage, relevance }) => ({
      page,
      score:
        KIND_WEIGHT[page.kind] *
        (0.45 * coverage + 0.35 * (peak > 0 ? matched / peak : 0) + 0.2 * relevance),
    }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);
}

/**
 * Above this the lexical match is unambiguous (every slug token present, and
 * they are the rarest tokens available) so the LLM call is pure overhead.
 */
const CONFIDENT_SCORE = 0.85;
/** Below this, a candidate is noise and should not reach the LLM. */
const PLAUSIBLE_SCORE = 0.12;

const pickSchema = z.object({
  path: z.string().describe("The single best-matching path, copied exactly from the candidate list"),
});

/**
 * Slug glosses for section pages whose name does not describe its content.
 * Leaf pages (/en/topics/*, /en/compare/*, /en/scenarios/*) have descriptive
 * slugs and need no gloss, so this stays short and does not mirror the site.
 */
const ALWAYS_OFFERED = ["evidence", "roi", "products", "faq"];

const SLUG_HINTS: Record<string, string> = {
  evidence: "downloadable signed benchmark reports R1-R9, raw data, verification methodology",
  roi: "interactive ROI / TCO calculator",
  products: "FX100/FX200/FX300/FX400 specifications and reference pricing",
  faq: "frequently asked questions",
  topics: "index of technical topic explainers",
  compare: "index of head-to-head vendor comparisons",
  scenarios: "index of deployment scenarios",
  solutions: "index of service lines",
};

/** `null` = AI failed; `"home"` = AI judged nothing specific fits. */
async function pickWithAi(keyword: string, shortlist: SitePage[]): Promise<SitePage | "home" | null> {
  const list = shortlist
    .map((p) => {
      const hint = SLUG_HINTS[p.slug];
      return `${p.path}  (${p.kind}${hint ? ` — ${hint}` : ""})`;
    })
    .join("\n");
  try {
    const { object } = await generateObjectWithFallback({
      schema: pickSchema,
      system:
        "You map a buyer's search query to the single most relevant landing page on a storage-acceleration " +
        "vendor's website. Answer with one path copied verbatim from the candidate list — nothing else. " +
        "Rules, in order: (1) if the query names a specific competing product or vendor and a /compare page " +
        "for that exact name is listed, choose it; (2) if the query names a specific technology, workload or " +
        "hardware platform, choose the matching topic/scenario page; (3) prefer a specific leaf page over a " +
        "section index; (4) only if nothing genuinely answers the query, return /en.",
      prompt:
        `Query: "${keyword}"\n\nCandidate pages:\n${list}\n/en  (site English home)\n\n` +
        "Return the path of the page a reader with this query would most want to land on.",
    });
    const chosen = object.path.trim();
    if (chosen === "/en") return "home";
    return shortlist.find((p) => p.path === chosen) ?? null;
  } catch (err) {
    console.error("[site/landing] AI pick failed:", err);
    return null;
  }
}

export interface LandingTarget {
  url: string;
  path: string;
  kind: SitePageKind;
  /** How the target was chosen — recorded so results stay auditable. */
  method: "lexical" | "ai" | "fallback";
}

/** The signed-report evidence library — every article's secondary link. */
export function getEvidenceUrl(): string {
  return `${getTargetOrigin()}/en/evidence`;
}

/** The English home page — used when nothing more specific fits. */
export function getHomeUrl(): string {
  return `${getTargetOrigin()}/en`;
}

export async function resolveLandingTarget(keyword: string): Promise<LandingTarget> {
  const fallback: LandingTarget = { url: getHomeUrl(), path: "/en", kind: "core", method: "fallback" };

  const map = await getSiteMap();
  const pool = candidates(map.pages);
  if (pool.length === 0) return fallback;

  const asTarget = (page: SitePage, method: LandingTarget["method"]): LandingTarget => ({
    url: page.url,
    path: page.path,
    kind: page.kind,
    method,
  });

  const decisive = decisiveMatch(keyword, pool);
  if (decisive) return asTarget(decisive, "lexical");

  const scored = scoreCandidates(keyword, pool);
  const best = scored[0];
  if (best && best.score >= CONFIDENT_SCORE) return asTarget(best.page, "lexical");

  // Lexical scoring is good at building the shortlist but can't tell that
  // "thousand gpu clusters" means the 1k-datacenter page rather than the
  // scale-out comparison. One cheap LLM call per article settles it.
  const shortlist = scored
    .filter((s) => s.score >= PLAUSIBLE_SCORE)
    .slice(0, 12)
    .map((s) => s.page);

  // Buyer-intent pages whose slugs share no words with the queries they serve
  // ("verify vendor benchmark claims" -> /en/evidence) can never be scored in,
  // so they are always offered to the LLM alongside the lexical shortlist.
  for (const slug of ALWAYS_OFFERED) {
    if (shortlist.some((p) => p.slug === slug)) continue;
    const page = pool.find((p) => p.slug === slug && p.kind === "core");
    if (page) shortlist.push(page);
  }

  if (shortlist.length > 0 && hasAiKey()) {
    const picked = await pickWithAi(keyword, shortlist);
    if (picked === "home") return fallback;
    if (picked) return asTarget(picked, "ai");
  }

  // No AI available (or it failed): a weak lexical hit still beats the home page.
  if (best && best.score >= PLAUSIBLE_SCORE) return asTarget(best.page, "lexical");
  return fallback;
}
