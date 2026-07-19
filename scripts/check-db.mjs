// Sanity check: is the project's DATABASE_URL reachable and writable?
import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";

if (!process.env.DATABASE_URL) {
  const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
  const m = env.match(/^DATABASE_URL="?([^\r\n"]+)/m);
  if (m) process.env.DATABASE_URL = m[1];
}
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL not found");
  process.exit(1);
}
console.log("value shape:", process.env.DATABASE_URL.slice(0, 12) + "... len=" + process.env.DATABASE_URL.length);
try {
  const u = new URL(process.env.DATABASE_URL);
  console.log("host:", u.hostname, "db:", u.pathname);
} catch {
  console.log("not a plain URL");
}

const sql = neon(process.env.DATABASE_URL);
const [{ now }] = await sql`SELECT now()`;
console.log("connected, server time:", now);
await sql`CREATE TABLE IF NOT EXISTS autopilot_kv (key text PRIMARY KEY, value jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now())`;
await sql`INSERT INTO autopilot_kv (key, value) VALUES ('healthcheck', '{"ok":true}'::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`;
const rows = await sql`SELECT value FROM autopilot_kv WHERE key = 'healthcheck'`;
console.log("kv round-trip:", JSON.stringify(rows[0]?.value));
const tables = await sql`SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename`;
console.log("public tables:", tables.map((t) => t.tablename).join(", "));
