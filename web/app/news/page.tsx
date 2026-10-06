"use client";
// 新聞熱度：最近 7 天台股 / 產業新聞，哪些標的、產業題材、關鍵字被提到最多、熱度是不是突然升高
// 「熱度高、主力賣超」= 媒體一直報、但主力（關鍵分點）在賣 → 留意是不是買新聞出貨
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Icon from "@/components/ui/Icon";
import IntelTabs from "@/components/IntelTabs";
import {
  allStocks, getNews, getNewsStats, type NewsGroup, type NewsHeat, type NewsItem, type NewsKeyword, type NewsStats, type NewsStock,
} from "@/lib/data";

type Tab = "stocks" | "groups" | "keywords" | "latest";
type Sel = { type: "stock"; v: NewsStock } | { type: "group"; v: NewsGroup } | { type: "kw"; v: NewsKeyword } | null;

const TW = 8 * 3600e3;
const hhmm = (iso: string) => new Date(new Date(iso).getTime() + TW).toISOString().slice(11, 16);
const mdhm = (iso: string) => { const s = new Date(new Date(iso).getTime() + TW).toISOString(); return `${s.slice(5, 7)}/${s.slice(8, 10)} ${s.slice(11, 16)}`; };
const ago = (iso: string) => {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  return m < 60 ? `${Math.max(1, m)} 分鐘前` : m < 1440 ? `${Math.round(m / 60)} 小時前` : mdhm(iso);
};
const cls = (v: number | null | undefined) => (v == null ? "text-muted" : v > 0 ? "up" : v < 0 ? "down" : "text-muted");
const pctTxt = (v: number | null | undefined) => (v == null ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(1)}%`);

/** 7 天每日提及次數（最右邊 = 今天） */
function Bars({ s, w = 64, h = 22 }: { s: number[]; w?: number; h?: number }) {
  const max = Math.max(1, ...s);
  const bw = w / s.length;
  return (
    <svg width={w} height={h} className="shrink-0" aria-hidden>
      {s.map((v, i) => {
        const bh = v ? Math.max(2, (v / max) * (h - 1)) : 1;
        return <rect key={i} x={i * bw + 1} y={h - bh} width={bw - 2} height={bh} rx={1}
          fill={i === s.length - 1 ? "var(--accent)" : "var(--muted)"} opacity={v ? (i === s.length - 1 ? 1 : 0.55) : 0.2} />;
      })}
    </svg>
  );
}

function Spike({ v }: { v: number | null }) {
  if (v == null || v < 1.5) return null;
  return <span className={`text-[11px] font-semibold rounded px-1 num ${v >= 3 ? "bg-up text-white" : "bg-[var(--accent-bg)] text-accent"}`}>↑{v.toFixed(1)}×</span>;
}

function Flags({ f }: { f: string[] }) {
  return <>{f.map((x) => (
    <span key={x} className={`text-[10px] font-semibold rounded px-1 whitespace-nowrap ${x.includes("主力賣超") ? "bg-[var(--param)] text-black" : x === "來源集中" ? "bg-panel-2 text-muted border border-line" : "bg-[var(--accent-bg)] text-accent"}`}>{x}</span>
  ))}</>;
}

function Count({ h, mode }: { h: NewsHeat; mode: "24h" | "7d" }) {
  return (
    <span className="text-right shrink-0 w-14">
      <span className="block text-[18px] font-bold num leading-tight">{mode === "24h" ? h.n24 : h.n7}</span>
      <span className="block text-[10px] text-muted num">{mode === "24h" ? `7日 ${h.n7}` : `24h ${h.n24}`}</span>
    </span>
  );
}

export default function NewsPage() {
  const router = useRouter();
  const [stats, setStats] = useState<NewsStats | null | undefined>(undefined);
  const [tab, setTab] = useState<Tab>("stocks");
  const [mode, setMode] = useState<"24h" | "7d">("7d");
  const [kindF, setKindF] = useState<"題材" | "產業">("題材");
  const [onlyFlag, setOnlyFlag] = useState(false);
  const [sel, setSel] = useState<Sel>(null);
  const [list, setList] = useState<NewsItem[] | null>(null);
  const [q, setQ] = useState("");
  const [more, setMore] = useState(false); // 清單先顯示前 30 名
  const detailRef = useRef<HTMLDivElement>(null);

  const [names, setNames] = useState<Record<string, string>>({});
  useEffect(() => {
    getNewsStats().then(setStats).catch(() => setStats(null));
    allStocks().then((l) => setNames(Object.fromEntries(l.map((x) => [x.code, x.name])))).catch(() => {});
  }, []);

  const key = (h: NewsHeat) => (mode === "24h" ? h.n24 * 1000 + h.n7 : h.n7 * 1000 + h.n24);
  const stocks = useMemo(() => [...(stats?.stocks ?? [])].filter((s) => !onlyFlag || s.flags.length).sort((a, b) => key(b) - key(a)), [stats, mode, onlyFlag]); // eslint-disable-line react-hooks/exhaustive-deps
  const groups = useMemo(() => [...(stats?.groups ?? [])].filter((g) => g.kind === kindF).sort((a, b) => key(b) - key(a)), [stats, mode, kindF]); // eslint-disable-line react-hooks/exhaustive-deps
  const kws = useMemo(() => [...(stats?.keywords ?? [])].sort((a, b) => key(b) - key(a)), [stats, mode]); // eslint-disable-line react-hooks/exhaustive-deps
  const hot = useMemo(() => [...(stats?.stocks ?? [])].filter((s) => (s.spike ?? 0) >= 3 && s.n24 >= 3).sort((a, b) => (b.spike ?? 0) - (a.spike ?? 0)).slice(0, 8), [stats]);

  // 選了什麼 → 讀相關新聞
  useEffect(() => {
    let alive = true;
    setList(null);
    const f = !sel ? { q, limit: 80 }
      : sel.type === "stock" ? { code: sel.v.code }
      : sel.type === "kw" ? { keyword: sel.v.k }
      : sel.v.kind === "題材" ? { theme: sel.v.name } : { codes: sel.v.codes ?? [] };
    const t = setTimeout(() => getNews(f).then((r) => { if (alive) setList(r); }).catch(() => { if (alive) setList([]); }), sel ? 0 : 250);
    return () => { alive = false; clearTimeout(t); };
  }, [sel, q]);

  function pick(s: Sel) {
    setSel(s);
    if (window.innerWidth < 1024) requestAnimationFrame(() => detailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }
  const isSel = (type: string, id: string) => !!sel && sel.type === type && (sel.type === "stock" ? sel.v.code : sel.type === "kw" ? sel.v.k : sel.v.name) === id;
  const pickStock = (code: string) => {
    const s = stats?.stocks.find((x) => x.code === code);
    if (s) { setTab("stocks"); pick({ type: "stock", v: s }); } else router.push(`/stock/${code}`);
  };
  const pickKw = (k: string) => { const x = stats?.keywords.find((y) => y.k === k); if (x) { setTab("keywords"); pick({ type: "kw", v: x }); } };

  if (stats === undefined) return <div className="page space-y-3"><div className="skeleton h-10" /><div className="skeleton h-[480px]" /></div>;

  const header = (
    <header className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <h1 className="text-[22px] lg:text-[26px] font-bold tracking-tight">新聞熱度</h1>
      <IntelTabs />
      {stats && (
        <div className="w-full lg:w-auto lg:ml-auto text-[12px] text-muted num">
          近 7 天 {stats.total.toLocaleString()} 則・24 小時 {stats.n24} 則・{hhmm(stats.asof)} 更新
        </div>
      )}
    </header>
  );

  if (!stats) {
    return (
      <div className="page space-y-4">
        {header}
        <div className="card p-6 text-center space-y-2">
          <Icon name="news" className="w-10 h-10 mx-auto text-muted" />
          <div className="text-[17px] font-semibold">還沒有新聞資料</div>
          <p className="text-sm text-muted">每 2 小時會自動整理一次。也可以到 GitHub Actions 手動執行「新聞熱度」。</p>
        </div>
      </div>
    );
  }

  const tabs: [Tab, string][] = [["stocks", "熱門標的"], ["groups", "產業題材"], ["keywords", "關鍵字"], ["latest", "最新新聞"]];
  const showMode = tab !== "latest";

  return (
    <div className="page space-y-3">
      {header}

      {/* 熱度急升 */}
      {hot.length > 0 && (
        <div className="card px-3 py-2.5 flex items-start gap-2">
          <span className="shrink-0 rounded-md bg-up text-white text-[12px] font-semibold px-1.5 py-0.5 mt-0.5">熱度急升</span>
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-[14px]">
            {hot.map((s) => (
              <button key={s.code} onClick={() => pickStock(s.code)} className="hover:underline">
                <b>{s.name}</b><span className="text-muted text-[12px] num"> 24h {s.n24} 則・↑{s.spike?.toFixed(1)}×</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div className="seg">
          {tabs.map(([k, l]) => <button key={k} aria-pressed={tab === k} onClick={() => { setTab(k); setSel(null); }}>{l}</button>)}
        </div>
        {showMode && (
          <div className="seg ml-auto">
            <button aria-pressed={mode === "24h"} onClick={() => setMode("24h")}>24 小時</button>
            <button aria-pressed={mode === "7d"} onClick={() => setMode("7d")}>7 天</button>
          </div>
        )}
      </div>

      <div className="lg:flex lg:gap-3 lg:items-start space-y-3 lg:space-y-0">
        {/* 左：排行 */}
        <section className={`${tab === "latest" ? "hidden" : ""} lg:w-[560px] lg:shrink-0 card overflow-hidden`}>
          {tab === "stocks" && (
            <>
              <div className="card-h text-[13px]">
                <span>提及次數排行</span>
                <label className="ml-auto flex items-center gap-1.5 font-normal text-[12px] text-muted">
                  <input type="checkbox" checked={onlyFlag} onChange={(e) => setOnlyFlag(e.target.checked)} />只看有警示
                </label>
              </div>
              <div className="hidden sm:grid grid-cols-[1.6rem_1fr_64px_3.5rem_4.2rem_4.6rem] gap-2 px-3 py-1.5 text-[11px] text-muted border-b border-line">
                <span>#</span><span>標的</span><span>7 日走勢</span><span className="text-right">提及</span><span className="text-right">5日漲跌</span><span className="text-right">主力5日</span>
              </div>
              <ul className="max-h-[none] lg:max-h-[calc(100vh-260px)] overflow-y-auto scroll-thin">
                {stocks.slice(0, more ? undefined : 30).map((s, i) => (
                  <li key={s.code} className="border-b border-line last:border-0">
                    <button onClick={() => pick({ type: "stock", v: s })}
                      className={`w-full text-left grid grid-cols-[1.6rem_1fr_auto_3.5rem] sm:grid-cols-[1.6rem_1fr_64px_3.5rem_4.2rem_4.6rem] gap-2 items-center px-3 py-2 transition-colors ${isSel("stock", s.code) ? "bg-[var(--accent-bg)]" : "hover:bg-panel-2"}`}>
                      <span className="text-[12px] text-muted num">{i + 1}</span>
                      <span className="min-w-0">
                        <span className="flex items-center gap-1 flex-wrap">
                          <span className="font-semibold text-[15px]">{s.name}</span>
                          <span className="text-[11px] text-muted num">{s.code}</span>
                          <Spike v={s.spike} />
                        </span>
                        <span className="flex items-center gap-1 flex-wrap mt-0.5">
                          {s.industry && <span className="text-[11px] text-muted truncate">{s.industry}</span>}
                          <Flags f={s.flags} />
                        </span>
                      </span>
                      <Bars s={s.series} />
                      <Count h={s} mode={mode} />
                      <span className={`hidden sm:block text-right num text-[13px] ${cls(s.pct5)}`}>{pctTxt(s.pct5)}</span>
                      <span className={`hidden sm:block text-right num text-[13px] ${cls(s.mf5)}`}>{s.mf5 == null ? "—" : `${s.mf5 > 0 ? "+" : ""}${s.mf5.toLocaleString()}張`}</span>
                    </button>
                  </li>
                ))}
                {!stocks.length && <li className="px-3 py-6 text-center text-sm text-muted">沒有符合的標的</li>}
              </ul>
              {stocks.length > 30 && (
                <button className="w-full py-2.5 text-[13px] text-accent border-t border-line" onClick={() => setMore(!more)}>
                  {more ? "只看前 30 名" : `顯示全部 ${stocks.length} 檔`}
                </button>
              )}
            </>
          )}

          {tab === "groups" && (
            <>
              <div className="card-h text-[13px]">
                <div className="seg !text-[12px]">
                  <button aria-pressed={kindF === "題材"} onClick={() => setKindF("題材")}>題材（細分）</button>
                  <button aria-pressed={kindF === "產業"} onClick={() => setKindF("產業")}>官方產業別</button>
                </div>
              </div>
              <ul className="lg:max-h-[calc(100vh-260px)] overflow-y-auto scroll-thin">
                {groups.map((g, i) => (
                  <li key={g.name} className="border-b border-line last:border-0">
                    <button onClick={() => pick({ type: "group", v: g })}
                      className={`w-full text-left grid grid-cols-[1.6rem_1fr_auto_3.5rem] gap-2 items-center px-3 py-2.5 transition-colors ${isSel("group", g.name) ? "bg-[var(--accent-bg)]" : "hover:bg-panel-2"}`}>
                      <span className="text-[12px] text-muted num">{i + 1}</span>
                      <span className="min-w-0">
                        <span className="flex items-center gap-1.5"><span className="font-semibold text-[15px] truncate">{g.name}</span><Spike v={g.spike} /></span>
                        <span className="block text-[11px] text-muted truncate mt-0.5">
                          {g.co.slice(0, 4).map((c) => `${c.name} ${c.n}`).join("・") || "—"}
                        </span>
                        {g.kw.length > 0 && <span className="block text-[11px] text-accent truncate">{g.kw.slice(0, 4).join("・")}</span>}
                      </span>
                      <Bars s={g.series} />
                      <Count h={g} mode={mode} />
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}

          {tab === "keywords" && (
            <>
              <div className="card-h text-[13px]"><span>關鍵字（鉅亨網標籤＋財經詞庫）</span></div>
              {/* 前 30 名：字越大提及越多 */}
              <div className="px-3 py-3 flex flex-wrap gap-1.5 border-b border-line">
                {kws.slice(0, 30).map((k) => {
                  const n = mode === "24h" ? k.n24 : k.n7;
                  const top = Math.max(1, mode === "24h" ? kws[0]?.n24 ?? 1 : kws[0]?.n7 ?? 1);
                  return (
                    <button key={k.k} onClick={() => pick({ type: "kw", v: k })}
                      className={`rounded-full border px-2.5 py-1 transition ${isSel("kw", k.k) ? "border-accent bg-[var(--accent-bg)] text-accent" : "border-line hover:bg-panel-2"}`}
                      style={{ fontSize: `${12 + Math.round((n / top) * 6)}px` }}>
                      {k.k}<span className="text-muted text-[11px] num ml-1">{n}</span>
                    </button>
                  );
                })}
              </div>
              <ul className="lg:max-h-[calc(100vh-420px)] overflow-y-auto scroll-thin">
                {kws.slice(0, more ? undefined : 30).map((k, i) => (
                  <li key={k.k} className="border-b border-line last:border-0">
                    <button onClick={() => pick({ type: "kw", v: k })}
                      className={`w-full text-left grid grid-cols-[1.6rem_1fr_auto_3.5rem] gap-2 items-center px-3 py-2 transition-colors ${isSel("kw", k.k) ? "bg-[var(--accent-bg)]" : "hover:bg-panel-2"}`}>
                      <span className="text-[12px] text-muted num">{i + 1}</span>
                      <span className="min-w-0">
                        <span className="flex items-center gap-1.5"><span className="font-semibold text-[15px]">{k.k}</span><Spike v={k.spike} /></span>
                        <span className="block text-[11px] text-muted truncate">{k.co.slice(0, 4).map((c) => c.name).join("・") || "—"}</span>
                      </span>
                      <Bars s={k.series} />
                      <Count h={k} mode={mode} />
                    </button>
                  </li>
                ))}
              </ul>
              {kws.length > 30 && (
                <button className="w-full py-2.5 text-[13px] text-accent border-t border-line" onClick={() => setMore(!more)}>
                  {more ? "只看前 30 個" : `顯示全部 ${kws.length} 個`}
                </button>
              )}
            </>
          )}
        </section>

        {/* 右：明細＋新聞 */}
        <section ref={detailRef} className="flex-1 min-w-0 space-y-3 scroll-mt-3">
          {sel && <Detail sel={sel} stats={stats} onStock={pickStock} onKw={pickKw} onClose={() => setSel(null)} />}
          <div className="card overflow-hidden">
            <div className="card-h">
              <span>{sel ? "相關新聞" : "最新新聞"}</span>
              {list && <span className="text-muted text-[12px] font-normal num">{list.length} 則</span>}
              {!sel && (
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜尋標題"
                  className="ml-auto !py-1 !text-[13px] w-36 sm:w-48 !rounded-full" />
              )}
            </div>
            {list === null ? <div className="p-3 space-y-2">{[0, 1, 2, 3].map((i) => <div key={i} className="skeleton h-12" />)}</div>
              : list.length === 0 ? <div className="px-3 py-8 text-center text-sm text-muted">沒有新聞</div>
              : (
                <ul>
                  {list.map((n) => <NewsRow key={n.id} n={n} nm={names} onStock={pickStock} onKw={pickKw} />)}
                </ul>
              )}
          </div>
          <p className="text-[11px] text-faint leading-relaxed px-1">
            來源：{stats.sources.map((s) => `${s.name} ${s.n}`).join("、")}。只顯示標題與摘要，點標題看原文。
            「熱度高、主力賣超」是提及次數在前段、但近 5 日關鍵分點合計賣超，僅供參考，不是買賣建議。
          </p>
        </section>
      </div>
    </div>
  );
}

function Detail({ sel, stats, onStock, onKw, onClose }: { sel: NonNullable<Sel>; stats: NewsStats; onStock: (c: string) => void; onKw: (k: string) => void; onClose: () => void }) {
  const h: NewsHeat = sel.v;
  const title = sel.type === "stock" ? sel.v.name : sel.type === "kw" ? sel.v.k : sel.v.name;
  const sub = sel.type === "stock" ? `${sel.v.code}${sel.v.industry ? `・${sel.v.industry}` : ""}` : sel.type === "kw" ? "關鍵字" : sel.v.kind;
  return (
    <div className="card p-3 lg:p-4 space-y-3">
      <div className="flex items-start gap-2">
        <div className="min-w-0">
          <div className="flex items-baseline gap-2 flex-wrap">
            <h2 className="text-[20px] font-bold">{title}</h2>
            <span className="text-[12px] text-muted num">{sub}</span>
            <Spike v={h.spike} />
          </div>
          {sel.type === "stock" && sel.v.flags.length > 0 && <div className="flex gap-1 mt-1"><Flags f={sel.v.flags} /></div>}
        </div>
        <div className="ml-auto flex items-center gap-1 shrink-0">
          {sel.type === "stock" && <Link href={`/stock/${sel.v.code}`} className="btn btn-sm">看個股</Link>}
          <button className="icon-btn" onClick={onClose} title="關閉"><Icon name="close" /></button>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {[
          ["7 日提及", `${h.n7} 則`], ["24 小時", `${h.n24} 則`],
          ["熱度變化", h.spike == null ? "—" : `${h.spike.toFixed(1)}×`],
          ["來源", `${h.sources} 家`, h.top_source && h.top_share != null ? `最多：${h.top_source} ${Math.round(h.top_share * 100)}%` : ""],
        ].map(([k, v, note]) => (
          <div key={k} className="rounded-xl bg-panel-2 px-2.5 py-2 min-w-0">
            <div className="text-[11px] text-muted">{k}</div>
            <div className="text-[15px] font-semibold num truncate">{v}</div>
            {note && <div className="text-[10px] text-muted truncate">{note}</div>}
          </div>
        ))}
      </div>
      {sel.type === "stock" && (
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-xl bg-panel-2 px-2.5 py-2"><div className="text-[11px] text-muted">5 日漲跌</div>
            <div className={`text-[15px] font-semibold num ${cls(sel.v.pct5)}`}>{pctTxt(sel.v.pct5)}</div></div>
          <div className="rounded-xl bg-panel-2 px-2.5 py-2"><div className="text-[11px] text-muted">主力 5 日買賣超</div>
            <div className={`text-[15px] font-semibold num ${cls(sel.v.mf5)}`}>{sel.v.mf5 == null ? "—（沒有分點資料）" : `${sel.v.mf5 > 0 ? "+" : ""}${sel.v.mf5.toLocaleString()} 張`}</div></div>
        </div>
      )}

      <div className="flex items-end gap-3">
        <div className="text-[11px] text-muted shrink-0">每日提及<br /><span className="num">{stats.days[0].slice(5)}～{stats.days[stats.days.length - 1].slice(5)}</span></div>
        <Bars s={h.series} w={180} h={40} />
      </div>

      {h.kw.length > 0 && (
        <div>
          <div className="section-title mb-1">一起出現的關鍵字</div>
          <div className="flex flex-wrap gap-1.5">{h.kw.map((k) => <button key={k} className="chip" onClick={() => onKw(k)}>{k}</button>)}</div>
        </div>
      )}
      {h.co.length > 0 && (
        <div>
          <div className="section-title mb-1">一起被提到的標的</div>
          <div className="flex flex-wrap gap-1.5">
            {h.co.map((c) => <button key={c.code} className="chip" onClick={() => onStock(c.code)}>{c.name}<span className="text-muted num ml-1">{c.n}</span></button>)}
          </div>
        </div>
      )}
    </div>
  );
}

function NewsRow({ n, nm, onStock, onKw }: { n: NewsItem; nm: Record<string, string>; onStock: (c: string) => void; onKw: (k: string) => void }) {
  return (
    <li className="px-3 py-2.5 border-b border-line last:border-0">
      <div className="flex items-center gap-1.5 text-[11px] text-muted num">
        <span>{ago(n.ts)}</span>{n.source && <span>・{n.source}</span>}
      </div>
      <a href={n.url ?? "#"} target="_blank" rel="noopener noreferrer" className="block text-[15px] font-semibold leading-snug mt-0.5 hover:underline">{n.title}</a>
      {n.summary && <p className="text-[12px] text-muted leading-snug mt-0.5 line-clamp-2">{n.summary}</p>}
      {(n.codes.length > 0 || n.keywords.length > 0) && (
        <div className="flex flex-wrap gap-1 mt-1.5">
          {n.codes.slice(0, 6).map((c) => (
            <button key={c} onClick={() => onStock(c)} className="text-[11px] rounded-md px-1.5 py-0.5 bg-[var(--accent-bg)] text-accent">{nm[c] ?? c}</button>
          ))}
          {n.keywords.slice(0, 5).map((k) => (
            <button key={k} onClick={() => onKw(k)} className="text-[11px] rounded-md px-1.5 py-0.5 border border-line text-muted">#{k}</button>
          ))}
        </div>
      )}
    </li>
  );
}
