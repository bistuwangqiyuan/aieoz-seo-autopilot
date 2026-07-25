import { getGeoConfig } from "@/lib/config";
import type { IntegrityViolation } from "@/lib/types";

/**
 * Deterministic content-integrity rules, kept dependency-free so both the
 * pre-publication quality gate (lib/geo/writer.ts) and the post-publication
 * sweep (lib/geo/integrity.ts) can share exactly one definition of "false".
 *
 * The writer prompt forbids unverifiable claims, but a prompt is a request,
 * not a guarantee — one early article did invent competitor benchmark numbers.
 * These rules are the enforcement.
 */

interface Rule {
  id: string;
  pattern: RegExp;
  /** Why this phrasing cannot stand, in the terms a reviewer would use. */
  reason: string;
}

/**
 * Every rule targets a claim the product context never contained, so its
 * presence means the model supplied it — i.e. invented it. Terms that ARE in
 * the verified context (vLLM, LMCache, Ascend 910B, MI308X, MetaX N260,
 * NVMe-oF, the R1-R9 report IDs) are deliberately absent from this list.
 */
const RULES: Rule[] = [
  {
    id: "superlative",
    pattern:
      /\b(only vendor|industry[- ]first|best[- ]in[- ]class|world[- ]leading|unmatched|fastest in the (world|industry))\b/i,
    reason: "无法证实的最高级表述；铭信公开口径中没有这类排名主张",
  },
  {
    id: "invented-stack",
    pattern: /\b(CANN|MindSpore|Atlas 800|SPDK)\b/,
    reason: "具体软硬件栈名称未出现在已核实的产品资料中，属模型自行补全",
  },
  {
    id: "invented-model",
    pattern: /\bLlama[- ]?\d/i,
    reason: "实测报告覆盖的是 DeepSeek 系列与 480B 模型，未测过 Llama，不能声称",
  },
  {
    id: "invented-fabric",
    pattern: /\b(InfiniBand|RoCE\s?v?\d)\b/i,
    reason: "网络组网细节不在公开测试配置里，写具体互联技术即为编造",
  },
  {
    id: "invented-version",
    pattern: /\b(vLLM|CANN|LMCache|NFSv?)\s?v?\d+(\.\d+)+/i,
    reason: "公开材料未标注软件具体版本号，精确到版本会造成不可复现的引用",
  },
  {
    id: "security-claim",
    pattern: /\b(cryptographic(ally)? (signed|verified)|tamper[- ]proof)\b/i,
    reason: "报告为第三方联合测试签署，并非密码学签名，措辞会夸大证据强度",
  },
  {
    id: "invented-firmware",
    pattern: /\bfirmware (version|revision) [\w.]+/i,
    reason: "固件版本号未公开，写出即为编造",
  },
  {
    id: "invented-source",
    pattern: /\b(production telemetry|internal testing|customer data) (logs? )?from \w+/i,
    reason: "除 R1–R9 联合测试报告外没有其他数据来源，虚构佐证来源比虚构数字更严重",
  },
  {
    id: "fx400-availability",
    pattern:
      /\bFX400\b[^.!?]{0,90}\b(shipping|available|in production|generally available|deployed|we (tested|measured|benchmarked)|our (tests|benchmarks) (show|found))\b|\b(shipping|in production|generally available|deployed|we (tested|measured|benchmarked)|our (tests|benchmarks) (show|found))\b[^.!?]{0,40}\bFX400\b/i,
    reason:
      "官网口径为 FX400（PCIe 6.0）2026 年底才量产、当前为厂商标称值而非实测；写成在售或已实测与官网自陈冲突",
  },
];

/* ---------- Numeric verification ---------- */

/**
 * Named-entity rules catch invented product names, but the far more damaging
 * fabrication is an invented *number* — a model will happily write "14.2 GB/s"
 * or "210 ms" beside real measurements, and the two are indistinguishable to a
 * reader. In an article whose entire premise is "every figure is downloadable
 * and reproducible", an unverifiable number does more harm than no number.
 *
 * The allowlist is derived from the verified product context at runtime rather
 * than hard-coded, so it cannot drift out of sync when the context is updated
 * or overridden via GEO_PRODUCT_CONTEXT.
 */
