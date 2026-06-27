import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI SEO Autopilot · 中科存储 (goni.top)",
  description:
    "全自动、无人值守的 AI SEO 优化平台：7×24 小时持续审计 goni.top，评分并生成可直接应用的优化产物。",
  robots: { index: false, follow: false },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN">
      <body className="min-h-screen font-sans antialiased">{children}</body>
    </html>
  );
}
