/**
 * The integrity rules gate publication and rewrite live articles automatically,
 * so a false positive silently mangles correct content and a false negative
 * leaves a fabricated claim standing. Both directions are checked here.
 *
 *   npx tsx scripts/test-integrity.ts
 */
import { findViolations } from "../lib/geo/rules";

/**
 * The verified fact set, pinned so this test does not drift when the runtime
 * context is edited. Mirrors DEFAULT_PRODUCT_CONTEXT in lib/config.ts.
 */
const CONTEXT =
  "FX100 (PCIe 3.0), FX200 (PCIe 4.0), FX300 (PCIe 5.0) shipping; FX400 (PCIe 6.0) planned late 2026 " +
  "(vendor spec, not yet measured). Reports R1-R9: KV-cache tiering on a 480B-parameter model lifts " +
  "inference throughput by 29-40% and cuts TTFT p50 by 26-32% (R2/R3); cold-context recovery is 8.6-20x " +
  "faster than recompute (R2); model loading is 6.2-9.3x faster than NFS on Huawei Ascend 910B — " +
  "DeepSeek-32B 691s -> 112s, DeepSeek-70B 1399s -> 150s (R9); checkpoint saves of 65.6 GB snapshots are " +
  "1.9x faster, 178s -> 94s (R1); an LMCache parallel-read patch improves cold-read TTFT 4.1x, " +
  "37.97s -> 9.30s (R1). Open source: https://github.com/mingxin-tech/mingxin-kvcache-bench. " +
  "Non-NVIDIA enablement: AMD MI308X, Huawei Ascend 910B, MetaX N260.";

/** Must be flagged: none of these are supported by the verified context. */
const MUST_FLAG: [string, string][] = [
  ["superlative", "Mingxin is the only vendor shipping KV-cache tiering at this scale."],
  ["superlative", "An industry-first approach to external KV cache."],
  ["superlative", "Best-in-class throughput across every workload."],
  ["invented-stack", "The array integrates with Huawei CANN for device-side access."],
  ["invented-stack", "Tested on an Atlas 800 inference server."],
  ["invented-stack", "Zero-copy kernel bypass via the native SPDK stack."],
  ["invented-model", "Measured on Llama-3 70B with 8 GPUs."],
  ["invented-fabric", "Connected over InfiniBand NDR to the compute fabric."],
  ["invented-fabric", "The fabric runs RoCE v2 with PFC enabled."],
  ["invented-version", "Running vLLM 0.6.3 with LMCache enabled."],
  ["invented-version", "Identical CANN 7.0 stack on both sides."],
  ["security-claim", "Every report is cryptographically signed by the lab."],
  ["invented-firmware", "Controller firmware version 2.14.7 was used."],
  ["invented-source", "Documented in production telemetry logs from three operators."],
  // Invented numbers — the failure mode that actually occurred in generation.
  ["unsourced-metric", "The FX300 sustains 14.2 GB/s bidirectional bandwidth."],
  ["unsourced-metric", "Restoring the slice takes 210 ms over NVMe-oF."],
  ["unsourced-metric", "Deterministic sub-100μs read latencies at the tail."],
  ["unsourced-metric", "Smaller models show lower uplift of 12-18%."],
  ["unsourced-metric", "Throughput gain falls to 22% without the fabric."],
  ["unsourced-metric", "Restoring a 12.7 GB KV cache slice from disk."],
  ["unsourced-metric", "Target a cold-start TTFT under 500 ms at p95."],
  ["unsourced-metric", "It takes 4.2 s over NFS in our measurements."],
  ["unsourced-metric", "The array delivers 1.4 million IOPS at queue depth 32."],
];

/**
 * Must NOT be flagged: all of this is in the verified context, and a rule that
 * trips on it would rewrite accurate text into something worse.
 */
const MUST_PASS = [
  "TTFT p50 dropped 26-32% on a 480B-parameter model (report R2).",
  "Inference throughput rose 29-40% with KV-cache tiering (R2/R3).",
  "Cold-context recovery is 8.6-20x faster than recomputing (R2).",
  "DeepSeek-32B model loading fell from 691s to 112s versus NFS on Ascend 910B (R9).",
  "DeepSeek-70B loading fell from 1399s to 150s (R9).",
  "Checkpoint saves of a 65.6 GB snapshot went from 178s to 94s, 1.9x faster (R1).",
  "An LMCache parallel-read patch improved cold-read TTFT 4.1x, 37.97s to 9.30s (R1).",
  "Model loading is 6.2-9.3x faster than NFS on the Huawei Ascend 910B platform.",
  "Benchmarks are reproducible from the open-source mingxin-kvcache-bench repository.",
  "The array exposes namespaces over NVMe-oF rather than a POSIX NFS mount.",
  "No published signed benchmark covers this workload.",
  "Inference was validated on Huawei Ascend 910B, AMD MI308X and MetaX N260.",
  "FX400 figures are vendor spec and have not been measured.",
  "Measure it on your own hardware rather than trusting a vendor's best-case config.",
];

let failures = 0;

console.log("A. fabricated claims must be flagged");
for (const [expectedRule, text] of MUST_FLAG) {
  const found = findViolations(text, CONTEXT);
  const hit = found.some((v) => v.rule === expectedRule);
  if (!hit) failures += 1;
  console.log(
    `  ${hit ? "PASS" : "FAIL"}  [${expectedRule}] ${text.slice(0, 58)}` +
      (hit ? "" : `  (got: ${found.map((v) => v.rule).join(",") || "nothing"})`),
  );
}

console.log("\nB. verified facts must survive untouched");
for (const text of MUST_PASS) {
  const found = findViolations(text, CONTEXT);
  const clean = found.length === 0;
  if (!clean) failures += 1;
  console.log(
    `  ${clean ? "PASS" : "FAIL"}  ${text.slice(0, 58)}` +
      (clean ? "" : `  (flagged: ${found.map((v) => `${v.rule}="${v.matched}"`).join(", ")})`),
  );
}

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURES`}`);
if (failures > 0) process.exit(1);
