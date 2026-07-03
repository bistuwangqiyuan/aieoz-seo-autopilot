import * as cheerio from "cheerio";
import { getTargetOrigin, getWritebackConfig } from "@/lib/config";
import { GitHubClient, type CommitFile } from "@/lib/apply/github";
import type { Snapshot, WritebackChange, WritebackResult } from "@/lib/types";

const VALUABLE_LD_TYPES = ["Organization", "Product", "FAQPage", "BreadcrumbList", "WebSite"];

/**
 * Closed-loop step: turn the AI artifacts into minimal, idempotent edits on the
 * goni.top source repo and (optionally) push them as a single commit.
 *
 * Design rules:
 *  - Additive only: never overwrite good existing values; only fill gaps. This
 *    guarantees idempotency (once a gap is filled, detection passes -> no-op).
 *  - Minimal diff: inject new tags right before </head> instead of reformatting.
 *  - Never shrink an existing sitemap; only create site files when missing.
 */
export async function applyWriteback(snapshot: Snapshot): Promise<WritebackResult> {
  const cfg = getWritebackConfig();
  const base: WritebackResult = {
    enabled: cfg.enabled,
    dryRun: cfg.dryRun,
    applied: false,
    repo: cfg.repo,
    branch: cfg.branch,
    changedFiles: [],
  };

  if (!cfg.enabled) {
    return { ...base, skippedReason: "writeback disabled (SEO_WRITEBACK_ENABLED=false)" };
  }
  if (!cfg.token) {
    return { ...base, skippedReason: "missing GITHUB_TOKEN" };
  }
  if (!cfg.pageFiles.length) {
    return { ...base, skippedReason: "no page-file mapping resolved" };
  }

  const origin = getTargetOrigin();
  const client = new GitHubClient({ repo: cfg.repo, branch: cfg.branch, token: cfg.token });

  const commitFiles: CommitFile[] = [];
  const changes: WritebackChange[] = [];

  try {
    // 1) Per-page <head> upserts.
    for (const { url, path } of cfg.pageFiles) {
      const file = await client.getFile(path);
      if (file.content === null) {
        changes.push({ path, summary: "skipped (file not found in repo)", edits: [] });
        continue;
      }
      const { html, edits } = upsertHead(file.content, {
        pageUrl: url,
        origin,
        themeColor: cfg.themeColor,
        alternates: cfg.pageFiles.map((p) => p.url),
        artifacts: snapshot.artifacts,
      });
      if (html !== file.content) {
        commitFiles.push({ path, content: html });
        changes.push({ path, summary: `head upsert (${edits.length} item)`, edits });
      }
    }

    // 2) Site-level robots.txt / sitemap.xml (create-if-missing only).
    const root = cfg.publishDir.replace(/^\.?\/*/, "").replace(/\/+$/, "");
    const sitePath = (name: string) => (root ? `${root}/${name}` : name);

    if (!snapshot.site.sitemapXml.present) {
      const p = sitePath("sitemap.xml");
      const existing = await client.getFile(p);
      if (existing.content === null) {
        commitFiles.push({ path: p, content: snapshot.artifacts.sitemapXml });
        changes.push({ path: p, summary: "created sitemap.xml", edits: ["sitemap.xml"] });
      }
    }

    if (!snapshot.site.robotsTxt.present) {
      const p = sitePath("robots.txt");
      const existing = await client.getFile(p);
      if (existing.content === null) {
        commitFiles.push({ path: p, content: snapshot.artifacts.robotsTxt });
        changes.push({ path: p, summary: "created robots.txt", edits: ["robots.txt"] });
      }
    } else if (!snapshot.site.robotsTxt.hasSitemap) {
      const p = sitePath("robots.txt");
      const existing = await client.getFile(p);
      if (existing.content !== null && !/^\s*sitemap\s*:/im.test(existing.content)) {
        const updated =
          existing.content.replace(/\s*$/, "") + `\nSitemap: ${origin}/sitemap.xml\n`;
        commitFiles.push({ path: p, content: updated });
        changes.push({
          path: p,
          summary: "declared sitemap in robots.txt",
          edits: ["robots.txt: Sitemap"],
        });
      }
    }

    if (commitFiles.length === 0) {
      return {
        ...base,
        changedFiles: changes,
        skippedReason: "no diff (site already converged)",
      };
    }

    if (cfg.dryRun) {
      return {
        ...base,
        changedFiles: changes,
        skippedReason: `dry-run: ${commitFiles.length} file(s) would change`,
      };
    }

    const message = buildCommitMessage(changes);
    const commit = await client.commitFiles(commitFiles, message);
    return {
      ...base,
      applied: true,
      changedFiles: changes,
      commitSha: commit.sha,
      commitUrl: commit.url,
    };
  } catch (err) {
    return {
      ...base,
      changedFiles: changes,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export interface UpsertCtx {
  pageUrl: string;
  origin: string;
  themeColor: string;
  alternates: string[];
  artifacts: Snapshot["artifacts"];
}

/** Returns possibly-edited HTML and the list of applied edits (empty = no change). */
export function upsertHead(html: string, ctx: UpsertCtx): { html: string; edits: string[] } {
  if (!/<\/head>/i.test(html)) return { html, edits: [] };

  const $ = cheerio.load(html);
  const additions: string[] = [];
  const edits: string[] = [];

  const titleText = $("title").first().text().trim();
  const descContent =
    ($('meta[name="description"]').attr("content") || "").trim() ||
    ctx.artifacts.metaDescription;
  const ogImage = `${ctx.origin}/assets/logo/og-image.png`;

  const add = (line: string, label: string) => {
    additions.push(line);
    edits.push(label);
  };

  // metadata
  if ($('link[rel="canonical"]').length === 0) {
    add(`<link rel="canonical" href="${esc(ctx.pageUrl)}" data-seo-autopilot="1" />`, "canonical");
  }
  if ($('meta[name="keywords"]').length === 0 && ctx.artifacts.keywords.length) {
    add(
      `<meta name="keywords" content="${esc(ctx.artifacts.keywords.join(","))}" data-seo-autopilot="1" />`,
      "keywords",
    );
  }

  // social: Open Graph (fill missing of the 5 scored keys)
  const ogTitle = titleText || ctx.artifacts.metaTitle;
  const ogNeeded: Record<string, string> = {
    "og:title": ogTitle,
    "og:description": descContent,
    "og:type": "website",
    "og:url": ctx.pageUrl,
    "og:image": ogImage,
  };
  for (const [prop, value] of Object.entries(ogNeeded)) {
    if ($(`meta[property="${prop}"]`).length === 0) {
      add(
        `<meta property="${prop}" content="${esc(value)}" data-seo-autopilot="1" />`,
        prop,
      );
    }
  }
  // Twitter Card
  if ($('meta[name="twitter:card"]').length === 0) {
    add(
      `<meta name="twitter:card" content="summary_large_image" data-seo-autopilot="1" />`,
      "twitter:card",
    );
  }
  if ($('meta[name="twitter:title"]').length === 0) {
    add(
      `<meta name="twitter:title" content="${esc(ogTitle)}" data-seo-autopilot="1" />`,
      "twitter:title",
    );
  }
  if ($('meta[name="twitter:description"]').length === 0) {
    add(
      `<meta name="twitter:description" content="${esc(descContent)}" data-seo-autopilot="1" />`,
      "twitter:description",
    );
  }

  // i18n
  const hreflangs = new Set(
    $('link[rel="alternate"][hreflang]')
      .map((_, el) => ($(el).attr("hreflang") || "").toLowerCase())
      .get(),
  );
  if (hreflangs.size > 0 && !hreflangs.has("x-default")) {
    add(
      `<link rel="alternate" hreflang="x-default" href="${esc(ctx.origin + "/")}" data-seo-autopilot="1" />`,
      "hreflang:x-default",
    );
  }

  // mobile / PWA
  if ($('meta[name="viewport"]').length === 0) {
    add(
      `<meta name="viewport" content="width=device-width, initial-scale=1" data-seo-autopilot="1" />`,
      "viewport",
    );
  }
  if ($('link[rel="manifest"]').length === 0) {
    add(
      `<link rel="manifest" href="/manifest.webmanifest" data-seo-autopilot="1" />`,
      "manifest",
    );
  }
  if ($('meta[name="theme-color"]').length === 0) {
    add(
      `<meta name="theme-color" content="${esc(ctx.themeColor)}" data-seo-autopilot="1" />`,
      "theme-color",
    );
  }

  // richdata: only inject when fewer than 3 valuable types are present
  if (countValuableLdTypes($) < 3 && ctx.artifacts.jsonLd.length) {
    for (const entry of ctx.artifacts.jsonLd) {
      additions.push(
        `<script type="application/ld+json" data-seo-autopilot="1">\n${entry.json}\n</script>`,
      );
    }
    edits.push(`json-ld(${ctx.artifacts.jsonLd.map((e) => e.type).join(", ")})`);
  }

  if (additions.length === 0) return { html, edits: [] };

  const block = additions.map((l) => `  ${l}`).join("\n");
  // Use a function replacer so `$` in AI-generated JSON-LD is never interpreted
  // as a String.replace special pattern (e.g. $&, $`, $').
  const newHtml = html.replace(/([ \t]*)<\/head>/i, (_m, p1: string) => `${block}\n${p1}</head>`);
  return { html: newHtml, edits };
}

function countValuableLdTypes($: cheerio.CheerioAPI): number {
  const found = new Set<string>();
  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).contents().text();
    try {
      collectTypes(JSON.parse(raw), found);
    } catch {
      /* ignore malformed JSON-LD */
    }
  });
  return [...found].filter((t) => VALUABLE_LD_TYPES.includes(t)).length;
}

function collectTypes(node: unknown, out: Set<string>): void {
  if (Array.isArray(node)) {
    for (const n of node) collectTypes(n, out);
    return;
  }
  if (node && typeof node === "object") {
    const t = (node as Record<string, unknown>)["@type"];
    if (typeof t === "string") out.add(t);
    else if (Array.isArray(t)) t.forEach((v) => typeof v === "string" && out.add(v));
    const graph = (node as Record<string, unknown>)["@graph"];
    if (graph) collectTypes(graph, out);
  }
}

function buildCommitMessage(changes: WritebackChange[]): string {
  const allEdits = changes.flatMap((c) => c.edits);
  const summary = [...new Set(allEdits)].slice(0, 8).join(", ");
  return (
    `chore(seo): autopilot writeback (${changes.length} file)\n\n` +
    `Automated SEO optimization by aieoz-seo-autopilot.\n` +
    `Applied: ${summary || "site files"}.\n` +
    changes.map((c) => `- ${c.path}: ${c.summary}`).join("\n")
  );
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
