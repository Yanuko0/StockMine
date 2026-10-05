import type { Metadata, Viewport } from "next";
import "./globals.css";
import AppShell from "@/components/AppShell";
import { THEME_BOOT } from "@/lib/theme";

export const metadata: Metadata = {
  title: "掘股 StockMine",
  description: "K線、扣抵、籌碼、分點與選股",
  appleWebApp: { capable: true, title: "掘股", statusBarStyle: "black-translucent" },
  icons: { icon: "/icon-192.png", apple: "/apple-touch-icon.png" },
};

export const viewport: Viewport = {
  themeColor: "#121212",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="zh-Hant-TW" className="h-full" data-theme="dark" suppressHydrationWarning>
      <head>
        {/* 第一次畫面出來前套用主題，避免閃一下 */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
      </head>
      <body className="h-full">
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
