// One-shot: operational report — cycle timeline by trigger, score trend, articles.
import { loadEnv, fetchStatus } from "./_env.mjs";

const d = await fetchStatus(loadEnv().CRON_SECRET);

console.log("storage:", d.storage, "| aiChain:", d.aiChain);
console.log("latest scan:", d.scan.id, "score:", d.scan.score, "ai:", d.scan.aiGenerated, "model:", d.scan.model);
console.log("historyPoints:", d.historyPoints, "| geo cycles:", d.geo.cycles, "| articles:", d.geo.articles);
console.log("keywords:", JSON.stringify(d.geo.keywords));
console.log("lastCycle:", JSON.stringify(d.geo.lastCycle)?.slice(0, 300));
console.log("\npublished articles:");
for (const a of d.geo.publishedArticles) {
  console.log(" -", a.slug.slice(0, 70), "| anchors:", a.hasReportAnchors, "| utm:", a.hasUtmBacklink);
}
