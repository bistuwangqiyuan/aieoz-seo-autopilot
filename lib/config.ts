export const DEFAULT_TARGET_URLS = [
  "https://goni.top/zh/index.html",
  "https://goni.top/en/index.html",
];

export const DEFAULT_TARGET_ORIGIN = "https://goni.top";

export function getTargetUrls(): string[] {
  const raw = process.env.TARGET_URLS;
  if (!raw) return DEFAULT_TARGET_URLS;
  const urls = raw
    .split(",")
    .map((u) => u.trim())
    .filter(Boolean);
  return urls.length ? urls : DEFAULT_TARGET_URLS;
}

export function getTargetOrigin(): string {
  const raw = process.env.TARGET_ORIGIN;
  if (raw && raw.trim()) return raw.trim().replace(/\/+$/, "");
  try {
    return new URL(getTargetUrls()[0]).origin;
  } catch {
    return DEFAULT_TARGET_ORIGIN;
  }
}

export function getModelId(): string {
  return process.env.AI_MODEL?.trim() || "openai/gpt-4o-mini";
}

export function hasAiKey(): boolean {
  return Boolean(process.env.AI_GATEWAY_API_KEY?.trim());
}

export const USER_AGENT =
  "AI-SEO-Autopilot/1.0 (+https://goni.top; autonomous SEO auditor)";
