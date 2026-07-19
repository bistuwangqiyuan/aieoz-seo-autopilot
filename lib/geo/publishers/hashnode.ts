import { getGeoConfig, USER_AGENT } from "@/lib/config";
import type { GeoArticle, PublishResult } from "@/lib/types";

const GQL_ENDPOINT = "https://gql.hashnode.com/";

/** Publish via the official Hashnode GraphQL API (publishPost mutation). */
export async function publishToHashnode(article: GeoArticle): Promise<PublishResult> {
  const { hashnodePat, hashnodePublicationId } = getGeoConfig();
  if (!hashnodePat || !hashnodePublicationId) {
    return {
      platform: "hashnode",
      status: "skipped",
      detail: "missing HASHNODE_PAT or HASHNODE_PUBLICATION_ID",
    };
  }

  const mutation = `
mutation PublishPost($input: PublishPostInput!) {
  publishPost(input: $input) {
    post { url }
  }
}`;

  try {
    const res = await fetch(GQL_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: hashnodePat,
        "Content-Type": "application/json",
        "User-Agent": USER_AGENT,
      },
      body: JSON.stringify({
        query: mutation,
        variables: {
          input: {
            publicationId: hashnodePublicationId,
            title: article.title,
            contentMarkdown: article.markdown,
            tags: article.tags.slice(0, 5).map((t) => ({ slug: t, name: t })),
            subtitle: article.description.slice(0, 250),
          },
        },
      }),
      cache: "no-store",
    });

    const data = (await res.json().catch(() => null)) as {
      data?: { publishPost?: { post?: { url?: string } } };
      errors?: { message: string }[];
    } | null;

    if (!res.ok || !data || data.errors?.length) {
      const msg = data?.errors?.map((e) => e.message).join("; ") ?? `HTTP ${res.status}`;
      return { platform: "hashnode", status: "failed", detail: msg.slice(0, 200) };
    }

    return {
      platform: "hashnode",
      status: "published",
      url: data.data?.publishPost?.post?.url,
    };
  } catch (err) {
    return {
      platform: "hashnode",
      status: "failed",
      detail: err instanceof Error ? err.message.slice(0, 200) : String(err),
    };
  }
}
