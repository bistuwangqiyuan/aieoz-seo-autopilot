import { marked } from "marked";
import * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";
import { getTargetOrigin, USER_AGENT } from "@/lib/config";
import type { GeoArticle, GeoState, PublishResult } from "@/lib/types";

const API = "https://api.telegra.ph";
const AUTHOR_NAME = "Mingxin Technology Engineering";

/**
 * Publish via the anonymous Telegraph API. Creates a reusable account token on
 * first run and stores it in GeoState.
 *
 * `originNote` is set when the same article is also on a higher-authority
 * platform, so this copy declares where it was first published instead of
 * competing with it as duplicate content.
 */
export async function publishToTelegraph(
  article: GeoArticle,
  state: GeoState,
  originNote?: string,
): Promise<PublishResult> {
  try {
    const authorUrl = `${getTargetOrigin()}/en`;
    if (!state.telegraphToken) {
      const created = await tgRequest<{ access_token: string }>("createAccount", {
        short_name: "mingxin",
        author_name: AUTHOR_NAME,
        author_url: authorUrl,
      });
      state.telegraphToken = created.access_token;
    }

    const content = markdownToTelegraphNodes(article.markdown, article.referenceUrl, originNote);
    const page = await tgRequest<{ url: string }>("createPage", {
      access_token: state.telegraphToken,
      title: article.title.slice(0, 250),
      author_name: AUTHOR_NAME,
      author_url: authorUrl,
      content: JSON.stringify(content),
      return_content: false,
    });

    return { platform: "telegraph", status: "published", url: page.url };
  } catch (err) {
    return {
      platform: "telegraph",
      status: "failed",
      detail: err instanceof Error ? err.message.slice(0, 200) : String(err),
    };
  }
}

/** Rewrite an already-published Telegraph page (used to repoint stale backlinks). */
export async function editTelegraphPage(
  accessToken: string,
  pageUrl: string,
  title: string,
  markdown: string,
  referenceUrl: string,
): Promise<void> {
  const path = new URL(pageUrl).pathname.replace(/^\//, "");
  await tgRequest("editPage", {
    access_token: accessToken,
    path,
    title: title.slice(0, 250),
    author_name: AUTHOR_NAME,
    author_url: `${getTargetOrigin()}/en`,
    content: JSON.stringify(markdownToTelegraphNodes(markdown, referenceUrl)),
    return_content: false,
  });
}

async function tgRequest<T>(method: string, params: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${API}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": USER_AGENT },
    body: JSON.stringify(params),
    cache: "no-store",
  });
  const data = (await res.json()) as { ok: boolean; result?: T; error?: string };
  if (!data.ok || !data.result) {
    throw new Error(`telegraph ${method}: ${data.error ?? `HTTP ${res.status}`}`);
  }
  return data.result;
}

type TgNode = string | { tag: string; attrs?: Record<string, string>; children?: TgNode[] };

/** Telegraph accepts a limited node set; convert markdown -> sanitized node tree. */
export function markdownToTelegraphNodes(
  markdown: string,
  referenceUrl: string,
  originNote?: string,
): TgNode[] {
  const html = marked.parse(markdown, { async: false }) as string;
  const $ = cheerio.load(`<div id="root">${html}</div>`);

  const ALLOWED = new Set([
    "a", "aside", "b", "blockquote", "br", "code", "em", "figcaption", "figure",
    "h3", "h4", "hr", "i", "iframe", "img", "li", "ol", "p", "pre", "s",
    "strong", "u", "ul", "video",
  ]);
  // Telegraph has no table support; degrade tables to preformatted text.
  const TAG_MAP: Record<string, string> = { h1: "h3", h2: "h3", h5: "h4", h6: "h4" };

  function walk(el: AnyNode): TgNode | TgNode[] | null {
    if (el.type === "text") {
      const text = (el as unknown as { data?: string }).data ?? "";
      return text.trim() === "" && text.includes("\n") ? null : text;
    }
    if (el.type !== "tag") return null;

    let tag = el.tagName.toLowerCase();
    if (tag === "table") {
      return { tag: "pre", children: [$(el).text().replace(/\n{2,}/g, "\n").trim()] };
    }
    if (TAG_MAP[tag]) tag = TAG_MAP[tag];

    const childNodes = $(el)
      .contents()
      .toArray()
      .flatMap((c) => {
        const r = walk(c);
        return r === null ? [] : Array.isArray(r) ? r : [r];
      });

    if (!ALLOWED.has(tag)) return childNodes;

    const node: TgNode = { tag };
    if (tag === "a") {
      const href = $(el).attr("href");
      if (href) node.attrs = { href };
    }
    if (childNodes.length) node.children = childNodes;
    return node;
  }

  const nodes = $("#root")
    .contents()
    .toArray()
    .flatMap((c) => {
      const r = walk(c);
      return r === null ? [] : Array.isArray(r) ? r : [r];
    });

  // Telegraph has no rel=canonical, so state the original publication in the
  // body — search engines and readers both need to know which copy is primary.
  if (originNote) {
    nodes.unshift({
      tag: "p",
      children: [
        { tag: "em", children: ["Originally published on "] },
        { tag: "a", attrs: { href: originNote }, children: [originNote] },
      ],
    });
  }

  const footerUrl = referenceUrl.includes("utm_source=")
    ? referenceUrl
    : `${referenceUrl}?utm_source=telegraph&utm_medium=referral&utm_campaign=geo`;
  nodes.push({
    tag: "p",
    children: [
      "More on this topic: ",
      { tag: "a", attrs: { href: footerUrl }, children: [footerUrl] },
    ],
  });

  return nodes;
}
