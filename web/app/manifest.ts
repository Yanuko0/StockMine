import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "掘股 StockMine",
    short_name: "掘股",
    description: "K線、扣抵、籌碼、分點與選股",
    id: "/",
    start_url: "/",
    scope: "/",
    lang: "zh-TW",
    categories: ["finance"],
    display: "standalone",
    orientation: "any",
    background_color: "#121212",
    theme_color: "#121212",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-512-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "選股", url: "/screener", icons: [{ src: "/icon-192.png", sizes: "192x192" }] },
      { name: "分批建倉", url: "/plan", icons: [{ src: "/icon-192.png", sizes: "192x192" }] },
    ],
  };
}
