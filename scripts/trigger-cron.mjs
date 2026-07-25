// Fire one production cron run (SEO scan + GEO cycle) and print the result.
import { readFileSync } from "node:fs";

const env = {};
for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)="?([^"\r]*)"?\s*$/);
  if (m) env[m[1]] = m[2];
}

const BASE = process.env.APP_URL ?? "https://www.clawpro.pw";
const started = Date.now();
const res = await fetch(`${BASE}/api/cron/scan`, {
  headers: { Authorization: `Bearer ${env.CRON_SECRET}` },
  signal: AbortSignal.timeout(310_000),
});
const body = await res.text();
console.log(`HTTP ${res.status} in ${Math.round((Date.now() - started) / 1000)}s`);
console.log(body.slice(0, 2000));
process.exitCode = res.ok ? 0 : 1;
