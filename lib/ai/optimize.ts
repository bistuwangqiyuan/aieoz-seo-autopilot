import { generateObject } from "ai";
import { z } from "zod";
import type { Artifacts, PageAudit, SiteSignals } from "@/lib/types";
import { getModelId, getTargetOrigin, getTargetUrls, hasAiKey } from "@/lib/config";

const artifactSchema = z.object({
  summary: z.string().describe("一句话中文总结当前 SEO 状况与本轮优化重点"),
  metaTitle: z.string().describe("优化后的标题（中文，30-60 字符，含核心关键词与品牌）"),
  metaDescription: z
    .string()
    .describe("优化后的 meta description（中文，120-160 字符，含关键词与行动号召）"),
  keywords: z.array(z.string()).max(12).describe("核心关键词数组"),
  jsonLd: z
    .array(
      z.object({
        type: z.string().describe("schema.org 类型，如 Organization / Product / FAQPage"),
        json: z.string().describe("完整且合法的 JSON-LD 字符串（含 @context 与 @type）"),
      }),
    )
    .max(6),
  faq: z
    .array(z.object({ question: z.string(), answer: z.string() }))
    .max(8)
    .describe("围绕产品（中科存储 WS5000）的常见问答，用于 FAQPage 结构化数据"),
  contentSuggestions: z
    .array(z.string())
    .max(10)
    .describe("提升内容深度与关键词覆盖的具体内容建议（中文）"),
  altTextSuggestions: z
    .array(z.object({ context: z.string(), alt: z.string() }))
    .max(10)
    .describe("缺失 alt 的图片的建议替代文本"),
  actions: z
    .array(
      z.object({
        title: z.string(),
        detail: z.string(),
        category: z.string(),
        impact: z.enum(["high", "medium", "low"]),
        effort: z.enum(["high", "medium", "low"]),
      }),
    )
    .max(12)
    .describe("按优先级排序的可执行优化动作清单"),
});

type AiArtifact = z.infer<typeof artifactSchema>;

export async function generateArtifacts(
  pages: PageAudit[],
  site: SiteSignals,
  gaps: string[],
): Promise<Artifacts> {
  if (hasAiKey()) {
    try {
      return await generateWithAi(pages, site, gaps);
    } catch (err) {
      console.error("[ai] generation failed, falling back to heuristic:", err);
    }
  }
  return heuristicArtifacts(pages, site, gaps);
}

async function generateWithAi(
  pages: PageAudit[],
  site: SiteSignals,
  gaps: string[],
): Promise<Artifacts> {
  const model = getModelId();
  const primary = pages.find((p) => p.ok) ?? pages[0];
  const context = buildContext(pages, site, gaps);

  const { object } = await generateObject({
    model,
    schema: artifactSchema,
    system:
      "你是一名顶尖的技术 SEO 专家与中文文案专家，服务对象是『中科存储 ZK-Storage WS5000 全闪存超高速存储』官方网站。" +
      "你的任务是基于审计结果，输出可以直接落地的 SEO 优化产物。所有面向用户的文本默认使用简体中文，保持专业、准确、具备搜索意图覆盖。" +
      "JSON-LD 必须是合法可解析的字符串，并使用 https://schema.org 上下文。",
    prompt:
      `以下是目标网站的 SEO 审计上下文，请据此生成优化产物：\n\n${context}\n\n` +
      "要求：\n" +
      "1. metaTitle/metaDescription 要在长度限制内并覆盖核心关键词；\n" +
      "2. jsonLd 至少包含 Organization、Product（WS5000）、FAQPage、BreadcrumbList、WebSite 五类中尽可能多的类型；\n" +
      "3. faq 紧扣全闪存存储、KV Cache、GPU 利用率、WS5000 规格等真实卖点；\n" +
      "4. actions 按 impact 从高到低排序，给出明确、可执行的说明。",
  });

  return assembleArtifacts(object, true, model, primary?.signals.lang ?? "zh-CN");
}

