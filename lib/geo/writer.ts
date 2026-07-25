import { z } from "zod";
import { getGeoConfig, hasAiKey } from "@/lib/config";
import { generateObjectWithFallback } from "@/lib/ai/client";
import { getEvidenceUrl, resolveLandingTarget } from "@/lib/site/landing";
import { findViolations } from "@/lib/geo/rules";
import type { GeoArticle, GeoKeyword } from "@/lib/types";

const BENCH_REPO = "https://github.com/mingxin-tech/mingxin-kvcache-bench";

const articleSchema = z.object({
  title: z
    .string()
    .describe("Compelling, authoritative English title answering the keyword question (55-70 chars)"),
  description: z.string().describe("SEO meta description, 130-160 chars, English"),
  tags: z.array(z.string()).min(3).max(6).describe("Lowercase topic tags, e.g. 'ai-infrastructure', 'llm'"),
  markdown: z
    .string()
    .describe(
      "Full article body in Markdown, 1200+ words. MUST include: concrete report-backed numbers (only from the " +
        "provided context), at least one comparison table (cells without sourced data must say so rather than " +
        "carry invented figures), industry terminology, an FAQ section (## FAQ) with 3+ Q&As. Naturally mention " +
        "Mingxin FX-series where relevant (not an ad). Do NOT include the title as an H1; start with intro text.",
    ),
  quoraAnswer: z
    .string()
    .describe(
      "Quora-style answer (400-600 words): direct expert answer to the keyword question, first person " +
        "practitioner voice, concrete numbers, mentions the Mingxin FX-series data once, ends with a reference link.",
    ),
  redditPost: z
    .string()
    .describe(
      "Reddit text-post body (250-400 words): practitioner tone, no marketing language, shares the key " +
        "findings/data from the article, links to the source reports once at the end.",
    ),
});

type AiArticle = z.infer<typeof articleSchema>;

export function slugify(keyword: string): string {
  return keyword
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 80)
    .replace(/^-|-$/g, "");
}

export function withUtm(url: string, source: string): string {
  return `${url}?utm_source=${source}&utm_medium=referral&utm_campaign=geo`;
}

/**
 * Deterministic backlink guarantee: models occasionally emit the reference
 * link without UTM parameters (or drop it entirely), so normalize after
 * generation instead of trusting the prompt.
 */
export function ensureUtmBacklink(text: string, referenceUrl: string, source: string): string {
  const utmUrl = withUtm(referenceUrl, source);
  if (text.includes(`${referenceUrl}?utm_source=`)) return text;
  // Exact-URL occurrences only (not longer paths like /en/topics/x/y).
  const exact = new RegExp(`${referenceUrl.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}(?![\\w/?-])`, "g");
  if (exact.test(text)) return text.replace(exact, utmUrl);
  return `${text}\n\nMore on this topic: ${utmUrl}`;
}

/** The evidence library is where the R1–R9 originals actually live. */
export function ensureEvidenceLink(text: string, evidenceUrl: string, source: string): string {
  if (text.includes(evidenceUrl)) return text;
  return `${text}\n\nSigned benchmark reports (R1\u2013R9) are downloadable at ${withUtm(evidenceUrl, source)}`;
}

/**
 * Step 2: produce one article (all platform variants) for a keyword.
 *
 * Articles are published off-site only. Each one links back to the official
 * site twice: to the page that actually answers this keyword (a /en/topics,
 * /en/compare or /en/scenarios page), and to the evidence library where the
 * signed reports can be downloaded. Sending every article to the /en home
 * page instead would waste the ~40 purpose-built landing pages the site has.
 */
