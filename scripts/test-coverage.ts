/**
 * Verifies the audit rotation against the live sitemap: core pages present
 * every run, no duplicates, batch size inside the function time budget, and a
 * full sweep of the site completing in a reasonable number of runs.
 *
 *   npx tsx --env-file=.env.local scripts/test-coverage.ts
 */
import { planAudit } from "../lib/seo/coverage";
import { getSiteMap } from "../lib/site/map";
import { auditTargets, collectGaps } from "../lib/seo/audit";
import { runCrossPageChecks } from "../lib/seo/cross-page";

const REQUIRED_CORE = ["/", "/en", "/en/products", "/en/evidence"];
/** Runs per day: GitHub Actions every 4h. */
const RUNS_PER_DAY = 6;

let failures = 0;
function check(name: string, pass: boolean, detail = "") {
  if (!pass) failures += 1;
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

async function main() {
  const map = await getSiteMap();
  console.log(`sitemap: ${map.pages.length} URLs`);
  const kinds = new Map<string, number>();
  for (const p of map.pages) kinds.set(p.kind, (kinds.get(p.kind) ?? 0) + 1);
  console.log(`by kind: ${[...kinds].map(([k, n]) => `${k}=${n}`).join(", ")}\n`);

  const plan = await planAudit();
  console.log(`plan: ${plan.urls.length} URLs this run, ${plan.totalUrls} total, degraded=${plan.degraded}\n`);

  check("sitemap discovery returned pages", map.pages.length > 50, `${map.pages.length} URLs`);
  check("plan is not degraded", !plan.degraded);

  const paths = plan.urls.map((u) => new URL(u).pathname.replace(/\/+$/, "") || "/");
  for (const core of REQUIRED_CORE) {
    check(`core page always audited: ${core}`, paths.includes(core));
  }

  check("no duplicate URLs in the plan", new Set(plan.urls).size === plan.urls.length);

  const sweepRuns = Math.ceil(plan.totalUrls / plan.urls.length);
  check(
    "full sweep completes within 7 days",
    sweepRuns / RUNS_PER_DAY <= 7,
    `${sweepRuns} runs ≈ ${(sweepRuns / RUNS_PER_DAY).toFixed(1)} days at ${RUNS_PER_DAY} runs/day`,
  );

  // The real constraint: one run must finish well inside Vercel's 300s cap,
  // and the crawl is only part of it (AI generation follows).
  console.log("\ncrawling the planned batch for real…");
  const start = Date.now();
  const { pages, site, score } = await auditTargets(plan.urls);
  const crawlMs = Date.now() - start;
  const okCount = pages.filter((p) => p.ok).length;

  console.log(`crawled ${pages.length} pages in ${(crawlMs / 1000).toFixed(1)}s, ${okCount} ok, avg score ${score}`);
  check("crawl budget leaves room for AI generation", crawlMs < 90_000, `${(crawlMs / 1000).toFixed(1)}s`);
  check("at least 90% of planned pages fetched", okCount / pages.length >= 0.9, `${okCount}/${pages.length}`);

  const failed = pages.filter((p) => !p.ok);
  for (const p of failed.slice(0, 8)) console.log(`   fetch failed: ${p.url} — ${p.error}`);

  const cross = await runCrossPageChecks(pages, plan.everAudited);
  console.log(
    `\ncross-page: canonical issues ${cross.canonicalIssues.length}, ` +
      `hreflang issues ${cross.hreflangIssues.length}, dead sampled URLs ${cross.deadSitemapUrls.length}`,
  );
  for (const c of cross.canonicalIssues.slice(0, 5)) console.log(`   canonical: ${c.url} -> ${c.canonical ?? "(缺失)"}`);
  for (const h of cross.hreflangIssues.slice(0, 5)) console.log(`   hreflang: ${h.url} — ${h.detail}`);
  for (const d of cross.deadSitemapUrls.slice(0, 5)) console.log(`   dead: ${d.url} HTTP ${d.status}`);

  check("cross-page checks ran against the sitemap", cross.sitemapUrls === map.pages.length);

  console.log(`\ngaps collected: ${collectGaps(pages).length}`);
  console.log(`site sitemap present: ${site.sitemapXml.present} (${site.sitemapXml.urlCount} urls)`);

  console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURES`}`);
  if (failures > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
