/**
 * Verification pass over what is actually live on the platforms.
 *
 * The in-cycle sweep (lib/geo/integrity.ts) checks our stored copy of each
 * article; this checks the published page itself, using the same rules, so a
 * failed edit or a platform-side change cannot hide. Read-only — it reports,
 * the cron loop is what repairs.
 *
 *   npx tsx --env-file=.env.local scripts/audit-live-articles.ts
 */
import { findViolations } from "../lib/geo/rules";

const BASE = process.env.APP_URL || "https://aieoz-seo-autopilot.vercel.app";

interface StatusArticle {
  slug: string;
  aiGenerated: boolean;
  hasReportAnchors: boolean;
  hasUtmBacklink: boolean;
  landingUrl: string;
  deepLinked: boolean;
  published: { platform: string; url: string | null }[];
}

type TgNode = string | { children?: TgNode[] };

function flatten(node: TgNode): string {
  return typeof node === "string" ? node : (node.children ?? []).map(flatten).join(" ");
}

async function fetchTelegraph(url: string): Promise<string | null> {
  const path = new URL(url).pathname.replace(/^\//, "");
  const res = await fetch(`https://api.telegra.ph/getPage/${path}?return_content=true`, {
    cache: "no-store",
  });
  const data = (await res.json()) as { ok: boolean; result?: { content?: TgNode[] } };
  if (!data.ok || !data.result) return null;
  return (data.result.content ?? []).map(flatten).join(" ");
}

async function main() {
  const secret = process.env.CRON_SECRET;
  const res = await fetch(`${BASE}/api/status`, {
    headers: secret ? { authorization: `Bearer ${secret}` } : {},
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`/api/status HTTP ${res.status}`);
  const status = (await res.json()) as { geo: { publishedArticles: StatusArticle[] } };

  let checked = 0;
  let dirty = 0;
  let shallow = 0;
  let unreachable = 0;

  for (const article of status.geo.publishedArticles) {
    const flags = [
      article.aiGenerated ? null : "非 AI 生成（启发式兜底）",
      article.hasReportAnchors ? null : "缺少 R1–R9 报告编号锚点",
      article.hasUtmBacklink ? null : "缺少带 UTM 的回链",
      article.deepLinked ? null : "回链仍指向 /en 首页",
    ].filter(Boolean);
    if (!article.deepLinked) shallow += 1;

    console.log(`${article.slug}`);
    console.log(`  落地页: ${article.landingUrl}${flags.length ? `  ⚠ ${flags.join(" / ")}` : ""}`);

    for (const p of article.published) {
      if (!p.url) continue;
      if (p.platform !== "telegraph") {
        console.log(`  ${p.platform}: ${p.url} (无只读内容 API，跳过正文核查)`);
        continue;
      }
      try {
        const text = await fetchTelegraph(p.url);
        if (text === null) {
          unreachable += 1;
          console.log(`  ${p.platform}: ${p.url} → 无法读取`);
          continue;
        }
        checked += 1;
        const violations = findViolations(text);
        if (violations.length === 0) {
          console.log(`  ${p.platform}: ${p.url} → 正文合规`);
        } else {
          dirty += 1;
          console.log(`  ${p.platform}: ${p.url} → ${violations.length} 处违规`);
          for (const v of violations) {
            console.log(`      [${v.rule}] "${v.matched}" — ${v.reason}`);
          }
        }
      } catch (err) {
        unreachable += 1;
        console.log(`  ${p.platform}: ${p.url} → 错误 ${String(err).slice(0, 120)}`);
      }
    }
  }

  console.log(
    `\n共核查 ${checked} 篇线上正文：${dirty} 篇存在违规，${unreachable} 篇不可读；` +
      `${shallow} 篇回链仍指向首页（待 cron 回溯改链）`,
  );
  if (dirty > 0) {
    console.log("违规文章会在后续 GEO 循环中被自动重写，无需人工处理；若连续多轮未清零请检查 AI 备援链。");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
