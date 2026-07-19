import { getGeoConfig, USER_AGENT } from "@/lib/config";
import type { GeoArticle, PublishResult } from "@/lib/types";

/** Publish via the official Dev.to (Forem) REST API. */
export async function publishToDevto(article: GeoArticle): Promise<PublishResult> {
  const { devtoApiKey } = getGeoConfig();
  if (!devtoApiKey) {
    return { platform: "devto", status: "skipped", detail: "missing DEVTO_API_KEY" };
  }

  try {
    const res = await fetch("https://dev.to/api/articles", {
      method: "POST",
      headers: {
        "api-key": devtoApiKey,
        "Content-Type": "application/json",
        "User-Agent": USER_AGENT,
      },
      body: JSON.stringify({
        article: {
          title: article.title,
          body_markdown: article.markdown,
          published: true,
          tags: article.tags.map((t) => t.replace(/-/g, "")).slice(0, 4),
          description: article.description,
        },
      }),
      cache: "no-store",
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return {
        platform: "devto",
        status: "failed",
        detail: `HTTP ${res.status}: ${text.slice(0, 200)}`,
      };
    }

    const data = (await res.json()) as { url?: string };
    return { platform: "devto", status: "published", url: data.url };
  } catch (err) {
    return {
      platform: "devto",
      status: "failed",
      detail: err instanceof Error ? err.message.slice(0, 200) : String(err),
    };
  }
}
