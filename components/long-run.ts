"use client";

interface Progress {
  latestSnapshotId: string | null;
  geoCycles: number;
}

async function getProgress(): Promise<Progress | null> {
  try {
    const res = await fetch("/api/progress", { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as Progress;
  } catch {
    return null;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Run a long POST that survives flaky networks. Serverless keeps working even
 * if the client connection is cut ("Failed to fetch"), so on a network error
 * we poll the progress fingerprint and treat a change as success instead of
 * surfacing a bogus failure to the user.
 */
export async function runWithRecovery(
  url: string,
  changed: (before: Progress, now: Progress) => boolean,
): Promise<void> {
  const before = await getProgress();

  let res: Response;
  try {
    res = await fetch(url, { method: "POST" });
  } catch {
    if (!before) throw new Error("网络中断，且无法读取运行状态");
    // The job is still running server-side; poll for up to 6 minutes.
    const deadline = Date.now() + 6 * 60 * 1000;
    while (Date.now() < deadline) {
      await sleep(10_000);
      const now = await getProgress();
      if (now && changed(before, now)) return;
    }
    throw new Error("网络不稳定：请求被中断，且 6 分钟内未观察到新结果。请稍后刷新页面确认。");
  }

  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.ok) {
    throw new Error(data?.error ?? `运行失败 (HTTP ${res.status})`);
  }
}
