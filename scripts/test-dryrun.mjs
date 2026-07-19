// One-shot: validate the writer via the production dry-run endpoint (no
// publishing, no state writes). Checks structure, UTM backlinks in all three
// variants, report anchors, and absence of invented-config red flags.
const res = await fetch("https://www.clawpro.pw/api/geo", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ dryRun: true }),
  signal: AbortSignal.timeout(240000),
});
const d = await res.json();
if (!d.ok || !d.dryRun) {
  console.log("FAIL dry-run:", res.status, JSON.stringify(d).slice(0, 300));
  process.exit(1);
}
const a = d.article;
const BAD =
  /only vendor|industry.first|best.in.class|\bCANN\b|MindSpore|Llama|\bRoCE(v\d)?\b|InfiniBand|cryptographic|Atlas 800|firmware|vLLM \d/i;

const checks = [
  ["aiGenerated", a.aiGenerated === true],
  ["title 20+ chars", (a.title ?? "").length >= 20],
  ["markdown 800+ words", (a.markdown ?? "").split(/\s+/).length >= 800],
  ["markdown UTM backlink", a.markdown.includes("utm_source=")],
  ["quora UTM backlink", a.quoraAnswer.includes("utm_source=")],
  ["reddit UTM backlink", a.redditPost.includes("utm_source=")],
  ["report anchors", /\bR[1-9]\b/.test(a.markdown) || a.markdown.includes("mingxin-kvcache-bench")],
  ["no invented config", !BAD.test(a.markdown)],
];
let pass = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (ok) pass++;
  else if (name === "no invented config") console.log("   match:", a.markdown.match(BAD)?.[0]);
}
console.log(`==== ${pass}/${checks.length} PASSED (dry-run, zero side effects) ====`);
process.exit(pass === checks.length ? 0 : 1);