function assembleArtifacts(
  a: AiArtifact,
  aiGenerated: boolean,
  model: string | null,
  lang: string,
): Artifacts {
  const jsonLd = a.jsonLd.map((entry) => ({
    type: entry.type,
    json: prettyJson(entry.json),
  }));

  return {
    aiGenerated,
    model,
    summary: a.summary,
    headHtml: buildHeadHtml(a, lang),
    metaTitle: a.metaTitle,
    metaDescription: a.metaDescription,
    keywords: a.keywords,
    jsonLd,
    faq: a.faq,
    contentSuggestions: a.contentSuggestions,
    altTextSuggestions: a.altTextSuggestions,
    sitemapXml: buildSitemap(),
    robotsTxt: buildRobots(),
    actions: a.actions,
  };
}

function buildContext(pages: PageAudit[], site: SiteSignals, gaps: string[]): string {
  const lines: string[] = [];
  for (const p of pages) {
    if (!p.ok) {
      lines.push(`- 页面 ${p.url} 抓取失败：${p.error}`);
      continue;
    }
    const s = p.signals;
    lines.push(
      [
        `页面: ${p.url}（当前得分 ${p.score}/100）`,
        `  标题: ${s.title ?? "(无)"}`,
        `  描述: ${s.metaDescription ?? "(无)"}`,
        `  关键词: ${s.metaKeywords ?? "(无)"}`,
        `  H1: ${s.h1.join(" | ") || "(无)"}`,
        `  现有 JSON-LD 类型: ${s.jsonLdTypes.join(", ") || "(无)"}`,
        `  图片缺失 alt: ${s.imagesMissingAlt}/${s.imageCount}`,
        `  正文字数: ${s.wordCount}`,
        `  正文摘录: ${s.textExcerpt.slice(0, 1200)}`,
      ].join("\n"),
    );
  }
  lines.push(
    `站点信号: robots.txt=${site.robotsTxt.present ? "有" : "无"}，sitemap.xml=${
      site.sitemapXml.present ? `有(${site.sitemapXml.urlCount}条)` : "无"
    }`,
  );
  lines.push("\n待改进项（gap）:");
  lines.push(gaps.slice(0, 40).map((g) => `  - ${g}`).join("\n") || "  - 无明显缺口，可做增强优化");
  return lines.join("\n");
}

function buildHeadHtml(a: AiArtifact, lang: string): string {
  const url = getTargetUrls()[0];
  const origin = getTargetOrigin();
  const keywords = a.keywords.join(",");
  const ld = a.jsonLd
    .map(
      (e) =>
        `<script type="application/ld+json">\n${prettyJson(e.json)}\n</script>`,
    )
    .join("\n");
  return [
    `<title>${escapeHtml(a.metaTitle)}</title>`,
    `<meta name="description" content="${escapeAttr(a.metaDescription)}" />`,
    `<meta name="keywords" content="${escapeAttr(keywords)}" />`,
    `<link rel="canonical" href="${url}" />`,
    `<meta property="og:title" content="${escapeAttr(a.metaTitle)}" />`,
    `<meta property="og:description" content="${escapeAttr(a.metaDescription)}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:url" content="${url}" />`,
    `<meta property="og:image" content="${origin}/assets/logo/og-image.png" />`,
    `<meta property="og:locale" content="${lang.replace("-", "_")}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${escapeAttr(a.metaTitle)}" />`,
    `<meta name="twitter:description" content="${escapeAttr(a.metaDescription)}" />`,
    `<meta name="twitter:image" content="${origin}/assets/logo/og-image.png" />`,
    ld,
  ].join("\n");
}

