import type { GeoSignalKind, GeoState, PublishResult } from "@/lib/types";
import { CopyBlock } from "@/components/artifact-card";
import { RunGeoButton } from "@/components/run-geo-button";
import { formatDateTime, timeAgo } from "@/lib/format";

const PLATFORM_LABEL: Record<PublishResult["platform"], string> = {
  devto: "Dev.to",
  hashnode: "Hashnode",
  telegraph: "Telegraph",
  reddit: "Reddit",
};

const SIGNAL_META: { kind: GeoSignalKind; label: string; desc: string }[] = [
  { kind: "reddit", label: "reddit.com", desc: "Referral 引荐流量" },
  { kind: "perplexity", label: "Perplexity", desc: "AI 引擎引用来源" },
  { kind: "chatgpt", label: "ChatGPT / OpenAI", desc: "AI 引擎引用来源" },
];

function statusBadge(status: PublishResult["status"]): string {
  if (status === "published") return "border-ok/40 text-ok bg-ok/10";
  if (status === "skipped") return "border-edge text-white/40 bg-white/5";
  return "border-bad/40 text-bad bg-bad/10";
}

function statusLabel(status: PublishResult["status"]): string {
  if (status === "published") return "已发布";
  if (status === "skipped") return "跳过";
  return "失败";
}

