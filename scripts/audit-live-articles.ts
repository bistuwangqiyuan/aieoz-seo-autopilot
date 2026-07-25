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
import { findArticleViolations } from "../lib/geo/rules";

const BASE = process.env.APP_URL || "https://aieoz-seo-autopilot.vercel.app";

interface StatusArticle {
  slug: string;
  title: string;
  aiGenerated: boolean;
  hasReportAnchors: boolean;
  hasUtmBacklink: boolean;
  landingUrl: string;
  deepLinked: boolean;
  published: { platform: string; url: string | null }[];
}

type TgNode = string | { tag?: string; children?: TgNode[] };

/** Tags that end a line of text; their contents must not run into the next. */
const BLOCK_TAGS = new Set(["p", "h3", "h4", "li", "blockquote", "pre", "figure", "hr"]);

/**
 * Telegraph stores content as a node tree, and collapsing it with a plain space
 * fuses text that is visually separate — a table row's cells, or the end of one
 * paragraph and the start of the next. That manufactured adjacency reads as a
 * claim nobody made: "…than NFS" followed by a cell of "6.2-9.3x" became
 * "NFS 6.2", which the version rule then flagged on three correct articles.
 */
function flatten(node: TgNode): string {
  if (typeof node === "string") return node;
  const inner = (node.children ?? []).map(flatten).join("");
  return node.tag && BLOCK_TAGS.has(node.tag) ? `${inner}\n` : inner;
}

/**
 * Reads the live page, including its headline as Telegraph actually serves it —
 * which is what a reader and a retrieval engine see, and may differ from the
 * title we have stored if an edit only partly landed.
 */
async function fetchTelegraph(url: string): Promise<{ title: string; text: string } | null> {
  const path = new URL(url).pathname.replace(/^\//, "");
  const res = await fetch(`https://api.telegra.ph/getPage/${path}?return_content=true`, {
    cache: "no-store",
  });
  const data = (await res.json()) as {
    ok: boolean;
    result?: { title?: string; content?: TgNode[] };
  };
  if (!data.ok || !data.result) return null;
  return {
    title: data.result.title ?? "",
    text: (data.result.content ?? []).map(flatten).join("\n"),
  };
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
        const page = await fetchTelegraph(p.url);
        if (page === null) {
          unreachable += 1;
          console.log(`  ${p.platform}: ${p.url} → 无法读取`);
          continue;
        }
        checked += 1;
        const violations = findArticleViolations(page.title, page.text);
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
