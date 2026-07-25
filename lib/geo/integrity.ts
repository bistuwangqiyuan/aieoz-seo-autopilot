import { z } from "zod";
import { generateObjectWithFallback } from "@/lib/ai/client";
import { getGeoConfig, hasAiKey } from "@/lib/config";
import { findViolations } from "@/lib/geo/rules";
import { editTelegraphPage } from "@/lib/geo/publishers/telegraph";
import { ensureEvidenceLink, ensureUtmBacklink } from "@/lib/geo/writer";
import type { GeoArticle, GeoState, IntegritySweep, IntegrityViolation } from "@/lib/types";

/**
 * Automatic integrity enforcement on already-published articles.
 *
 * New articles are gated before publication by the same rules (see
 * articleDefects in lib/geo/writer.ts). This sweep covers the corpus that was
 * published before that gate existed, and catches anything the gate let
 * through. Articles that cannot be repaired are surfaced rather than left
 * standing.
 */

const repairSchema = z.object({
  markdown: z
    .string()
    .describe("The full corrected article body in Markdown, with every flagged claim removed or replaced"),
});

/** Articles re-checked per cycle; each repair costs an AI call plus a platform edit. */
const SWEEP_BATCH = 4;

export async function runIntegritySweep(state: GeoState): Promise<IntegritySweep> {
  // Oldest-checked first, so the whole corpus is revisited on a rotation
  // rather than the sweep fixating on the newest articles.
  const queue = [...state.articles].sort((a, b) =>
    (a.integrityCheckedAt ?? "").localeCompare(b.integrityCheckedAt ?? ""),
  );
  const batch = queue.slice(0, SWEEP_BATCH);

  const sweep: IntegritySweep = {
    checkedAt: new Date().toISOString(),
    checked: batch.length,
    flagged: 0,
    repaired: 0,
    unrepaired: [],
  };

  for (const article of batch) {
    const violations = findViolations(article.markdown);
    article.integrityCheckedAt = sweep.checkedAt;

    if (violations.length === 0) {
      article.integrityFlags = [];
      continue;
    }

    sweep.flagged += 1;
    article.integrityFlags = violations.map((v) => `${v.rule}: ${v.matched}`);

    const repaired = await repairArticle(article, violations).catch((err) => {
      console.error(`[geo/integrity] repair failed for ${article.slug}:`, err);
      return null;
    });

    if (!repaired) {
      sweep.unrepaired.push({ slug: article.slug, violations });
      continue;
    }

    try {
      await republish(article, repaired, state);
      article.markdown = repaired;
      article.integrityFlags = [];
      sweep.repaired += 1;
    } catch (err) {
      console.error(`[geo/integrity] republish failed for ${article.slug}:`, err);
      sweep.unrepaired.push({ slug: article.slug, violations });
    }
  }

  return sweep;
}

export async function repairArticle(
  article: Pick<GeoArticle, "markdown">,
  violations: IntegrityViolation[],
): Promise<string | null> {
  if (!hasAiKey()) return null;
  const cfg = getGeoConfig();

  const { object } = await generateObjectWithFallback({
    schema: repairSchema,
    system:
      "You are a technical fact-checker correcting a published article. You may only state facts present " +
      "in the verified product context supplied below. Remove or rewrite every flagged claim. Do not " +
      "substitute a different invented fact for the one you remove — if the claim cannot be supported, " +
      "delete it or replace it with an explicit statement that no published measurement covers it. " +
      "Never invent a replacement number: express thresholds and guidance qualitatively instead. " +
      "Preserve the article's structure, headings, comparison table, FAQ section, length, and all links.",
    prompt:
      `Verified product context (the ONLY facts you may assert):\n${cfg.productContext}\n\n` +
      `Flagged claims that must not remain:\n` +
      violations.map((v) => `- "${v.matched}" — ${v.reason}\n  context: …${v.excerpt}…`).join("\n") +
      `\n\nArticle to correct:\n\n${article.markdown}`,
  });

  const fixed = object.markdown.trim();
  // A repair that reintroduces a violation, or guts the article, is not a repair.
  if (findViolations(fixed).length > 0) return null;
  if (fixed.length < article.markdown.length * 0.6) return null;
  return fixed;
}

/** Push the corrected text back to every platform that supports editing. */
async function republish(article: GeoArticle, markdown: string, state: GeoState): Promise<void> {
  const telegraph = article.publishResults.find(
    (r) => r.platform === "telegraph" && r.status === "published" && r.url,
  );
  if (!telegraph?.url) return;
  if (!state.telegraphToken) {
    throw new Error("telegraph page needs correcting but no access token is stored");
  }

  const withLinks = ensureEvidenceLink(
    ensureUtmBacklink(markdown, article.referenceUrl, "geo-article"),
    article.evidenceUrl ?? article.referenceUrl,
    "geo-article",
  );
  await editTelegraphPage(
    state.telegraphToken,
    telegraph.url,
    article.title,
    withLinks,
    article.referenceUrl,
  );
}
