import type {
  CheckStatus,
  PageAudit,
  PageSignals,
  SeoCategory,
  SeoCheck,
  SiteSignals,
} from "@/lib/types";
import { crawlPage, crawlSite, extractSignals } from "@/lib/seo/crawler";
import { getTargetOrigin } from "@/lib/config";

interface CheckBuilder {
  id: string;
  label: string;
  max: number;
  evaluate: (s: PageSignals, site: SiteSignals) => { status: CheckStatus; ratio: number; detail: string };
}

function ok(detail: string) {
  return { status: "pass" as CheckStatus, ratio: 1, detail };
}
function warn(detail: string, ratio = 0.5) {
  return { status: "warn" as CheckStatus, ratio, detail };
}
function fail(detail: string) {
  return { status: "fail" as CheckStatus, ratio: 0, detail };
}

const CATEGORIES: { id: string; label: string; checks: CheckBuilder[] }[] = [
  {
    id: "metadata",
    label: "元数据 Metadata",
    checks: [
      {
        id: "title",
        label: "标题标签 <title>",
        max: 10,
        evaluate: (s) => {
          if (!s.title) return fail("缺少 <title> 标签");
          if (s.titleLength < 10) return warn(`标题过短（${s.titleLength} 字符）`);
          if (s.titleLength > 65) return warn(`标题偏长（${s.titleLength} 字符），可能被截断`, 0.6);
          return ok(`标题长度合适（${s.titleLength} 字符）`);
        },
      },
      {
        id: "description",
        label: "Meta description",
        max: 10,
        evaluate: (s) => {
          if (!s.metaDescription) return fail("缺少 meta description");
          if (s.metaDescriptionLength < 70) return warn(`描述过短（${s.metaDescriptionLength} 字符）`);
          if (s.metaDescriptionLength > 165) return warn(`描述偏长（${s.metaDescriptionLength} 字符）`, 0.6);
          return ok(`描述长度合适（${s.metaDescriptionLength} 字符）`);
        },
      },
      {
        id: "keywords",
        label: "Meta keywords",
        max: 3,
        evaluate: (s) =>
          s.metaKeywords ? ok("已设置 keywords") : warn("未设置 meta keywords（影响较小）", 0.4),
      },
      {
        id: "canonical",
        label: "Canonical 链接",
        max: 8,
        evaluate: (s) =>
          s.canonical ? ok(`canonical: ${s.canonical}`) : fail("缺少 canonical 链接"),
      },
    ],
  },
  {
    id: "social",
    label: "社交分享 Open Graph / Twitter",
    checks: [
      {
        id: "og",
        label: "Open Graph 标签",
        max: 8,
        evaluate: (s) => {
          const required = ["og:title", "og:description", "og:image", "og:url", "og:type"];
          const present = required.filter((k) => s.ogTags[k]);
          if (present.length === 0) return fail("缺少 Open Graph 标签");
          if (present.length < required.length)
            return warn(`OG 标签不完整（${present.length}/${required.length}）`, present.length / required.length);
          return ok("Open Graph 标签完整");
        },
      },
      {
        id: "twitter",
        label: "Twitter Card 标签",
        max: 5,
        evaluate: (s) => {
          const keys = Object.keys(s.twitterTags);
          if (keys.length === 0) return fail("缺少 Twitter Card 标签");
          if (!s.twitterTags["twitter:card"]) return warn("缺少 twitter:card 类型", 0.5);
          return ok("Twitter Card 标签存在");
        },
      },
    ],
  },
  {
    id: "structure",
    label: "内容结构 Structure",
    checks: [
      {
        id: "h1",
        label: "H1 标题",
        max: 8,
        evaluate: (s) => {
          if (s.h1.length === 0) return fail("缺少 H1 标题");
          if (s.h1.length > 1) return warn(`存在多个 H1（${s.h1.length} 个）`, 0.5);
          return ok("唯一 H1 标题");
        },
      },
      {
        id: "headings",
        label: "标题层级",
        max: 5,
        evaluate: (s) => {
          if (s.headingOutline.length < 2) return warn("标题层级过于扁平", 0.5);
          const hasH2 = s.headingOutline.some((h) => h.tag === "h2");
          return hasH2 ? ok(`检测到 ${s.headingOutline.length} 个标题`) : warn("缺少 H2 小节标题", 0.6);
        },
      },
      {
        id: "content",
        label: "内容深度",
        max: 8,
        evaluate: (s) => {
          if (s.wordCount < 150) return fail(`内容过少（约 ${s.wordCount} 词/字）`);
          if (s.wordCount < 400) return warn(`内容偏少（约 ${s.wordCount} 词/字）`, 0.6);
          return ok(`内容充足（约 ${s.wordCount} 词/字）`);
        },
      },
      {
        id: "alt",
        label: "图片 Alt 覆盖率",
        max: 7,
        evaluate: (s) => {
          if (s.imageCount === 0) return warn("页面无图片", 0.7);
          const ratio = (s.imageCount - s.imagesMissingAlt) / s.imageCount;
          if (ratio >= 0.95) return ok("图片 alt 覆盖完整");
          if (ratio >= 0.5)
            return warn(`${s.imagesMissingAlt}/${s.imageCount} 张图片缺少 alt`, ratio);
          return fail(`${s.imagesMissingAlt}/${s.imageCount} 张图片缺少 alt`);
        },
      },
    ],
  },
  {
    id: "richdata",
    label: "结构化数据 Structured Data",
    checks: [
      {
        id: "jsonld",
        label: "JSON-LD 结构化数据",
        max: 12,
        evaluate: (s) => {
          if (s.jsonLdTypes.length === 0) return fail("缺少 JSON-LD 结构化数据");
          const valuable = ["Organization", "Product", "FAQPage", "BreadcrumbList", "WebSite"];
          const matched = s.jsonLdTypes.filter((t) => valuable.includes(t));
          if (matched.length >= 3) return ok(`丰富的结构化数据：${unique(s.jsonLdTypes).join(", ")}`);
          if (matched.length >= 1)
            return warn(`结构化数据有限：${unique(s.jsonLdTypes).join(", ")}`, 0.6);
          return warn(`存在 JSON-LD 但类型有限：${unique(s.jsonLdTypes).join(", ")}`, 0.4);
        },
      },
    ],
  },
  {
    id: "i18n",
    label: "国际化与索引 i18n & Indexing",
    checks: [
      {
        id: "lang",
        label: "html lang 属性",
        max: 4,
        evaluate: (s) => (s.lang ? ok(`lang="${s.lang}"`) : fail("缺少 html lang 属性")),
      },
      {
        id: "hreflang",
        label: "hreflang 多语言标注",
        max: 6,
        evaluate: (s) => {
          if (s.hreflang.length === 0) return fail("缺少 hreflang 标注");
          if (!s.hreflang.includes("x-default"))
            return warn(`已设置 hreflang（${s.hreflang.length}），缺少 x-default`, 0.7);
          return ok(`hreflang 完整（${s.hreflang.join(", ")}）`);
        },
      },
      {
        id: "robots",
        label: "robots meta",
        max: 5,
        evaluate: (s) => {
          if (!s.robots) return warn("未设置 robots meta（默认可索引）", 0.6);
          if (/noindex/i.test(s.robots)) return fail(`robots 设置为 noindex：${s.robots}`);
          return ok(`robots: ${s.robots}`);
        },
      },
    ],
  },
  {
    id: "mobile",
    label: "移动端与 PWA Mobile & PWA",
    checks: [
      {
        id: "viewport",
        label: "Viewport meta",
        max: 6,
        evaluate: (s) => (s.viewport ? ok("已设置 viewport") : fail("缺少 viewport meta")),
      },
      {
        id: "manifest",
        label: "Web App Manifest",
        max: 3,
        evaluate: (s) => (s.hasManifest ? ok("已链接 manifest") : warn("缺少 manifest", 0.4)),
      },
      {
        id: "favicon",
        label: "Favicon / 图标",
        max: 2,
        evaluate: (s) => (s.hasFavicon ? ok("已设置 favicon") : warn("缺少 favicon", 0.3)),
      },
      {
        id: "themecolor",
        label: "Theme color",
        max: 2,
        evaluate: (s) => (s.hasThemeColor ? ok("已设置 theme-color") : warn("缺少 theme-color", 0.3)),
      },
    ],
  },
  {
    id: "links",
    label: "链接与性能 Links & Perf",
    checks: [
      {
        id: "internal",
        label: "内部链接",
        max: 4,
        evaluate: (s) => {
          if (s.internalLinks === 0) return fail("没有内部链接");
          if (s.internalLinks < 3) return warn(`内部链接较少（${s.internalLinks}）`, 0.6);
          return ok(`内部链接：${s.internalLinks}`);
        },
      },
      {
        id: "anchors",
        label: "锚文本质量",
        max: 3,
        evaluate: (s) => {
          if (s.genericAnchors === 0) return ok("锚文本描述性良好");
          return warn(`${s.genericAnchors} 处使用了模糊锚文本（如“点击这里”）`, 0.5);
        },
      },
      {
        id: "preload",
        label: "资源预加载提示",
        max: 3,
        evaluate: (s) =>
          s.preloadHints > 0
            ? ok(`已使用 ${s.preloadHints} 个资源提示`)
            : warn("未使用 preload/preconnect 资源提示", 0.5),
      },
      {
        id: "sitemap",
        label: "Sitemap 与 robots.txt",
        max: 5,
        evaluate: (_s, site) => {
          if (site.sitemapXml.present && site.robotsTxt.hasSitemap)
            return ok(`sitemap.xml（${site.sitemapXml.urlCount} 条）且 robots.txt 已声明`);
          if (site.sitemapXml.present) return warn("有 sitemap.xml，但 robots.txt 未声明", 0.7);
          if (site.robotsTxt.present) return warn("有 robots.txt，但缺少 sitemap.xml", 0.4);
          return fail("缺少 sitemap.xml 与 robots.txt");
        },
      },
    ],
  },
];

