/**
 * Deterministic check on the legacy-backlink rewrite. This runs against 23
 * already-published articles, so a regex that is too greedy would corrupt real
 * links on real pages — verify it offline before letting it near Telegraph.
 *
 *   npx tsx scripts/test-backfill.ts
 */
import { repointLinks } from "../lib/geo/backfill";

const HOME = "https://mingxinstorage.xyz/en";
const LANDING = "https://mingxinstorage.xyz/en/topics/ttft-optimization";
const EVIDENCE = "https://mingxinstorage.xyz/en/evidence";
const UTM = "utm_source=geo-article&utm_medium=referral&utm_campaign=geo";

interface Case {
  name: string;
  input: string;
  /** Substrings that must appear in the output. */
  must: string[];
  /** Substrings that must NOT appear in the output. */
  mustNot: string[];
}

const CASES: Case[] = [
  {
    name: "bare home link is repointed",
    input: `See ${HOME} for details.`,
    must: [`${LANDING}?${UTM}`],
    mustNot: [`See ${HOME} for`],
  },
  {
    name: "home link carrying old UTM is repointed",
    input: `More on this topic: ${HOME}?utm_source=telegraph&utm_medium=referral&utm_campaign=geo`,
    must: [`${LANDING}?${UTM}`],
    mustNot: ["utm_source=telegraph"],
  },
  {
    name: "markdown link syntax is repointed",
    input: `[Mingxin](${HOME}) publishes signed reports.`,
    must: [`[Mingxin](${LANDING}?${UTM})`],
    mustNot: [`](${HOME})`],
  },
  {
    name: "deeper paths on the same origin are left alone",
    input: `Compare ${HOME}/products and ${HOME}/compare/vs-weka today.`,
    must: [`${HOME}/products`, `${HOME}/compare/vs-weka`],
    mustNot: [`${LANDING}?${UTM} /products`],
  },
  {
    name: "existing evidence link is not duplicated",
    input: `Reports live at ${EVIDENCE} and the overview is ${HOME}.`,
    must: [EVIDENCE],
    mustNot: ["Signed benchmark reports"],
  },
  {
    name: "missing evidence link is appended",
    input: `Only a home link here: ${HOME}`,
    must: ["Signed benchmark reports", EVIDENCE],
    mustNot: [],
  },
  {
    name: "article with no official link at all still gets both",
    input: "A body that forgot to link back anywhere.",
    must: [`${LANDING}?${UTM}`, EVIDENCE],
    mustNot: [],
  },
];

let failures = 0;
for (const c of CASES) {
  const out = repointLinks(c.input, HOME, LANDING, "geo-article", EVIDENCE);
  const missing = c.must.filter((m) => !out.includes(m));
  const present = c.mustNot.filter((m) => out.includes(m));
  const pass = missing.length === 0 && present.length === 0;
  if (!pass) failures += 1;
  console.log(`${pass ? "PASS" : "FAIL"}  ${c.name}`);
  if (!pass) {
    if (missing.length) console.log(`        missing: ${missing.join(" | ")}`);
    if (present.length) console.log(`        should not contain: ${present.join(" | ")}`);
    console.log(`        got: ${JSON.stringify(out)}`);
  }
}

// The evidence page must never be mistaken for the home page and rewritten.
const evidenceOnly = repointLinks(`Read ${EVIDENCE} now.`, HOME, LANDING, "geo-article", EVIDENCE);
if (!evidenceOnly.includes(`Read ${EVIDENCE} now.`)) {
  failures += 1;
  console.log("FAIL  evidence URL must survive untouched");
}

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURES`}`);
if (failures > 0) process.exit(1);
