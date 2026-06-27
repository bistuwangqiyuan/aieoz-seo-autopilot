"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { HistoryPoint } from "@/lib/types";
import { formatDateTime } from "@/lib/format";

export function TrendChart({ history }: { history: HistoryPoint[] }) {
  const data = history.map((h) => ({
    time: formatDateTime(h.createdAt),
    score: h.score,
    trigger: h.trigger,
  }));

  if (data.length === 0) {
    return (
      <div className="flex h-[260px] items-center justify-center text-sm text-white/40">
        暂无历史数据 — 首次扫描后将展示评分趋势
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={260}>
      <AreaChart data={data} margin={{ top: 10, right: 12, left: -18, bottom: 0 }}>
        <defs>
          <linearGradient id="scoreFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#818cf8" stopOpacity={0.5} />
            <stop offset="100%" stopColor="#818cf8" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
        <XAxis dataKey="time" tick={{ fill: "rgba(255,255,255,0.4)", fontSize: 11 }} minTickGap={28} />
        <YAxis domain={[0, 100]} tick={{ fill: "rgba(255,255,255,0.4)", fontSize: 11 }} width={40} />
        <Tooltip
          contentStyle={{
            background: "#0e0e1c",
            border: "1px solid rgba(99,102,241,0.3)",
            borderRadius: 12,
            color: "#e7e7f3",
            fontSize: 12,
          }}
          labelStyle={{ color: "rgba(255,255,255,0.6)" }}
        />
        <Area
          type="monotone"
          dataKey="score"
          stroke="#818cf8"
          strokeWidth={2.5}
          fill="url(#scoreFill)"
          dot={{ r: 2, fill: "#818cf8" }}
          activeDot={{ r: 5 }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