export function auditPage(url: string, signals: PageSignals, site: SiteSignals): {
  score: number;
  categories: SeoCategory[];
} {
  const categories: SeoCategory[] = CATEGORIES.map((cat) => {
    const checks: SeoCheck[] = cat.checks.map((c) => {
      const r = c.evaluate(signals, site);
      return {
        id: c.id,
        label: c.label,
        status: r.status,
        score: round(c.max * r.ratio),
        max: c.max,
        detail: r.detail,
      };
    });
    const score = round(checks.reduce((a, c) => a + c.score, 0));
    const max = checks.reduce((a, c) => a + c.max, 0);
    return { id: cat.id, label: cat.label, score, max, checks };
  });

  const totalScore = categories.reduce((a, c) => a + c.score, 0);
  const totalMax = categories.reduce((a, c) => a + c.max, 0);
  const score = totalMax > 0 ? Math.round((totalScore / totalMax) * 100) : 0;
  return { score, categories };
}

export async function auditUrl(url: string, site: SiteSignals): Promise<PageAudit> {
  const page = await crawlPage(url);
  const fetchedAt = new Date().toISOString();

  if (!page.ok || !page.html) {
    return {
      url,
      httpStatus: page.httpStatus,
      fetchedAt,
      ok: false,
      error: page.error ?? `HTTP ${page.httpStatus}`,
      score: 0,
      categories: [],
      signals: emptySignals(),
    };
  }

  const signals = extractSignals(url, page.html);
  const { score, categories } = auditPage(url, signals, site);

  return {
    url,
    httpStatus: page.httpStatus,
    fetchedAt,
    ok: true,
    score,
    categories,
    signals,
  };
}

