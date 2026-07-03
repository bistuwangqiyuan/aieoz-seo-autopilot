import { getGeoConfig, USER_AGENT } from "@/lib/config";
import type { GeoArticle, PublishResult } from "@/lib/types";

/**
 * Publish a text post to the bot account's own profile (u_<username>) via the
 * official OAuth API (script app, password grant). Posting to one's own
 * profile is compliant and avoids subreddit rules/moderation.
 */
export async function publishToReddit(article: GeoArticle): Promise<PublishResult> {
  const { reddit } = getGeoConfig();
  if (!reddit.clientId || !reddit.clientSecret || !reddit.username || !reddit.password) {
    return {
      platform: "reddit",
      status: "skipped",
      detail: "missing REDDIT_CLIENT_ID/SECRET/USERNAME/PASSWORD",
    };
  }

  try {
    const tokenRes = await fetch("https://www.reddit.com/api/v1/access_token", {
      method: "POST",
      headers: {
        Authorization:
          "Basic " + Buffer.from(`${reddit.clientId}:${reddit.clientSecret}`).toString("base64"),
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": USER_AGENT,
      },
      body: new URLSearchParams({
        grant_type: "password",
        username: reddit.username,
        password: reddit.password,
      }),
      cache: "no-store",
    });

    const tokenData = (await tokenRes.json().catch(() => null)) as {
      access_token?: string;
      error?: string;
    } | null;
    if (!tokenRes.ok || !tokenData?.access_token) {
      return {
        platform: "reddit",
        status: "failed",
        detail: `auth failed: ${tokenData?.error ?? `HTTP ${tokenRes.status}`}`,
      };
    }

    const submitRes = await fetch("https://oauth.reddit.com/api/submit", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": USER_AGENT,
      },
      body: new URLSearchParams({
        sr: `u_${reddit.username}`,
        kind: "self",
        title: article.title.slice(0, 300),
        text: article.redditPost,
        api_type: "json",
        resubmit: "true",
      }),
      cache: "no-store",
    });

    const submitData = (await submitRes.json().catch(() => null)) as {
      json?: { errors?: string[][]; data?: { url?: string } };
    } | null;

    const errors = submitData?.json?.errors ?? [];
    if (!submitRes.ok || errors.length) {
      const msg = errors.map((e) => e.join(":")).join("; ") || `HTTP ${submitRes.status}`;
      const isRateLimit = /RATELIMIT|429/i.test(msg);
      return {
        platform: "reddit",
        status: "failed",
        detail: (isRateLimit ? "rate-limited (will retry next cycle): " : "") + msg.slice(0, 200),
      };
    }

    return {
      platform: "reddit",
      status: "published",
      url: submitData?.json?.data?.url,
    };
  } catch (err) {
    return {
      platform: "reddit",
      status: "failed",
      detail: err instanceof Error ? err.message.slice(0, 200) : String(err),
    };
  }
}
