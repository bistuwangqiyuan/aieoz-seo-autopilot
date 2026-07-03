import { list, put } from "@vercel/blob";
import type { GeoState, HistoryPoint, Snapshot } from "@/lib/types";

const LATEST_KEY = "seo/latest.json";
const HISTORY_KEY = "seo/history.json";
const SNAPSHOT_PREFIX = "seo/snapshots/";
const GEO_STATE_KEY = "geo/state.json";
const MAX_HISTORY = 720; // ~30 days of hourly runs

function hasBlob(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN?.trim());
}

/* ---- In-memory fallback for local dev without a Blob token ---- */
const mem: { latest: Snapshot | null; history: HistoryPoint[]; geo: GeoState | null } = {
  latest: null,
  history: [],
  geo: null,
};

async function readJson<T>(key: string): Promise<T | null> {
  if (!hasBlob()) return null;
  try {
    const { blobs } = await list({ prefix: key, limit: 1 });
    const blob = blobs.find((b) => b.pathname === key) ?? blobs[0];
    if (!blob) return null;
    const res = await fetch(blob.url, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch (err) {
    console.error(`[blob] read ${key} failed:`, err);
    return null;
  }
}

async function writeJson(key: string, data: unknown): Promise<void> {
  if (!hasBlob()) return;
  await put(key, JSON.stringify(data), {
    access: "public",
    contentType: "application/json",
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 0,
  });
}

export async function saveSnapshot(snapshot: Snapshot): Promise<void> {
  const point: HistoryPoint = {
    id: snapshot.id,
    createdAt: snapshot.createdAt,
    score: snapshot.score,
    trigger: snapshot.trigger,
  };

  if (!hasBlob()) {
    mem.latest = snapshot;
    mem.history = [...mem.history, point].slice(-MAX_HISTORY);
    return;
  }

  const history = (await readJson<HistoryPoint[]>(HISTORY_KEY)) ?? [];
  const nextHistory = [...history, point].slice(-MAX_HISTORY);

  await Promise.all([
    writeJson(LATEST_KEY, snapshot),
    writeJson(HISTORY_KEY, nextHistory),
    writeJson(`${SNAPSHOT_PREFIX}${snapshot.id}.json`, snapshot),
  ]);
}

export async function getLatest(): Promise<Snapshot | null> {
  if (!hasBlob()) return mem.latest;
  return readJson<Snapshot>(LATEST_KEY);
}

export async function listHistory(): Promise<HistoryPoint[]> {
  if (!hasBlob()) return mem.history;
  return (await readJson<HistoryPoint[]>(HISTORY_KEY)) ?? [];
}

export function storageMode(): "blob" | "memory" {
  return hasBlob() ? "blob" : "memory";
}

/* ==================== GEO state ==================== */

export function emptyGeoState(): GeoState {
  return {
    keywords: [],
    articles: [],
    draftQueue: [],
    signalFirstSeen: {},
    signalHistory: [],
    cycles: [],
  };
}

const MAX_GEO_ARTICLES = 400;
const MAX_GEO_DRAFTS = 200;
const MAX_GEO_SIGNAL_CHECKS = 180; // ~30 days at 6 checks/day
const MAX_GEO_CYCLES = 180;

export async function getGeoState(): Promise<GeoState> {
  const raw = hasBlob() ? await readJson<Partial<GeoState>>(GEO_STATE_KEY) : mem.geo;
  return sanitizeGeoState(raw);
}

/**
 * Normalize a stored state so legacy/partial/corrupt blobs can never crash the
 * pipeline: every collection exists and every item carries required fields.
 */
export function sanitizeGeoState(raw: Partial<GeoState> | null | undefined): GeoState {
  const empty = emptyGeoState();
  const now = new Date().toISOString();
  const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

  const keywords = arr<Partial<GeoState["keywords"][number]>>(raw?.keywords)
    .filter((k) => typeof k?.keyword === "string" && k.keyword.trim() !== "")
    .map((k) => ({
      keyword: k.keyword!,
      intent: typeof k.intent === "string" ? k.intent : "unknown",
      rationale: typeof k.rationale === "string" ? k.rationale : "",
      priority: typeof k.priority === "number" ? k.priority : 3,
      status: (k.status === "written" || k.status === "published" ? k.status : "pending") as GeoState["keywords"][number]["status"],
      createdAt: typeof k.createdAt === "string" ? k.createdAt : now,
      articleSlug: typeof k.articleSlug === "string" ? k.articleSlug : undefined,
    }));

  const articles = arr<Partial<GeoState["articles"][number]>>(raw?.articles)
    .filter((a) => typeof a?.slug === "string" && typeof a?.title === "string")
    .map((a) => ({
      slug: a.slug!,
      keyword: typeof a.keyword === "string" ? a.keyword : "",
      title: a.title!,
      description: typeof a.description === "string" ? a.description : "",
      tags: arr<string>(a.tags),
      markdown: typeof a.markdown === "string" ? a.markdown : "",
      quoraAnswer: typeof a.quoraAnswer === "string" ? a.quoraAnswer : "",
      redditPost: typeof a.redditPost === "string" ? a.redditPost : "",
      canonicalUrl: typeof a.canonicalUrl === "string" ? a.canonicalUrl : "",
      createdAt: typeof a.createdAt === "string" ? a.createdAt : now,
      aiGenerated: Boolean(a.aiGenerated),
      publishResults: arr<GeoState["articles"][number]["publishResults"][number]>(a.publishResults),
    }));

  const draftQueue = arr<Partial<GeoState["draftQueue"][number]>>(raw?.draftQueue)
    .filter((d) => typeof d?.content === "string" && (d.platform === "medium" || d.platform === "quora"))
    .map((d) => ({
      platform: d.platform!,
      articleSlug: typeof d.articleSlug === "string" ? d.articleSlug : "",
      title: typeof d.title === "string" ? d.title : "",
      content: d.content!,
      createdAt: typeof d.createdAt === "string" ? d.createdAt : now,
    }));

  return {
    keywords,
    articles,
    draftQueue,
    signalFirstSeen:
      raw?.signalFirstSeen && typeof raw.signalFirstSeen === "object"
        ? raw.signalFirstSeen
        : empty.signalFirstSeen,
    signalHistory: arr(raw?.signalHistory),
    cycles: arr(raw?.cycles),
    telegraphToken: typeof raw?.telegraphToken === "string" ? raw.telegraphToken : undefined,
  };
}

export async function saveGeoState(state: GeoState): Promise<void> {
  const trimmed: GeoState = {
    ...state,
    articles: state.articles.slice(-MAX_GEO_ARTICLES),
    draftQueue: state.draftQueue.slice(-MAX_GEO_DRAFTS),
    signalHistory: state.signalHistory.slice(-MAX_GEO_SIGNAL_CHECKS),
    cycles: state.cycles.slice(-MAX_GEO_CYCLES),
  };
  if (!hasBlob()) {
    mem.geo = trimmed;
    return;
  }
  await writeJson(GEO_STATE_KEY, trimmed);
}
