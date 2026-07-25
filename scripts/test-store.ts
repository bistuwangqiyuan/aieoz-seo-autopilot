/**
 * sanitizeGeoState rebuilds every article field by field, which makes it safe
 * against corrupt records and quietly lossy against new ones: a field added to
 * GeoArticle but not to the sanitizer is dropped on the next read. That failure
 * is invisible in tests that write and read in one process, and in production
 * it cost us both migrations — backfill and the integrity sweep each recorded
 * their progress, lost the marker, and reprocessed the same articles forever.
 *
 * So this asserts the property rather than any single field: everything that
 * goes in must come back out.
 *
 *   npx tsx scripts/test-store.ts
 */
import { sanitizeGeoState } from "../lib/store/blob";
import type { GeoArticle, GeoKeyword, GeoState } from "../lib/types";

const article: Required<GeoArticle> = {
  slug: "example-article",
  keyword: "example keyword",
  title: "Example",
  description: "Example description",
  tags: ["storage", "llm"],
  markdown: "# Body",
  quoraAnswer: "answer",
  redditPost: "post",
  referenceUrl: "https://mingxinstorage.xyz/en/topics/ttft-optimization",
  landingKind: "topic",
  evidenceUrl: "https://mingxinstorage.xyz/en/evidence",
  createdAt: "2026-07-01T00:00:00.000Z",
  aiGenerated: true,
  publishResults: [{ platform: "telegraph", status: "published", url: "https://telegra.ph/x" }],
  linkBackfilledAt: "2026-07-20T00:00:00.000Z",
  integrityCheckedAt: "2026-07-21T00:00:00.000Z",
  integrityFlags: ["unsourced-metric: 14.2 GB/s"],
  integrityRulesVersion: "deadbeef",
};

const keyword: Required<GeoKeyword> = {
  keyword: "example keyword",
  intent: "comparison",
  rationale: "why",
  priority: 1,
  status: "published",
  createdAt: "2026-07-01T00:00:00.000Z",
  articleSlug: "example-article",
};

const state: Partial<GeoState> = {
  articles: [article],
  keywords: [keyword],
  telegraphToken: "token",
  citationHistory: [],
  livenessHistory: [],
  cycles: [],
  signalHistory: [],
  draftQueue: [],
  signalFirstSeen: {},
};

// Round-trip through JSON as well: production stores this as JSONB, so a value
// that survives in-process but not serialization would still be lost.
const restored = sanitizeGeoState(JSON.parse(JSON.stringify(state)));

let failures = 0;
const compare = (label: string, original: object, result: object | undefined) => {
  console.log(`${label}:`);
  for (const [key, want] of Object.entries(original)) {
    const got = (result as Record<string, unknown> | undefined)?.[key];
    const ok = JSON.stringify(got) === JSON.stringify(want);
    if (!ok) failures += 1;
    console.log(
      `  ${ok ? "PASS" : "FAIL"}  ${key}` + (ok ? "" : `  (want ${JSON.stringify(want)}, got ${JSON.stringify(got)})`),
    );
  }
};

compare("article fields survive a save/load round-trip", article, restored.articles[0]);
compare("keyword fields survive a save/load round-trip", keyword, restored.keywords[0]);

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FIELD(S) DROPPED`}`);
if (failures > 0) process.exitCode = 1;
