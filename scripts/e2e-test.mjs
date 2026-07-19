/**
 * End-to-end functional test battery against the PRODUCTION deployment,
 * exercising every feature with real data:
 *
 *   T1  dashboard renders with live data
 *   T2  cron endpoint rejects unauthenticated calls
 *   T3  status endpoint rejects unauthenticated calls
 *   T4  cron endpoint runs a full SEO+GEO cycle (authenticated)
 *   T5  manual SEO scan endpoint
 *   T6  manual GEO cycle endpoint (real article written & published)
 *   T7  Postgres persistence: history/cycles actually grow across runs
 *   T8  published article is live on the platform & factually anchored
 *       (backlink with UTM, report IDs / bench repo in the markdown)
 *   T9  audit correctness: all target pages fetched, sitemap/robots checked,
 *       fix recommendations (metadata snippet + actions) produced
 *   T10 GA4 signal check degrades gracefully when unconfigured
 *   T11 dashboard reflects the new state
 *
 * Reads CRON_SECRET from .env.local (gitignored).
 * Usage: node scripts/e2e-test.mjs [--skip-writes]
 */
import { readFileSync } from "node:fs";

const BASE = "https://www.clawpro.pw";
const SKIP_WRITES = process.argv.includes("--skip-writes");

const env = {};
for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)="?([^"\r]*)"?\s*$/);
  if (m) env[m[1]] = m[2];
}
const CRON_SECRET = env.CRON_SECRET || "";
if (!CRON_SECRET) {
  console.error("CRON_SECRET missing in .env.local");
  process.exit(2);
}
const AUTH = { Authorization: `Bearer ${CRON_SECRET}` };

