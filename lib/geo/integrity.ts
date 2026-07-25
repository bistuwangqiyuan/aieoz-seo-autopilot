import { z } from "zod";
import { generateObjectWithFallback } from "@/lib/ai/client";
import { getGeoConfig, hasAiKey } from "@/lib/config";
import { currentRulesVersion, findArticleViolations } from "@/lib/geo/rules";
import { editTelegraphPage } from "@/lib/geo/publishers/telegraph";
import { MIN_ARTICLE_WORDS, ensureEvidenceLink, ensureUtmBacklink, wordCount } from "@/lib/geo/writer";
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
  title: z
    .string()
    .describe("The article title, rewritten if it promises something the corrected body no longer supports"),
  markdown: z
    .string()
    .describe("The full corrected article body in Markdown, with every flagged claim removed or replaced"),
});

/** A corrected article, which may carry a corrected headline too. */
interface Repair {
  title: string;
  markdown: string;
}

/** Articles re-checked per cycle; each repair costs an AI call plus a platform edit. */
const SWEEP_BATCH = 4;
/**
 * Verifying costs nothing but CPU — only a *failing* article costs an AI call.
 * So when the rule set changes, scan far more widely than we could afford to
 * repair, to find out how big the backlog is in one pass instead of discovering
 * it one rotation slot at a time.
 */
const RESCAN_BATCH = 40;

/** Articles not yet cleared against the current rules, worst-first. */
export function staleForRules(state: GeoState, version: string): GeoArticle[] {
  return state.articles.filter((a) => a.integrityRulesVersion !== version);
}

export async function runIntegritySweep(
  state: GeoState,
  deadline = Number.POSITIVE_INFINITY,
): Promise<IntegritySweep> {
  const version = currentRulesVersion();
  const stale = staleForRules(state, version);

  // Articles never checked under the current rules come first; after that,
  // oldest-checked first so the corpus is revisited on a rotation rather than
  // the sweep fixating on the newest articles.
  const queue = [
    ...stale,
    ...state.articles
      .filter((a) => a.integrityRulesVersion === version)
      .sort((a, b) => (a.integrityCheckedAt ?? "").localeCompare(b.integrityCheckedAt ?? "")),
  ];
  const batch = queue.slice(0, stale.length > 0 ? RESCAN_BATCH : SWEEP_BATCH);

  const sweep: IntegritySweep = {
    checkedAt: new Date().toISOString(),
    checked: 0,
    flagged: 0,
    repaired: 0,
    unrepaired: [],
    rulesVersion: version,
    staleBefore: stale.length,
  };

  // Verify the whole batch first. Repairs are rate-limited by the time budget,
  // and a run that repairs two articles but knows about all twenty is far more
  // useful than one that reports only what it had time to touch.
  const dirty: { article: GeoArticle; violations: IntegrityViolation[] }[] = [];

  for (const article of batch) {
    sweep.checked += 1;
    const violations = findArticleViolations(article.title, article.markdown);
    article.integrityCheckedAt = sweep.checkedAt;

    if (violations.length === 0) {
      article.integrityFlags = [];
      // Cleared against this exact rule set — safe to skip until rules change.
      article.integrityRulesVersion = version;
      continue;
    }

    sweep.flagged += 1;
    article.integrityFlags = violations.map((v) => `${v.rule}: ${v.matched}`);
    dirty.push({ article, violations });
  }

  for (const { article, violations } of dirty) {
    // A repair costs an AI call plus a platform edit. Stop before starting one
    // we may not be able to finish and republish; an article left unstamped
    // stays at the front of the queue and is retried next cycle.
    if (Date.now() > deadline) {
      sweep.unrepaired.push({ slug: article.slug, violations });
      continue;
    }

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
      article.title = repaired.title;
      article.markdown = repaired.markdown;
      article.integrityFlags = [];
      article.integrityRulesVersion = version;
      sweep.repaired += 1;
    } catch (err) {
      console.error(`[geo/integrity] republish failed for ${article.slug}:`, err);
      sweep.unrepaired.push({ slug: article.slug, violations });
    }
  }

  return sweep;
}

