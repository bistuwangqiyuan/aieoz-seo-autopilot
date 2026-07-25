import type { CitationCheck, GeoState, LivenessCheck } from "@/lib/types";
import { formatDateTime } from "@/lib/format";

/**
 * Effect measurement, stated with its limits.
 *
 * The official site has no GA4 and we deliberately do not touch it, so "did
 * organic traffic rise" is not answerable from here. Rather than dress up a
 * proxy as a result, each metric below carries the question it can actually
 * answer and the question it cannot.
 */
export function EffectPanel({ state }: { state: GeoState }) {
  const citation = state.citationHistory[state.citationHistory.length - 1] ?? null;
  const liveness = state.livenessHistory[state.livenessHistory.length - 1] ?? null;

  return (
    <section className="glass rounded-2xl p-5" id="effect">
      <div className="mb-4">
        <h2 className="text-base font-semibold text-white/90">
          效果监测 <span className="text-xs font-normal text-white/40">· 每轮采集 · 口径与局限逐条标注</span>
        </h2>
        <p className="mt-1 text-xs text-white/50">
          官网未部署 GA4，且本工具对官网保持零写入，因此无法直接测量自然流量。
          以下两项是不依赖官网、不需新增凭据的替代指标；第三项（IndexNow）经核查在当前架构下不可行，原因见下方说明。
        </p>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <CitationCard check={citation} history={state.citationHistory} />
        <LivenessCard check={liveness} history={state.livenessHistory} />
      </div>

      <IntegrityCard state={state} />

      <div className="mt-3 rounded-xl border border-edge/50 bg-white/[0.02] p-3">
        <h3 className="text-sm font-medium text-white/75">IndexNow 自动提交 · 已评估为不可行</h3>
        <p className="mt-1 text-xs text-white/50">
          IndexNow 要求提交方在<strong className="text-white/70">被提交 URL 所在域名</strong>的根目录托管密钥文件。
          我们的文章发布在 telegra.ph / dev.to / hashnode.dev 等第三方域名下，无法在这些域名放置密钥；
          而官网 mingxinstorage.xyz 的密钥文件需由官网侧部署，超出本工具的零耦合边界。
          本仓库 <code className="text-white/60">public/</code> 下的密钥文件只对本仓库自身域名有效，
          用它提交上述任何 URL 都会被拒绝。
        </p>
        <p className="mt-1.5 text-xs text-white/50">
          替代方案：文章存活监测已覆盖「外链是否仍然有效」这一真正的风险点。
          若需真实收录数据，需官网侧配置 Bing Webmaster / Search Console API —— 这属于官网团队的决策，不在本工具范围内。
        </p>
      </div>
    </section>
  );
}

