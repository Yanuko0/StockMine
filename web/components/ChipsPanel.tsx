"use client";
// 籌碼：三大法人、融資融券、主力進出（參考看盤軟體：期間切換、買賣超柱狀 + 股價線、連買連賣、佔成交量）
import { useEffect, useMemo, useState } from "react";
import { getInst, getMainForce, getMargin } from "@/lib/data";
import type { Bar } from "@/lib/bars";

export const lots = (shares: number | null | undefined) => (shares == null ? "-" : Math.round(shares / 1000).toLocaleString());
export const cls = (v: number | null | undefined) => (v == null ? "" : v > 0 ? "up" : v < 0 ? "down" : "");
const sum = (a: number[]) => a.reduce((s, x) => s + (x || 0), 0);
const PERIODS = [1, 5, 10, 20, 60];
const signed = (v: number) => `${v > 0 ? "+" : ""}${Math.round(v).toLocaleString()}`;

// 由新到舊，連續同方向幾天
function streak(vals: number[]): number {
  if (!vals.length || !vals[0]) return 0;
  const sign = Math.sign(vals[0]);
  let n = 0;
  for (const v of vals) { if (Math.sign(v) === sign) n++; else break; }
  return sign * n;
}

/** 買賣超柱狀（紅買綠賣）＋ 股價折線，日期對齊。rows 由舊到新 */
function Combo({ rows, price, line, lineLabel, unit = "張", vLabel = "買賣超" }: {
  rows: { date: string; v: number }[]; price: Record<string, number>; line?: Record<string, number>; lineLabel?: string; unit?: string; vLabel?: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 360, H = 150, top = 8, mid = 92, bot = 140;
  if (!rows.length) return null;
  const n = rows.length, bw = W / n;
  const maxV = Math.max(1, ...rows.map((r) => Math.abs(r.v)));
  const ps = rows.map((r) => price[r.date]).filter((x) => x != null);
  const pMin = Math.min(...ps), pMax = Math.max(...ps), pSpan = pMax - pMin || 1;
  const py = (p: number) => top + (1 - (p - pMin) / pSpan) * (mid - top - 6);
  const ls = line ? rows.map((r) => line[r.date]).filter((x) => x != null) : [];
  const lMin = Math.min(...ls), lMax = Math.max(...ls), lSpan = lMax - lMin || 1;
  const ly = (v: number) => top + (1 - (v - lMin) / lSpan) * (mid - top - 6);
  const zero = (mid + bot) / 2 + 4, half = (bot - mid) / 2 - 2;
  const pricePts = rows.map((r, i) => (price[r.date] != null ? `${(i + 0.5) * bw},${py(price[r.date])}` : "")).filter(Boolean).join(" ");
  const linePts = line ? rows.map((r, i) => (line[r.date] != null ? `${(i + 0.5) * bw},${ly(line[r.date])}` : "")).filter(Boolean).join(" ") : "";
  const h = hover != null ? rows[hover] : rows[n - 1];
  return (
    <div>
      <div className="flex gap-3 text-[11px] text-muted mb-1 num">
        <span>{h.date}</span>
        <span>收 <b className="text-text">{price[h.date]?.toFixed(2) ?? "-"}</b></span>
        <span>{vLabel} <b className={cls(h.v)}>{signed(h.v)} {unit}</b></span>
        {line && lineLabel && <span style={{ color: "var(--info)" }}>{lineLabel} {line[h.date]?.toLocaleString() ?? "-"}</span>}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto select-none" onMouseLeave={() => setHover(null)}
        onPointerMove={(e) => { const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect(); setHover(Math.max(0, Math.min(n - 1, Math.floor(((e.clientX - r.left) / r.width) * n)))); }}>
        <line x1={0} x2={W} y1={zero} y2={zero} stroke="var(--line)" />
        {rows.map((r, i) => {
          const hh = (Math.abs(r.v) / maxV) * half;
          return <rect key={r.date} x={i * bw + bw * 0.15} width={bw * 0.7} y={r.v >= 0 ? zero - hh : zero} height={Math.max(hh, 0.5)}
            fill={r.v >= 0 ? "var(--up)" : "var(--down)"} opacity={hover == null || hover === i ? 0.85 : 0.45} />;
        })}
        <polyline points={pricePts} fill="none" stroke="var(--text)" strokeWidth={1.4} opacity={0.85} />
        {line && <polyline points={linePts} fill="none" stroke="var(--info)" strokeWidth={1.4} strokeDasharray="3 2" />}
        {hover != null && <line x1={(hover + 0.5) * bw} x2={(hover + 0.5) * bw} y1={top} y2={bot} stroke="var(--faint)" strokeDasharray="2 2" />}
      </svg>
      <div className="flex justify-between text-[10px] text-faint num"><span>{rows[0].date.slice(5)}</span><span>白線：收盤價{line ? `　藍虛線：${lineLabel}` : ""}</span><span>{rows[n - 1].date.slice(5)}</span></div>
    </div>
  );
}

function PeriodSeg({ v, set }: { v: number; set: (n: number) => void }) {
  return (
    <div className="seg">{PERIODS.map((n) => <button key={n} aria-pressed={v === n} onClick={() => set(n)}>{n}日</button>)}</div>
  );
}

function Stat({ label, value, sub, c = "" }: { label: string; value: string; sub?: string; c?: string }) {
  return (
    <div className="rounded-xl bg-panel-2 px-3 py-2 min-w-0">
      <div className="text-[11px] text-muted">{label}</div>
      <div className={`font-bold num text-[15px] ${c}`}>{value}</div>
      {sub && <div className="text-[11px] text-muted num truncate">{sub}</div>}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="rounded-xl bg-panel-2 p-4 text-sm text-muted leading-relaxed">{children}</div>;
}

const WHO = [["foreign_net", "外資"], ["trust_net", "投信"], ["dealer_net", "自營商"], ["total_net", "三大法人"]] as const;
type WhoKey = (typeof WHO)[number][0];

export default function ChipsPanel({ code, daily, market }: { code: string; daily: Bar[]; market?: string }) {
  const [tab, setTab] = useState<"inst" | "margin" | "mf">("inst");
  const [inst, setInst] = useState<Awaited<ReturnType<typeof getInst>> | null>(null);
  const [margin, setMargin] = useState<Awaited<ReturnType<typeof getMargin>> | null>(null);
  const [mf, setMf] = useState<Awaited<ReturnType<typeof getMainForce>> | null>(null);
  const [who, setWho] = useState<WhoKey>("foreign_net");
  const [days, setDays] = useState(5);
  const [chartN, setChartN] = useState(20);

  useEffect(() => {
    setInst(null); setMargin(null); setMf(null);
    getInst(code, 120).then(setInst).catch(() => setInst([]));
    getMargin(code, 120).then(setMargin).catch(() => setMargin([]));
    getMainForce(code, 90).then(setMf).catch(() => setMf([]));
  }, [code]);

  const price = useMemo(() => Object.fromEntries(daily.map((b) => [b.date!, b.close])), [daily]);
  const volByDate = useMemo(() => Object.fromEntries(daily.map((b) => [b.date!, b.volume])), [daily]); // 張
  const volOf = (dates: string[]) => sum(dates.map((d) => volByDate[d] ?? 0));

  const tabs = (
    <div className="px-3 pt-3 pb-2 flex flex-wrap items-center gap-2">
      <div className="seg">
        {([["inst", "三大法人"], ["margin", "融資融券"], ["mf", "主力進出"]] as const).map(([k, l]) => (
          <button key={k} aria-pressed={tab === k} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>
    </div>
  );

  return (
    <div className="pb-4">
      {tabs}

      {tab === "inst" && (
        <div className="px-3 space-y-3">
          {inst === null ? <div className="skeleton h-40" /> : inst.length === 0 ? (
            <Empty>這檔目前沒有三大法人資料。三大法人每個交易日收盤後（約 16:10 起）更新；ETF、新上市股票可能沒有資料。</Empty>
          ) : (
            <>
              <div className="flex items-center gap-2 flex-wrap"><PeriodSeg v={days} set={setDays} />
                <span className="text-[11px] text-muted">{inst[Math.min(days, inst.length) - 1]?.date.slice(5)}～{inst[0].date.slice(5)}</span></div>
              <div className="grid grid-cols-2 gap-2">
                {WHO.map(([k, name]) => {
                  const vals = inst.map((r) => +(r[k] ?? 0));
                  const v = sum(vals.slice(0, days));
                  const s = streak(vals);
                  const vol = volOf(inst.slice(0, days).map((r) => r.date));
                  const ratio = vol ? (v / 1000 / vol) * 100 : null;
                  return (
                    <button key={k} onClick={() => setWho(k)} className={`text-left rounded-xl px-3 py-2 border transition-colors ${who === k ? "border-accent bg-panel-2" : "border-transparent bg-panel-2"}`}>
                      <div className="flex text-[11px] text-muted"><span>{name}</span>
                        <span className={`ml-auto ${cls(s)}`}>{s ? `連${Math.abs(s)}${s > 0 ? "買" : "賣"}` : ""}</span></div>
                      <div className={`font-bold num text-[15px] ${cls(v)}`}>{signed(v / 1000)} 張</div>
                      <div className="text-[11px] text-muted num">佔成交量 {ratio == null ? "-" : `${ratio.toFixed(1)}%`}</div>
                    </button>
                  );
                })}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted">{WHO.find((w) => w[0] === who)![1]}買賣超</span>
                <div className="seg ml-auto">{[20, 60].map((n) => <button key={n} aria-pressed={chartN === n} onClick={() => setChartN(n)}>{n}日</button>)}</div>
              </div>
              <Combo rows={[...inst.slice(0, chartN)].reverse().map((r) => ({ date: r.date, v: +(r[who] ?? 0) / 1000 }))} price={price} />
              <table className="tbl">
                <thead><tr><th>日期</th><th>外資</th><th>投信</th><th>自營商</th><th>合計</th><th>收盤</th></tr></thead>
                <tbody>
                  {inst.slice(0, 20).map((r) => (
                    <tr key={r.date}>
                      <td>{r.date.slice(5)}</td>
                      <td className={cls(r.foreign_net)}>{lots(r.foreign_net)}</td>
                      <td className={cls(r.trust_net)}>{lots(r.trust_net)}</td>
                      <td className={cls(r.dealer_net)}>{lots(r.dealer_net)}</td>
                      <td className={cls(r.total_net)}>{lots(r.total_net)}</td>
                      <td>{price[r.date]?.toFixed(2) ?? "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="text-[11px] text-muted">單位：張。點上方卡片切換圖表；佔成交量 = 期間買賣超 ÷ 期間成交量。</p>
            </>
          )}
        </div>
      )}

      {tab === "margin" && (
        <div className="px-3 space-y-3">
          {margin === null ? <div className="skeleton h-40" /> : margin.length === 0 ? (
            <Empty>這檔目前沒有融資融券資料。融資融券每個交易日約 22:15 更新（證交所 / 櫃買中心晚上才公布）；不能信用交易的股票、ETF 不會有資料。</Empty>
          ) : (() => {
            const m0 = margin[0], m1 = margin[1];
            const ratio = (r: typeof m0) => (r.margin_balance ? (r.short_balance / r.margin_balance) * 100 : null);
            const r0 = ratio(m0);
            return (
              <>
                <div className="text-[11px] text-muted">{m0.date} 資料</div>
                <div className="grid grid-cols-3 gap-2">
                  <Stat label="融資餘額（張）" value={m0.margin_balance?.toLocaleString() ?? "-"} sub={m1 ? `${signed(m0.margin_balance - m1.margin_balance)}` : undefined}
                    c={m1 ? cls(m0.margin_balance - m1.margin_balance) : ""} />
                  <Stat label="融券餘額（張）" value={m0.short_balance?.toLocaleString() ?? "-"} sub={m1 ? `${signed(m0.short_balance - m1.short_balance)}` : undefined}
                    c={m1 ? cls(m0.short_balance - m1.short_balance) : ""} />
                  <Stat label="券資比" value={r0 == null ? "-" : `${r0.toFixed(2)}%`} sub={m1 && ratio(m1) != null && r0 != null ? `前日 ${ratio(m1)!.toFixed(2)}%` : undefined} />
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted">融資增減（柱）與融資餘額（藍線）</span>
                  <div className="seg ml-auto">{[20, 60].map((n) => <button key={n} aria-pressed={chartN === n} onClick={() => setChartN(n)}>{n}日</button>)}</div>
                </div>
                <Combo rows={[...margin.slice(0, chartN)].reverse().map((r) => ({ date: r.date, v: (r.margin_buy ?? 0) - (r.margin_sell ?? 0) }))}
                  price={price} line={Object.fromEntries(margin.map((r) => [r.date, r.margin_balance]))} lineLabel="融資餘額" vLabel="融資增減" />
                <table className="tbl">
                  <thead><tr><th>日期</th><th>資增減</th><th>資餘額</th><th>券增減</th><th>券餘額</th><th>券資比</th></tr></thead>
                  <tbody>
                    {margin.slice(0, 30).map((r) => {
                      const md = (r.margin_buy ?? 0) - (r.margin_sell ?? 0);
                      const sd = (r.short_sell ?? 0) - (r.short_buy ?? 0);
                      return (
                        <tr key={r.date}>
                          <td>{r.date.slice(5)}</td>
                          <td className={cls(md)}>{signed(md)}</td>
                          <td>{r.margin_balance?.toLocaleString()}</td>
                          <td className={cls(sd)}>{signed(sd)}</td>
                          <td>{r.short_balance?.toLocaleString()}</td>
                          <td>{ratio(r) == null ? "-" : ratio(r)!.toFixed(1) + "%"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <p className="text-[11px] text-muted">單位：張。資增減 = 融資買進 − 融資賣出；券增減 = 融券賣出 − 融券買進。</p>
              </>
            );
          })()}
        </div>
      )}

      {tab === "mf" && (
        <div className="px-3 space-y-3">
          {mf === null ? <div className="skeleton h-40" /> : mf.length === 0 ? (
            <Empty>
              {market === "TPEX"
                ? "上櫃股票的分點（主力）沒有免費資料來源：櫃買中心使用 Google 驗證，要付費資料才能自動抓。"
                : "還沒有主力資料。全市場上市股票從開始抓的那天起，每個交易日收盤後自動累積（證交所只提供當天，無法回補過去）。"}
            </Empty>
          ) : (
            <>
              <div className="flex items-center gap-2 flex-wrap"><PeriodSeg v={days} set={setDays} />
                <span className="text-[11px] text-muted">已累積 {mf.length} 個交易日</span></div>
              {(() => {
                const span = mf.slice(0, days);
                const net = sum(span.map((r) => r.net)) / 1000;
                const buy = sum(span.map((r) => r.top_buy)) / 1000;
                const sell = sum(span.map((r) => r.top_sell)) / 1000;
                const vol = volOf(span.map((r) => r.date));
                const s = streak(mf.map((r) => r.net));
                return (
                  <div className="grid grid-cols-2 gap-2">
                    <Stat label="主力買賣超" value={`${signed(net)} 張`} c={cls(net)} sub={s ? `連${Math.abs(s)}${s > 0 ? "買" : "賣"}` : undefined} />
                    <Stat label="籌碼集中度" value={vol ? `${((net / vol) * 100).toFixed(2)}%` : "-"} c={cls(net)} sub="主力買賣超 ÷ 成交量" />
                    <Stat label="買超前 15 名合計" value={`${Math.round(buy).toLocaleString()} 張`} c="up" />
                    <Stat label="賣超前 15 名合計" value={`${Math.round(Math.abs(sell)).toLocaleString()} 張`} c="down" />
                  </div>
                );
              })()}
              <Combo rows={[...mf.slice(0, Math.max(days, 20))].reverse().map((r) => ({ date: r.date, v: r.net / 1000 }))} price={price} />
              <table className="tbl">
                <thead><tr><th>日期</th><th>買超前15</th><th>賣超前15</th><th>主力淨</th><th>收盤</th></tr></thead>
                <tbody>
                  {mf.slice(0, 30).map((r) => (
                    <tr key={r.date}>
                      <td>{r.date.slice(5)}</td>
                      <td className="up">{lots(r.top_buy)}</td>
                      <td className="down">{lots(r.top_sell)}</td>
                      <td className={cls(r.net)}>{lots(r.net)}</td>
                      <td>{price[r.date]?.toFixed(2) ?? "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="text-[11px] text-muted">主力 = 當日買超前 15 名分點合計 + 賣超前 15 名分點合計（張）。各分點明細在「分點進出」。</p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