export async function auditTargets(urls: string[]): Promise<{
  pages: PageAudit[];
  site: SiteSignals;
  score: number;
}> {
  const origin = getTargetOrigin();
  const site = await crawlSite(origin);
  const pages = await Promise.all(urls.map((u) => auditUrl(u, site)));
  const okPages = pages.filter((p) => p.ok);
  const score = okPages.length
    ? Math.round(okPages.reduce((a, p) => a + p.score, 0) / okPages.length)
    : 0;
  return { pages, site, score };
}

/** Flatten all failing/warning checks into a gap list for the AI engine. */
export function collectGaps(pages: PageAudit[]): string[] {
  const gaps: string[] = [];
  for (const page of pages) {
    for (const cat of page.categories) {
      for (const check of cat.checks) {
        if (check.status !== "pass") {
          gaps.push(`[${page.url}] ${cat.label} › ${check.label}: ${check.detail}`);
        }
      }
    }
  }
  return gaps;
}

function unique(arr: string[]): string[] {
  return Array.from(new Set(arr));
}

function round(n: number): number {
  return Math.round(n * 10) / 10;
}

function emptySignals(): PageSignals {
  return {
    title: null,
    titleLength: 0,
    metaDescription: null,
    metaDescriptionLength: 0,
    metaKeywords: null,
    canonical: null,
    robots: null,
    lang: null,
    viewport: null,
    hreflang: [],
    h1: [],
    headingOutline: [],
    ogTags: {},
    twitterTags: {},
    jsonLdTypes: [],
    imageCount: 0,
    imagesMissingAlt: 0,
    internalLinks: 0,
    externalLinks: 0,
    genericAnchors: 0,
    wordCount: 0,
    hasManifest: false,
    hasFavicon: false,
    hasThemeColor: false,
    preloadHints: 0,
    textExcerpt: "",
  };
}
