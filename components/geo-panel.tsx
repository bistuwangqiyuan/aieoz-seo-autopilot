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
            GEO 生成式引擎优化 <span className="text-xs font-normal text-white/40">· 四步循环 · 每 4 小时</span>
          </h2>
          <p className="mt-1 text-xs text-white/50">
            AI 挖词 → AI 写权威英文长文（实测数据带 R1–R9 报告编号）→ 站外多平台自动分发（回链官网 /en）→ GA4 检测 Reddit / Perplexity / ChatGPT 引流信号
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

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-edge/50 bg-white/[0.02] p-3">
      <div className="text-lg font-semibold tabular-nums text-white/90">{value}</div>
      <div className="text-[11px] text-white/45">{label}</div>
    </div>
  );
}
