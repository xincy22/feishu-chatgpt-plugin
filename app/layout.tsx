import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "飞书连接",
  description: "在 ChatGPT 和 Codex 中搜索、读取你的飞书云文档。",
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className="antialiased">{children}</body>
    </html>
  );
}
