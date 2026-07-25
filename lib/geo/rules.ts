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
    /**
     * NFS is handled separately from the rest. The verified context says model
     * loading is "6.2-9.3x faster than NFS", so a comparison table row reading
     * `| NFS | 6.2-9.3x |` puts the word and the number side by side with
     * nothing between them — and a pattern accepting "NFS 6.2" reads that as a
     * version number and flags a correct, sourced sentence. A false positive
     * here is not harmless: it sends a good article to be rewritten.
     *
     * Real NFS versions are written NFSv4.1 or NFS v4.1, so requiring the "v"
     * keeps the rule while removing the collision. (There is also no NFS 6.2 —
     * the protocol stops at 4.2.)
     */
    id: "invented-version",
    pattern: /\b(vLLM|CANN|LMCache)\s?v?\d+(\.\d+)+|\bNFS\s?v\d+(\.\d+)*/i,
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
 * The headline is part of the claim, and the most load-bearing part of it: a
 * title promising "Comprehensive FX300 Benchmarks" is a misattribution even
 * when the body underneath correctly credits every figure to the FX100. It also
 * survives repair, because a sweep that only rewrites the body leaves the
 * promise standing — and for a retrieval engine the title carries the most
 * weight of anything on the page.
 */
export function auditText(title: string, markdown: string): string {
  return title.trim() ? `${title.trim()}\n\n${markdown}` : markdown;
}

/**
 * A title can make the false claim without containing a single number:
 * "Comprehensive Benchmarks for Mingxin FX300" promises measurements that do
 * not exist, and every sentence below it can be scrupulously correct. The
 * sentence-level attribution check cannot see that by construction — it looks
 * for a real figure next to the wrong model, and here the figures are all
 * correctly credited to the FX100 one line down.
 *
 * So the promise itself is the violation, and it is judged at document level.
 * Note what stays allowed: comparing these models, discussing them, or
 * explaining how to evaluate one. Only claiming to *report measurements* of an
 * unmeasured product is barred — a rule that made FX200/FX300 unmentionable
 * would be its own kind of distortion.
 */
const PROMISES_MEASUREMENT =
  /\b(benchmarks?|benchmarked|benchmarking|performance (results|data|numbers|figures)|test results|measured results|measurements)\b/i;
const TITLE_HEDGE =
  /\b(no published|not yet|unmeasured|without published|how to (evaluate|test|measure|benchmark)|what to (ask|look|expect)|evaluating|evaluation|choosing|your own|vendor spec|planned|roadmap|FX100)\b/i;

export function findTitleViolations(title: string): IntegrityViolation[] {
  const models = [...title.matchAll(UNMEASURED_MODELS)].map((m) => m[0]);
  if (models.length === 0) return [];
  if (!PROMISES_MEASUREMENT.test(title) || TITLE_HEDGE.test(title)) return [];

  return [
    {
      rule: "title-promises-unmeasured-benchmark",
      matched: title,
      reason:
        `标题承诺提供 ${models[0]} 的实测数据，而 R1–R9 全部以 FX100 为被测设备、${models[0]} 没有任何公开实测。` +
        `标题不含数字，所以逐句校验抓不到它——正文可以句句正确，标题却已经把结论说错了；` +
        `对检索引擎而言标题是权重最高的信号，改正文不改标题等于没改`,
      excerpt: title,
    },
  ];
}

/* ---------- Rule-set versioning ---------- */

/**
 * Adding a rule is worthless if the corpus published before it is never
 * re-examined. That happened once already: the misattribution rule landed while
 * five live articles carried exactly that fault, and the rotation would have
 * taken a day to stumble onto them — the fault was found by hand, which is the
 * one thing this system is not allowed to depend on.
 *
 * So each article records the rule set it was cleared against. Change a
 * pattern, or change the product context the numeric allowlist derives from,
 * and every article's stamp goes stale, which puts the whole corpus back at the
 * front of the sweep queue automatically.
 */
function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/**
 * Bump when the checking *logic* changes in a way the patterns below do not
 * capture — widening what gets audited, changing how sentences are split, etc.
 * Without this, a change like "audit the title too" would leave every existing
 * article stamped as compliant and its title never examined: the same blind
 * spot the versioning exists to remove, wearing a different hat.
 *
 * 2: titles are audited together with the body.
 */
const AUDIT_REVISION = 2;

/** Identifies what "compliant" currently means, for staleness comparison. */
export function currentRulesVersion(context?: string): string {
  const surface = [
    `audit-revision:${AUDIT_REVISION}`,
    ...RULES.map((r) => `${r.id}|${r.pattern.source}`),
    METRIC_PATTERN.source,
    SECONDS_PATTERN.source,
    UNMEASURED_MODELS.source,
    LEGACY_NAMES.source,
    VENDOR_SPEC_FIGURES.source,
    VENDOR_SPEC_LABEL.source,
    PROVENANCE_HEDGE.source,
    PROMISES_MEASUREMENT.source,
    TITLE_HEDGE.source,
    // The allowlist is derived from the context, so the context is part of the
    // definition: a new verified figure legitimises text that was a violation.
    context ?? getGeoConfig().productContext,
  ].join("\n");
  return fnv1a(surface);
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

/**
 * Everything wrong with an article, title included. Callers that have both
 * should use this rather than assembling the checks themselves — a title rule
 * is only worth having if it cannot be forgotten at one call site.
 */
export function findArticleViolations(
  title: string,
  markdown: string,
  context?: string,
): IntegrityViolation[] {
  return [...findTitleViolations(title), ...findViolations(auditText(title, markdown), context)];
}
