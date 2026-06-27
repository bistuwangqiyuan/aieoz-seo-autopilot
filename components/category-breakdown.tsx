import type { PageAudit } from "@/lib/types";
import { statusColor, statusDot } from "@/lib/format";

export function CategoryBreakdown({ page }: { page: PageAudit }) {
  if (!page.ok) {
    return (
      <div className="rounded-xl border border-bad/30 bg-bad/5 p-4 text-sm text-bad">
        抓取失败：{page.error}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {page.categories.map((cat) => {
        const pct = cat.max > 0 ? Math.round((cat.score / cat.max) * 100) : 0;
        return (
          <div key={cat.id}>
            <div className="mb-1.5 flex items-center justify-between text-sm">
              <span className="font-medium text-white/80">{cat.label}</span>
              <span className="tabular-nums text-white/50">
                {cat.score}/{cat.max}
              </span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/5">
              <div
                className="h-full rounded-full bg-gradient-to-r from-brand to-accent transition-all"
                style={{ width: `${pct}%` }}
              />
            </div>
            <ul className="mt-2 space-y-1">
              {cat.checks.map((check) => (
                <li key={check.id} className="flex items-start gap-2 text-xs text-white/55">
                  <span className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${statusDot(check.status)}`} />
                  <span className="min-w-0">
                    <span className={`font-medium ${statusColor(check.status)}`}>{check.label}</span>
                    <span className="text-white/40"> — {check.detail}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
