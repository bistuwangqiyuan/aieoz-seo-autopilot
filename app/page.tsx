import { getGeoState, getLatest, listHistory, storageMode } from "@/lib/store/blob";
import { getModelId, getTargetUrls, hasAiKey } from "@/lib/config";
import { ScoreGauge } from "@/components/score-gauge";
import { TrendChart } from "@/components/trend-chart";
import { CategoryBreakdown } from "@/components/category-breakdown";
import { CopyBlock } from "@/components/artifact-card";
import { RunNowButton } from "@/components/run-now-button";
import { GeoPanel } from "@/components/geo-panel";
import { impactBadge, scoreTone, timeAgo } from "@/lib/format";
import type { HistoryPoint, Snapshot } from "@/lib/types";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function nextRunLabel(): string {
  const d = new Date();
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + (4 - (d.getHours() % 4)));
  return d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
}

function Chip({ label, value, tone = "default" }: { label: string; value: string; tone?: "default" | "ok" | "warn" }) {
  const toneCls =
    tone === "ok"
      ? "border-ok/40 text-ok"
      : tone === "warn"
        ? "border-warn/40 text-warn"
        : "border-edge text-white/70";
  return (
    <div className={`flex items-center gap-2 rounded-full border ${toneCls} bg-white/5 px-3 py-1 text-xs`}>
      <span className="text-white/40">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}

export default async function DashboardPage() {
  const [latest, history, geoState] = await Promise.all([
    getLatest(),
    listHistory(),
    getGeoState(),
  ]);
  const targets = getTargetUrls();
  const aiOn = hasAiKey();

  return (
    <main className="mx-auto max-w-6xl px-4 py-8 md:px-6 md:py-12">
      <Header aiOn={aiOn} model={getModelId()} storage={storageMode()} />

      {latest ? (
        <Dashboard latest={latest} history={history} />
      ) : (
        <EmptyState targets={targets} />
      )}

      <div className="mt-6">
        <GeoPanel state={geoState} />
      </div>

      <Footer targets={targets} />
    </main>
  );
}

function Header({ aiOn, model, storage }: { aiOn: boolean; model: string; storage: "blob" | "memory" }) {
  return (
    <header className="mb-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="mb-3 flex items-center gap-3">
            <span className="relative flex h-3 w-3">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-ok/70" />
              <span className="relative inline-flex h-3 w-3 rounded-full bg-ok" />
            </span>
            <span className="text-xs font-medium uppercase tracking-[0.2em] text-ok">
              AUTONOMOUS · 7×24 运行中
            </span>
          </div>
          <h1 className="text-3xl font-bold tracking-tight md:text-4xl">
            铭信 <span className="bg-gradient-to-r from-brand-glow to-accent bg-clip-text text-transparent">SEO / GEO</span> 自动驾驶
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-white/55 md:text-base">
            面向 <span className="text-white/80">铭信科技 · mingxinstorage.xyz</span> 官网的外部独立审计与海外 GEO 分发。
            每 4 小时自动审计评分并产出修复建议，AI 挖英文长尾词、写权威长文并多平台分发，全流程零人工参与。
          </p>
        </div>
        <RunNowButton />
      </div>

      <div className="mt-5 flex flex-wrap gap-2">
        <Chip label="自动调度" value="每 4 小时 (GitHub Actions + Vercel Cron)" />
        <Chip label="下次运行" value={`约 ${nextRunLabel()}`} />
        <Chip label="AI 引擎" value={aiOn ? model : "未配置密钥 (启发式)"} tone={aiOn ? "ok" : "warn"} />
        <Chip label="存储" value={storage === "blob" ? "Vercel Blob" : "内存(本地)"} tone={storage === "blob" ? "ok" : "warn"} />
      </div>
    </header>
  );
}

function Dashboard({ latest, history }: { latest: Snapshot; history: HistoryPoint[] }) {
  const tone = scoreTone(latest.score);
  const a = latest.artifacts;
  const site = latest.site;

  return (
    <div className="space-y-6">
      {/* Score + trend */}
      <section className="grid gap-6 lg:grid-cols-3">
        <div className="glass flex flex-col items-center justify-center rounded-2xl p-6">
          <ScoreGauge score={latest.score} />
          <p className="mt-4 text-center text-xs text-white/50">
            上次运行 {timeAgo(latest.createdAt)} · 用时 {(latest.durationMs / 1000).toFixed(1)}s ·{" "}
            {latest.trigger === "cron" ? "自动" : "手动"}触发
          </p>
        </div>

        <div className="glass rounded-2xl p-6 lg:col-span-2">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-white/80">评分趋势</h2>
            <span className="text-xs text-white/40">{history.length} 个数据点</span>
          </div>
          <TrendChart history={history} />
        </div>
      </section>

      {/* AI summary */}
      <section className={`glass rounded-2xl border-l-2 p-5 ${tone.className}`} style={{ borderLeftColor: tone.ring }}>
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-widest text-white/40">
            {a.aiGenerated ? `AI 分析 · ${a.model}` : "启发式分析"}
          </span>
        </div>
        <p className="mt-1 text-sm text-white/80">{a.summary}</p>
      </section>

      {/* Site-level availability signals (external audit catches what self-audit can't) */}
      <section className="glass rounded-2xl p-5">
        <h2 className="mb-3 text-sm font-semibold text-white/80">站点级信号（外部实测）</h2>
        <div className="grid gap-3 md:grid-cols-2">
          <SiteSignalCard
            ok={site.robotsTxt.present}
            label="robots.txt"
            detail={
              site.robotsTxt.present
                ? site.robotsTxt.hasSitemap
                  ? "可访问，已声明 sitemap"
                  : "可访问，但未声明 sitemap"
                : "不可访问"
            }
          />
          <SiteSignalCard
            ok={site.sitemapXml.present}
            label="sitemap.xml"
            detail={
              site.sitemapXml.present
                ? `可访问 · ${site.sitemapXml.urlCount} 条 URL`
                : "不可访问 — 官网 sitemap 为数据库动态生成，请优先检查官网 Vercel 项目的 DATABASE_URL / Neon 数据库"
            }
          />
        </div>
      </section>

      {/* Per-page breakdown */}
      <section className="grid gap-6 md:grid-cols-2">
        {latest.pages.map((page) => (
          <div key={page.url} className="glass rounded-2xl p-5">
            <div className="mb-4 flex items-center justify-between gap-2">
              <a
                href={page.url}
                target="_blank"
                rel="noreferrer"
                className="truncate text-sm font-medium text-accent hover:underline"
                title={page.url}
              >
                {page.url.replace(/^https?:\/\//, "")}
              </a>
              {page.ok && (
                <span className="shrink-0 rounded-full bg-white/5 px-2.5 py-1 text-xs font-semibold tabular-nums">
                  {page.score}/100
                </span>
              )}
            </div>
            <CategoryBreakdown page={page} />
          </div>
        ))}
      </section>

      {/* Fix recommendations */}
      {a.actions.length > 0 && (
        <section className="glass rounded-2xl p-5">
          <h2 className="mb-1 text-sm font-semibold text-white/80">修复建议清单</h2>
          <p className="mb-4 text-xs text-white/45">
            官网为 Next.js 应用，修复在官网源码仓库落地；本工具作为外部审计方持续复测验证效果。
          </p>
          <ol className="space-y-3">
            {a.actions.map((action, i) => (
              <li key={i} className="flex gap-3 rounded-xl border border-edge/50 bg-white/[0.02] p-3">
                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand/15 text-xs font-semibold text-brand-glow">
                  {i + 1}
                </span>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-white/85">{action.title}</span>
                    <span className={`rounded border px-1.5 py-0.5 text-[10px] uppercase ${impactBadge(action.impact)}`}>
                      影响 {action.impact}
                    </span>
                    <span className="rounded border border-edge px-1.5 py-0.5 text-[10px] uppercase text-white/40">
                      工作量 {action.effort}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-white/55">{action.detail}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>
      )}

      {/* Ready-to-paste fix artifacts */}
      <section className="glass rounded-2xl p-5">
        <h2 className="mb-1 text-sm font-semibold text-white/80">可直接粘贴的修复代码</h2>
        <p className="mb-4 text-xs text-white/45">
          以下产物由 AI 生成，可粘贴到官网仓库对应页面的 <code className="text-white/60">metadata</code> 导出或{" "}
          <code className="text-white/60">JsonLd</code> 组件中。
        </p>
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="lg:col-span-2">
            <CopyBlock title="Next.js metadata 导出（主页面）" code={a.metadataSnippet} language="tsx" />
          </div>
          {a.jsonLd.map((ld, i) => (
            <CopyBlock key={i} title={`JSON-LD · ${ld.type}`} code={ld.json} language="json" />
          ))}
        </div>

        {a.faq.length > 0 && (
          <div className="mt-5">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-widest text-white/40">建议 FAQ 内容</h3>
            <div className="space-y-2">
              {a.faq.map((f, i) => (
                <details key={i} className="rounded-lg border border-edge/50 bg-white/[0.02] p-3 text-sm">
                  <summary className="cursor-pointer font-medium text-white/80">{f.question}</summary>
                  <p className="mt-2 text-white/55">{f.answer}</p>
                </details>
              ))}
            </div>
          </div>
        )}

        {a.contentSuggestions.length > 0 && (
          <div className="mt-5">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-widest text-white/40">内容增强建议</h3>
            <ul className="list-inside list-disc space-y-1 text-sm text-white/60">
              {a.contentSuggestions.map((c, i) => (
                <li key={i}>{c}</li>
              ))}
            </ul>
          </div>
        )}

        {a.altTextSuggestions.length > 0 && (
          <div className="mt-5">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-widest text-white/40">图片 Alt 文本建议</h3>
            <ul className="space-y-1 text-sm text-white/60">
              {a.altTextSuggestions.map((alt, i) => (
                <li key={i}>
                  <span className="text-white/40">{alt.context}：</span>
                  {alt.alt}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
    </div>
  );
}

function SiteSignalCard({ ok, label, detail }: { ok: boolean; label: string; detail: string }) {
  return (
    <div className={`rounded-xl border p-3 ${ok ? "border-ok/40 bg-ok/5" : "border-bad/40 bg-bad/5"}`}>
      <div className="flex items-center gap-2">
        <span className={`h-2.5 w-2.5 rounded-full ${ok ? "bg-ok" : "bg-bad"}`} />
        <span className={`text-sm font-medium ${ok ? "text-ok" : "text-bad"}`}>{label}</span>
      </div>
      <p className="mt-1 text-xs text-white/55">{detail}</p>
    </div>
  );
}

function EmptyState({ targets }: { targets: string[] }) {
  return (
    <section className="glass flex flex-col items-center rounded-2xl p-10 text-center">
      <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-brand/15 text-2xl">
        🛰️
      </div>
      <h2 className="text-lg font-semibold">尚未运行首次扫描</h2>
      <p className="mt-2 max-w-md text-sm text-white/55">
        平台会按计划每 4 小时自动运行。你也可以点击右上角「立即运行一次扫描」，
        立刻对以下目标执行首次外部 SEO 审计：
      </p>
      <ul className="mt-3 space-y-1 text-sm text-accent">
        {targets.map((t) => (
          <li key={t}>{t}</li>
        ))}
      </ul>
    </section>
  );
}

function Footer({ targets }: { targets: string[] }) {
  return (
    <footer className="mt-12 border-t border-edge/50 pt-6 text-center text-xs text-white/35">
      <p>
        Mingxin SEO/GEO Autopilot · 外部独立审计 + 海外 GEO 分发 · 目标：{targets.map((t) => t.replace(/^https?:\/\//, "")).join(" / ")}
      </p>
      <p className="mt-1">由 GitHub Actions + Vercel Cron + AI Gateway + Blob 驱动 · 所有运营均由 AI 自动完成</p>
    </footer>
  );
}
