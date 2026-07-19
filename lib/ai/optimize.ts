import { z } from "zod";
import type { Artifacts, PageAudit, SiteSignals } from "@/lib/types";
import { getTargetOrigin, getTargetUrls, hasAiKey } from "@/lib/config";
import { generateObjectWithFallback } from "@/lib/ai/client";

const artifactSchema = z.object({
  summary: z.string().describe("一句话中文总结当前 SEO 状况与本轮最需要修复的问题"),
  metaTitle: z.string().describe("优化后的标题（中文，30-60 字符，含核心关键词与品牌『铭信科技』）"),
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
    .describe("围绕铭信 FX 系列存储加速平台的常见问答，用于 FAQPage 结构化数据；只使用页面内容中出现的真实数据"),
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
    .describe("按优先级排序的可执行修复动作清单（供官网仓库开发者落地）"),
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
  const context = buildContext(pages, site, gaps);

  const { object, model } = await generateObjectWithFallback({
    schema: artifactSchema,
    system:
      "你是一名顶尖的技术 SEO 专家，作为外部独立审计方服务『铭信科技（Mingxin Technology）』官网 " +
      "https://mingxinstorage.xyz —— 一家存储加速与算力中心服务商（FX 系列全闪 NVMe-oF 存储加速平台、" +
      "KV Cache 分层、国产算力卡适配、算力中心建设与效能优化）。官网是 Next.js 应用（中文为默认语言，" +
      "/en/* 为英文镜像），修复由官网仓库开发者落地，因此你的产物是『可直接粘贴的修复建议』而非对静态 HTML 的改写。" +
      "铭信的核心信誉是『以实测立信』：所有性能数字都带签字级测试报告编号（R1–R9）且可下载查证。" +
      "因此你绝不编造任何数字或性能声明，只使用审计上下文（页面正文）中出现的真实数据。" +
      "所有面向用户的文本默认使用简体中文，保持专业、准确、具备搜索意图覆盖。" +
      "JSON-LD 必须是合法可解析的字符串，并使用 https://schema.org 上下文。",
    prompt:
      `以下是目标网站的 SEO 审计上下文，请据此生成修复建议：\n\n${context}\n\n` +
      "要求：\n" +
      "1. metaTitle/metaDescription 要在长度限制内并覆盖核心关键词（存储加速、KV Cache 分层、NVMe-oF、国产算力、FX 系列）；\n" +
      "2. jsonLd 至少包含 Organization、Product（FX100/FX200/FX300）、FAQPage、BreadcrumbList、WebSite 五类中尽可能多的类型；\n" +
      "3. faq 紧扣 KV Cache 分层加速、FX 系列规格与报价、联测门禁流程、国产算力卡适配等真实卖点，" +
      "性能数字必须取自页面正文并保留报告编号（如 R2/R3 实测吞吐提升 29–40%）；\n" +
      "4. actions 按 impact 从高到低排序，给出明确、可在官网 Next.js 仓库落地的说明" +
      "（指明改 metadata 导出、JSON-LD 组件还是页面内容）。",
  });

  return assembleArtifacts(object, true, model, pages.find((p) => p.ok)?.signals.lang ?? "zh-CN");
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
    metadataSnippet: buildMetadataSnippet(a, lang),
    metaTitle: a.metaTitle,
    metaDescription: a.metaDescription,
    keywords: a.keywords,
    jsonLd,
    faq: a.faq,
    contentSuggestions: a.contentSuggestions,
    altTextSuggestions: a.altTextSuggestions,
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
      site.sitemapXml.present ? `有(${site.sitemapXml.urlCount}条)` : "无/不可访问（重点检查：官网 sitemap 为数据库动态生成，返回失败通常意味着 DATABASE_URL 或 Neon 数据库异常）"
    }`,
  );
  lines.push("\n待改进项（gap）:");
  lines.push(gaps.slice(0, 40).map((g) => `  - ${g}`).join("\n") || "  - 无明显缺口，可做增强优化");
  return lines.join("\n");
}

/**
 * The official site is a Next.js App Router app — deliver the fix as a
 * ready-to-paste `metadata` export plus JSON-LD blocks for its JsonLd component.
 */
function buildMetadataSnippet(a: AiArtifact, lang: string): string {
  const url = getTargetUrls()[0];
  const origin = getTargetOrigin();
  const locale = lang.startsWith("en") ? "en_US" : "zh_CN";
  const meta = {
    title: a.metaTitle,
    description: a.metaDescription,
    keywords: a.keywords,
    alternates: { canonical: url },
    openGraph: {
      title: a.metaTitle,
      description: a.metaDescription,
      type: "website",
      url,
      siteName: "铭信科技",
      locale,
    },
    twitter: {
      card: "summary_large_image",
      title: a.metaTitle,
      description: a.metaDescription,
    },
  };
  return [
    `// 粘贴到官网仓库对应 page.tsx（site/src/app/...），与现有 metadata 合并`,
    `// 站点根域: ${origin}`,
    `import type { Metadata } from "next";`,
    ``,
    `export const metadata: Metadata = ${JSON.stringify(meta, null, 2)};`,
  ].join("\n");
}

/* -------------------- Heuristic fallback (no AI key) -------------------- */

/**
 * Every number below is copied from the official site and carries its signed
 * benchmark-report ID (R1–R9); originals are downloadable in the site's
 * evidence library. Never add unbacked claims here.
 */
