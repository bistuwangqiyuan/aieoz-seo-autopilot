// Shared .env.local reader + authorized status/cron callers for the operational
// scripts. The status and cron endpoints both sit behind CRON_SECRET, so every
// script needs the same two things and they must not drift apart.
import { readFileSync } from "node:fs";

export function loadEnv(file = ".env.local") {
  const env = {};
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)="?([^"\r]*)"?\s*$/);
    if (m) env[m[1]] = m[2];
  }
  return env;
}

export const BASE = process.env.APP_URL ?? "https://www.clawpro.pw";

export async function fetchStatus(secret) {
  const res = await fetch(`${BASE}/api/status`, {
    headers: { Authorization: `Bearer ${secret}` },
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`status endpoint HTTP ${res.status}`);
  return res.json();
}

export async function runCron(secret) {
  const started = Date.now();
  const res = await fetch(`${BASE}/api/cron/scan`, {
    headers: { Authorization: `Bearer ${secret}` },
    signal: AbortSignal.timeout(310_000),
  });
  const text = await res.text();
  return { ok: res.ok, status: res.status, seconds: Math.round((Date.now() - started) / 1000), text };
}