export async function repairArticle(
  article: Pick<GeoArticle, "title" | "markdown">,
  violations: IntegrityViolation[],
): Promise<Repair | null> {
  if (!hasAiKey()) return null;
  const cfg = getGeoConfig();

  const system =
    "You are a technical fact-checker correcting a published article. You may only state facts present " +
    "in the verified product context supplied below. Remove or rewrite every flagged claim. Do not " +
    "substitute a different invented fact for the one you remove — if the claim cannot be supported, " +
    "delete it or replace it with an explicit statement that no published measurement covers it. " +
    "Never invent a replacement number: express thresholds and guidance qualitatively instead. " +
    "The title is part of the claim: if it promises a result the corrected body no longer delivers, " +
    "rewrite it to describe what the article actually establishes. " +
    "Preserve the article's structure, headings, comparison table, FAQ section, length, and all links.";
  const brief =
    `Verified product context (the ONLY facts you may assert):\n${cfg.productContext}\n\n` +
    `Flagged claims that must not remain:\n` +
    violations.map((v) => `- "${v.matched}" — ${v.reason}\n  context: …${v.excerpt}…`).join("\n") +
    `\n\nTitle to check: ${article.title}\n\nArticle to correct:\n\n${article.markdown}`;

  const attempt = async (prompt: string): Promise<Repair> => {
    const { object } = await generateObjectWithFallback({ schema: repairSchema, system, prompt });
    return { title: object.title.trim() || article.title, markdown: object.markdown.trim() };
  };

  let fixed = await attempt(brief);
  // A repair that reintroduces a violation, or guts the article, is not a repair.
  if (findArticleViolations(fixed.title, fixed.markdown).length > 0) return null;
  if (fixed.markdown.length < article.markdown.length * 0.6) return null;

  // An honest correction can legitimately end up shorter than the false version
  // it replaced. Try once to bring it back to the publication standard, but a
  // clean short article always beats leaving the false one live — so a failed
  // expansion must never turn into "no repair".
  if (wordCount(fixed.markdown) < MIN_ARTICLE_WORDS) {
    const expanded = await attempt(
      `${brief}\n\n--- LENGTH PASS ---\nYour corrected body came to ` +
        `${wordCount(fixed.markdown)} words; published articles must reach ${MIN_ARTICLE_WORDS}. ` +
        `Deepen the engineering analysis, the evaluation methodology a reader could run themselves, ` +
        `and the buyer guidance. Do NOT restore any flagged claim, invent figures, or pad with ` +
        `marketing language — if a section cannot be extended honestly, leave it as it is.`,
    ).catch(() => null);

    if (
      expanded &&
      wordCount(expanded.markdown) > wordCount(fixed.markdown) &&
      findArticleViolations(expanded.title, expanded.markdown).length === 0
    ) {
      fixed = expanded;
    }
  }

  return fixed;
}

/** Push the corrected text back to every platform that supports editing. */
async function republish(article: GeoArticle, repair: Repair, state: GeoState): Promise<void> {
  const telegraph = article.publishResults.find(
    (r) => r.platform === "telegraph" && r.status === "published" && r.url,
  );
  if (!telegraph?.url) return;
  if (!state.telegraphToken) {
    throw new Error("telegraph page needs correcting but no access token is stored");
  }

  const withLinks = ensureEvidenceLink(
    ensureUtmBacklink(repair.markdown, article.referenceUrl, "geo-article"),
    article.evidenceUrl ?? article.referenceUrl,
    "geo-article",
  );
  await editTelegraphPage(
    state.telegraphToken,
    telegraph.url,
    repair.title,
    withLinks,
    article.referenceUrl,
  );
}
