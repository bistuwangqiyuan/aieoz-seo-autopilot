/**
 * Writes one real article end-to-end (no publishing, no state writes) and
 * checks the properties the pipeline depends on: deep backlink, evidence
 * link, UTM tagging, length, report anchoring.
 *
 *   npx tsx --env-file=.env.local scripts/test-article.ts "<keyword>"
 */
import { writeArticle } from "../lib/geo/writer";
import { getEvidenceUrl, getHomeUrl } from "../lib/site/landing";
import { findViolations } from "../lib/geo/rules";

const keyword = process.argv[2] || "how does mooncake handle kv cache transfer";

async function main() {
  const article = await writeArticle({
    keyword,
    intent: "comparison",
    rationale: "acceptance test",
    priority: 1,
    status: "pending",
    createdAt: new Date().toISOString(),
  });

  const words = article.markdown.split(/\s+/).filter(Boolean).length;
  const evidence = getEvidenceUrl();
  // The gate that matters most: an article can satisfy every structural check
  // and still be substantially fabricated.
  const violations = findViolations(article.markdown);
  const checks: [string, boolean, string][] = [
    [
      "no unsupported claims",
      violations.length === 0,
      violations.length === 0 ? "clean" : `${violations.length} violations`,
    ],
    ["ai-generated", article.aiGenerated, String(article.aiGenerated)],
    ["deep landing (not /en home)", article.referenceUrl !== getHomeUrl(), article.referenceUrl],
    ["landingKind recorded", Boolean(article.landingKind), String(article.landingKind)],
    ["markdown has landing backlink", article.markdown.includes(article.referenceUrl), ""],
    ["markdown has evidence link", article.markdown.includes(evidence), ""],
    ["markdown backlink has UTM", article.markdown.includes(`${article.referenceUrl}?utm_source=`), ""],
    ["quora has landing + evidence", article.quoraAnswer.includes(article.referenceUrl) && article.quoraAnswer.includes(evidence), ""],
    ["reddit has landing + evidence", article.redditPost.includes(article.referenceUrl) && article.redditPost.includes(evidence), ""],
    ["markdown >= 1200 words", words >= 1200, `${words} words`],
    ["cites report IDs", /\bR[1-9]\b/.test(article.markdown), ""],
    ["mentions bench repo", article.markdown.includes("mingxin-kvcache-bench"), ""],
    ["has FAQ section", /##\s*FAQ/i.test(article.markdown), ""],
    [
      "has comparison table",
      /^\s*\|[^\n]*\|\s*$/m.test(article.markdown) && /\|\s*:?-{3,}/.test(article.markdown),
      "",
    ],
  ];

  if (process.env.DUMP === "1") {
    console.log("\n----- markdown -----\n");
    console.log(article.markdown);
    console.log("\n----- end -----\n");
  }

  console.log(`keyword : ${keyword}`);
  console.log(`title   : ${article.title}`);
  console.log(`landing : ${article.referenceUrl} (${article.landingKind})`);
  console.log(`evidence: ${article.evidenceUrl}`);
  console.log("");

  let failed = 0;
  for (const [label, ok, note] of checks) {
    if (!ok) failed += 1;
    console.log(`${ok ? "PASS" : "FAIL"}  ${label}${note ? `  [${note}]` : ""}`);
  }

  for (const v of violations) {
    console.log(`      [${v.rule}] "${v.matched}"\n        …${v.excerpt}…`);
  }
  console.log(`\n${checks.length - failed}/${checks.length} passed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