function heuristicArtifacts(pages: PageAudit[], site: SiteSignals, gaps: string[]): Artifacts {
  const primary = pages.find((p) => p.ok) ?? pages[0];
  const s = primary?.signals;
  const origin = getTargetOrigin();

  const metaTitle = s?.title ?? "铭信科技 — 存储加速 · 国产算力 · 算力中心全产业链";
  const metaDescription =
    s?.metaDescription ??
    "铭信科技：以实测立信的存储加速与算力中心服务商。FX 系列全闪 NVMe-oF 存储加速平台，480B 大模型生产部署形态签字级实测：推理吞吐提升 29–40%、首 token 延迟降低 26–32%（R2/R3），每个关键数字都有可下载的测试报告。";
  const keywords = (s?.metaKeywords?.split(",").map((k) => k.trim()).filter(Boolean)) ?? [
    "铭信科技",
    "存储加速",
    "KV Cache 分层",
    "NVMe-oF 全闪存储",
    "FX100",
    "国产算力卡适配",
    "算力中心建设",
    "推理加速",
  ];

  const faq = [
    {
      question: "铭信 FX 系列存储加速平台能带来多大的推理性能提升？",
      answer:
        "在 480B 大模型生产部署形态下的签字级实测：KV Cache 分层加速使推理吞吐提升 29–40%（R2/R3 报告），首 token 延迟（TTFT p50）降低 26–32%（R2 报告）。全部指标注明报告编号，原始报告可在官网证据库下载查证，测试代码与数据开源可复现。",
    },
    {
      question: "FX 系列有哪些型号，目前哪些在售？",
      answer:
        "FX100（PCIe 3.0）、FX200（PCIe 4.0）、FX300（PCIe 5.0）量产在售；FX400（PCIe 6.0）预计 2026 年底量产（4.8Tb/s 聚合带宽、1.4 亿 IOPS 为厂商口径）。历史测试报告中的 AISSD5000/WS5000/GP5000 均为 FX100 的既往称谓。",
    },
    {
      question: "铭信支持国产算力卡吗？",
      answer:
        "支持。铭信具备跨 AMD MI308X、华为昇腾 910B、沐曦 N260 等多平台的推理栈源码级适配与实测验证能力；在昇腾 Atlas 910B 平台上实测模型加载较 NFS 加速 6.2–9.3 倍（R9 报告）。",
    },
    {
      question: "如何验证铭信公布的性能数据？",
      answer:
        "三条路径：1) 官网证据库下载 R1–R9 签字版测试报告；2) 开源测试套件 github.com/mingxin-tech/mingxin-kvcache-bench 可复现全部结论；3) 预约联测——门禁化验收流程（G1–G4），TTFT 降幅 ≥25%、吞吐提升落在 +29–40% 实测带内方为通过，不达标即止损。",
    },
  ];

  const aiInput: AiArtifact = {
    summary:
      "（未配置 AI 密钥，使用启发式产物）已基于审计结果生成基础修复建议，配置 AI Gateway 后将获得更高质量的内容与结构化数据建议。",
    metaTitle,
    metaDescription,
    keywords,
    jsonLd: [
      {
        type: "Organization",
        json: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "Organization",
          name: "铭信科技",
          alternateName: "Mingxin Technology",
          legalName: "铭信（天津）半导体设备有限公司",
          url: origin,
          sameAs: ["https://github.com/mingxin-tech/mingxin-kvcache-bench"],
        }),
      },
      {
        type: "Product",
        json: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "Product",
          name: "铭信 FX 系列全闪 NVMe-oF 存储加速平台",
          description:
            "FX100/FX200/FX300 量产在售的全闪 NVMe-oF 存储加速平台：KV Cache 分层实测推理吞吐提升 29–40%、TTFT 降低 26–32%（R2/R3 签字级报告，可下载查证）。",
          brand: { "@type": "Brand", name: "铭信科技" },
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
      "为 FX100/FX200/FX300/FX400 各建独立规格页（接口、IOPS、闪存形态、满配参考价），覆盖型号级长尾搜索词。",
      "把 R1–R9 报告摘要做成可索引的 HTML 页面（而非仅 PDF 下载），让搜索引擎与 AI 引擎能直接引用实测数据。",
      "为核心术语（KV Cache 分层、NVMe-oF、TTFT、国产算力卡适配）撰写解释性内容，覆盖科普型长尾关键词。",
    ],
    altTextSuggestions:
      s && s.imagesMissingAlt > 0
        ? [{ context: "产品主图", alt: "铭信 FX 系列全闪 NVMe-oF 存储加速平台产品图" }]
        : [],
    actions: buildHeuristicActions(site, gaps),
  };

  return assembleArtifacts(aiInput, false, null, s?.lang ?? "zh-CN");
}

function buildHeuristicActions(site: SiteSignals, gaps: string[]) {
  const base: AiArtifact["actions"] = [];

  if (!site.sitemapXml.present) {
    base.push({
      title: "修复 sitemap.xml 不可访问",
      detail:
        `${site.origin}/sitemap.xml 当前无法正常返回。官网 sitemap 由 site/src/app/sitemap.ts 动态生成并依赖 Neon 数据库，` +
        "请优先检查 Vercel 项目的 DATABASE_URL 与数据库健康状态——sitemap 失败会直接影响收录。",
      category: "indexing",
      impact: "high",
      effort: "low",
    });
  }

  base.push(
    ...gaps.slice(0, 8).map((g) => ({
      title: g.split(": ")[0]?.split("› ").pop()?.trim() ?? "优化项",
      detail: `${g}（修复位置：官网仓库对应页面的 metadata 导出或 JsonLd 组件）`,
      category: "audit-gap",
      impact: (g.toLowerCase().includes("json-ld") || g.includes("结构化") ? "high" : "medium") as
        | "high"
        | "medium",
      effort: "low" as const,
    })),
  );

  if (base.length === 0) {
    base.push({
      title: "增强结构化数据",
      detail: "在已有基础上补充 FAQPage 与 BreadcrumbList，提升富结果展示概率。",
      category: "richdata",
      impact: "high",
      effort: "low",
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
