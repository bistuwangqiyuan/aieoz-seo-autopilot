"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

export function RunNowButton() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setRunning(true);
    setError(null);
    try {
      const res = await fetch("/api/scan", { method: "POST" });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error ?? "扫描失败");
      startTransition(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : "扫描失败");
    } finally {
      setRunning(false);
    }
  }

  const busy = running || isPending;

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        onClick={run}
        disabled={busy}
        className="group inline-flex items-center gap-2 rounded-lg border border-brand/50 bg-brand/15 px-4 py-2 text-sm font-medium text-brand-glow shadow-glow transition hover:bg-brand/25 disabled:cursor-not-allowed disabled:opacity-60"
      >
        <span
          className={`h-2 w-2 rounded-full bg-brand-glow ${busy ? "animate-ping" : "animate-pulseRing"}`}
        />
        {busy ? "正在运行 AI 优化…" : "立即运行一次扫描"}
      </button>
      {error && <span className="text-xs text-bad">{error}</span>}
    </div>
  );
}
