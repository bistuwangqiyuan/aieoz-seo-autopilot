/**
 * Acceptance check for the deep-link resolver: prints the landing page each
 * seed/sample keyword resolves to, so the mapping can be eyeballed against the
 * official site's actual page inventory.
 *
 *   npx tsx scripts/test-landing.ts
 */
import { getSiteMap, countByKind } from "../lib/site/map";
import { resolveLandingTarget } from "../lib/site/landing";

const KEYWORDS = [
  "how to reduce time to first token with kv cache tiering",
  "offload llm kv cache to external nvme storage vs recompute",
  "why is model loading so slow from nfs on gpu clusters",
  "nvme-of storage array vs local nvme for llm inference latency",
  "storage bandwidth requirements for llm training checkpointing",
  "running llm inference on amd mi308x or huawei ascend 910b",
  "lmcache cold read performance tuning for vllm",
  "how to verify storage vendor benchmark claims before buying",
  "long context llm inference cold start recovery optimization",
  "ai datacenter storage architecture for thousand gpu clusters",
  "vast data vs nvme-of array for llm inference",
  "weka filesystem alternative for kv cache",
  "how does mooncake handle kv cache transfer",
  "prefix caching vs full kv cache offload",
  "sglang kv cache storage backend options",
  "moe model inference storage bottlenecks",
  "kv cache eviction policy for long running agents",
  "prefill decode disaggregation storage requirements",
  "tco model for gpu cluster storage tier",
  "rag knowledge base retrieval latency at scale",
];

async function main() {
  const map = await getSiteMap(true);
  console.log(`sitemap: ${map.pages.length} pages${map.error ? ` (ERROR: ${map.error})` : ""}`);
  console.log("by kind:", JSON.stringify(countByKind(map.pages)));
  console.log(
    "english candidates:",
    map.pages.filter((p) => p.lang === "en" && p.kind !== "other" && p.kind !== "insight").length,
  );
  console.log("");

  let deep = 0;
  for (const kw of KEYWORDS) {
    const t = await resolveLandingTarget(kw);
    if (t.path !== "/en") deep += 1;
    const flag = t.path === "/en" ? "HOME" : t.kind.toUpperCase();
    console.log(`[${flag.padEnd(8)}] ${t.method.padEnd(7)} ${kw}\n            -> ${t.path}`);
  }
  console.log(`\ndeep-linked: ${deep}/${KEYWORDS.length}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
