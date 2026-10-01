"use client";
// 條件漏斗：每一條條件單獨通過幾檔、依序累積還剩幾檔 → 一眼看出是哪一條把股票都刷掉
import { useState } from "react";
import { condText, needs } from "@/lib/condText";
import type { Condition } from "@/lib/data";

type Meta = {
  total: number;
  funnel?: { single: number[]; cumul: number[] };
  coverage?: { minute: number; inst: number; mainforce: number; yields: number; margins: number };
};

const NEED_TEXT = {
  minute: (n: number, t: number) => `只有 ${n} / ${t} 檔有分K 資料`,
  mainforce: (n: number, t: number) => `只有 ${n} / ${t} 檔有主力（分點）資料`,
  yields: (n: number) => `${n} 檔有除權息資料`,
  margins: (n: number, t: number) => `只有 ${n} / ${t} 檔有完整 5 年財報（每天持續補）`,
};

export default function Funnel({ conds, logic, meta, defaultOpen }: { conds: Condition[]; logic: "AND" | "OR"; meta: Meta; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const f = meta.funnel;
  if (!f || f.single.length !== conds.length) return null;
  const t = meta.total || 1;
  const cov = meta.coverage;
  // 讓結果變成 0 的那一條、單獨看最嚴格的那一條
  const zeroAt = logic === "OR" ? -1 : f.cumul.findIndex((c) => c === 0);
  let strict = -1;
  f.single.forEach((n, i) => { if (conds[i].kind !== "group" && conds[i].kind !== "unsupported" && (strict < 0 || n < f.single[strict])) strict = i; });

  return (
    <div className="card overflow-hidden">
      <button className="card-h w-full text-sm" onClick={() => setOpen(!open)}>
        條件漏斗 <span className="text-xs text-muted font-normal">看是哪一條把股票刷掉（全市場 {meta.total} 檔）</span>
        <span className="ml-auto text-muted">{open ? "收合" : "展開"}</span>
      </button>
      {open && (
        <div className="py-1">
          <div className="grid grid-cols-[1fr_64px_64px] gap-2 px-4 py-1 text-[11px] text-muted">
            <span>條件</span><span className="text-right">單獨通過</span><span className="text-right">{logic === "OR" ? "" : "累積剩下"}</span>
          </div>
          {conds.map((c, i) => {
            const need = needs(c);
            const covN = need && cov ? cov[need] : null;
            const pct = (f.single[i] / t) * 100;
            return (
              <div key={i} className={`px-4 py-1.5 ${i === zeroAt ? "bg-up-soft" : ""}`}>
                <div className="grid grid-cols-[1fr_64px_64px] gap-2 items-center text-[13px]">
                  <span className="min-w-0 truncate">{i + 1}. {condText(c)}</span>
                  <span className="text-right num">{f.single[i]}</span>
                  <span className={`text-right num font-semibold ${f.cumul[i] === 0 ? "up" : ""}`}>{logic === "OR" ? "" : f.cumul[i]}</span>
                </div>
                <div className="h-1 rounded-full bg-panel-2 mt-1 overflow-hidden"><div className="h-full bg-accent" style={{ width: `${Math.max(pct, f.single[i] ? 1 : 0)}%` }} /></div>
                {i === zeroAt && <div className="text-[11px] up mt-0.5">到這一條剩 0 檔：前面剩下的 {i ? f.cumul[i - 1] : meta.total} 檔都不符合這條</div>}
                {i === strict && i !== zeroAt && <div className="text-[11px] text-muted mt-0.5">單獨看最嚴格的一條（全市場只有 {f.single[i]} 檔符合）</div>}
                {need && covN != null && <div className="text-[11px] text-accent mt-0.5">{NEED_TEXT[need](covN, meta.total)}</div>}
              </div>
            );
          })}
          <p className="px-4 py-2 text-[11px] text-muted">「累積剩下」是從第 1 條依序套用到這一條後還剩幾檔。最後剩 0 時，可以把讓結果變成 0 的那條放寬（例如糾結 3% → 5%），或先刪掉暫時沒有資料的條件。</p>
        </div>
      )}
    </div>
  );
}
