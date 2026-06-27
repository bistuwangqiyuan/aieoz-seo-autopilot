export function scoreTone(score: number): { label: string; className: string; ring: string } {
  if (score >= 90) return { label: "优秀", className: "text-ok", ring: "#34d399" };
  if (score >= 75) return { label: "良好", className: "text-accent", ring: "#22d3ee" };
  if (score >= 60) return { label: "一般", className: "text-warn", ring: "#fbbf24" };
  return { label: "待优化", className: "text-bad", ring: "#f87171" };
}

export function statusColor(status: "pass" | "warn" | "fail"): string {
  if (status === "pass") return "text-ok";
  if (status === "warn") return "text-warn";
  return "text-bad";
}

export function statusDot(status: "pass" | "warn" | "fail"): string {
  if (status === "pass") return "bg-ok";
  if (status === "warn") return "bg-warn";
  return "bg-bad";
}

export function impactBadge(impact: "high" | "medium" | "low"): string {
  if (impact === "high") return "border-bad/40 text-bad bg-bad/10";
  if (impact === "medium") return "border-warn/40 text-warn bg-warn/10";
  return "border-ok/40 text-ok bg-ok/10";
}

export function formatDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const diff = Date.now() - then;
  const min = Math.floor(diff / 60000);
  if (min < 1) return "刚刚";
  if (min < 60) return `${min} 分钟前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} 小时前`;
  const day = Math.floor(hr / 24);
  return `${day} 天前`;
}
