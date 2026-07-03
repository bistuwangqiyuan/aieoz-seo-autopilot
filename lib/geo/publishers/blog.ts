import { marked } from "marked";
import { GitHubClient, type CommitFile } from "@/lib/apply/github";
import { buildGtagSnippet, getTargetOrigin, getWritebackConfig } from "@/lib/config";
import type { GeoArticle, PublishResult } from "@/lib/types";

/**
 * Publish the article as a standalone HTML page on goni.top via a GitHub commit:
 *   blog/<slug>.html  (+ create/refresh blog/index.html, append to sitemap.xml)
 * Reuses the writeback repo configuration (GONI_REPO / GITHUB_TOKEN / GONI_BRANCH).
 */
export async function publishToBlog(
  article: GeoArticle,
  priorArticles: GeoArticle[],
): Promise<PublishResult> {
  const cfg = getWritebackConfig();
  if (!cfg.token) {
    return { platform: "blog", status: "skipped", detail: "missing GITHUB_TOKEN" };
  }

  const origin = getTargetOrigin();
  const client = new GitHubClient({ repo: cfg.repo, branch: cfg.branch, token: cfg.token });
  const root = cfg.publishDir.replace(/^\.?\/*/, "").replace(/\/+$/, "");
  const p = (name: string) => (root ? `${root}/${name}` : name);

  try {
    const pagePath = p(`blog/${article.slug}.html`);
    const existing = await client.getFile(pagePath);
    if (existing.content !== null) {
      return {
        platform: "blog",
        status: "skipped",
        url: article.canonicalUrl,
        detail: "page already exists",
      };
    }

    const files: CommitFile[] = [
      { path: pagePath, content: renderArticleHtml(article, origin) },
      {
        path: p("blog/index.html"),
        content: renderBlogIndex([article, ...priorArticles], origin),
      },
    ];

    // Append the page to sitemap.xml (never shrink).
    const sitemapPath = p("sitemap.xml");
    const sitemap = await client.getFile(sitemapPath);
    if (sitemap.content && !sitemap.content.includes(article.canonicalUrl)) {
      const entry =
        `  <url>\n    <loc>${article.canonicalUrl}</loc>\n` +
        `    <lastmod>${article.createdAt.slice(0, 10)}</lastmod>\n` +
        `    <changefreq>monthly</changefreq>\n    <priority>0.7</priority>\n  </url>\n`;
      files.push({
        path: sitemapPath,
        content: sitemap.content.replace(/<\/urlset>/, `${entry}</urlset>`),
      });
    }

    const commit = await client.commitFiles(
      files,
      `feat(blog): publish "${article.title}"\n\nAutomated GEO article by aieoz-seo-autopilot.\nKeyword: ${article.keyword}`,
    );

    return {
      platform: "blog",
      status: "published",
      url: article.canonicalUrl,
      detail: `commit ${commit.sha.slice(0, 7)}`,
    };
  } catch (err) {
    return {
      platform: "blog",
      status: "failed",
      detail: err instanceof Error ? err.message.slice(0, 300) : String(err),
    };
  }
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function renderArticleHtml(article: GeoArticle, origin: string): string {
  const bodyHtml = marked.parse(article.markdown, { async: false }) as string;
  const jsonLd = JSON.stringify(
    {
      "@context": "https://schema.org",
      "@type": "Article",
      headline: article.title,
      description: article.description,
      datePublished: article.createdAt,
      dateModified: article.createdAt,
      author: { "@type": "Organization", name: "ZK-Storage", url: origin },
      publisher: {
        "@type": "Organization",
        name: "ZK-Storage",
        logo: { "@type": "ImageObject", url: `${origin}/assets/logo/og-image.png` },
      },
      mainEntityOfPage: article.canonicalUrl,
    },
    null,
    2,
  );
  const breadcrumb = JSON.stringify(
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: `${origin}/` },
        { "@type": "ListItem", position: 2, name: "Blog", item: `${origin}/blog/index.html` },
        { "@type": "ListItem", position: 3, name: article.title, item: article.canonicalUrl },
      ],
    },
    null,
    2,
  );

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(article.title)} | ZK-Storage Blog</title>
<meta name="description" content="${esc(article.description)}" />
<link rel="canonical" href="${article.canonicalUrl}" />
<meta name="robots" content="index,follow,max-image-preview:large" />
<meta property="og:title" content="${esc(article.title)}" />
<meta property="og:description" content="${esc(article.description)}" />
<meta property="og:type" content="article" />
<meta property="og:url" content="${article.canonicalUrl}" />
<meta property="og:image" content="${origin}/assets/logo/og-image.png" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="theme-color" content="#0a0a0f" />
<link rel="icon" type="image/svg+xml" href="../assets/logo/favicon.svg" />
${buildGtagSnippet()}
<script type="application/ld+json">
${jsonLd}
</script>
<script type="application/ld+json">
${breadcrumb}
</script>
<style>
:root{color-scheme:dark}
body{margin:0;background:#0a0a0f;color:#e8e8f0;font:16px/1.75 -apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
.wrap{max-width:760px;margin:0 auto;padding:48px 20px}
a{color:#7dd3fc}
h1{font-size:2rem;line-height:1.3;margin:0 0 8px}
h2{margin-top:2.2em;border-bottom:1px solid #26263a;padding-bottom:.3em}
.meta{color:#8a8aa3;font-size:.85rem;margin-bottom:32px}
table{border-collapse:collapse;width:100%;margin:1em 0;font-size:.92rem}
th,td{border:1px solid #26263a;padding:8px 12px;text-align:left}
th{background:#14141f}
code{background:#1a1a2b;padding:2px 6px;border-radius:4px;font-size:.9em}
blockquote{border-left:3px solid #6366f1;margin:1em 0;padding:.2em 1em;color:#b9b9cf}
.crumbs{font-size:.85rem;color:#8a8aa3;margin-bottom:24px}
footer{margin-top:56px;padding-top:24px;border-top:1px solid #26263a;color:#8a8aa3;font-size:.85rem}
</style>
</head>
<body>
<div class="wrap">
<nav class="crumbs"><a href="${origin}/">Home</a> › <a href="${origin}/blog/index.html">Blog</a></nav>
<article>
<h1>${esc(article.title)}</h1>
<p class="meta">Published ${article.createdAt.slice(0, 10)} · ZK-Storage Engineering</p>
${bodyHtml}
</article>
<footer>
<p>ZK-Storage WS5000 — all-flash ultra-high-speed storage for AI clusters. <a href="${origin}/en/index.html">Learn more</a>.</p>
</footer>
</div>
</body>
</html>
`;
}

export function renderBlogIndex(articles: GeoArticle[], origin: string): string {
  const items = articles
    .slice()
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map(
      (a) =>
        `<li><a href="${origin}/blog/${a.slug}.html">${esc(a.title)}</a>` +
        `<span class="date">${a.createdAt.slice(0, 10)}</span>` +
        `<p>${esc(a.description)}</p></li>`,
    )
    .join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Engineering Blog | ZK-Storage</title>
<meta name="description" content="Data-driven articles on AI infrastructure, all-flash storage, KV Cache offloading, and GPU utilization from the ZK-Storage engineering team." />
<link rel="canonical" href="${origin}/blog/index.html" />
<meta name="robots" content="index,follow" />
<meta name="theme-color" content="#0a0a0f" />
<link rel="icon" type="image/svg+xml" href="../assets/logo/favicon.svg" />
${buildGtagSnippet()}
<style>
:root{color-scheme:dark}
body{margin:0;background:#0a0a0f;color:#e8e8f0;font:16px/1.7 -apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
.wrap{max-width:760px;margin:0 auto;padding:48px 20px}
a{color:#7dd3fc;text-decoration:none}
a:hover{text-decoration:underline}
h1{font-size:2rem}
ul{list-style:none;padding:0}
li{padding:20px 0;border-bottom:1px solid #26263a}
li a{font-size:1.15rem;font-weight:600}
.date{color:#8a8aa3;font-size:.8rem;margin-left:12px}
li p{color:#b9b9cf;margin:6px 0 0;font-size:.92rem}
</style>
</head>
<body>
<div class="wrap">
<h1>ZK-Storage Engineering Blog</h1>
<p>Data-driven articles on AI infrastructure, storage performance, and GPU utilization.</p>
<ul>
${items}
</ul>
<p><a href="${origin}/">← Back to goni.top</a></p>
</div>
</body>
</html>
`;
}
