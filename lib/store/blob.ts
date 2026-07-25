import { neon } from "@neondatabase/serverless";
import { list, put } from "@vercel/blob";
import type { GeoState, HistoryPoint, Snapshot } from "@/lib/types";

const LATEST_KEY = "seo/latest.json";
const HISTORY_KEY = "seo/history.json";
const SNAPSHOT_PREFIX = "seo/snapshots/";
const GEO_STATE_KEY = "geo/state.json";
const MAX_HISTORY = 720; // ~30 days of hourly runs

/**
 * Persistence backends, in priority order:
 *   1. Neon Postgres (DATABASE_URL) — key/value JSONB table `autopilot_kv`
 *   2. Vercel Blob (BLOB_READ_WRITE_TOKEN)
 *   3. In-memory (local dev without credentials)
 * Postgres is preferred because the project's Blob store can be suspended by
 * account usage limits, which would silently kill the whole loop.
 */
function pgUrl(): string | null {
  const raw = process.env.DATABASE_URL?.trim();
  // Guard against placeholder values (e.g. `vercel env pull` masks secrets).
  return raw && raw.startsWith("postgres") ? raw : null;
}

function hasBlob(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN?.trim());
}

export function storageMode(): "postgres" | "blob" | "memory" {
  if (pgUrl()) return "postgres";
  if (hasBlob()) return "blob";
  return "memory";
}

/* ---- In-memory fallback for local dev without credentials ---- */
const mem: { latest: Snapshot | null; history: HistoryPoint[]; geo: GeoState | null } = {
  latest: null,
  history: [],
  geo: null,
};

/* ---- Postgres KV backend ---- */

let tableReady: Promise<void> | null = null;

function sql() {
  return neon(pgUrl()!);
}

function ensureTable(): Promise<void> {
  if (!tableReady) {
    tableReady = sql()`
      CREATE TABLE IF NOT EXISTS autopilot_kv (
        key text PRIMARY KEY,
        value jsonb NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `.then(() => undefined);
  }
  return tableReady;
}

async function pgRead<T>(key: string): Promise<T | null> {
  try {
    await ensureTable();
    const rows = await sql()`SELECT value FROM autopilot_kv WHERE key = ${key}`;
    return rows.length ? (rows[0].value as T) : null;
  } catch (err) {
    console.error(`[store/pg] read ${key} failed:`, err);
    return null;
  }
}

async function pgWrite(key: string, data: unknown): Promise<void> {
  await ensureTable();
  await sql()`
    INSERT INTO autopilot_kv (key, value) VALUES (${key}, ${JSON.stringify(data)}::jsonb)
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
  `;
}

/* ---- Vercel Blob backend ---- */

