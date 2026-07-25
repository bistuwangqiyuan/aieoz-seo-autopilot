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

  violations.push(...findNumericViolations(markdown, context ?? getGeoConfig().productContext));
  return violations;
}
