"use client";
import type { Bar } from "@/lib/bars";

const fmt = (v: number | undefined, d = 2) => (v == null || isNaN(v) ? "-" : v.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d }));

function Cell({ k, v, c = "" }: { k: string; v: string; c?: string }) {
  return <div className="flex justify-between gap-2"><span className="text-muted">{k}</span><span className={`num ${c}`}>{v}</span></div>;
}

/** 報價區。side = 電腦版右側欄（直式、字比較大） */
export default function QuoteHeader({ daily, side = false }: { daily: Bar[]; side?: boolean }) {
  const last = daily[daily.length - 1];
  const prev = daily[daily.length - 2];
  if (!last) {
    return <div className={`px-3 py-3 bg-panel border-b border-line ${side ? "" : ""}`}><div className="skeleton h-12" /></div>;
  }
  const chg = prev ? last.close - prev.close : 0;
  const pct = prev ? (chg / prev.close) * 100 : 0;
  const cls = chg > 0 ? "up" : chg < 0 ? "down" : "";
  const amp = prev ? ((last.high - last.low) / prev.close) * 100 : 0;
  const v5 = daily.slice(-6, -1);
  const avgVol = v5.length ? v5.reduce((s, b) => s + b.volume, 0) / v5.length : 0;
  const px = (v: number) => (prev ? (v > prev.close ? "up" : v < prev.close ? "down" : "") : "");
  const hitUp = pct >= 9.5;   // 台股漲跌幅上限 10%
  const hitDown = pct <= -9.5;
  const y = daily.slice(-250);
  const hi52 = Math.max(...y.map((b) => b.high)), lo52 = Math.min(...y.map((b) => b.low));

  const price = (
    <div className={cls}>
      <div className={`${side ? "text-[34px]" : "text-3xl"} font-bold num leading-tight tracking-tight`}>
        {fmt(last.close)}
        {(hitUp || hitDown) && <span className={`ml-1.5 text-xs align-middle px-1.5 py-0.5 rounded ${hitUp ? "bg-up" : "bg-down"} text-white`}>{hitUp ? "漲停" : "跌停"}</span>}
      </div>
      <div className="text-sm num font-medium">
        {chg > 0 ? "▲" : chg < 0 ? "▼" : ""}{fmt(Math.abs(chg))}　{chg > 0 ? "+" : ""}{fmt(pct)}%
      </div>
      <div className="text-[11px] text-muted mt-0.5">{last.date} 收盤</div>
    </div>
  );
  const cells = (
    <>
      <Cell k="開盤" v={fmt(last.open)} c={px(last.open)} />
      <Cell k="昨收" v={fmt(prev?.close)} />
      <Cell k="最高" v={fmt(last.high)} c={px(last.high)} />
      <Cell k="振幅" v={`${fmt(amp)}%`} />
      <Cell k="最低" v={fmt(last.low)} c={px(last.low)} />
      <Cell k="總量" v={`${last.volume.toLocaleString()} 張`} />
      <Cell k="5日均量" v={`${Math.round(avgVol).toLocaleString()} 張`} />
      <Cell k="量比" v={avgVol ? fmt(last.volume / avgVol) : "-"} c={avgVol && last.volume > avgVol * 1.5 ? "text-accent" : ""} />
    </>
  );

  if (side) {
    const pos = hi52 > lo52 ? ((last.close - lo52) / (hi52 - lo52)) * 100 : 50;
    return (
      <div className="px-4 py-3 space-y-3">
        {price}
        <div className="grid grid-cols-2 gap-x-5 gap-y-1 text-[13px]">{cells}</div>
        <div className="text-[11px] text-muted">
          <div className="flex justify-between"><span>一年低 {fmt(lo52)}</span><span>一年高 {fmt(hi52)}</span></div>
          <div className="relative h-1.5 rounded-full bg-panel-2 mt-1">
            <div className="absolute -top-[3px] w-3 h-3 rounded-full bg-accent border-2 border-panel" style={{ left: `calc(${pos}% - 6px)` }} />
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="flex gap-3 px-3 py-2 bg-panel border-b border-line">
      <div className="min-w-[7.5rem]">{price}</div>
      <div className="flex-1 grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs">{cells}</div>
    </div>
  );
}
