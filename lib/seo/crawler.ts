import * as cheerio from "cheerio";
import { USER_AGENT } from "@/lib/config";
import type { PageSignals, SiteSignals } from "@/lib/types";

export interface CrawledPage {
  url: string;
  httpStatus: number;
  ok: boolean;
  html: string | null;
  error?: string;
}

const FETCH_TIMEOUT_MS = 20_000;

async function fetchText(
  url: string,
): Promise<{ status: number; ok: boolean; text: string | null; error?: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { "user-agent": USER_AGENT, accept: "text/html,*/*" },
      signal: controller.signal,
      cache: "no-store",
    });
    const text = await res.text();
    return { status: res.status, ok: res.ok, text };
  } catch (err) {
    return {
      status: 0,
      ok: false,
      text: null,
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function crawlPage(url: string): Promise<CrawledPage> {
  const { status, ok, text, error } = await fetchText(url);
  return { url, httpStatus: status, ok, html: text, error };
}

const GENERIC_ANCHOR_TEXT = new Set([
  "click here",
  "here",
  "read more",
  "more",
  "link",
  "this",
  "点击",
  "点击这里",
  "更多",
  "详情",
  "了解更多",
  "查看",
]);

export function extractSignals(url: string, html: string): PageSignals {
  const $ = cheerio.load(html);
  const origin = safeOrigin(url);

  const title = textOrNull($("head > title").first().text());
  const metaDescription = attrOrNull($('meta[name="description"]').attr("content"));
  const metaKeywords = attrOrNull($('meta[name="keywords"]').attr("content"));
  const canonical = attrOrNull($('link[rel="canonical"]').attr("href"));
  const robots = attrOrNull($('meta[name="robots"]').attr("content"));
  const lang = attrOrNull($("html").attr("lang"));
  const viewport = attrOrNull($('meta[name="viewport"]').attr("content"));

  const hreflang: string[] = [];
  $('link[rel="alternate"][hreflang]').each((_, el) => {
    const hl = $(el).attr("hreflang");
    if (hl) hreflang.push(hl);
  });

  const h1: string[] = [];
  const headingOutline: { tag: string; text: string }[] = [];
  $("h1, h2, h3, h4, h5, h6").each((_, el) => {
    const tag = String($(el).prop("tagName") ?? "").toLowerCase();
    const text = $(el).text().replace(/\s+/g, " ").trim();
    if (!tag) return;
    if (tag === "h1" && text) h1.push(text);
    if (text) headingOutline.push({ tag, text: text.slice(0, 120) });
  });

  const ogTags: Record<string, string> = {};
  $('meta[property^="og:"]').each((_, el) => {
    const prop = $(el).attr("property");
    const content = $(el).attr("content");
    if (prop && content) ogTags[prop] = content;
  });

  const twitterTags: Record<string, string> = {};
  $('meta[name^="twitter:"]').each((_, el) => {
    const name = $(el).attr("name");
    const content = $(el).attr("content");
    if (name && content) twitterTags[name] = content;
  });

  const jsonLdTypes: string[] = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).contents().text();
    try {
      const parsed = JSON.parse(raw);
      collectJsonLdTypes(parsed, jsonLdTypes);
    } catch {
      /* ignore malformed JSON-LD */
    }
  });

  let imageCount = 0;
  let imagesMissingAlt = 0;
  $("img").each((_, el) => {
    imageCount += 1;
    const alt = $(el).attr("alt");
    if (alt === undefined || alt.trim() === "") imagesMissingAlt += 1;
  });

  let internalLinks = 0;
  let externalLinks = 0;
  let genericAnchors = 0;
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href") ?? "";
    if (!href || href.startsWith("#") || href.startsWith("javascript:")) return;
    const anchorText = $(el).text().replace(/\s+/g, " ").trim().toLowerCase();
    if (anchorText && GENERIC_ANCHOR_TEXT.has(anchorText)) genericAnchors += 1;
    try {
      const resolved = new URL(href, url);
      if (resolved.origin === origin) internalLinks += 1;
      else externalLinks += 1;
    } catch {
      internalLinks += 1;
    }
  });

  $("script, style, noscript, template").remove();
  const bodyText = $("body").text().replace(/\s+/g, " ").trim();
  const wordCount = countWords(bodyText);

  const hasManifest = $('link[rel="manifest"]').length > 0;
  const hasFavicon =
    $('link[rel="icon"], link[rel="shortcut icon"], link[rel="apple-touch-icon"]').length > 0;
  const hasThemeColor = $('meta[name="theme-color"]').length > 0;
  const preloadHints = $('link[rel="preload"], link[rel="preconnect"], link[rel="dns-prefetch"]').length;

  return {
    title,
    titleLength: title?.length ?? 0,
    metaDescription,
    metaDescriptionLength: metaDescription?.length ?? 0,
    metaKeywords,
    canonical,
    robots,
    lang,
    viewport,
    hreflang,
    h1,
    headingOutline: headingOutline.slice(0, 40),
    ogTags,
    twitterTags,
    jsonLdTypes,
    imageCount,
    imagesMissingAlt,
    internalLinks,
    externalLinks,
    genericAnchors,
    wordCount,
    hasManifest,
    hasFavicon,
    hasThemeColor,
    preloadHints,
    textExcerpt: bodyText.slice(0, 4000),
  };
}

export async function crawlSite(origin: string): Promise<SiteSignals> {
  const robotsUrl = `${origin}/robots.txt`;
  const sitemapUrl = `${origin}/sitemap.xml`;

  const [robotsRes, sitemapRes] = await Promise.all([
    fetchText(robotsUrl),
    fetchText(sitemapUrl),
  ]);

  const robotsPresent = robotsRes.ok && !!robotsRes.text;
  const robotsContent = robotsPresent ? robotsRes.text!.slice(0, 4000) : null;
  const hasSitemapDirective = robotsPresent
    ? /sitemap\s*:/i.test(robotsRes.text ?? "")
    : false;

  const sitemapPresent = sitemapRes.ok && !!sitemapRes.text;
  const urlCount = sitemapPresent
    ? (sitemapRes.text!.match(/<loc>/gi)?.length ?? 0)
    : 0;

  return {
    origin,
    robotsTxt: {
      present: robotsPresent,
      hasSitemap: hasSitemapDirective,
      content: robotsContent,
    },
    sitemapXml: { present: sitemapPresent, urlCount },
  };
}

function collectJsonLdTypes(node: unknown, out: string[]): void {
  if (!node) return;
  if (Array.isArray(node)) {
    node.forEach((n) => collectJsonLdTypes(n, out));
    return;
  }
  if (typeof node === "object") {
    const obj = node as Record<string, unknown>;
    const t = obj["@type"];
    if (typeof t === "string") out.push(t);
    else if (Array.isArray(t)) t.forEach((v) => typeof v === "string" && out.push(v));
    if (Array.isArray(obj["@graph"])) collectJsonLdTypes(obj["@graph"], out);
  }
}

function countWords(text: string): number {
  if (!text) return 0;
  const cjk = (text.match(/[\u4e00-\u9fff]/g) ?? []).length;
  const latin = (text.match(/[A-Za-z0-9]+/g) ?? []).length;
  return cjk + latin;
}

function textOrNull(v: string | undefined | null): string | null {
  const t = (v ?? "").replace(/\s+/g, " ").trim();
  return t ? t : null;
}

function attrOrNull(v: string | undefined | null): string | null {
  const t = (v ?? "").trim();
  return t ? t : null;
}

function safeOrigin(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return "";
  }
}
