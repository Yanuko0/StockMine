"use client";
// 選到一條線後的編輯面板（三竹式）：精確修改價格、時間、顏色、註解；點高 / 低 / 開 / 收直接吸附到那根 K 棒的價格
// 手機：固定在畫面底部的面板；電腦：浮在 K 線圖下方的卡片
import { useEffect, useMemo, useState } from "react";
import Icon from "@/components/ui/Icon";
import { COLORS } from "@/components/DrawToolbar";
import { TOOLS } from "@/lib/tools";
import { MINUTES, type Bar, type TF } from "@/lib/bars";
import type { Drawing, DrawPoint } from "@/lib/data";

const TW = 8 * 3600 * 1000;
const twIso = (t: number) => new Date(t + TW).toISOString(); // 台灣時間的 ISO 字串
const fmtP = (v: number) => (Math.abs(v) >= 1000 ? v.toFixed(1) : v.toFixed(2));

/** 這個時間點所在的那根 K 棒（找開始時間 ≤ t 的最後一根） */
function barAt(bars: Bar[], t: number): Bar | null {
  if (!bars.length) return null;
  let lo = 0, hi = bars.length - 1;
  if (t < bars[0].timestamp) return bars[0];
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (bars[m].timestamp <= t) lo = m; else hi = m - 1; }
  return bars[lo];
}

