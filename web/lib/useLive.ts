"use client";
// 一組股票的即時報價：打開時抓一次，盤中每 5 秒更新（證交所資料本身約 5 秒更新一次）
import { useEffect, useState } from "react";
import { getLiveQuotes, marketOpen, type LiveQuote } from "@/lib/data";

export const LIVE_MS = 5000;

export function useLiveQuotes(codes: string[], ms = LIVE_MS) {
  const [m, setM] = useState<Record<string, LiveQuote>>({});
  const key = codes.join(",");
  useEffect(() => {
    const list = key ? key.split(",") : [];
    if (!list.length) return;
    let alive = true;
    const pull = () => getLiveQuotes(list).then((r) => { if (alive) setM((o) => ({ ...o, ...r })); }).catch(() => {});
    pull();
    const id = setInterval(() => { if (marketOpen() && !document.hidden) pull(); }, ms);
    return () => { alive = false; clearInterval(id); };
  }, [key, ms]);
  return m;
}

/** 即時價優先，沒有就用收盤價；漲跌幅用即時的昨收算 */
export function livePx(l: LiveQuote | undefined, close: number | null | undefined, pct: number | null | undefined) {
  if (l?.price != null && l.prev) return { px: l.price, pct: (l.price / l.prev - 1) * 100, live: true, time: l.time };
  return { px: close ?? null, pct: pct ?? null, live: false, time: "" };
}