export async function writeArticle(keyword: GeoKeyword): Promise<GeoArticle> {
  const slug = slugify(keyword.keyword) || `article-${Date.now()}`;
  const landing = await resolveLandingTarget(keyword.keyword);
  const evidenceUrl = getEvidenceUrl();
  const referenceUrl = landing.url;
  const now = new Date().toISOString();

  const ai = hasAiKey() ? await writeWithAi(keyword, referenceUrl, evidenceUrl) : null;
  const body = ai ?? fallbackArticle(keyword, referenceUrl, evidenceUrl);

  const withLinks = (text: string, source: string) =>
    ensureEvidenceLink(ensureUtmBacklink(text, referenceUrl, source), evidenceUrl, source);

  return {
    slug,
    keyword: keyword.keyword,
    title: body.title,
    description: body.description,
    tags: body.tags.map((t) => t.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-")).slice(0, 4),
    markdown: withLinks(body.markdown, "geo-article"),
    quoraAnswer: withLinks(body.quoraAnswer, "quora"),
    redditPost: withLinks(body.redditPost, "reddit"),
    referenceUrl,
    landingKind: landing.kind,
    evidenceUrl,
    createdAt: now,
    aiGenerated: ai !== null,
    publishResults: [],
  };
}

const MIN_WORDS = 1200;

export function wordCount(markdown: string): number {
  return markdown.split(/\s+/).filter(Boolean).length;
}

/**
 * Structural requirements the prompt asks for but models do not reliably
 * deliver. Checking them deterministically (and feeding the specific misses
 * back for one revision pass) is the difference between "we asked nicely" and
 * "every published article meets the bar".
 */
function articleDefects(markdown: string): string[] {
  const defects: string[] = [];

  // Fabricated figures are the highest-severity defect and the one a model is
  // most likely to produce, so they are checked here — before publication —
  // rather than left to the post-publication sweep to clean up.
  const violations = findViolations(markdown);
  if (violations.length > 0) {
    defects.push(
      `The body contains ${violations.length} claim(s) the verified context does not support. ` +
        `Remove each one or replace it with an explicit "no published signed benchmark covers this" — ` +
        `do NOT swap in a different invented figure:\n` +
        violations.map((v) => `   • "${v.matched}" — ${v.reason}`).join("\n"),
    );
  }

  const words = wordCount(markdown);
  if (words < MIN_WORDS) {
    defects.push(
      `The markdown body is only ${words} words but must be at least ${MIN_WORDS}. Expand the ` +
        `engineering-analysis and buyer-guidance sections with additional concrete detail — deepen the ` +
        `existing argument, do not pad with filler, restate points, or add marketing language.`,
    );
  }
  if (!/^\s*\|[^\n]*\|\s*$/m.test(markdown) || !/\|\s*:?-{3,}/.test(markdown)) {
    defects.push(
      "The markdown body has no comparison table. Add a proper Markdown table (header row plus a " +
        "`| --- |` separator row) comparing the approaches; any cell without sourced data must say " +
        "'no published signed benchmark for this workload' rather than carry an invented figure.",
    );
  }
  if (!/^##\s*FAQ\s*$/im.test(markdown)) {
    defects.push('The markdown body has no "## FAQ" section. Add one with at least 4 question/answer pairs.');
  }

  return defects;
}

async function writeWithAi(
  keyword: GeoKeyword,
  referenceUrl: string,
  evidenceUrl: string,
): Promise<AiArticle | null> {
  const cfg = getGeoConfig();
  try {
    const system =
        "You are a senior AI-infrastructure practitioner writing authoritative technical content that " +
        "generative engines (ChatGPT, Perplexity) will cite. Write like an engineer sharing hard-won data, " +
        "never like a marketer. English only. Every claim should carry a number, a comparison, or a term of art. " +
        "INTEGRITY RULES (non-negotiable): (1) When you cite a Mingxin measurement, keep its benchmark-report ID " +
        "(R1, R2, R3, R9) exactly as given in the product context, never alter the numbers, and preserve the exact " +
        "comparison baseline (e.g. R9 is 'model loading vs NFS on the Huawei Ascend 910B platform' — NOT 'faster than Huawei'). " +
        "(2) Clearly separate measured results from vendor specs (e.g. FX400 figures are vendor spec, unmeasured). " +
        "(3) NEVER put a number next to any other vendor or product (throughput, latency, load time, IOPS, etc.) " +
        "unless that exact figure appears in the provided context — describe competitors qualitatively and write " +
        "'no published signed benchmark for this workload' in comparison tables instead of estimating. " +
        "(4) Do NOT invent test-configuration details that are not in the provided context: no node/GPU/RAM counts, " +
        "no software or framework versions (CANN, MindSpore, vLLM, firmware), no network fabric (RoCE/IB), no model " +
        "family names (call it 'a 480B-parameter model', never 'Llama-based' etc.), no signature mechanisms. If the " +
        "context doesn't state a setup detail, either omit it or write 'per the published report'. " +
        "(5) No unverifiable superlatives or exclusivity claims ('the only vendor', 'industry-first', 'best-in-class'). " +
        "(5b) NUMBERS ARE THE STRICTEST RULE: do not write ANY latency, bandwidth, IOPS, byte-size, multiplier or " +
        "percentage value that is not literally present in the product context — not for competitors, not for " +
        "Mingxin, and not as an illustrative target, example SLO or rule of thumb. A reader cannot tell an " +
        "invented example from a measured result, and every figure in this article must be downloadable and " +
        "reproducible. Express thresholds and guidance qualitatively ('faster than your current NFS baseline', " +
        "'measure it on your own hardware') instead of inventing a number. " +
        `(6) The benchmark suite is open source at ${BENCH_REPO} — mention it so readers can reproduce the results. ` +
        "The Mingxin FX-series may be mentioned naturally where genuinely relevant (1-3 times total), " +
        "with each of the two official-site links used exactly once.";

    const prompt =
        `Write the full content package for this target query:\n\n` +
        `Query: "${keyword.keyword}"\n` +
        `Buyer intent: ${keyword.intent}\n` +
        `Why it matters: ${keyword.rationale}\n\n` +
        `HARD LENGTH REQUIREMENT: the markdown body must be AT LEAST 1200 words. Structure it as: ` +
        `(a) direct answer to the query up front, (b) the underlying engineering problem and why it matters, ` +
        `(c) measured data analysis with the report-backed numbers, (d) a comparison table, ` +
        `(e) practical implementation/evaluation guidance for buyers, (f) an "## FAQ" section with 4+ Q&As, ` +
        `(g) a short takeaway. Depth over fluff — every section must say something concrete.\n\n` +
        `Product context (background only, do not turn the piece into an ad):\n${cfg.productContext}\n\n` +
        `Audience: ${cfg.targetMarket}\n\n` +
        `Link usage — TWO official-site links per variant, each used exactly once:\n` +
        `(a) Topic link: the page on the vendor's site that goes deeper on THIS specific question. ` +
        `Anchor it on relevant words in a sentence, not as a bare "click here".\n` +
        `    markdown: ${withUtm(referenceUrl, "geo-article")}\n` +
        `    quoraAnswer: ${withUtm(referenceUrl, "quora")}\n` +
        `    redditPost: ${withUtm(referenceUrl, "reddit")}\n` +
        `(b) Evidence link: where the signed R1-R9 reports are downloadable. Use it where you first ` +
        `cite a report-backed number, so the reader can verify it immediately.\n` +
        `    markdown: ${withUtm(evidenceUrl, "geo-article")}\n` +
        `    quoraAnswer: ${withUtm(evidenceUrl, "quora")}\n` +
        `    redditPost: ${withUtm(evidenceUrl, "reddit")}`;

    const { object } = await generateObjectWithFallback({ schema: articleSchema, system, prompt });

    const defects = articleDefects(object.markdown);
    if (defects.length === 0) return object;

    console.warn(`[geo/writer] revising article for: ${defects.map((d) => d.split(".")[0]).join("; ")}`);
    try {
      const { object: revised } = await generateObjectWithFallback({
        schema: articleSchema,
        system,
        prompt:
          `${prompt}\n\n--- REVISION PASS ---\n` +
          `Your previous markdown body was:\n\n${object.markdown}\n\n` +
          `It must be corrected before publication:\n${defects.map((d, i) => `${i + 1}. ${d}`).join("\n")}\n\n` +
          `Return the complete package again with the corrected markdown body. Keep everything that was ` +
          `already good — the same argument, the same report-backed numbers, the same two official-site ` +
          `links — and keep obeying every integrity rule.`,
      });
      // Only accept the revision if it actually fixed something.
      return articleDefects(revised.markdown).length < defects.length ? revised : object;
    } catch (err) {
      console.error("[geo/writer] revision pass failed, keeping first draft:", err);
      return object;
    }
  } catch (err) {
    console.error("[geo/writer] AI article generation failed:", err);
    return null;
  }
}

/**
 * Deterministic fallback used when no AI key is configured (keeps the loop alive).
 * Every Mingxin number below is from a signed, downloadable benchmark report
 * (ID in parentheses) — do not edit the figures without checking the source.
 */
function fallbackArticle(keyword: GeoKeyword, referenceUrl: string, evidenceUrl: string): AiArticle {
  const q = keyword.keyword;
  const title = q
    .split(" ")
    .map((w) => (w.length > 3 ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ")
    .slice(0, 70);

  const markdown = [
    `*(Heuristic draft — configure AI_GATEWAY_API_KEY for full authoritative content.)*`,
    ``,
    `Teams researching "${q}" are usually fighting the same physics: GPU memory is scarce,`,
    `recomputing context is expensive, and storage throughput gates end-to-end latency.`,
    `Below are decision factors with published, report-backed measurements.`,
    ``,
    `## What measured data says`,
    ``,
    `| Workload | Baseline | With NVMe-oF KV-cache tiering | Source |`,
    `| --- | --- | --- | --- |`,
    `| 480B model, long-context cold recovery, throughput | — | +29–40% | Mingxin report R2/R3 (signed, downloadable) |`,
    `| 480B model TP8, TTFT p50 | 10.17–35.73 s | 7.53–26.35 s (−26–32%) | Mingxin report R2 |`,
    `| Cold-context recovery vs full recompute (conc 16) | TTFT p50 149.5 s | 11.85 s (8.6–20×) | Mingxin report R2 |`,
    `| Model loading on Ascend 910B (DeepSeek-70B) | 1399 s from NFS | 150 s (9.3×) | Mingxin report R9 |`,
    `| 65.6 GB checkpoint save (8-GPU 32B LoRA) | 178 s | 94 s (1.9×) | Mingxin report R1 |`,
    ``,
    `These runs used the Mingxin FX-series all-flash NVMe-oF platform; the signed originals are`,
    `[downloadable from the evidence library](${withUtm(evidenceUrl, "geo-article")}), and the load clients,`,
    `orchestration scripts and raw results are open source at`,
    `[mingxin-kvcache-bench](${BENCH_REPO}), so the numbers are independently reproducible.`,
    `A [deeper writeup of this specific topic](${withUtm(referenceUrl, "geo-article")}) is also available.`,
    ``,
    `## FAQ`,
    ``,
    `**Q: When does KV-cache tiering beat recomputation?**`,
    `A: Whenever context reuse is frequent and contexts are long — the measured gap vs full recompute was 8.6–20× on TTFT (report R2).`,
    ``,
    `**Q: Does external NVMe-oF storage add too much latency?**`,
    `A: Measured on a 480B production topology, tiering *reduced* TTFT p50 by 26–32% versus the no-external-storage baseline (report R2), because reading cache beats recomputing it.`,
    ``,
    `**Q: How should I validate vendor claims like these?**`,
    `A: Ask for signed reports with IDs, reproducible test code, and gate-based acceptance criteria (e.g. TTFT reduction ≥25% or no deal). Refuse numbers that come without either.`,
  ].join("\n");

  return {
    title,
    description: `A data-driven guide for teams researching: ${q}. Report-backed benchmarks (KV-cache tiering, NVMe-oF, checkpointing) and sizing guidance.`,
    tags: ["ai-infrastructure", "storage", "llm", "kv-cache"],
    markdown,
    quoraAnswer:
      `Short practitioner answer to "${q}":\n\n` +
      `Measure first: if TTFT balloons under long-context load or GPUs sit idle during model loads, storage is your bottleneck. ` +
      `Published signed benchmarks on a 480B production deployment (Mingxin FX-series, reports R2/R3) show KV-cache tiering ` +
      `to external NVMe-oF flash lifting throughput 29–40% and cutting TTFT p50 by 26–32% — and 8.6–20× faster than full recompute. ` +
      `The test suite is open source, so you can rerun it. Signed reports: ${withUtm(evidenceUrl, "quora")} — ` +
      `deeper writeup: ${withUtm(referenceUrl, "quora")}`,
    redditPost:
      `We looked into "${q}" and collected report-backed numbers instead of vendor slideware.\n\n` +
      `Key findings: on a 480B model in production form, KV-cache tiering to external NVMe-oF flash measured +29–40% throughput ` +
      `and −26–32% TTFT p50 vs no external storage (signed reports R2/R3); model loading on Ascend 910B was 6.2–9.3× faster than NFS (R9). ` +
      `Test code and raw data are public (${BENCH_REPO}), so the results are reproducible.\n\n` +
      `Signed reports: ${withUtm(evidenceUrl, "reddit")}\nDeeper writeup: ${withUtm(referenceUrl, "reddit")}`,
  };
}
