import { getGeoConfig } from "@/lib/config";
import { getGeoState, saveGeoState } from "@/lib/store/blob";
import { mineKeywords, pickKeywordsToWrite } from "@/lib/geo/keywords";
import { writeArticle } from "@/lib/geo/writer";
import { distributeArticle } from "@/lib/geo/publishers";
import { checkGeoSignals } from "@/lib/geo/signals";
import type { GeoCycle, PublishResult } from "@/lib/types";

/**
 * The full 4-step GEO loop, run every cycle (cron or manual):
 *   1. mine long-tail keywords (top up the pool)
 *   2. write authoritative articles for the highest-priority pending keywords
 *   3. distribute to all configured platforms + enqueue Medium/Quora drafts
 *   4. check GA4 for reddit/perplexity/chatgpt traffic signals
 */
export async function runGeoCycle(trigger: GeoCycle["trigger"]): Promise<GeoCycle> {
  const start = Date.now();
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

    // Step 4: GA4 signal check
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
    cycle.error = err instanceof Error ? err.message.slice(0, 500) : String(err);
    console.error("[geo] cycle failed:", err);
  }

  cycle.durationMs = Date.now() - start;
  state.cycles.push(cycle);
  await saveGeoState(state);
  return cycle;
}
