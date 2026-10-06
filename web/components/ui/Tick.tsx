"use client";
// 價格跳動：數字變了就閃一下（漲紅、跌綠），像看盤軟體一樣
import { useEffect, useRef, useState, type ReactNode } from "react";

export default function Tick({ v, children, className = "" }: { v: number | null | undefined; children: ReactNode; className?: string }) {
  const prev = useRef(v);
  const [f, setF] = useState<"" | "up" | "down">("");
  useEffect(() => {
    const p = prev.current;
    prev.current = v;
    if (p == null || v == null || p === v) return;
    setF(v > p ? "up" : "down");
    const t = setTimeout(() => setF(""), 900);
    return () => clearTimeout(t);
  }, [v]);
  return <span className={`tick ${f ? `tick-${f}` : ""} ${className}`}>{children}</span>;
}
