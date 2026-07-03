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
  // Normalize: guarantee every collection exists even if the stored blob is
  // from an older schema or partially written.
  const empty = emptyGeoState();
  return {
    ...empty,
    ...(raw ?? {}),
    keywords: Array.isArray(raw?.keywords) ? raw.keywords : empty.keywords,
    articles: Array.isArray(raw?.articles) ? raw.articles : empty.articles,
    draftQueue: Array.isArray(raw?.draftQueue) ? raw.draftQueue : empty.draftQueue,
    signalFirstSeen: raw?.signalFirstSeen ?? empty.signalFirstSeen,
    signalHistory: Array.isArray(raw?.signalHistory) ? raw.signalHistory : empty.signalHistory,
    cycles: Array.isArray(raw?.cycles) ? raw.cycles : empty.cycles,
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