export function GeoPanel({ state }: { state: GeoState }) {
  const lastCycle = state.cycles[state.cycles.length - 1] ?? null;
  const pendingCount = state.keywords.filter((k) => k.status === "pending").length;
  const publishedArticles = state.articles.filter((a) =>
    a.publishResults.some((r) => r.status === "published"),
  ).length;
  const recentArticles = state.articles.slice(-6).reverse();
  const recentDrafts = state.draftQueue.slice(-6).reverse();
  const keywords = state.keywords.slice(-20).reverse();
  const lastCheck = state.signalHistory[state.signalHistory.length - 1] ?? null;
  const ga4Configured = lastCheck?.configured ?? false;

  return (
    <section className="glass rounded-2xl p-5" id="geo">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-white/90">
            GEO 生成式引擎优化 <span className="text-xs font-normal text-white/40">· 每 4 小时</span>
          </h2>
          <p className="mt-1 text-xs text-white/50">
            AI 挖词（避开官网已覆盖主题、与存量文章语义去重）→ AI 写权威英文长文（实测数据带 R1–R9 报告编号）→
            站外多平台自动分发，主回链指向官网最相关的深层落地页、次链指向 /en/evidence → 效果监测见下方「效果监测」区
          </p>
        </div>
        <RunGeoButton />
      </div>

      {/* Stats row */}
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="词池待写" value={String(pendingCount)} />
        <Stat label="累计文章" value={String(state.articles.length)} />
        <Stat label="已发布文章" value={String(publishedArticles)} />
        <Stat
          label="上次循环"
          value={lastCycle ? timeAgo(lastCycle.createdAt) : "未运行"}
        />
      </div>

      <BacklinkMigration state={state} />

      {/* Step 4: signal lights */}
      <div className="mb-5">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-widest text-white/40">
          第 4 步 · GEO 生效信号（GA4 近 7 天）
        </h3>
        <div className="grid gap-3 md:grid-cols-3">
          {SIGNAL_META.map((meta) => {
            const firstSeen = state.signalFirstSeen[meta.kind];
            const current = lastCheck?.signals.filter((s) => s.kind === meta.kind) ?? [];
            const sessions = current.reduce((a, s) => a + s.sessions, 0);
            const active = Boolean(firstSeen);
            return (
              <div
                key={meta.kind}
                className={`rounded-xl border p-3 ${active ? "border-ok/40 bg-ok/5" : "border-edge/50 bg-white/[0.02]"}`}
              >
                <div className="flex items-center gap-2">
                  <span
                    className={`h-2.5 w-2.5 rounded-full ${active ? "bg-ok animate-pulseRing" : "bg-white/15"}`}
                  />
                  <span className={`text-sm font-medium ${active ? "text-ok" : "text-white/70"}`}>
                    {meta.label}
                  </span>
                </div>
                <p className="mt-1 text-xs text-white/45">{meta.desc}</p>
                <p className="mt-1 text-xs text-white/60">
                  {active
                    ? `已生效 · 首次 ${formatDateTime(firstSeen!)}${sessions ? ` · ${sessions} 次会话` : ""}`
                    : ga4Configured
                      ? "暂未检测到 — 持续积累中"
                      : "等待 GA4 凭据"}
                </p>
              </div>
            );
          })}
        </div>
        {!ga4Configured && (
          <p className="mt-2 text-[11px] text-white/40">
            配置 <code className="text-white/55">GA4_PROPERTY_ID</code> +{" "}
            <code className="text-white/55">GA4_SERVICE_ACCOUNT_JSON</code>（base64 服务账号）即可启用真实流量检测；
            未配置时其余三步照常自动运行。
          </p>
        )}
        {lastCheck?.error && <p className="mt-2 text-[11px] text-warn">GA4 错误：{lastCheck.error}</p>}
      </div>

      <PlatformReadiness state={state} />

      {/* Step 2/3: article publish log */}
      <div className="mb-5">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-widest text-white/40">
          第 2-3 步 · 文章与多平台分发日志
        </h3>
        {recentArticles.length === 0 ? (
          <p className="text-xs text-white/40">暂无文章 — 首轮 GEO 循环后此处将展示发布记录</p>
        ) : (
          <ul className="space-y-2">
            {recentArticles.map((a) => {
              const firstPublished = a.publishResults.find((r) => r.status === "published" && r.url);
              return (
              <li key={a.slug} className="rounded-xl border border-edge/50 bg-white/[0.02] p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  {firstPublished?.url ? (
                    <a
                      href={firstPublished.url}
                      target="_blank"
                      rel="noreferrer"
                      className="min-w-0 truncate text-sm font-medium text-accent hover:underline"
                      title={a.title}
                    >
                      {a.title}
                    </a>
                  ) : (
                    <span className="min-w-0 truncate text-sm font-medium text-white/80" title={a.title}>
                      {a.title}
                    </span>
                  )}
                  <span className="shrink-0 text-[11px] text-white/40">{formatDateTime(a.createdAt)}</span>
                </div>
                <p className="mt-0.5 text-[11px] text-white/45">关键词：{a.keyword}</p>
                <p className="mt-0.5 text-[11px] text-white/45">
                  回链落地页：
                  <a
                    href={a.referenceUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-accent hover:underline"
                  >
                    {a.referenceUrl.replace(/^https?:\/\/[^/]+/, "")}
                  </a>
                  {a.landingKind && a.landingKind !== "core" && (
                    <span className="ml-1.5 rounded border border-ok/40 px-1 py-0.5 text-[10px] text-ok">
                      深层页 · {a.landingKind}
                    </span>
                  )}
                  {a.linkBackfilledAt && (
                    <span className="ml-1.5 rounded border border-edge px-1 py-0.5 text-[10px] text-white/40">
                      已回溯改链
                    </span>
                  )}
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {a.publishResults.map((r, i) => (
                    <span
                      key={i}
                      className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] ${statusBadge(r.status)}`}
                      title={r.detail}
                    >
                      {PLATFORM_LABEL[r.platform]} · {statusLabel(r.status)}
                      {r.url && (
                        <a href={r.url} target="_blank" rel="noreferrer" className="underline">
                          ↗
                        </a>
                      )}
                    </span>
                  ))}
                </div>
              </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Step 1: keyword pool */}
      <div className="mb-5">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-widest text-white/40">
          第 1 步 · AI 长尾词池（最近 20 个）
        </h3>
        {keywords.length === 0 ? (
          <p className="text-xs text-white/40">词池为空 — 首轮循环将自动挖掘</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-edge/60 text-white/40">
                  <th className="py-1.5 pr-3 font-medium">关键词</th>
                  <th className="py-1.5 pr-3 font-medium">意图</th>
                  <th className="py-1.5 pr-3 font-medium">优先级</th>
                  <th className="py-1.5 font-medium">状态</th>
                </tr>
              </thead>
              <tbody>
                {keywords.map((k) => (
                  <tr key={k.keyword} className="border-b border-edge/30">
                    <td className="max-w-md py-1.5 pr-3 text-white/75" title={k.rationale}>
                      {k.keyword}
                    </td>
                    <td className="py-1.5 pr-3 text-white/50">{k.intent}</td>
                    <td className="py-1.5 pr-3 tabular-nums text-white/50">P{k.priority}</td>
                    <td className="py-1.5">
                      <span
                        className={`rounded border px-1.5 py-0.5 text-[10px] ${
                          k.status === "published"
                            ? "border-ok/40 text-ok"
                            : k.status === "written"
                              ? "border-warn/40 text-warn"
                              : "border-edge text-white/45"
                        }`}
                      >
                        {k.status === "published" ? "已发布" : k.status === "written" ? "已成文" : "待写"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Medium / Quora draft queue */}
      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-widest text-white/40">
          Medium / Quora 成稿队列（无官方 API，一键复制发布）
        </h3>
        {recentDrafts.length === 0 ? (
          <p className="text-xs text-white/40">暂无成稿 — 每篇文章会自动生成 Medium 长文版与 Quora 问答版</p>
        ) : (
          <div className="space-y-2">
            {recentDrafts.map((d, i) => (
              <details key={`${d.articleSlug}-${d.platform}-${i}`} className="rounded-xl border border-edge/50 bg-white/[0.02] p-3">
                <summary className="cursor-pointer text-sm text-white/80">
                  <span className="mr-2 rounded border border-brand/40 bg-brand/10 px-1.5 py-0.5 text-[10px] uppercase text-brand-glow">
                    {d.platform}
                  </span>
                  {d.title}
                  <span className="ml-2 text-[11px] text-white/35">{formatDateTime(d.createdAt)}</span>
                </summary>
                <div className="mt-3">
                  <CopyBlock
                    title={d.platform === "medium" ? "Medium 文章（Markdown）" : "Quora 回答"}
                    code={d.content}
                    language={d.platform === "medium" ? "md" : "txt"}
                  />
                </div>
              </details>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

const PLATFORM_NOTE: Record<PublishResult["platform"], string> = {
  devto: "技术受众最对口、域名权重最高，作为首发平台；未配置 DEVTO_API_KEY 时整条分发链只剩低权重平台",
  hashnode: "开发者博客平台，跨发时以 Dev.to 为 canonical",
  telegraph: "匿名即时发布、无需凭据，但不支持表格且权重低，只作兜底",
  reddit: "发到账号自己的主页（u_username），不涉及子版规则",
};

/**
 * Which platforms are actually reachable. A missing credential shows up in the
 * log as a quiet "skipped" on every article, which is easy to scroll past —
 * stating it once, up front, is the difference between a known gap and an
 * unnoticed one.
 */
/**
 * The migration of legacy home-page backlinks runs a few articles per cycle and
 * oldest-first, so the recent-articles list below shows nothing until it is
 * nearly finished. Without a corpus-wide counter it looks like it never ran.
 */
function BacklinkMigration({ state }: { state: GeoState }) {
  const total = state.articles.length;
  if (total === 0) return null;

  const deep = state.articles.filter((a) => !/\/en\/?$/.test(a.referenceUrl)).length;
  const pending = state.articles.filter((a) => !a.linkBackfilledAt && !a.landingKind).length;
  const percent = Math.round((deep / total) * 100);
  if (pending === 0 && deep === total) return null;

  return (
    <div className="mb-5 rounded-xl border border-edge/50 bg-white/[0.02] p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-widest text-white/40">
          回链深化进度
        </h3>
        <span className="text-xs text-white/60">
          {deep}/{total} 篇已指向深层落地页（{percent}%）
        </span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
        <div className="h-full rounded-full bg-accent" style={{ width: `${percent}%` }} />
      </div>
      <p className="mt-2 text-[11px] text-white/40">
        存量文章的回链原本全部指向首页。每轮改写 3 篇（按发布时间由早到晚），
        经 Telegraph editPage 直接改已发布页面，还剩 {pending} 篇待处理。
        限速是因为每篇都要重新解析落地页并调用一次编辑接口，与写稿共用同一个 300s 函数预算。
      </p>
    </div>
  );
}

function PlatformReadiness({ state }: { state: GeoState }) {
  const recent = state.articles.slice(-5).flatMap((a) => a.publishResults);
  if (recent.length === 0) return null;

  const platforms = Object.keys(PLATFORM_LABEL) as PublishResult["platform"][];
  const summary = platforms.map((platform) => {
    const results = recent.filter((r) => r.platform === platform);
    const published = results.filter((r) => r.status === "published").length;
    const skipped = results.filter((r) => r.status === "skipped");
    return {
      platform,
      published,
      total: results.length,
      unconfigured: results.length > 0 && skipped.length === results.length,
      detail: skipped[0]?.detail,
    };
  });

  const missing = summary.filter((s) => s.unconfigured);

  return (
    <div className="mb-5">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-widest text-white/40">
        分发平台可用性（近 5 篇）
      </h3>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {summary.map((s) => (
          <div
            key={s.platform}
            className={`rounded-xl border p-2.5 ${
              s.unconfigured
                ? "border-warn/40 bg-warn/5"
                : s.published > 0
                  ? "border-ok/40 bg-ok/5"
                  : "border-bad/40 bg-bad/5"
            }`}
            title={PLATFORM_NOTE[s.platform]}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-white/80">{PLATFORM_LABEL[s.platform]}</span>
              <span
                className={`text-xs tabular-nums ${
                  s.unconfigured ? "text-warn" : s.published > 0 ? "text-ok" : "text-bad"
                }`}
              >
                {s.unconfigured ? "未配置" : `${s.published}/${s.total}`}
              </span>
            </div>
            <p className="mt-1 line-clamp-2 text-[10px] text-white/40">{PLATFORM_NOTE[s.platform]}</p>
          </div>
        ))}
      </div>
      {missing.length > 0 && (
        <p className="mt-2 text-[11px] text-warn">
          缺少凭据：{missing.map((m) => PLATFORM_LABEL[m.platform]).join("、")}。
          {missing.some((m) => m.platform === "devto") && (
            <>
              {" "}
              其中 Dev.to 是权重最高的首发平台，未配置时新文章只能落到 Telegraph 这类低权重站点，
              分发效果会显著打折。在 Vercel 生产环境加上{" "}
              <code className="text-white/60">DEVTO_API_KEY</code>
              （Dev.to → Settings → Extensions → DEV Community API Keys）即可自动启用，无需改代码。
            </>
          )}
        </p>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-edge/50 bg-white/[0.02] p-3">
      <div className="text-lg font-semibold tabular-nums text-white/90">{value}</div>
      <div className="text-[11px] text-white/45">{label}</div>
    </div>
  );
}
