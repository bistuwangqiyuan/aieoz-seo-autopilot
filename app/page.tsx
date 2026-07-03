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
            全自动 <span className="bg-gradient-to-r from-brand-glow to-accent bg-clip-text text-transparent">AI SEO</span> 优化平台
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-white/55 md:text-base">
            面向 <span className="text-white/80">中科存储 · goni.top</span> 官网的无人值守 SEO + GEO 优化服务。
            每 4 小时自动审计评分、写回优化、AI 挖词写文并多平台分发，全流程零人工参与。
          </p>
        </div>
        <RunNowButton />
      </div>

      <div className="mt-5 flex flex-wrap gap-2">
        <Chip label="自动调度" value="每 4 小时 (Vercel Cron)" />
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

      {/* Writeback (closed-loop auto-commit) status */}
      {latest.writeback && <WritebackPanel wb={latest.writeback} />}

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

      {/* Optimization actions */}
      {a.actions.length > 0 && (
        <section className="glass rounded-2xl p-5">
          <h2 className="mb-4 text-sm font-semibold text-white/80">AI 优化行动清单</h2>
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

      {/* Ready-to-apply artifacts */}
      <section className="glass rounded-2xl p-5">
        <h2 className="mb-1 text-sm font-semibold text-white/80">可直接应用的优化产物</h2>
        <p className="mb-4 text-xs text-white/45">
          以下产物由 AI 生成，可直接粘贴到 goni.top 对应页面的 <code className="text-white/60">&lt;head&gt;</code> 或站点根目录。
        </p>
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="lg:col-span-2">
            <CopyBlock title="优化后的 <head> 元数据 + JSON-LD" code={a.headHtml} language="html" />
          </div>
          {a.jsonLd.map((ld, i) => (
            <CopyBlock key={i} title={`JSON-LD · ${ld.type}`} code={ld.json} language="json" />
          ))}
          <CopyBlock title="sitemap.xml" code={a.sitemapXml} language="xml" />
          <CopyBlock title="robots.txt" code={a.robotsTxt} language="txt" />
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

function WritebackPanel({ wb }: { wb: NonNullable<Snapshot["writeback"]> }) {
  const status = wb.error
    ? { label: "失败", tone: "warn" as const }
    : wb.applied
      ? { label: "已自动提交", tone: "ok" as const }
      : !wb.enabled
        ? { label: "未启用", tone: "default" as const }
        : wb.dryRun
          ? { label: "演练 (Dry-run)", tone: "warn" as const }
          : { label: "已收敛 (无需变更)", tone: "ok" as const };

  return (
    <section className="glass rounded-2xl p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-white/80">自动写回（闭环）</h2>
        <div className="flex flex-wrap gap-2">
          <Chip label="状态" value={status.label} tone={status.tone} />
          <Chip label="仓库" value={wb.repo} />
          <Chip label="分支" value={wb.branch} />
        </div>
      </div>

      {wb.commitUrl && (
        <p className="text-xs text-white/60">
          提交：{" "}
          <a href={wb.commitUrl} target="_blank" rel="noreferrer" className="text-accent hover:underline">
            {wb.commitSha?.slice(0, 7)}
          </a>{" "}
          → Netlify 将自动重建，下次扫描验证分数变化。
        </p>
      )}
      {wb.skippedReason && !wb.commitUrl && (
        <p className="text-xs text-white/50">{wb.skippedReason}</p>
      )}
      {wb.error && <p className="text-xs text-warn">错误：{wb.error}</p>}

      {wb.changedFiles.length > 0 && (
        <ul className="mt-3 space-y-2">
          {wb.changedFiles.map((f) => (
            <li key={f.path} className="rounded-xl border border-edge/50 bg-white/[0.02] p-3 text-xs">
              <div className="font-medium text-white/80">{f.path}</div>
              <div className="mt-0.5 text-white/50">{f.summary}</div>
              {f.edits.length > 0 && (
                <div className="mt-1 flex flex-wrap gap-1">
                  {f.edits.map((e, i) => (
                    <span key={i} className="rounded border border-edge px-1.5 py-0.5 text-[10px] text-white/55">
                      {e}
                    </span>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
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
        立刻对以下目标执行首次 AI SEO 审计：
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
        AI SEO Autopilot · 全自动无人值守 · 优化目标：{targets.map((t) => t.replace(/^https?:\/\//, "")).join(" / ")}
      </p>
      <p className="mt-1">由 Vercel Cron + AI Gateway + Blob 驱动 · 所有运营均由 AI 自动完成</p>
    </footer>
  );
}
