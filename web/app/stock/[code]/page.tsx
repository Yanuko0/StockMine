"use client";
import { use, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Icon from "@/components/ui/Icon";
import { openSearch } from "@/components/SearchPalette";
import { useDesktop } from "@/lib/useMedia";
import dynamic from "next/dynamic";
import type { SubInd } from "@/components/KChart";
import ChipsPanel from "@/components/ChipsPanel";
import BrokerPanel from "@/components/BrokerPanel";
import QuoteHeader from "@/components/QuoteHeader";
import DrawToolbar, { COLORS } from "@/components/DrawToolbar";
import DrawEditor from "@/components/DrawEditor";
import { TF_LIST, MINUTES, dateToTs, resampleDaily, resampleMinutes, type Bar, type TF } from "@/lib/bars";
import { maColor, setMaColors, type MaLine } from "@/lib/colors";
import { loadMa, saveMa } from "@/lib/maConf";
import { DEFAULT_PARAMS } from "@/lib/chart";
import IndicatorParams, { DEFAULT_BOX, type BoxConf } from "@/components/IndicatorParams";
import { deductIndex, deduct3low, vpBox } from "@/lib/indicators";
import { TimeMapper } from "@/lib/timeline";
import { TOOLS, type DrawKind } from "@/lib/tools";
import {
  addDrawing, addWatch, allStocks, applyLiveBars, deleteDrawing, getDaily, getLiveQuotes, marketOpen, type LiveQuote, getDrawings, getInst, getMainForce, getMinute, getSetting, getWatchlist, me,
  pushRecent, removeWatch, subscribeDrawings, updateDrawing, type Drawing, type DrawPoint, type Stock,
} from "@/lib/data";

const KChart = dynamic(() => import("@/components/KChart"), { ssr: false });

const SUBS: { id: SubInd; label: string }[] = [
  { id: "VOL", label: "量" }, { id: "TW_KD", label: "KD" }, { id: "TW_RSI", label: "RSI" },
  { id: "TW_MACD", label: "MACD" }, { id: "TW_BIAS", label: "乖離" },
  { id: "TW_MF", label: "主力" }, { id: "TW_FOREIGN", label: "外資" }, { id: "TW_TRUST", label: "投信" }, { id: "TW_DEALER", label: "自營" },
];
const CHIP_SUBS = new Set<SubInd>(["TW_MF", "TW_FOREIGN", "TW_TRUST", "TW_DEALER"]);
const KIND_NAME = Object.fromEntries(TOOLS.map((t) => [t.kind, t.label])) as Record<DrawKind, string>;

function loadPref<T>(k: string, d: T): T {
  try { const v = localStorage.getItem(k); return v ? (JSON.parse(v) as T) : d; } catch { return d; }
}
function savePref(k: string, v: unknown) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* */ } }

type Tab = "tech" | "chips" | "broker";

