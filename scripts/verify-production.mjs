// Acceptance check against the live deployment. Each assertion maps to one of
// the criteria in the rollout plan, so a green run means the plan's phases are
// verifiably done rather than merely deployed.
import { readFileSync } from "node:fs";

const env = {};
for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)="?([^"\r]*)"?\s*$/);
  if (m) env[m[1]] = m[2];
}

const BASE = process.env.APP_URL ?? "https://www.clawpro.pw";
const res = await fetch(`${BASE}/api/status`, {
  headers: { Authorization: `Bearer ${env.CRON_SECRET}` },
});
if (!res.ok) {
  console.error(`status endpoint HTTP ${res.status}`);
  process.exit(1);
}
const d = await res.json();

const checks = [];
const check = (phase, label, ok, note = "") => checks.push({ phase, label, ok, note });

// Phase 1 — scheduling restored.
check(1, "history is accumulating", d.historyPoints > 0, `${d.historyPoints} points`);
check(1, "persistent storage (not in-memory)", d.storage !== "memory", d.storage);

// Phase 2 — backlinks land on the page that answers the keyword. Backfill runs
// oldest-first, so corpus-wide counters are the honest measure here; the
// newest-10 view would read 0% until the migration was almost finished.
const arts = d.geo.publishedArticles;
const links = d.geo.backlinks;
check(2, "backfill migration complete", links.pendingBackfill === 0,
  `${links.pendingBackfill} of ${links.total} still queued`);
check(2, "corpus deep-linked", links.deepLinked === links.total,
  `${links.deepLinked}/${links.total}`);
check(2, "backfill ran this cycle", Boolean(links.lastRun), JSON.stringify(links.lastRun));
check(2, "new articles deep-linked", arts.at(-1)?.deepLinked === true, arts.at(-1)?.landingUrl);
check(2, "backlinks carry UTM", arts.every((a) => a.hasUtmBacklink));
check(2, "articles cite report anchors", arts.every((a) => a.hasReportAnchors));

// Phase 3 — effect is measured, with its limits stated.
check(3, "citation probe has run", Boolean(d.effect.citation),
  d.effect.citation ? `memory ${d.effect.citation.memoryRate}` : "no data yet");
check(3, "liveness probe has run", Boolean(d.effect.liveness),
  d.effect.liveness ? `${d.effect.liveness.liveCount}/${d.effect.liveness.totalCount} live` : "no data yet");
check(3, "each metric ships its caveat",
  Boolean(d.effect.citation?.caveat && d.effect.liveness?.caveat && d.effect.indexNow.reason));

// Phase 4 — audit coverage sweeps the whole site.
const cov = d.coverage;
check(4, "sitemap discovered", Boolean(cov) && cov.sitemapUrls > 100, `${cov?.sitemapUrls} urls`);
check(4, "coverage is being recorded", Boolean(cov) && cov.everAudited > 0,
  `${cov?.everAudited}/${cov?.sitemapUrls} ever audited (${cov?.percent}%)`);
check(4, "rotation reaches full sweep in 7 days",
  Boolean(cov) && cov.sitemapUrls <= 7 * 6 * (d.scan.auditedThisRun ?? 0),
  `${d.scan.auditedThisRun}/run x 6 runs/day`);
check(4, "cross-page checks ran", cov !== null,
  cov ? `standing: canonical ${cov.canonicalIssues}, hreflang ${cov.hreflangIssues}` +
    ` (this run: ${cov.canonicalIssuesThisRun}/${cov.hreflangIssuesThisRun}), dead ${cov.deadSitemapUrls}` : "");

// Phase 5 — Dev.to. Without the key the publisher must skip cleanly, never fail.
const devtoResults = arts.flatMap((a) => a.published.filter((p) => p.platform === "devto"));
check(5, "dev.to publishing (needs DEVTO_API_KEY)", devtoResults.length > 0,
  devtoResults.length ? `${devtoResults.length} published` : "key not configured - publisher skips");

// Phase 6 — integrity enforced by the cron loop, not by hand.
check(6, "integrity sweep has run", Boolean(d.effect.integrity.lastSweep),
  d.effect.integrity.lastSweep ? JSON.stringify(d.effect.integrity.lastSweep) : "no sweep yet");
check(6, "no article left flagged", d.effect.integrity.articlesFlagged === 0,
  `${d.effect.integrity.articlesFlagged} flagged of ${d.effect.integrity.articlesChecked} checked`);
// A rule added but never applied to the existing corpus protects nothing.
check(6, "whole corpus cleared against current rules", d.effect.integrity.staleForRules === 0,
  `${d.effect.integrity.staleForRules} awaiting recheck under rules ${d.effect.integrity.rulesVersion}`);

let failed = 0;
let phase = 0;
for (const c of checks) {
  if (c.phase !== phase) {
    phase = c.phase;
    console.log(`\n-- phase ${phase} --`);
  }
  if (!c.ok) failed += 1;
  console.log(`${c.ok ? "PASS" : "FAIL"}  ${c.label}${c.note ? `  [${c.note}]` : ""}`);
}
console.log(`\n${checks.length - failed}/${checks.length} passed`);
process.exitCode = failed ? 1 : 0;