const METRIC_PATTERN =
  /(\d+(?:\.\d+)?)\s*(?:[–—-]\s*(\d+(?:\.\d+)?)\s*)?(million|billion|thousand)?\s*(GB\/s|MB\/s|TB\/s|Tb\/s|Gb\/s|IOPS|µs|μs|ms|GB|TB|[x×]|%)(?![\w/])/gi;

/** Bare-second timings, written in the context as "691s -> 112s". */
const SECONDS_PATTERN = /(\d+(?:\.\d+)?)\s*(?:s\b|seconds\b)/gi;

/**
 * A scale word belongs to the unit, not the number: "1.4 million IOPS" and
 * "1.4 IOPS" are different claims, and collapsing them would let a fabricated
 * headline figure inherit an allowance meant for something else.
 */
function normalizeUnit(unit: string, scale?: string): string {
  const u = unit.toLowerCase();
  const base = u === "×" ? "x" : u === "μs" || u === "µs" ? "us" : u;
  return scale ? `${scale.toLowerCase()}-${base}` : base;
}

/** Every (number, unit) pair the verified context actually supports. */
function allowedMetrics(context: string): Set<string> {
  const allowed = new Set<string>();
  for (const m of context.matchAll(METRIC_PATTERN)) {
    const unit = normalizeUnit(m[4], m[3]);
    allowed.add(`${Number(m[1])}${unit}`);
    if (m[2]) allowed.add(`${Number(m[2])}${unit}`);
  }
  for (const m of context.matchAll(SECONDS_PATTERN)) {
    allowed.add(`${Number(m[1])}s`);
  }
  return allowed;
}

function findNumericViolations(markdown: string, context: string): IntegrityViolation[] {
  const allowed = allowedMetrics(context);
  const seen = new Set<string>();
  const violations: IntegrityViolation[] = [];

  const record = (value: number, unit: string, at: number, raw: string) => {
    const key = `${value}${unit}`;
    if (allowed.has(key) || seen.has(key)) return;
    seen.add(key);
    violations.push({
      rule: "unsourced-metric",
      matched: raw.trim(),
      reason:
        `已核实资料中不存在这个量值（${key}）。文章的全部说服力来自「每个数字都可下载复现」，` +
        `写入无出处的数字——哪怕只是举例或建议阈值——会让读者无法区分实测值与虚构值`,
      excerpt: markdown.slice(Math.max(0, at - 100), at + 100).replace(/\s+/g, " ").trim(),
    });
  };

  for (const m of markdown.matchAll(METRIC_PATTERN)) {
    const unit = normalizeUnit(m[4], m[3]);
    const at = m.index ?? 0;
    record(Number(m[1]), unit, at, m[0]);
    if (m[2]) record(Number(m[2]), unit, at, m[0]);
  }
  for (const m of markdown.matchAll(SECONDS_PATTERN)) {
    record(Number(m[1]), "s", m.index ?? 0, m[0]);
  }

  return violations;
}

/* ---------- Attribution verification ---------- */

/**
 * Every signed report R1-R9 names the same device under test: FX100 (the
 * historical filenames read AISSD5000 / WS5000 / GP5000, which the site
 * documents as former names for that one product). FX200, FX300 and FX400 are
 * real products but have no published measurements.
 *
 * So the dangerous sentence is not an invented number — it is a *real* number
 * bolted onto the wrong model. "FX300 cuts TTFT by 26-32%" is built entirely
 * from verified parts and is still false, which makes it invisible to both the
 * named-entity rules and the numeric allowlist above.
 */
const UNMEASURED_MODELS = /\bFX(200|300|400)\b/g;
const LEGACY_NAMES = /\b(AISSD5000|WS5000|GP5000)\b/g;
/**
 * FX400's headline figures are publishable, but only as what they are. The
 * site labels every number by provenance (measured / vendor / public /
 * estimated); dropping the label is how a projection becomes a measurement.
 */
const VENDOR_SPEC_FIGURES = /\b(4\.8\s*Tb\/s|140\s*million\s*IOPS|1\.4\s*(亿|hundred million)\s*IOPS)\b/gi;
const VENDOR_SPEC_LABEL = /\b(vendor[- ](spec|specification|claim|figure)|manufacturer[- ]stated|not yet measured|厂商口径)\b/i;
/** Marks a sentence as being *about* provenance rather than asserting a result. */
const PROVENANCE_HEDGE =
  /\b(no published|not (yet )?(been )?(measured|benchmarked|tested)|unmeasured|former(ly)?|historical|previously|also known as|same product|renamed|report filename|naming|vendor spec|planned|roadmap|late 2026)\b/i;