function CitationCard({ check, history }: { check: CitationCheck | null; history: CitationCheck[] }) {
  const rate = check ? Math.round(check.memoryRate * 100) : null;
  const trend = history.slice(-12).map((c) => c.memoryRate);

  return (
    <div className="rounded-xl border border-edge/50 bg-white/[0.02] p-3">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-medium text-white/75">AI 引擎认知度</h3>
        <span className="text-2xl font-semibold tabular-nums text-white/90">
          {rate === null ? "—" : `${rate}%`}
        </span>
      </div>

      <p className="mt-1 text-[11px] text-white/45">
        {check
          ? `最近一次 ${formatDateTime(check.checkedAt)} · ${check.probes.length} 次探测`
          : "尚无数据 — 首轮循环后开始采集"}
      </p>

      <Sparkline values={trend} />

      <div className="mt-2 space-y-1 text-[11px] text-white/50">
        <p>
          <span className="text-white/65">口径：</span>
          向 provider 链上每个模型提固定的 5 个买家问题（轮转，每轮 2 个），统计回答中出现
          Mingxin / mingxinstorage.xyz / FX 系列 / mingxin-kvcache-bench 的比例。
        </p>
        <p>
          <span className="text-warn/80">局限：</span>
          当前 provider 链（DeepSeek / 通义 / GLM / Kimi）
          <strong className="text-white/70">均不联网检索</strong>，
          测的是「模型训练数据里是否已有铭信」，不是「引擎刚刚读到了我们的文章」。
          这是<strong className="text-white/70">长期滞后指标</strong>，数月内大概率维持在 0，
          读数为 0 不代表分发无效。若接入带检索的模型，其读数会单独标注。
        </p>
      </div>

      {check && check.probes.some((p) => p.mentioned) && (
        <div className="mt-2 border-t border-edge/40 pt-2">
          <p className="text-[11px] text-ok">已被提及的模型：</p>
          <ul className="mt-1 space-y-0.5">
            {check.probes
              .filter((p) => p.mentioned)
              .slice(0, 5)
              .map((p, i) => (
                <li key={i} className="text-[11px] text-white/55">
                  {p.model} → {p.matches.join(", ")}
                </li>
              ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function LivenessCard({ check, history }: { check: LivenessCheck | null; history: LivenessCheck[] }) {
  const liveRate = check && check.totalCount > 0 ? check.liveCount / check.totalCount : null;
  const backlinkCount = check?.probes.filter((p) => p.backlinkPresent).length ?? 0;
  const dead = check?.probes.filter((p) => !p.live) ?? [];
  const trend = history.slice(-12).map((c) => (c.totalCount > 0 ? c.liveCount / c.totalCount : 0));

  return (
    <div className="rounded-xl border border-edge/50 bg-white/[0.02] p-3">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-medium text-white/75">文章存活与回链</h3>
        <span
          className={`text-2xl font-semibold tabular-nums ${
            liveRate === null ? "text-white/90" : liveRate >= 0.95 ? "text-ok" : "text-warn"
          }`}
        >
          {liveRate === null ? "—" : `${Math.round(liveRate * 100)}%`}
        </span>
      </div>

      <p className="mt-1 text-[11px] text-white/45">
        {check
          ? `最近一次 ${formatDateTime(check.checkedAt)} · 抽查 ${check.totalCount} 篇 · ${backlinkCount} 篇回链完好`
          : "尚无数据 — 首轮循环后开始采集"}
      </p>

      <Sparkline values={trend} />

      <div className="mt-2 space-y-1 text-[11px] text-white/50">
        <p>
          <span className="text-white/65">口径：</span>
          按发布时间轮转抽查已发布文章 URL，记录 HTTP 状态码，并检查页面正文里官网域名的回链是否仍然存在。
        </p>
        <p>
          <span className="text-warn/80">局限：</span>
          只能证明「文章还在、外链还在」，
          <strong className="text-white/70">不能证明搜索引擎已收录或有人点击</strong>。
          它的价值在于兜住最坏情况：平台删帖会让外链静默失效，不查就永远不会知道。
        </p>
      </div>

      {dead.length > 0 && (
        <div className="mt-2 border-t border-edge/40 pt-2">
          <p className="text-[11px] text-bad">失效文章（需重发）：</p>
          <ul className="mt-1 space-y-0.5">
            {dead.slice(0, 5).map((p, i) => (
              <li key={i} className="truncate text-[11px] text-white/55" title={p.url}>
                {p.platform} · HTTP {p.httpStatus || "无响应"} · {p.url}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/**
 * Content integrity is not a vanity metric — an article asserting something
 * the benchmark data does not support damages the credibility the whole
 * strategy rests on, so the state of the automatic sweep belongs in plain view.
 */
function IntegrityCard({ state }: { state: GeoState }) {
  const lastSweep = [...state.cycles].reverse().find((c) => c.integrity)?.integrity ?? null;
  const flagged = state.articles.filter((a) => (a.integrityFlags?.length ?? 0) > 0);
  const everChecked = state.articles.filter((a) => a.integrityCheckedAt).length;
  // Compared against the rule set the last sweep ran, since the current one is
  // derived server-side from the product context.
  const version = lastSweep?.rulesVersion;
  const stale = version
    ? state.articles.filter((a) => a.integrityRulesVersion !== version).length
    : null;

  return (
    <div className="mt-3 rounded-xl border border-edge/50 bg-white/[0.02] p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-medium text-white/75">事实一致性自动巡检</h3>
        <span className={`text-xs ${flagged.length === 0 ? "text-ok" : "text-bad"}`}>
          {flagged.length === 0 ? "当前无未修复违规" : `${flagged.length} 篇待修复`}
        </span>
      </div>

      <p className="mt-1 text-[11px] text-white/45">
        {lastSweep
          ? `最近一轮 ${formatDateTime(lastSweep.checkedAt)} · 抽查 ${lastSweep.checked} 篇 · ` +
            `命中 ${lastSweep.flagged} 篇 · 自动重写成功 ${lastSweep.repaired} 篇`
          : "尚未巡检 — 首轮 GEO 循环后开始"}
        {everChecked > 0 && ` · 累计已巡检 ${everChecked}/${state.articles.length} 篇`}
      </p>

      {stale !== null && (
        <p className="mt-1 text-[11px] text-white/45">
          规则集 <code className="text-white/60">{version}</code> ·{" "}
          {stale === 0 ? (
            <span className="text-ok">全部 {state.articles.length} 篇均已按现行规则复核</span>
          ) : (
            <span className="text-warn">{stale} 篇尚未按现行规则复核（规则刚更新，将在后续循环自动补齐）</span>
          )}
        </p>
      )}

      <p className="mt-1.5 text-[11px] text-white/50">
        <span className="text-white/65">口径：</span>
        命中「无法证实的最高级表述、未经实测的软硬件栈/模型/组网/版本号、把 FX100 实测值安到 FX200/300/400 上、
        无出处的量值」等规则时，交由 AI 依据已核实产品资料重写并回写平台，全程无人工介入；
        重写后仍不合规的文章会列在此处而不是被默认放过。规则集带版本号——只要规则或已核实资料有改动，
        全部存量文章会自动回到待复核队列，避免「新规则只管新文章」。
      </p>

      {flagged.length > 0 && (
        <ul className="mt-2 space-y-0.5 border-t border-edge/40 pt-2">
          {flagged.slice(0, 5).map((a) => (
            <li key={a.slug} className="truncate text-[11px] text-bad" title={a.integrityFlags?.join("; ")}>
              {a.slug} — {a.integrityFlags?.join("; ")}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Bare-bones trend bars; a chart library would be overkill for 12 points. */
function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) {
    return <div className="mt-2 h-8 rounded bg-white/[0.03]" />;
  }
  return (
    <div className="mt-2 flex h-8 items-end gap-0.5">
      {values.map((v, i) => (
        <div
          key={i}
          className="flex-1 rounded-sm bg-brand/50"
          style={{ height: `${Math.max(4, v * 100)}%` }}
          title={`${Math.round(v * 100)}%`}
        />
      ))}
    </div>
  );
}