function buildSitemap(): string {
  const urls = getTargetUrls();
  const origin = getTargetOrigin();
  const now = new Date().toISOString().slice(0, 10);
  const entries = [origin + "/", ...urls]
    .filter((v, i, arr) => arr.indexOf(v) === i)
    .map(
      (u) =>
        `  <url>\n    <loc>${u}</loc>\n    <lastmod>${now}</lastmod>\n    <changefreq>weekly</changefreq>\n    <priority>0.8</priority>\n  </url>`,
    )
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries}\n</urlset>`;
}

function buildRobots(): string {
  const origin = getTargetOrigin();
  return [
    "User-agent: *",
    "Allow: /",
    "",
    `Sitemap: ${origin}/sitemap.xml`,
  ].join("\n");
}

/* -------------------- Heuristic fallback (no AI key) -------------------- */

function heuristicArtifacts(pages: PageAudit[], site: SiteSignals, gaps: string[]): Artifacts {
  const primary = pages.find((p) => p.ok) ?? pages[0];
  const s = primary?.signals;
  const origin = getTargetOrigin();

  const metaTitle = s?.title ?? "中科存储 WS5000 — 全闪存超高速存储一体机";
  const metaDescription =
    s?.metaDescription ??
    "中科存储 WS5000：面向 AI 训练与推理的全闪存超高速存储，让每一块 GPU 尽其用，KV Cache 高效卸载。";
  const keywords = (s?.metaKeywords?.split(",").map((k) => k.trim()).filter(Boolean)) ?? [
    "中科存储",
    "ZK-Storage",
    "WS5000",
    "全闪存存储",
    "AI 存储",
    "KV Cache",
    "GPU 利用率",
  ];

  const faq = [
    {
      question: "中科存储 WS5000 适用于哪些场景？",
      answer:
        "WS5000 面向大模型训练与推理、KV Cache 卸载、高并发数据加载等 AI 场景，提供超高带宽与低时延的全闪存存储。",
    },
    {
      question: "WS5000 如何提升 GPU 利用率？",
      answer:
        "通过高吞吐、低时延的全闪存架构与高效数据通道，减少 GPU 等待数据的时间，让算力尽其用。",
    },
    {
      question: "WS5000 支持哪些接口与协议？",
      answer: "支持主流高速网络与存储协议，可无缝接入现有 AI 训练与推理集群（具体规格以官方为准）。",
    },
  ];

  const aiInput: AiArtifact = {
    summary:
      "（未配置 AI 密钥，使用启发式产物）已基于审计结果生成基础优化建议，配置 AI Gateway 后将获得更高质量的内容与结构化数据。",
    metaTitle,
    metaDescription,
    keywords,
    jsonLd: [
      {
        type: "Organization",
        json: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "Organization",
          name: "中科存储 ZK-Storage",
          url: origin,
          logo: `${origin}/assets/logo/og-image.png`,
        }),
      },
      {
        type: "Product",
        json: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "Product",
          name: "中科存储 WS5000",
          description: metaDescription,
          brand: { "@type": "Brand", name: "ZK-Storage" },
        }),
      },
      {
        type: "FAQPage",
        json: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "FAQPage",
          mainEntity: faq.map((f) => ({
            "@type": "Question",
            name: f.question,
            acceptedAnswer: { "@type": "Answer", text: f.answer },
          })),
        }),
      },
    ],
    faq,
    contentSuggestions: [
      "补充 WS5000 的关键规格表（容量、带宽、IOPS、时延、接口），提升内容深度与关键词覆盖。",
      "增加典型 AI 场景案例与性能数据，强化 E-E-A-T 与搜索意图匹配。",
      "为核心术语（KV Cache、全闪存、GPU 利用率）撰写解释性段落，覆盖长尾关键词。",
    ],
    altTextSuggestions:
      s && s.imagesMissingAlt > 0
        ? [{ context: "产品主图", alt: "中科存储 WS5000 全闪存超高速存储一体机产品图" }]
        : [],
    actions: buildHeuristicActions(gaps),
  };

  return assembleArtifacts(aiInput, false, null, s?.lang ?? "zh-CN");
}

function buildHeuristicActions(gaps: string[]) {
  const base = gaps.slice(0, 8).map((g) => ({
    title: g.split(": ")[0]?.split("› ").pop()?.trim() ?? "优化项",
    detail: g,
    category: "audit-gap",
    impact: g.toLowerCase().includes("json-ld") || g.includes("结构化") ? ("high" as const) : ("medium" as const),
    effort: "low" as const,
  }));
  if (base.length === 0) {
    base.push({
      title: "增强结构化数据",
      detail: "在已有基础上补充 FAQPage 与 BreadcrumbList，提升富结果展示概率。",
      category: "richdata",
      impact: "high" as const,
      effort: "low" as const,
    });
  }
  return base;
}

/* -------------------- utils -------------------- */

function prettyJson(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/"/g, "&quot;");
}