function sentences(markdown: string): { text: string; at: number }[] {
  const out: { text: string; at: number }[] = [];
  let at = 0;
  for (const part of markdown.split(/(?<=[.!?])\s+|\n+/)) {
    if (part.trim()) out.push({ text: part, at });
    at += part.length + 1;
  }
  return out;
}

function findAttributionViolations(markdown: string, context: string): IntegrityViolation[] {
  const allowed = allowedMetrics(context);
  const violations: IntegrityViolation[] = [];
  const seen = new Set<string>();

  const push = (rule: string, matched: string, reason: string, at: number) => {
    if (seen.has(`${rule}:${matched}`)) return;
    seen.add(`${rule}:${matched}`);
    violations.push({
      rule,
      matched,
      reason,
      excerpt: markdown.slice(Math.max(0, at - 100), at + 100).replace(/\s+/g, " ").trim(),
    });
  };

  for (const { text, at } of sentences(markdown)) {
    for (const figure of [...text.matchAll(VENDOR_SPEC_FIGURES)].map((m) => m[0])) {
      if (VENDOR_SPEC_LABEL.test(text)) continue;
      push(
        "unlabeled-vendor-spec",
        figure,
        `${figure} 是 FX400 的厂商标称值，尚无实测。官网对每个数字都标注来源（实测/厂商/公开/估算），` +
          `不带标注地引用会把一个projection读成一次测量`,
        at,
      );
    }

    if (PROVENANCE_HEDGE.test(text)) continue;

    const models = [...text.matchAll(UNMEASURED_MODELS)].map((m) => m[0]);
    if (models.length > 0 && !/\bFX100\b/.test(text)) {
      // A measured figure in this sentence can only have come from an FX100
      // report, so naming a different model attributes it to the wrong device.
      const carriesMeasurement =
        /\bR[1-9]\b/.test(text) ||
        [...text.matchAll(METRIC_PATTERN)].some((m) =>
          allowed.has(`${Number(m[1])}${normalizeUnit(m[4], m[3])}`),
        ) ||
        [...text.matchAll(SECONDS_PATTERN)].some((m) => allowed.has(`${Number(m[1])}s`));

      if (carriesMeasurement) {
        push(
          "benchmark-misattribution",
          models[0],
          `R1–R9 全部以 FX100 为被测设备（官网证据库明示 "Device under test: Mingxin FX100"），` +
            `${models[0]} 没有公开实测数据。把 FX100 的实测值安到 ${models[0]} 上，每个零件都是真的、` +
            `整句话却是假的——这比编造数字更难被发现`,
          at,
        );
      }
    }

    for (const legacy of [...text.matchAll(LEGACY_NAMES)].map((m) => m[0])) {
      if (/\bFX100\b/.test(text)) continue;
      push(
        "legacy-name-as-product",
        legacy,
        `${legacy} 是 FX100 的历史称谓（仅保留在原始报告文件名中以便查证），不是在售的独立型号；` +
          `当作单独产品来写会让读者以为铭信有更多产品线`,
        at,
      );
    }
  }

  return violations;
}

/**
 * All integrity violations in a piece of text. `context` defaults to the
 * configured product context; pass it explicitly to test against a fixed set.
 */
export function findViolations(markdown: string, context?: string): IntegrityViolation[] {
  const violations: IntegrityViolation[] = [];

  for (const rule of RULES) {
    const match = rule.pattern.exec(markdown);
    if (!match) continue;
    const at = match.index ?? 0;
    violations.push({
      rule: rule.id,
      matched: match[0],
      reason: rule.reason,
      excerpt: markdown.slice(Math.max(0, at - 100), at + 100).replace(/\s+/g, " ").trim(),
    });
  }

  const ctx = context ?? getGeoConfig().productContext;
  violations.push(...findNumericViolations(markdown, ctx));
  violations.push(...findAttributionViolations(markdown, ctx));
  return violations;
}
