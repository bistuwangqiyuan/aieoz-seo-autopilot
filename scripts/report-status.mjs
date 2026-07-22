// One-shot: operational report — cycle timeline by trigger, score trend, articles.
import { readFileSync } from "node:fs";

const env = {};
for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)="?([^"\r]*)"?\s*$/);
  if (m) env[m[1]] = m[2];
}
const d = await (
  await fetch("https://www.clawpro.pw/api/status", {
    headers: { Authorization: `Bearer ${env.CRON_SECRET}` },
  })
).json();

console.log("storage:", d.storage, "| aiChain:", d.aiChain);
console.log("latest scan:", d.scan.id, "score:", d.scan.score, "ai:", d.scan.aiGenerated, "model:", d.scan.model);
console.log("historyPoints:", d.historyPoints, "| geo cycles:", d.geo.cycles, "| articles:", d.geo.articles);
console.log("keywords:", JSON.stringify(d.geo.keywords));
console.log("lastCycle:", JSON.stringify(d.geo.lastCycle)?.slice(0, 300));
console.log("\npublished articles:");
for (const a of d.geo.publishedArticles) {
  console.log(" -", a.slug.slice(0, 70), "| anchors:", a.hasReportAnchors, "| utm:", a.hasUtmBacklink);
}
