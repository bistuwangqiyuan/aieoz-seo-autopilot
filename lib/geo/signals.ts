import { createSign } from "crypto";
import { getGeoConfig } from "@/lib/config";
import type { GeoSignal, GeoSignalCheck, GeoSignalKind } from "@/lib/types";

/**
 * Step 4: query the GA4 Data API for the last 7 days of sessions grouped by
 * source/medium and detect the three GEO success signals:
 *   - reddit.com referral traffic
 *   - perplexity.* sources (Perplexity citing the site)
 *   - chatgpt / openai sources (ChatGPT citing the site)
 * Gracefully degrades when GA4 credentials are not configured.
 */
export async function checkGeoSignals(): Promise<GeoSignalCheck> {
  const checkedAt = new Date().toISOString();
  const { ga4PropertyId, ga4ServiceAccountJson } = getGeoConfig();

  if (!ga4PropertyId || !ga4ServiceAccountJson) {
    return {
      checkedAt,
      configured: false,
      signals: [],
    };
  }

  try {
    const sa = parseServiceAccount(ga4ServiceAccountJson);
    const accessToken = await getAccessToken(sa);

    const res = await fetch(
      `https://analyticsdata.googleapis.com/v1beta/properties/${ga4PropertyId}:runReport`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          dateRanges: [{ startDate: "7daysAgo", endDate: "today" }],
          dimensions: [{ name: "sessionSource" }, { name: "sessionMedium" }],
          metrics: [{ name: "sessions" }],
          limit: 250,
        }),
        cache: "no-store",
      },
    );

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return {
        checkedAt,
        configured: true,
        error: `GA4 runReport HTTP ${res.status}: ${text.slice(0, 200)}`,
        signals: [],
      };
    }

    const data = (await res.json()) as {
      rows?: { dimensionValues: { value: string }[]; metricValues: { value: string }[] }[];
    };

    const signals: GeoSignal[] = [];
    for (const row of data.rows ?? []) {
      const source = (row.dimensionValues[0]?.value ?? "").toLowerCase();
      const sessions = Number(row.metricValues[0]?.value ?? "0");
      if (!source || sessions <= 0) continue;

      const kind = classifySource(source);
      if (kind) {
        const existing = signals.find((s) => s.kind === kind && s.source === source);
        if (existing) existing.sessions += sessions;
        else signals.push({ kind, source, sessions, detectedAt: checkedAt });
      }
    }

    return { checkedAt, configured: true, signals };
  } catch (err) {
    return {
      checkedAt,
      configured: true,
      error: err instanceof Error ? err.message.slice(0, 300) : String(err),
      signals: [],
    };
  }
}

export function classifySource(source: string): GeoSignalKind | null {
  if (source.includes("reddit")) return "reddit";
  if (source.includes("perplexity")) return "perplexity";
  if (source.includes("chatgpt") || source.includes("chat.openai") || source.includes("openai"))
    return "chatgpt";
  return null;
}

interface ServiceAccount {
  client_email: string;
  private_key: string;
  token_uri?: string;
}

function parseServiceAccount(encoded: string): ServiceAccount {
  // Accept both raw JSON and base64-encoded JSON.
  let raw = encoded;
  if (!encoded.trimStart().startsWith("{")) {
    raw = Buffer.from(encoded, "base64").toString("utf-8");
  }
  const parsed = JSON.parse(raw) as ServiceAccount;
  if (!parsed.client_email || !parsed.private_key) {
    throw new Error("service account JSON missing client_email/private_key");
  }
  return parsed;
}

function b64url(input: Buffer | string): string {
  return (typeof input === "string" ? Buffer.from(input) : input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** Exchange a self-signed RS256 JWT for a Google OAuth2 access token. */
async function getAccessToken(sa: ServiceAccount): Promise<string> {
  const tokenUri = sa.token_uri ?? "https://oauth2.googleapis.com/token";
  const now = Math.floor(Date.now() / 1000);

  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(
    JSON.stringify({
      iss: sa.client_email,
      scope: "https://www.googleapis.com/auth/analytics.readonly",
      aud: tokenUri,
      iat: now,
      exp: now + 3600,
    }),
  );

  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${claims}`);
  const signature = b64url(signer.sign(sa.private_key));
  const assertion = `${header}.${claims}.${signature}`;

  const res = await fetch(tokenUri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
    cache: "no-store",
  });

  const data = (await res.json().catch(() => null)) as {
    access_token?: string;
    error_description?: string;
    error?: string;
  } | null;

  if (!res.ok || !data?.access_token) {
    throw new Error(
      `GA4 token exchange failed: ${data?.error_description ?? data?.error ?? `HTTP ${res.status}`}`,
    );
  }
  return data.access_token;
}
