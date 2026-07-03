"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

export function RunGeoButton() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setRunning(true);
    setError(null);
    try {
      const res = await fetch("/api/geo", { method: "POST" });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error ?? "GEO 运行失败");
      startTransition(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : "GEO 运行失败");
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
        className="group inline-flex items-center gap-2 rounded-lg border border-accent/50 bg-accent/10 px-4 py-2 text-sm font-medium text-accent transition hover:bg-accent/20 disabled:cursor-not-allowed disabled:opacity-60"
      >
        <span className={`h-2 w-2 rounded-full bg-accent ${busy ? "animate-ping" : ""}`} />
        {busy ? "GEO 循环运行中…" : "立即运行 GEO 循环"}
      </button>
      {error && <span className="max-w-xs text-right text-xs text-bad">{error}</span>}
    </div>
  );
}
