import type { CrossPageAudit } from "@/lib/types";

/**
 * Audit coverage and the structural findings a per-page audit cannot produce.
 * Each run audits the core pages plus an oldest-first rotation of the rest;
 * the bar below is how you tell whether that rotation is keeping up.
 */
export function CoveragePanel({ cross }: { cross: CrossPageAudit }) {
  const pct = cross.sitemapUrls > 0 ? Math.round((cross.auditedUrls / cross.sitemapUrls) * 100) : 0;
  // Show the standing site-wide lists, not this run's slice: a broken page the
  // rotation has moved past is still broken, and showing zero would tell the
  // official site's developers the work is done when it is not.
  const canonical = cross.standing?.canonical ?? cross.canonicalIssues;
  const hreflang = cross.standing?.hreflang ?? cross.hreflangIssues;
  const canonicalTotal = cross.standing?.canonicalTotal ?? cross.canonicalIssues.length;
  const hreflangTotal = cross.standing?.hreflangTotal ?? cross.hreflangIssues.length;
  const issues = canonicalTotal + hreflangTotal + cross.deadSitemapUrls.length;

  return (
    <section className="glass rounded-2xl p-5">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-white/80">全站审计覆盖与跨页检查</h2>
        <span className="text-xs text-white/40">
          {cross.auditedUrls} / {cross.sitemapUrls} 个 URL 已审计
        </span>
      </div>

      <div className="h-2 overflow-hidden rounded-full bg-white/[0.06]">
        <div
          className="h-full rounded-full bg-gradient-to-r from-brand to-accent transition-all"
          style={{ width: `${Math.min(100, pct)}%` }}
        />
      </div>
      <p className="mt-1.5 text-[11px] text-white/45">
        覆盖率 {pct}% · 每轮固定审计核心页，其余按「最久未审优先」轮转，约 6 轮（≈1 天）扫完全站。
        轮转的原因是单轮全量会让存档快照膨胀数倍（抓取本身只需数秒），不是时间不够。
      </p>

      {issues === 0 ? (
        <p className="mt-4 text-xs text-ok">
          跨页检查未发现问题：已审计页面 canonical 全部自指、中英 hreflang 成对、抽样 URL 全部可达。
        </p>
      ) : (
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <IssueList
            title="canonical 非自指"
            hint="canonical 指向别处等于告诉搜索引擎「别收录本页」"
            items={canonical.map((c) => `${short(c.url)} → ${c.canonical ?? "缺失"}`)}
            total={canonicalTotal}
          />
          <IssueList
            title="hreflang 问题"
            hint="中英互指必须成对，单向声明会被忽略、译文按重复内容处理"
            items={hreflang.map((h) => `${short(h.url)}：${h.detail}`)}
            total={hreflangTotal}
          />
          <IssueList
            title="sitemap 抽样不可达"
            hint="sitemap 里的死链会浪费抓取预算并降低整份文件的可信度"
            items={cross.deadSitemapUrls.map((d) => `${short(d.url)} · HTTP ${d.status || "无响应"}`)}
          />
        </div>
      )}

      <p className="mt-3 text-[11px] text-white/40">
        <span className="text-white/60">口径：</span>
        canonical 与 hreflang 为<span className="text-white/60">跨轮累计</span>
        的全站待修清单（逐 URL 记录，页面复审通过即自动移出），
        不是本轮抽样值——否则轮转一过，未修的问题会显示为已修好。
        sitemap 可达性为每轮抽样 12 条，只反映抽中的 URL。
      </p>
    </section>
  );
}

/** `total` may exceed `items.length`: the stored examples are capped, the count is not. */
function IssueList({
  title,
  hint,
  items,
  total = items.length,
}: {
  title: string;
  hint: string;
  items: string[];
  total?: number;
}) {
  return (
    <div className="rounded-xl border border-edge/50 bg-white/[0.02] p-3">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-xs font-medium text-white/75">{title}</h3>
        <span className={`text-sm font-semibold tabular-nums ${total ? "text-warn" : "text-ok"}`}>
          {total}
        </span>
      </div>
      <p className="mt-1 text-[11px] text-white/40">{hint}</p>
      {items.length > 0 && (
        <ul className="mt-2 space-y-1">
          {items.slice(0, 6).map((item, i) => (
            <li key={i} className="truncate text-[11px] text-white/55" title={item}>
              {item}
            </li>
          ))}
          {total > 6 && <li className="text-[11px] text-white/35">…另有 {total - 6} 条</li>}
        </ul>
      )}
    </div>
  );
}

function short(url: string): string {
  return url.replace(/^https?:\/\/[^/]+/, "") || "/";
}
