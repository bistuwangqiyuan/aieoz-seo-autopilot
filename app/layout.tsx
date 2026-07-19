import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Mingxin SEO/GEO Autopilot · 铭信科技 (mingxinstorage.xyz)",
  description:
    "铭信官网的外部独立 SEO/GEO 自动驾驶：7×24 小时从外部审计 mingxinstorage.xyz 并生成修复建议，同时面向海外英文市场自动挖词、写文、多平台分发。",
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
