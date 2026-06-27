"use client";

import { useState } from "react";

export function CopyBlock({
  title,
  code,
  language = "html",
}: {
  title: string;
  code: string;
  language?: string;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard unavailable */
    }
  }

  return (
    <div className="overflow-hidden rounded-xl border border-edge/60 bg-black/40">
      <div className="flex items-center justify-between border-b border-edge/60 bg-white/5 px-3 py-2">
        <span className="text-xs font-medium text-white/70">{title}</span>
        <div className="flex items-center gap-2">
          <span className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-white/40">
            {language}
          </span>
          <button
            onClick={copy}
            className="rounded-md border border-brand/40 bg-brand/10 px-2 py-1 text-[11px] font-medium text-brand-glow transition hover:bg-brand/20"
          >
            {copied ? "已复制 ✓" : "复制"}
          </button>
        </div>
      </div>
      <pre className="max-h-72 overflow-auto p-3 text-[11.5px] leading-relaxed text-white/75">
        <code>{code}</code>
      </pre>
    </div>
  );
}