async function blobRead<T>(key: string): Promise<T | null> {
  try {
    const { blobs } = await list({ prefix: key, limit: 1 });
    const blob = blobs.find((b) => b.pathname === key) ?? blobs[0];
    if (!blob) return null;
    const res = await fetch(blob.url, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch (err) {
    console.error(`[store/blob] read ${key} failed:`, err);
    return null;
  }
}

async function blobWrite(key: string, data: unknown): Promise<void> {
  await put(key, JSON.stringify(data), {
    access: "public",
    contentType: "application/json",
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 0,
  });
}

/* ---- Unified KV ---- */

async function readJson<T>(key: string): Promise<T | null> {
  const mode = storageMode();
  if (mode === "postgres") return pgRead<T>(key);
  if (mode === "blob") return blobRead<T>(key);
  return null;
}

async function writeJson(key: string, data: unknown): Promise<void> {
  const mode = storageMode();
  if (mode === "postgres") return pgWrite(key, data);
  if (mode === "blob") return blobWrite(key, data);
}

/**
 * Generic KV access for auxiliary records (site map, audit coverage) that do
 * not warrant their own typed accessor. In-memory mode keeps them in a plain
 * map so local runs behave like production.
 */
const memKv = new Map<string, unknown>();

export async function readKv<T>(key: string): Promise<T | null> {
  if (storageMode() === "memory") return (memKv.get(key) as T) ?? null;
  return readJson<T>(key);
}

export async function writeKv(key: string, data: unknown): Promise<void> {
  if (storageMode() === "memory") {
    memKv.set(key, data);
    return;
  }
  await writeJson(key, data);
}

/* ==================== SEO snapshots ==================== */

export async function saveSnapshot(snapshot: Snapshot): Promise<void> {
  const point: HistoryPoint = {
    id: snapshot.id,
    createdAt: snapshot.createdAt,
    score: snapshot.score,
    trigger: snapshot.trigger,
  };

  if (storageMode() === "memory") {
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
  if (storageMode() === "memory") return mem.latest;
  return readJson<Snapshot>(LATEST_KEY);
}

export async function listHistory(): Promise<HistoryPoint[]> {
  if (storageMode() === "memory") return mem.history;
  return (await readJson<HistoryPoint[]>(HISTORY_KEY)) ?? [];
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
    citationHistory: [],
    livenessHistory: [],
  };
}

const MAX_GEO_ARTICLES = 400;
const MAX_GEO_DRAFTS = 200;
const MAX_GEO_SIGNAL_CHECKS = 180; // ~30 days at 6 checks/day
const MAX_GEO_CYCLES = 180;
const MAX_EFFECT_CHECKS = 180;

export async function getGeoState(): Promise<GeoState> {
  const raw = storageMode() === "memory" ? mem.geo : await readJson<Partial<GeoState>>(GEO_STATE_KEY);
  return sanitizeGeoState(raw);
}

/**
 * Normalize a stored state so legacy/partial/corrupt records can never crash
 * the pipeline: every collection exists and every item carries required fields.
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
      referenceUrl: typeof a.referenceUrl === "string" ? a.referenceUrl : "",
      landingKind: typeof a.landingKind === "string" ? a.landingKind : undefined,
      evidenceUrl: typeof a.evidenceUrl === "string" ? a.evidenceUrl : undefined,
      createdAt: typeof a.createdAt === "string" ? a.createdAt : now,
      aiGenerated: Boolean(a.aiGenerated),
      publishResults: arr<GeoState["articles"][number]["publishResults"][number]>(a.publishResults),
      // Progress markers for the one-off backlink migration and the rolling
      // integrity sweep. Dropping them here would not lose an article, it
      // would lose the record that we already handled it — so both jobs would
      // reprocess the same oldest few every cycle and never finish.
      linkBackfilledAt: typeof a.linkBackfilledAt === "string" ? a.linkBackfilledAt : undefined,
      integrityCheckedAt: typeof a.integrityCheckedAt === "string" ? a.integrityCheckedAt : undefined,
      integrityFlags: Array.isArray(a.integrityFlags) ? arr<string>(a.integrityFlags) : undefined,
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
    citationHistory: arr(raw?.citationHistory),
    livenessHistory: arr(raw?.livenessHistory),
  };
}

export async function saveGeoState(state: GeoState): Promise<void> {
  const trimmed: GeoState = {
    ...state,
    articles: state.articles.slice(-MAX_GEO_ARTICLES),
    draftQueue: state.draftQueue.slice(-MAX_GEO_DRAFTS),
    signalHistory: state.signalHistory.slice(-MAX_GEO_SIGNAL_CHECKS),
    cycles: state.cycles.slice(-MAX_GEO_CYCLES),
    citationHistory: state.citationHistory.slice(-MAX_EFFECT_CHECKS),
    livenessHistory: state.livenessHistory.slice(-MAX_EFFECT_CHECKS),
  };
  if (storageMode() === "memory") {
    mem.geo = trimmed;
    return;
  }
  await writeJson(GEO_STATE_KEY, trimmed);
}
