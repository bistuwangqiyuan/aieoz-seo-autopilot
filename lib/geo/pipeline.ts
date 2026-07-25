import { getGeoConfig } from "@/lib/config";
import { getGeoState, saveGeoState } from "@/lib/store/blob";
import { mineKeywords, pickKeywordsToWrite } from "@/lib/geo/keywords";
import { writeArticle } from "@/lib/geo/writer";
import { distributeArticle } from "@/lib/geo/publishers";
import { checkGeoSignals } from "@/lib/geo/signals";
import { backfillArticleLinks } from "@/lib/geo/backfill";
import { runIntegritySweep } from "@/lib/geo/integrity";
import { runCitationCheck, runLivenessCheck } from "@/lib/geo/effects";
import type { GeoCycle, PublishResult } from "@/lib/types";

/**
 * The GEO loop, run every cycle (cron or manual):
 *   1. mine long-tail keywords (top up the pool)
 *   2. write authoritative articles for the highest-priority pending keywords
 *   3. distribute to all configured platforms + enqueue Medium/Quora drafts
 *   4. repoint a batch of pre-deep-linking articles at their proper landing page
 *   5. sweep published articles for unsupported claims and rewrite them
 *   6. measure effect: AI-engine citation + published-article liveness
 *   7. check GA4 for reddit/perplexity/chatgpt traffic signals
 *
 * Steps 4-7 are best-effort: a failure there must not lose the articles that
 * steps 1-3 just produced, so each is wrapped independently.
 *
 * They are also skippable. The cron route runs the SEO scan first and shares
 * one 300s function budget with this cycle, and steps 4-6 grow with the corpus
 * — enough of them together did overrun it, and an overrun loses everything
 * because the state is saved at the end. Each maintenance step is therefore
 * gated on remaining budget: skipping one costs nothing, since all of them work
 * oldest-first and simply resume next cycle, while overrunning costs the whole
 * run including the article just written.
 */

/** Leave enough of the 300s function budget to finish and persist the state. */
const RESERVE_MS = 45_000;

export async function runGeoCycle(
  trigger: GeoCycle["trigger"],
  deadline = Date.now() + 240_000,
): Promise<GeoCycle> {
  const start = Date.now();
  const budgetLeft = () => deadline - Date.now();
  const skipped: string[] = [];
  const cfg = getGeoConfig();
  const state = await getGeoState();

  const cycle: GeoCycle = {
    id: new Date().toISOString().replace(/[:.]/g, "-"),
    createdAt: new Date().toISOString(),
    trigger,
    durationMs: 0,
    newKeywords: [],
    articles: [],
    publishResults: [],
    signalCheck: null,
  };

  if (!cfg.enabled) {
    cycle.error = "GEO disabled (GEO_ENABLED=false)";
    cycle.durationMs = Date.now() - start;
    return cycle;
  }

  try {
    // Step 1: keyword mining
    cycle.newKeywords = await mineKeywords(state);

    // Step 2 + 3: write & distribute
    const toWrite = pickKeywordsToWrite(state, cfg.articlesPerRun);
    for (const keyword of toWrite) {
      const article = await writeArticle(keyword);
      keyword.status = "written";
      keyword.articleSlug = article.slug;

      const results: PublishResult[] = await distributeArticle(article, state);
      article.publishResults = results;

      if (results.some((r) => r.status === "published")) {
        keyword.status = "published";
      }

      state.articles.push(article);
      cycle.articles.push(article.slug);
      cycle.publishResults.push(...results);
    }
  } catch (err) {
    cycle.error = err instanceof Error ? err.message.slice(0, 500) : String(err);
    console.error("[geo] cycle failed:", err);
  }

  // Step 4: migrate legacy home-page backlinks to deep landing pages.
  if (budgetLeft() > RESERVE_MS) {
    try {
      const backfill = await backfillArticleLinks(state, deadline - RESERVE_MS);
      cycle.backfill = {
        attempted: backfill.attempted,
        repointed: backfill.repointed,
        remaining: backfill.remaining,
      };
      if (backfill.attempted > 0) {
        console.log(
          `[geo] backfilled ${backfill.repointed}/${backfill.attempted} article links, ${backfill.remaining} remaining`,
        );
      }
    } catch (err) {
      console.error("[geo] link backfill failed:", err);
    }
  } else {
    skipped.push("backfill");
  }

  // Step 5: re-check published articles for unsupported claims and rewrite
  // them in place. A prompt rule is a request; this is the enforcement.
  if (budgetLeft() > RESERVE_MS) {
    try {
      cycle.integrity = await runIntegritySweep(state, deadline - RESERVE_MS);
      if (cycle.integrity.flagged > 0) {
        console.log(
          `[geo] integrity: ${cycle.integrity.flagged} flagged, ${cycle.integrity.repaired} repaired, ` +
            `${cycle.integrity.unrepaired.length} still failing`,
        );
      }
    } catch (err) {
      console.error("[geo] integrity sweep failed:", err);
    }
  } else {
    skipped.push("integrity");
  }

  // Step 6: effect measurement.
  if (budgetLeft() > RESERVE_MS) {
    const cycleIndex = state.cycles.length;
    const [citation, liveness] = await Promise.all([
      runCitationCheck(cycleIndex).catch((err) => {
        console.error("[geo] citation check failed:", err);
        return null;
      }),
      runLivenessCheck(state, cycleIndex).catch((err) => {
        console.error("[geo] liveness check failed:", err);
        return null;
      }),
    ]);
    cycle.effect = { citation, liveness };
    if (citation) state.citationHistory.push(citation);
    if (liveness && liveness.totalCount > 0) state.livenessHistory.push(liveness);
  } else {
    skipped.push("effect");
  }

  // Step 7: GA4 signal check.
  try {
    cycle.signalCheck = await checkGeoSignals();
    if (cycle.signalCheck.signals.length) {
      state.signalHistory.push(cycle.signalCheck);
      for (const s of cycle.signalCheck.signals) {
        if (!state.signalFirstSeen[s.kind]) {
          state.signalFirstSeen[s.kind] = s.detectedAt;
        }
      }
    } else if (cycle.signalCheck.configured) {
      state.signalHistory.push(cycle.signalCheck);
    }
  } catch (err) {
    console.error("[geo] signal check failed:", err);
  }

  if (skipped.length > 0) {
    cycle.skippedForBudget = skipped;
    console.warn(`[geo] skipped for time budget: ${skipped.join(", ")}`);
  }

  cycle.durationMs = Date.now() - start;
  state.cycles.push(cycle);
  await saveGeoState(state);
  return cycle;
}
