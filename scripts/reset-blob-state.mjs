// One-shot ops script: wipe legacy ZK-Storage era state (geo/*, seo/*) from the
// Vercel Blob store so the Mingxin autopilot starts from a clean slate.
// Usage: node scripts/reset-blob-state.mjs   (reads BLOB_READ_WRITE_TOKEN from .env.local or env)
import { readFileSync } from "node:fs";
import { list, del } from "@vercel/blob";

if (!process.env.BLOB_READ_WRITE_TOKEN) {
  try {
    const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
    const m = env.match(/BLOB_READ_WRITE_TOKEN="?([^\r\n"]+)/);
    if (m) process.env.BLOB_READ_WRITE_TOKEN = m[1];
  } catch {
    // fall through to the check below
  }
}
if (!process.env.BLOB_READ_WRITE_TOKEN) {
  console.error("BLOB_READ_WRITE_TOKEN not found (env or .env.local)");
  process.exit(1);
}

let deleted = 0;
for (const prefix of ["geo/", "seo/"]) {
  let cursor;
  do {
    const res = await list({ prefix, cursor });
    for (const b of res.blobs) {
      await del(b.url);
      deleted++;
      console.log("deleted", b.pathname);
    }
    cursor = res.cursor;
  } while (cursor);
}
console.log("total deleted:", deleted);