export default function StockPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = use(params);
  const [stock, setStock] = useState<Stock | null>(null);
  const [tab, setTab] = useState<Tab>("tech");
  const [sideTab, setSideTab] = useState<"chips" | "broker">(() => loadPref("sideTab", "chips"));
  const [sideOpen, setSideOpen] = useState<boolean>(() => loadPref("sideOpen", true)); // 電腦版右側個股資訊：展開 / 收起
  useEffect(() => savePref("sideOpen", sideOpen), [sideOpen]);
  useEffect(() => savePref("sideTab", sideTab), [sideTab]);
  const desk = useDesktop();
  const router = useRouter();
  useEffect(() => { pushRecent(code); }, [code]);
  const [tf, setTf] = useState<TF>(() => loadPref("tf", "D"));
  const [dailyRaw, setDaily] = useState<Bar[]>([]);
  const [live, setLive] = useState<LiveQuote | undefined>(undefined);
  // 盤中 / 收盤後還沒進資料庫前：用證交所即時報價接上今天這一根
  const daily = useMemo(() => applyLiveBars(dailyRaw, live), [dailyRaw, live]);
  const [minute, setMinute] = useState<Bar[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [subs, setSubs] = useState<SubInd[]>(() => loadPref("subs", ["VOL", "TW_KD"]));
  const [showDeduct, setShowDeduct] = useState<boolean>(() => loadPref("deduct", true));
  const [d3On, setD3On] = useState<boolean>(() => loadPref("d3", true));
  const [polyOn, setPolyOn] = useState<boolean>(() => loadPref("d3poly", true));
  useEffect(() => savePref("d3poly", polyOn), [polyOn]);
  const [bollOn, setBollOn] = useState<boolean>(() => loadPref("boll", false));
  const [indParams, setIndParams] = useState<Record<string, number[]>>(() => ({ ...DEFAULT_PARAMS, ...loadPref("indParams", {}) }));
  const [paramOpen, setParamOpen] = useState(false);
  // 自動箱型（密集成交區）
  const [d3Info, setD3Info] = useState(false);
  const [boxOn, setBoxOn] = useState<boolean>(() => loadPref("boxOn", false));
  const [boxConf, setBoxConf] = useState<BoxConf>(() => ({ ...DEFAULT_BOX, ...loadPref("boxConf", {}) }));
  useEffect(() => savePref("boxOn", boxOn), [boxOn]);
  useEffect(() => savePref("boxConf", boxConf), [boxConf]);
  // 均線：期數、顏色、開關（這台裝置）
  const [maConf, setMaConf] = useState<MaLine[]>(() => loadMa());
  useEffect(() => saveMa(maConf), [maConf]);
  const maPeriods = useMemo(() => { setMaColors(maConf); return maConf.filter((m) => m.on).map((m) => m.n); }, [maConf]);
  const [chips, setChips] = useState<Record<string, { ts: number; v: number }[]>>({});
  const needChips = subs.some((x) => CHIP_SUBS.has(x));
  useEffect(() => {
    if (!needChips) return;
    let alive = true;
    // 法人保留約 400 天、主力（分點）保留約 90 天；單位：股 → 張
    Promise.all([getInst(code, 400).catch(() => []), getMainForce(code, 90).catch(() => [])]).then(([inst, mf]) => {
      if (!alive) return;
      const asc = <T extends { date: string }>(a: T[]) => [...a].sort((x, y) => x.date.localeCompare(y.date));
      const col = (k: "foreign_net" | "trust_net" | "dealer_net") => asc(inst).map((r) => ({ ts: dateToTs(r.date), v: Math.round(+r[k] / 1000) }));
      setChips({
        TW_FOREIGN: col("foreign_net"), TW_TRUST: col("trust_net"), TW_DEALER: col("dealer_net"),
        TW_MF: asc(mf).map((r) => ({ ts: dateToTs(r.date), v: Math.round(+r.net / 1000) })),
      });
    });
    return () => { alive = false; };
  }, [code, needChips]);
  useEffect(() => savePref("boll", bollOn), [bollOn]);
  useEffect(() => savePref("indParams", indParams), [indParams]);
  const [d3N, setD3N] = useState(5);
  const [offset, setOffset] = useState(0);
  const [userId, setUserId] = useState<string | null>(null);
  const [watched, setWatched] = useState(false);
  // 畫線
  const [drawings, setDrawings] = useState<Drawing[]>([]);
  const [drawOpen, setDrawOpen] = useState(false);
  const [tool, setTool] = useState<DrawKind | null>(null);
  const [color, setColor] = useState(COLORS[0]);
  const [label, setLabel] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showList, setShowList] = useState(false);
  const [priv, setPriv] = useState<boolean>(() => loadPref("drawPriv", false));
  useEffect(() => savePref("drawPriv", priv), [priv]);

  useEffect(() => {
    allStocks().then((l) => setStock(l.find((s) => s.code === code) ?? null));
    me().then((u) => setUserId(u?.id ?? null));
    getWatchlist().then((w) => setWatched(w.includes(code)));
    getSetting<{ ma: number }>("deduct3low", { ma: 5 }).then((v) => setD3N(v?.ma ?? 5));
    getSetting<number>("deduct_offset", 0).then((v) => setOffset(Number(v) || 0));
    setLoading(true);
    setLive(undefined);
    getDaily(code).then((d) => { setDaily(d); setLoading(false); });
  }, [code]);

  useEffect(() => {
    let alive = true;
    const pull = () => getLiveQuotes([code]).then((m) => { if (alive && m[code]) setLive(m[code]); });
    pull();
    const id = setInterval(() => { if (marketOpen() && !document.hidden) pull(); }, 15_000);
    return () => { alive = false; clearInterval(id); };
  }, [code]);

  useEffect(() => {
    if (MINUTES[tf] && minute === null) getMinute(code).then(setMinute).catch(() => setMinute([]));
  }, [tf, code, minute]);

  const refresh = useCallback(() => { getDrawings(code).then(setDrawings).catch(() => {}); }, [code]);
  useEffect(() => { refresh(); return subscribeDrawings(code, refresh); }, [code, refresh]);

  useEffect(() => savePref("tf", tf), [tf]);
  useEffect(() => savePref("subs", subs), [subs]);
  useEffect(() => savePref("deduct", showDeduct), [showDeduct]);
  useEffect(() => savePref("d3", d3On), [d3On]);

  const bars = useMemo(() => {
    if (tf === "D") return daily;
    if (tf === "W") return resampleDaily(daily, "W");
    if (tf === "M") return resampleDaily(daily, "M");
    return minute ? resampleMinutes(minute, MINUTES[tf]!) : [];
  }, [tf, daily, minute]);
  const tradingDays = useMemo(() => daily.map((b) => b.date!), [daily]);
  const mapper = useMemo(() => new TimeMapper(bars, tf, tradingDays), [bars, tf, tradingDays]);

  // 扣三低是「月」的規則：用月K 算出扣三低線，所有週期都畫同一條線
  const d3 = useMemo(() => deduct3low(resampleDaily(daily, "M").map((b) => b.close), d3N, offset), [daily, d3N, offset]);
  const d3Status = useMemo(() => {
    if (!d3 || daily.length < 2) return "";
    const c1 = daily[daily.length - 1].close, c0 = daily[daily.length - 2].close;
    if (c0 <= d3.line && c1 > d3.line) return "今日突破 ✓";
    return c1 > d3.line ? "站上（已突破）" : "未突破";
  }, [d3, daily]);
  const box = useMemo(() => {
    if (!boxOn || daily.length < boxConf.n + 2) return null;
    const r = vpBox(daily.map((b) => b.high), daily.map((b) => b.low), daily.map((b) => b.close), daily.map((b) => b.volume),
      boxConf.n, boxConf.bins, boxConf.va / 100);
    if (!r) return null;
    const c1 = daily[daily.length - 1].close, c0 = daily[daily.length - 2].close;
    const status = c0 <= r.top && c1 > r.top ? "今日突破箱頂" : c0 >= r.bottom && c1 < r.bottom ? "今日跌破箱底"
      : c1 > r.top ? "在箱頂之上" : c1 < r.bottom ? "在箱底之下" : "箱內盤整";
    return { ...r, status, ok: r.height <= boxConf.maxHeight };
  }, [boxOn, daily, boxConf]);
  const maExt = useMemo(() => ({
    box: box ? {
      top: box.top, bottom: box.bottom, poc: box.poc, startTs: daily[box.start].timestamp, profile: box.profile, pmin: box.pmin, step: box.step,
      showProfile: boxConf.profile, label: `前${boxConf.n}日 ${boxConf.va}% 量・箱高 ${box.height.toFixed(1)}%${box.ok ? "" : "（超過上限，不算箱型）"}`,
    } : null,
    deduct: showDeduct, offset, colors: maConf.map((m) => m.color).join(), // colors：顏色改了要重畫
    d3: { enabled: d3On && !!d3, n: d3N, monthly: tf === "M", line: d3?.line ?? null, status: d3Status, poly: polyOn },
  }), [showDeduct, offset, d3On, d3N, tf, d3, d3Status, maConf, box, boxConf, daily, polyOn]);
  const toolState = useMemo(() => (tool ? { kind: tool, color, label } : null), [tool, color, label]);

  const last = bars[bars.length - 1];
  const closes = bars.map((b) => b.close);
  // 手機版圖表上方的一行：均線數值（手指移到哪根就顯示那根）
  const [crossIdx, setCrossIdx] = useState<number | null>(null);
  const maRow = useMemo(() => {
    const i = crossIdx != null && crossIdx >= 0 && crossIdx < closes.length ? crossIdx : closes.length - 1;
    if (i < 0) return null;
    const vals = maPeriods.map((n) => {
      if (i + 1 < n) return { n, v: null as number | null };
      let sum = 0; for (let k = i - n + 1; k <= i; k++) sum += closes[k];
      return { n, v: sum / n };
    });
    const b = bars[i];
    return { vals, bar: b, cross: crossIdx != null };
  }, [crossIdx, closes, maPeriods, bars]);
  const selected = drawings.find((d) => d.id === selectedId) ?? null;

  async function onCreated(kind: DrawKind, points: DrawPoint[]) {
    let lbl = label.trim();
    if (kind === "text" && !lbl) lbl = window.prompt("要寫的文字") ?? "";
    if (kind === "text" && !lbl) { setTool(null); return; }
    setTool(null);
    const d = await addDrawing({ code, kind, points, color, label: lbl || null, is_private: priv });
    setLabel("");
    setDrawings((x) => [...x, d]);
  }
  async function patchSelected(patch: Partial<Pick<Drawing, "color" | "label" | "is_private">>) {
    if (!selected) return;
    setDrawings((x) => x.map((d) => (d.id === selected.id ? { ...d, ...patch } : d)));
    await updateDrawing(selected.id, patch);
  }

  const starBtn = (
    <button className={`icon-btn ${watched ? "!text-accent" : ""}`} title={watched ? "移出自選" : "加入自選（分點只抓自選股）"}
      onClick={async () => { if (watched) await removeWatch(code); else await addWatch(code); setWatched(!watched); }}>
      <Icon name="star" fill={watched ? "currentColor" : "none"} />
    </button>
  );
  const tech = (
        <div className="flex-1 min-h-0 flex flex-col">
          {/* 週期 + 畫線開關 */}
          <div className="flex items-center gap-2 px-2 py-1.5 border-b border-line">
            <div className="flex-1 min-w-0 overflow-x-auto no-scrollbar">
              <div className="seg">
                {TF_LIST.map((t, i) => (
                  <button key={t.tf} aria-pressed={tf === t.tf} className={i === 3 ? "ml-1.5" : ""} onClick={() => setTf(t.tf)}>{t.label}</button>
                ))}
              </div>
            </div>
            <button className={`chip ${drawOpen ? "chip-on" : ""}`} onClick={() => { setDrawOpen(!drawOpen); setTool(null); }}>
              <Icon name="pencil" className="w-4 h-4" /> 畫線
            </button>
          </div>

          {drawOpen && (
            <DrawToolbar active={tool} setActive={(k) => { setTool(k); setSelectedId(null); }} color={color} setColor={setColor}
              label={label} setLabel={setLabel} selected={selected} mineSelected={!!selected && selected.created_by === userId}
              onRecolor={(c) => patchSelected({ color: c })} onRelabel={(s) => patchSelected({ label: s || null })}
              priv={priv} setPriv={setPriv} onTogglePrivate={(v) => patchSelected({ is_private: v })}
              onDelete={async () => { if (!selected) return; const id = selected.id; setSelectedId(null); setDrawings((x) => x.filter((d) => d.id !== id)); await deleteDrawing(id); }} />
          )}

          {/* 手機：均線數值一行（可左右滑），手指在圖上時顯示那根的開高低收 */}
          {maRow && (
            <div className="lg:hidden flex items-center gap-2.5 px-2 h-6 text-[11px] num overflow-x-auto no-scrollbar whitespace-nowrap border-b border-line bg-panel">
              {maRow.cross && maRow.bar ? (
                <>
                  <span className="text-muted">{maRow.bar.date?.slice(5) ?? new Date(maRow.bar.timestamp + 8 * 3600e3).toISOString().slice(5, 16).replace("T", " ")}</span>
                  <span>開 {maRow.bar.open.toFixed(2)}</span><span className="up">高 {maRow.bar.high.toFixed(2)}</span>
                  <span className="down">低 {maRow.bar.low.toFixed(2)}</span><span>收 {maRow.bar.close.toFixed(2)}</span>
                  <span className="text-muted">量 {Math.round(maRow.bar.volume).toLocaleString()}</span>
                  <span className="w-px h-3 bg-line shrink-0" />
                </>
              ) : null}
              {maRow.vals.map(({ n, v }) => (
                <span key={n} style={{ color: maColor(n) }}>{n}T:{v == null ? "-" : v.toFixed(2)}</span>
              ))}
            </div>
          )}
          {/* 圖表 */}
          <div className="relative flex-1 min-h-[52vh]">
            {d3On && d3 && daily.length > 1 && !loading && (
              <button onClick={() => setD3Info(!d3Info)} title="月扣三低：點開看 D1~D3"
                className="hidden lg:block absolute z-10 right-[72px] top-1.5 rounded-lg px-2 py-1 text-[11px] num glass border border-line text-left shadow"
                style={{ color: "var(--accent)" }}>
                <b>月扣三低線 {d3.line.toFixed(2)}</b>・{d3Status}
                <span className="text-muted">　{((daily[daily.length - 1].close / d3.line - 1) * 100).toFixed(1)}%</span>
                {d3Info && (
                  <span className="block mt-1 text-text space-y-0.5">
                    {d3.d.map((v, i) => <span key={i} className="block">D{i + 1}（{["下個月", "下下個月", "第三個月"][i]}要扣的月收盤）{v.toFixed(2)}</span>)}
                    <span className="block text-muted">線 = D1~D3 最高；日K 收盤由下往上穿過這條線 = 突破</span>
                  </span>
                )}
              </button>
            )}
            {loading || (MINUTES[tf] && minute === null) ? (
              <div className="absolute inset-0 p-3 flex flex-col gap-2"><div className="skeleton flex-[3]" /><div className="skeleton flex-1" /></div>
            ) : bars.length === 0 ? (
              <div className="absolute inset-0 flex items-center justify-center text-muted text-sm p-6 text-center">
                {MINUTES[tf] ? "這檔目前沒有分鐘K資料（每天收盤後自動抓全市場近 30 天）" : "沒有資料"}
              </div>
            ) : (
              <KChart code={code} tf={tf} bars={bars} mapper={mapper} maPeriods={maPeriods} maExt={maExt} subs={subs}
                boll={bollOn} params={indParams} chips={chips}
                drawings={drawings} userId={userId} tool={toolState}
                onCreated={onCreated}
                onMoved={(id, points) => { setDrawings((x) => x.map((d) => (d.id === id ? { ...d, points } : d))); updateDrawing(id, { points }); }}
                onSelect={(id) => { if (id) setSelectedId(id); }} onCross={setCrossIdx} />
            )}
            {selected && (
              <DrawEditor d={selected} mine={selected.created_by === userId} bars={bars} tf={tf}
                onPoints={(points) => { setDrawings((x) => x.map((d) => (d.id === selected.id ? { ...d, points } : d))); updateDrawing(selected.id, { points }); }}
                onRecolor={(c) => patchSelected({ color: c })} onRelabel={(s) => patchSelected({ label: s || null })}
                onTogglePrivate={(v) => patchSelected({ is_private: v })}
                onDuplicate={async () => {
                  const nd = await addDrawing({ code, kind: selected.kind, points: selected.points, color: selected.color, label: selected.label, is_private: !!selected.is_private });
                  setDrawings((x) => [...x, nd]); setSelectedId(nd.id);
                }}
                onDelete={async () => { const id = selected.id; setSelectedId(null); setDrawings((x) => x.filter((d) => d.id !== id)); await deleteDrawing(id); }}
                onClose={() => setSelectedId(null)} />
            )}
          </div>

          {/* 指標 + 扣抵 */}
          <div className="border-t border-line bg-panel px-2 py-1.5 space-y-1.5 safe-bottom lg:pb-1.5">
            <div className="flex gap-1 overflow-x-auto no-scrollbar items-center lg:flex-wrap">
              {SUBS.map((s) => {
                const on = subs.includes(s.id);
                return <button key={s.id} className={`chip ${on ? "chip-on" : ""}`}
                  onClick={() => setSubs(on ? subs.filter((x) => x !== s.id) : [...subs, s.id].slice(-4))}>{s.label}</button>;
              })}
              <button className={`chip ${bollOn ? "chip-on" : ""}`} onClick={() => setBollOn(!bollOn)}>布林</button>
              <button className={`chip ${boxOn ? "chip-on" : ""}`} onClick={() => setBoxOn(!boxOn)} title="自動判定密集成交區箱型">箱型</button>
              <button className="chip" onClick={() => setParamOpen(true)} title="指標參數"><Icon name="gear" className="w-4 h-4" /> 參數</button>
              <span className="w-px h-5 bg-line mx-1 shrink-0" />
              <button className={`chip ${showDeduct ? "chip-on" : ""}`} onClick={() => setShowDeduct(!showDeduct)}>扣抵</button>
              <button className={`chip ${d3On ? "chip-on" : ""}`} onClick={() => setD3On(!d3On)}>月扣三低</button>
              <button className={`chip ${polyOn ? "chip-on" : ""}`} title="月K 上畫扣抵折線（3AI）：未來 3 個月要扣的值"
                onClick={() => { const v = !polyOn; setPolyOn(v); if (v && tf !== "M") setTf("M"); }}>扣三低折線</button>
              <button className={`chip ${showList ? "chip-on" : ""}`} onClick={() => setShowList(!showList)}>畫線清單 {drawings.length}</button>
            </div>
            {last && (
              <div className="flex gap-3 overflow-x-auto no-scrollbar text-xs tabular-nums lg:flex-wrap lg:gap-y-0.5">
                {maPeriods.map((n) => {
                  const i = deductIndex(closes.length, n, offset);
                  if (i == null) return null;
                  const v = closes[i];
                  const up = last.close > v;
                  return (
                    <span key={n} className="whitespace-nowrap">
                      <span style={{ color: maColor(n) }}>扣{n}</span> {v.toFixed(2)}<span className={up ? "up" : "down"}>{up ? "↑" : "↓"}</span>
                    </span>
                  );
                })}
                {needChips && MINUTES[tf] && <span className="whitespace-nowrap text-muted">籌碼副圖只在日 / 週 / 月K 顯示</span>}
                {box && (
                  <span className="whitespace-nowrap" style={{ color: "var(--info)" }}>
                    箱型 {box.bottom.toFixed(2)}～{box.top.toFixed(2)}・{box.status}{box.ok ? "" : "（箱高超過上限）"}
                  </span>
                )}
                {d3On && d3 && (
                  <span className="whitespace-nowrap text-accent">
                    扣三低線 {d3.line.toFixed(2)}・{d3Status}・D1~D3 {d3.d.map((x) => x.toFixed(1)).join("/")}
                  </span>
                )}
              </div>
            )}
          </div>

          {showList && (
            <div className="max-h-[30vh] overflow-y-auto scroll-thin border-t border-line bg-panel">
              {drawings.length === 0 && <p className="text-muted text-sm p-3">還沒有畫線。按「✎ 畫線」開始畫，畫好的線所有人都看得到。</p>}
              <ul className="divide">
                {drawings.map((d) => {
                  const mine = d.created_by === userId;
                  const price = d.kind === "hline" ? d.points[0].v.toFixed(2) : d.points.map((p) => p.v.toFixed(1)).join(" → ");
                  return (
                    <li key={d.id} className={`flex items-center gap-2 px-3 py-2 text-sm row-hover cursor-pointer ${selectedId === d.id ? "bg-panel-2" : ""}`}
                      onClick={() => setSelectedId(d.id)}>
                      <span className="w-3 h-3 rounded-full shrink-0" style={{ background: d.color }} />
                      <span className="w-14 text-muted text-xs">{KIND_NAME[d.kind]}</span>
                      <span className="tabular-nums text-xs truncate flex-1">{d.is_private ? "🔒" : ""}{d.label ? `${d.label}・` : ""}{price}</span>
                      <span className="text-muted text-xs">{d.created_by_name}</span>
                      {mine && <button className="text-muted text-xs" onClick={async (e) => {
                        e.stopPropagation(); setDrawings((x) => x.filter((y) => y.id !== d.id)); await deleteDrawing(d.id);
                      }}>刪除</button>}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>
  );
  const sidePanel = (key: "chips" | "broker") => key === "chips"
    ? <ChipsPanel code={code} daily={daily} market={stock?.market} />
    : <BrokerPanel code={code} daily={daily} market={stock?.market} />;

  return (
    <div className="h-full flex flex-col">
      {/* 標題 */}
      <header className="flex items-center gap-1.5 px-2 lg:px-4 py-1 border-b border-line bg-panel" style={{ paddingTop: "max(6px, env(safe-area-inset-top))" }}>
        <button className="icon-btn lg:hidden" onClick={() => (history.length > 1 ? router.back() : router.push("/"))} aria-label="返回">
          <Icon name="back" className="w-6 h-6" />
        </button>
        <div className="min-w-0 flex-1 lg:flex-none flex flex-col items-center lg:items-start lg:flex-row lg:items-baseline lg:gap-2">
          <div className="flex items-baseline gap-1.5 min-w-0">
            <span className="text-muted num text-[15px]">{code}</span>
            <span className="font-bold truncate text-[18px]">{stock?.name}</span>
          </div>
          <span className="text-[11px] px-1.5 rounded-md border border-line text-muted whitespace-nowrap leading-[18px]">
            {stock?.market === "TPEX" ? "上櫃" : "上市"}{stock?.kind === "etf" ? "-ETF" : stock?.industry ? `-${stock.industry}` : ""}
          </span>
        </div>
        <div className="ml-auto flex items-center">
          <button className="icon-btn" onClick={() => openSearch()} title="搜尋（直接打股號）"><Icon name="search" /></button>
          {starBtn}
        </div>
      </header>

      {desk ? (
        <div className="flex-1 min-h-0 flex">
          <div className="flex-1 min-w-0 flex flex-col">{tech}</div>
          {!sideOpen ? (
            <aside className="w-7 shrink-0 border-l border-line bg-panel">
              <button className="w-7 h-full flex flex-col items-center pt-3 gap-2 text-muted hover:text-text hover:bg-panel-2" title="展開個股資訊" onClick={() => setSideOpen(true)}>
                <Icon name="dblLeft" className="w-4 h-4" />
                <span className="text-[11px] [writing-mode:vertical-rl] tracking-widest">個股資訊</span>
              </button>
            </aside>
          ) : (
          <aside className="w-[360px] xl:w-[400px] shrink-0 border-l border-line bg-panel flex flex-col min-h-0 relative">
            <button className="icon-btn !w-7 !h-7 absolute right-1.5 top-1.5 z-10" title="收起個股資訊" onClick={() => setSideOpen(false)}>
              <Icon name="dblRight" className="w-4 h-4" />
            </button>
            <QuoteHeader daily={daily} side liveTime={live?.date === daily[daily.length - 1]?.date ? live?.time : undefined} />
            <div className="px-3 py-2 border-y border-line">
              <div className="seg w-full">
                {([["chips", "籌碼"], ["broker", "分點進出"]] as const).map(([k, l]) => (
                  <button key={k} className="flex-1" aria-pressed={sideTab === k} onClick={() => setSideTab(k)}>{l}</button>
                ))}
              </div>
            </div>
            <div className="flex-1 overflow-y-auto scroll-thin">{sidePanel(sideTab)}</div>
          </aside>
          )}
        </div>
      ) : (
        <>
          <QuoteHeader daily={daily} liveTime={live?.date === daily[daily.length - 1]?.date ? live?.time : undefined} />
          <div className="tabbar" role="tablist">
            {([["tech", "技術"], ["chips", "籌碼"], ["broker", "進出"]] as const).map(([k, l]) => (
              <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{l}</button>
            ))}
          </div>
          {tab === "tech" && tech}
          {tab !== "tech" && <div className="flex-1 overflow-y-auto">{sidePanel(tab)}</div>}
        </>
      )}

      {paramOpen && <IndicatorParams value={indParams} onChange={setIndParams} ma={maConf} onMa={setMaConf} box={boxConf} onBox={setBoxConf} onClose={() => setParamOpen(false)} />}

    </div>
  );
}