export default function DrawEditor({ d, mine, bars, tf, onPoints, onRecolor, onRelabel, onTogglePrivate, onDuplicate, onDelete, onClose }: {
  d: Drawing; mine: boolean; bars: Bar[]; tf: TF;
  onPoints: (pts: DrawPoint[]) => void; onRecolor: (c: string) => void; onRelabel: (s: string) => void;
  onTogglePrivate: (v: boolean) => void; onDuplicate: () => void; onDelete: () => void; onClose: () => void;
}) {
  const [idx, setIdx] = useState(0);
  const [colorOpen, setColorOpen] = useState(false);
  const [label, setLabel] = useState(d.label ?? "");
  useEffect(() => { setIdx(0); setLabel(d.label ?? ""); setColorOpen(false); }, [d.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const pt = d.points[Math.min(idx, d.points.length - 1)];
  const bar = useMemo(() => (pt ? barAt(bars, pt.t) : null), [bars, pt]);
  const [price, setPrice] = useState("");
  useEffect(() => { if (pt) setPrice(fmtP(pt.v)); }, [pt?.v, d.id, idx]); // eslint-disable-line react-hooks/exhaustive-deps

  const tool = TOOLS.find((t) => t.kind === d.kind);
  const minute = !!MINUTES[tf];
  const setPt = (patch: Partial<DrawPoint>) => onPoints(d.points.map((p, i) => (i === idx ? { ...p, ...patch } : p)));
  // 水平線、只有一點的線：改時間沒有意義（水平線是整條）
  const showTime = d.kind !== "hline";
  const timeValue = pt ? (minute ? twIso(pt.t).slice(0, 16) : (bar?.date ?? twIso(pt.t).slice(0, 10))) : "";

  function setTime(v: string) {
    if (!v) return;
    if (minute) { setPt({ t: Date.parse(v + ":00Z") - TW }); return; }
    const b = bars.find((x) => x.date && x.date >= v);
    setPt({ t: b ? b.timestamp : Date.parse(v + "T09:00:00Z") - TW });
  }
  function commitPrice() {
    const v = +price;
    if (price !== "" && isFinite(v) && v > 0) setPt({ v }); else if (pt) setPrice(fmtP(pt.v));
  }

  const ohlc: [string, number | undefined, string][] = [
    ["高", bar?.high, "border-up text-up"], ["低", bar?.low, "border-down text-down"],
    ["開", bar?.open, "border-[var(--param)] text-param"], ["收", bar?.close, "border-[var(--param)] text-param"],
  ];

  return (
    <div className="fixed lg:absolute inset-x-0 bottom-0 lg:inset-x-auto lg:left-1/2 lg:-translate-x-1/2 lg:bottom-3 lg:w-[min(680px,calc(100%-24px))] z-40
      bg-panel border-t lg:border border-line lg:rounded-2xl shadow-[var(--shadow)] safe-bottom">
      {/* 上排：種類、顏色、私人、複製、刪除、關閉 */}
      <div className="flex items-center gap-1 px-3 pt-2.5 pb-2 border-b border-line">
        <span className="w-3 h-3 rounded-full shrink-0" style={{ background: d.color }} />
        <span className="font-semibold text-[15px] truncate">{tool?.label ?? "畫線"}</span>
        {!mine && <span className="text-[12px] text-muted truncate">・{d.created_by_name ?? "他人"}畫的，只能看</span>}
        <div className="ml-auto flex items-center">
          {mine && (
            <>
              <div className="relative">
                <button className="icon-btn" title="顏色" onClick={() => setColorOpen(!colorOpen)}>
                  <span className="w-5 h-5 rounded-full border-2 border-white/80" style={{ background: d.color }} />
                </button>
                {colorOpen && (
                  <div className="absolute bottom-full lg:bottom-auto lg:top-full right-0 mb-2 lg:mt-2 p-2 rounded-xl bg-panel-2 border border-line shadow-[var(--shadow)] flex gap-1.5 z-10">
                    {COLORS.map((c) => (
                      <button key={c} aria-label={c} onClick={() => { onRecolor(c); setColorOpen(false); }}
                        className={`w-7 h-7 rounded-full border-2 ${d.color === c ? "border-white" : "border-transparent"}`} style={{ background: c }} />
                    ))}
                  </div>
                )}
              </div>
              <button className={`icon-btn ${d.is_private ? "!text-accent" : ""}`} title={d.is_private ? "私人（只有你看得到）" : "公開（大家看得到）"}
                onClick={() => onTogglePrivate(!d.is_private)}>
                <span className="text-[16px] leading-none">{d.is_private ? "🔒" : "🔓"}</span>
              </button>
              <button className="icon-btn" title="複製一條" onClick={onDuplicate}><Icon name="copy" /></button>
              <button className="icon-btn hover:!text-up" title="刪除" onClick={onDelete}><Icon name="trash" /></button>
            </>
          )}
          <button className="icon-btn" title="完成" onClick={onClose}><Icon name="close" /></button>
        </div>
      </div>

      <div className="px-3 py-2.5 space-y-2.5">
        {/* 多點的線：選第幾點 */}
        {d.points.length > 1 && (
          <div className="seg">
            {d.points.map((_, i) => (
              <button key={i} aria-pressed={i === idx} onClick={() => setIdx(i)}>
                {d.kind === "rect" ? ["左上角", "右下角"][i] ?? `第 ${i + 1} 點` : d.kind === "channel" && i === 2 ? "通道寬度" : i === 0 ? "起點" : i === 1 ? "終點" : `第 ${i + 1} 點`}
              </button>
            ))}
          </div>
        )}

        {/* 這根 K 棒的高低開收：點一下就把價格對齊 */}
        {mine && (
          <div className="grid grid-cols-4 gap-2">
            {ohlc.map(([k, v, cls]) => (
              <button key={k} disabled={v == null} onClick={() => v != null && (setPrice(fmtP(v)), setPt({ v }))}
                className={`rounded-xl border px-1 py-1.5 text-[15px] num font-semibold bg-panel-2 hover:brightness-125 transition ${cls}`}>
                {k} {v != null ? fmtP(v) : "-"}
              </button>
            ))}
          </div>
        )}

        {/* 時間、價格、註解 */}
        <div className="flex gap-2 items-center flex-wrap sm:flex-nowrap">
          {showTime && (
            <input type={minute ? "datetime-local" : "date"} disabled={!mine} value={timeValue}
              onChange={(e) => setTime(e.target.value)}
              className="!rounded-full text-[15px] num !px-3 w-[9.5rem] sm:w-auto shrink-0" title="這一點的時間" />
          )}
          <div className="relative flex-1 min-w-[8rem]">
            <Icon name="pencil" className="w-4 h-4 text-muted absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input type="number" inputMode="decimal" step="any" disabled={!mine} value={price}
              onChange={(e) => setPrice(e.target.value)} onBlur={commitPrice}
              onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
              className="w-full !rounded-full !pl-9 text-[16px] num font-semibold text-center" title="價格（可以直接輸入）" />
          </div>
          <input disabled={!mine} value={label} placeholder="輸入註解" onChange={(e) => setLabel(e.target.value)}
            onBlur={() => label !== (d.label ?? "") && onRelabel(label)}
            onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
            className="!rounded-full flex-1 min-w-[8rem] text-[15px] !px-4" />
        </div>
        {mine && <p className="text-[11px] text-muted">也可以直接在圖上拖動端點；改好會自動儲存。{d.kind === "hline" ? "" : "時間會對齊到那天（那根）K 棒。"}</p>}
      </div>
    </div>
  );
}
