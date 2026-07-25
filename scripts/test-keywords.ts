/**
 * Two-part check on keyword mining:
 *   A. deterministic dedupe assertions (offline, no AI, no database)
 *   B. a live mining run against the real published pool, verifying the new
 *      keywords are novel and resolve to deep landing pages
 *
 *   npx tsx --env-file=.env.local scripts/test-keywords.ts
 */
import { isDuplicateOf, mineKeywords } from "../lib/geo/keywords";
import { resolveLandingTarget } from "../lib/site/landing";
import { emptyGeoState } from "../lib/store/blob";

const BASE = process.env.APP_URL || "https://aieoz-seo-autopilot.vercel.app";

/** [candidate, shouldBeRejected] against the pool below. */
const POOL = [
  "how to reduce time to first token with kv cache tiering",
  "offload llm kv cache to external nvme storage vs recompute",
  "storage bandwidth requirements for llm training checkpointing",
];

const DEDUPE_CASES: [string, boolean][] = [
  // Reworded copies of pool entries — must be rejected.
  ["kv cache tiering to reduce time to first token", true],
  ["reducing the time to first token using kv cache tiering", true],
  ["kv cache offload vs recompute", true],
  ["what storage bandwidth is required for llm training checkpointing", true],
  // Genuinely different queries — must be kept.
  ["best nvme-of vendor for huawei ascend 910b clusters", false],
  ["how to verify storage vendor benchmark claims before buying", false],
  ["lmcache cold read performance tuning for vllm", false],
];

function partA(): boolean {
  console.log("A. dedupe rules");
  let pass = true;
  for (const [candidate, shouldReject] of DEDUPE_CASES) {
    const rejected = isDuplicateOf(candidate, POOL);
    const good = rejected === shouldReject;
    if (!good) pass = false;
    console.log(
      `  ${good ? "PASS" : "FAIL"}  ${rejected ? "rejected" : "kept    "}  ${candidate}` +
        (good ? "" : `  (expected ${shouldReject ? "rejected" : "kept"})`),
    );
  }
  return pass;
}

async function loadPublishedKeywords(): Promise<string[]> {
  const secret = process.env.CRON_SECRET;
  const res = await fetch(`${BASE}/api/status`, {
    headers: secret ? { authorization: `Bearer ${secret}` } : {},
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`/api/status HTTP ${res.status}`);
  const data = (await res.json()) as { geo?: { keywordList?: string[] } };
  return data.geo?.keywordList ?? [];
}

async function partB(): Promise<boolean> {
  console.log("\nB. live mining against the published pool");

  let published: string[] = [];
  try {
    published = await loadPublishedKeywords();
  } catch (err) {
    console.log(`  SKIP  could not load the published pool: ${err}`);
    return true;
  }
  if (published.length === 0) {
    console.log("  SKIP  published pool is empty (deploy /api/status keywordList first)");
    return true;
  }

  const state = emptyGeoState();
  const now = new Date().toISOString();
  for (const keyword of published) {
    state.keywords.push({
      keyword,
      intent: "unknown",
      rationale: "",
      priority: 3,
      status: "published",
      createdAt: now,
    });
  }
  console.log(`  pool: ${published.length} published keywords`);

  const added = await mineKeywords(state);
  console.log(`  mined: ${added.length} new`);
  if (added.length === 0) {
    console.log("  FAIL  mining produced nothing");
    return false;
  }

  let pass = true;
  let deep = 0;
  for (const keyword of added) {
    const dup = isDuplicateOf(keyword, published);
    const target = await resolveLandingTarget(keyword);
    if (target.path !== "/en") deep += 1;
    if (dup) pass = false;
    console.log(
      `  ${dup ? "FAIL (dup)" : "ok        "}  ${keyword}\n                -> ${target.path} (${target.kind}, ${target.method})`,
    );
  }

  const deepRatio = deep / added.length;
  console.log(`  deep-linkable: ${deep}/${added.length}`);
  if (deepRatio < 0.8) {
    console.log("  FAIL  fewer than 80% of new keywords map to a deep landing page");
    pass = false;
  }
  return pass;
}

async function main() {
  const a = partA();
  const b = await partB();
  console.log(`\n${a && b ? "ALL PASS" : "FAILURES PRESENT"}`);
  if (!(a && b)) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