const results = [];
function record(id, name, pass, detail) {
  results.push({ id, name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${id}  ${name}${detail ? `  -- ${detail}` : ""}`);
}

async function jfetch(url, opts = {}, timeoutMs = 300000) {
  const res = await fetch(url, { ...opts, signal: AbortSignal.timeout(timeoutMs) });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: res.status, body };
}

// ---------- T1 dashboard ----------
try {
  const { status, body } = await jfetch(`${BASE}/`, {}, 60000);
  const html = String(body);
  const ok = status === 200 && html.includes("铭信") && html.includes("Neon Postgres") && html.includes("备用");
  record("T1", "dashboard renders with live data", ok, `HTTP ${status}`);
} catch (e) {
  record("T1", "dashboard renders with live data", false, String(e).slice(0, 150));
}

// ---------- T2/T3 auth ----------
for (const [id, path] of [["T2", "/api/cron/scan"], ["T3", "/api/status"]]) {
  try {
    const { status } = await jfetch(`${BASE}${path}`, {}, 30000);
    record(id, `${path} rejects unauthenticated calls`, status === 401, `HTTP ${status}`);
  } catch (e) {
    record(id, `${path} rejects unauthenticated calls`, false, String(e).slice(0, 150));
  }
}

// ---------- baseline via /api/status ----------
let baseline = null;
try {
  const { status, body } = await jfetch(`${BASE}/api/status`, { headers: AUTH }, 60000);
  if (status !== 200 || !body.ok) throw new Error(`HTTP ${status}`);
  baseline = body;
  console.log(
    `(baseline: storage=${body.storage}, history=${body.historyPoints}, geoCycles=${body.geo.cycles}, articles=${body.geo.articles})`,
  );
} catch (e) {
  console.log(`(baseline read failed: ${String(e).slice(0, 150)})`);
}

// ---------- T4 authenticated cron full cycle ----------
if (!SKIP_WRITES) {
  try {
    const { status, body } = await jfetch(`${BASE}/api/cron/scan`, { headers: AUTH });
    const ok =
      status === 200 &&
      body.ok === true &&
      body.scan?.aiGenerated === true &&
      typeof body.scan?.score === "number" &&
      !body.geo?.error;
    record(
      "T4",
      "cron runs full SEO+GEO cycle",
      ok,
      `HTTP ${status}, score=${body.scan?.score}, ai=${body.scan?.aiGenerated}, geoArticles=${body.geo?.articles?.length}, published=${body.geo?.published}`,
    );
  } catch (e) {
    record("T4", "cron runs full SEO+GEO cycle", false, String(e).slice(0, 200));
  }
} else {
  record("T4", "cron runs full SEO+GEO cycle", true, "skipped (--skip-writes)");
}

// ---------- T5 manual scan ----------
if (!SKIP_WRITES) {
  try {
    const { status, body } = await jfetch(`${BASE}/api/scan`, { method: "POST" });
    const ok = status === 200 && body.ok === true && body.aiGenerated === true;
    record("T5", "manual SEO scan endpoint", ok, `HTTP ${status}, score=${body.score}, ai=${body.aiGenerated}`);
  } catch (e) {
    record("T5", "manual SEO scan endpoint", false, String(e).slice(0, 200));
  }
} else {
  record("T5", "manual SEO scan endpoint", true, "skipped (--skip-writes)");
}

// ---------- T6 manual GEO cycle ----------
if (!SKIP_WRITES) {
  try {
    const { status, body } = await jfetch(`${BASE}/api/geo`, { method: "POST" });
    const published = (body.publishResults ?? []).filter((r) => r.status === "published");
    const ok = status === 200 && body.ok === true && published.length > 0;
    record(
      "T6",
      "manual GEO cycle publishes real article",
      ok,
      `HTTP ${status}, articles=${JSON.stringify(body.articles)}, published=${published.map((p) => p.platform).join("/")}`,
    );
  } catch (e) {
    record("T6", "manual GEO cycle publishes real article", false, String(e).slice(0, 200));
  }
} else {
  record("T6", "manual GEO cycle publishes real article", true, "skipped (--skip-writes)");
}

// ---------- final status snapshot ----------
let final = null;
try {
  const { status, body } = await jfetch(`${BASE}/api/status`, { headers: AUTH }, 60000);
  if (status !== 200 || !body.ok) throw new Error(`HTTP ${status}`);
  final = body;
} catch (e) {
  console.log(`(final status read failed: ${String(e).slice(0, 150)})`);
}

// ---------- T7 persistence grew ----------
try {
  if (!baseline || !final) throw new Error("status snapshots unavailable");
  const grew = SKIP_WRITES
    ? final.historyPoints >= baseline.historyPoints
    : final.historyPoints >= baseline.historyPoints + 2 && final.geo.cycles >= baseline.geo.cycles + 2;
  const ok = grew && final.storage === "postgres";
  record(
    "T7",
    "Postgres persistence stores & grows",
    ok,
    `storage=${final.storage}, history ${baseline.historyPoints}->${final.historyPoints}, geoCycles ${baseline.geo.cycles}->${final.geo.cycles}`,
  );
} catch (e) {
  record("T7", "Postgres persistence stores & grows", false, String(e).slice(0, 200));
}

// ---------- T8 published article live & factually anchored ----------
try {
  const arts = final?.geo?.publishedArticles ?? [];
  const candidates = arts.filter((a) => a.published.some((p) => p.url)).reverse();
  if (!candidates.length) throw new Error("no published article with URL");
  const a = candidates[0];
  const url = a.published.find((p) => p.url).url;
  const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
  const html = await res.text();
  const live = res.status === 200 && html.includes("mingxinstorage.xyz");
  const ok = live && a.hasReportAnchors && a.hasUtmBacklink;
  record(
    "T8",
    "published article live & factually anchored",
    ok,
    `HTTP ${res.status} ${url} backlink=${live} reportAnchors=${a.hasReportAnchors} utm=${a.hasUtmBacklink}`,
  );
} catch (e) {
  record("T8", "published article live & factually anchored", false, String(e).slice(0, 200));
}

// ---------- T9 audit correctness ----------
try {
  const s = final?.scan;
  if (!s) throw new Error("no scan in status");
  const allFetched = s.pages.length >= 6 && s.pages.every((p) => p.ok);
  const ok = allFetched && typeof s.sitemapOk === "boolean" && s.hasMetadataSnippet && s.actions > 0;
  record(
    "T9",
    "audit fetches all targets + sitemap/robots + fix recs",
    ok,
    `pages=${s.pages.length} allOk=${allFetched} sitemapOk=${s.sitemapOk} robotsOk=${s.robotsOk} actions=${s.actions} model=${s.model}`,
  );
} catch (e) {
  record("T9", "audit fetches all targets + sitemap/robots + fix recs", false, String(e).slice(0, 200));
}

// ---------- T10 GA4 graceful degradation ----------
try {
  const sc = final?.geo?.lastCycle?.signalCheck;
  const ok = sc ? sc.configured === false : false;
  record("T10", "GA4 unconfigured degrades gracefully", ok, JSON.stringify(sc)?.slice(0, 120));
} catch (e) {
  record("T10", "GA4 unconfigured degrades gracefully", false, String(e).slice(0, 200));
}

// ---------- T11 dashboard reflects new state ----------
try {
  const { status, body } = await jfetch(`${BASE}/`, {}, 60000);
  const html = String(body);
  const scoreShown = final?.scan ? html.includes(String(final.scan.score)) : false;
  const articleCountShown = final ? html.includes(`${final.geo.articles}`) : false;
  const ok = status === 200 && scoreShown && articleCountShown;
  record("T11", "dashboard reflects updated state", ok, `HTTP ${status}, score=${final?.scan?.score}, articles=${final?.geo?.articles}`);
} catch (e) {
  record("T11", "dashboard reflects updated state", false, String(e).slice(0, 200));
}

// ---------- summary ----------
const failed = results.filter((r) => !r.pass);
console.log(`\n==== ${results.length - failed.length}/${results.length} PASSED ====`);
if (failed.length) {
  console.log("FAILURES:");
  for (const f of failed) console.log(`  ${f.id} ${f.name}: ${f.detail}`);
  process.exit(1);
}
