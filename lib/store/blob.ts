import { list, put } from "@vercel/blob";
import type { HistoryPoint, Snapshot } from "@/lib/types";

const LATEST_KEY = "seo/latest.json";
const HISTORY_KEY = "seo/history.json";
const SNAPSHOT_PREFIX = "seo/snapshots/";
const MAX_HISTORY = 720; // ~30 days of hourly runs

function hasBlob(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN?.trim());
}

/* ---- In-memory fallback for local dev without a Blob token ---- */
const mem: { latest: Snapshot | null; history: HistoryPoint[] } = {
  latest: null,
  history: [],
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
