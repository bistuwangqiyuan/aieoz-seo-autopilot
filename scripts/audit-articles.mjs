// One-shot: list every published article in production state and check the
// live platform copies for fabricated details the context never contained.
import { readFileSync } from "node:fs";

const env = {};
for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)="?([^"\r]*)"?\s*$/);
  if (m) env[m[1]] = m[2];
}

const BAD =
  /only vendor|industry.first|best.in.class|\bCANN\b|MindSpore|Llama|\bRoCE(v\d)?\b|InfiniBand|cryptographic|Atlas 800|firmware|vLLM \d/i;

const status = await (
  await fetch("https://www.clawpro.pw/api/status", {
    headers: { Authorization: `Bearer ${env.CRON_SECRET}` },
  })
).json();

const flat = (n) => (typeof n === "string" ? n : (n.children || []).map(flat).join(" "));

for (const a of status.geo.publishedArticles) {
  console.log(`${a.slug}  ai=${a.aiGenerated} anchors=${a.hasReportAnchors} utm=${a.hasUtmBacklink}`);
  for (const p of a.published) {
    if (!p.url) continue;
    try {
      const path = new URL(p.url).pathname.slice(1);
      const d = await (await fetch(`https://api.telegra.ph/getPage/${path}?return_content=true`)).json();
      if (!d.ok) {
        console.log(`    ${p.platform} ${p.url} -> FETCH FAIL ${d.error}`);
        continue;
      }
      const text = (d.result.content || []).map(flat).join(" ");
      const m = text.match(BAD);
      console.log(
        `    ${p.platform} ${p.url} -> ${m ? `SUSPECT [${m[0]}]: ...${text.slice(Math.max(0, m.index - 90), m.index + 90)}...` : "clean"}`,
      );
    } catch (e) {
      console.log(`    ${p.platform} ${p.url} -> ERR ${String(e).slice(0, 100)}`);
    }
  }
}
