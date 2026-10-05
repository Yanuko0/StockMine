"use client";
import Link from "next/link";
import { memo, useEffect, useMemo, useState } from "react";
import Icon from "@/components/ui/Icon";
import Spark from "@/components/ui/Spark";
import { openSearch } from "@/components/SearchPalette";
import {
  allStocks, getAlerts, getGroups, getJobRuns, getMarketSummary, getQuotes, getResults, getStrategies, getWatchlist,
  prefetchDaily, removeWatch, WATCH_EVENT, type MarketSummary, type Quote, type RankRow, type TradeAlert, type UserGroup,
} from "@/lib/data";

const cls = (v: number | null | undefined) => (v == null ? "" : v > 0 ? "up" : v < 0 ? "down" : "");
const sign = (v: number) => (v > 0 ? "+" : "");
const pctTxt = (v: number | null | undefined) => (v == null ? "—" : `${sign(v)}${v.toFixed(2)}%`);
const n0 = (v: number | null | undefined) => (v == null ? "—" : Math.round(v).toLocaleString());

function Pill({ v }: { v: number | null | undefined }) {
  const bg = v == null || v === 0 ? "bg-panel-2 text-muted" : v > 0 ? "bg-up text-white" : "bg-down text-white";
  return <span className={`inline-block min-w-[68px] text-center rounded-md px-1.5 py-0.5 text-[13px] font-semibold num ${bg}`}>{pctTxt(v)}</span>;
}

function Card({ title, right, children, className = "" }: { title: string; right?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={`card overflow-hidden ${className}`}>
      <div className="card-h"><span>{title}</span><span className="ml-auto flex items-center gap-2 font-normal">{right}</span></div>
      {children}
    </section>
  );
}

// ---------------- 大盤 ----------------
const DIST_LABELS = ["<-5", "-5~", "-3~", "-2~", "-1~", "0", "~1", "~2", "~3", "~5", ">5"];

function MarketStrip({ m }: { m: MarketSummary | null | undefined }) {
  if (m === undefined) return <div className="skeleton h-[92px]" />;
  if (!m) {
    return <div className="card p-4 text-sm text-muted">大盤總覽會在下一次收盤排程（每天 16:10）跑完後出現。</div>;
  }
  const b = m.breadth;
  const t = m.taiex;
  const dist = b.dist;
  const maxD = dist ? Math.max(1, ...dist) : 1;
  const downAll = b.down, upAll = b.up;
  const tot = b.up + b.down + b.flat || 1;
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {/* 指數（三竹式的三格） */}
      <section className="card p-2 grid grid-cols-3 gap-1 text-center">
        <div className="rounded-xl bg-panel-2 py-2 px-1 min-w-0">
          <div className="text-[15px] font-semibold">加權指</div>
          {t ? (
            <div className={cls(t.chg)}>
              <div className="text-[20px] font-semibold num leading-tight truncate">{t.close.toLocaleString(undefined, { minimumFractionDigits: 2 })}</div>
              <div className="text-[12px] num truncate">{t.chg != null ? `${t.chg > 0 ? "▲" : t.chg < 0 ? "▼" : ""}${Math.abs(t.chg).toFixed(2)}` : "—"}({t.pct != null ? Math.abs(t.pct).toFixed(2) : "—"}%)</div>
            </div>
          ) : <div className="text-muted text-sm mt-2">—</div>}
        </div>
        <div className="py-2 px-1 min-w-0">
          <div className="text-[15px] font-semibold">成交值</div>
          <div className="text-[20px] font-semibold num leading-tight">{n0(b.amount)}<span className="text-xs text-muted">億</span></div>
          <div className="text-[12px] text-muted num truncate">市 {n0(b.twse_amount)}・櫃 {n0(b.tpex_amount)}</div>
        </div>
        <div className="py-2 px-1 min-w-0">
          <div className="text-[15px] font-semibold">漲 / 跌</div>
          <div className="text-[20px] font-semibold num leading-tight"><span className="up">{b.up}</span><span className="text-muted text-sm"> / </span><span className="down">{b.down}</span></div>
          <div className="text-[12px] text-muted num">平 {b.flat}・{m.date.slice(5)}</div>
        </div>
        {t && <div className="col-span-3 px-2 pt-1"><Spark data={t.spark} w={300} h={44} fluid area /></div>}
      </section>

      {/* 市場漲跌 */}
      <section className="card p-3">
        <div className="grid grid-cols-4 text-center">
          <div><div className="text-[14px]">跌停</div><div className="text-[22px] num down leading-tight">{b.limit_down}</div></div>
          <div><div className="text-[14px]">創月新低</div><div className="text-[22px] num down leading-tight">{b.month_low ?? "—"}</div></div>
          <div><div className="text-[14px]">創月新高</div><div className="text-[22px] num up leading-tight">{b.month_high ?? "—"}</div></div>
          <div><div className="text-[14px]">漲停</div><div className="text-[22px] num up leading-tight">{b.limit_up}</div></div>
        </div>
        {dist && dist.length === 11 && (
          <div className="mt-3">
            <div className="grid grid-cols-11 gap-1 items-end h-[120px]">
              {dist.map((n, i) => {
                const c = i < 5 ? "var(--down)" : i === 5 ? "var(--faint)" : "var(--up)";
                return (
                  <div key={i} className="flex flex-col items-center justify-end h-full min-w-0">
                    <span className="text-[11px] num" style={{ color: c }}>{n}</span>
                    <div className="w-[70%] rounded-t-[3px]" style={{ height: `${Math.max(3, (n / maxD) * 88)}px`, background: c }} />
                  </div>
                );
              })}
            </div>
            <div className="grid grid-cols-11 gap-1 mt-1 text-center">
              {DIST_LABELS.map((l, i) => (
                <span key={l} className="text-[10px] num leading-tight" style={{ color: i < 5 ? "var(--down)" : i === 5 ? "var(--muted)" : "var(--up)" }}>{l}<br />%</span>
              ))}
            </div>
          </div>
        )}
        <div className="flex gap-1 h-[5px] mt-3">
          <div className="rounded-full bg-down" style={{ width: `${(downAll / tot) * 100}%` }} />
          <div className="rounded-full" style={{ width: `${(b.flat / tot) * 100}%`, background: "var(--faint)" }} />
          <div className="rounded-full bg-up" style={{ width: `${(upAll / tot) * 100}%` }} />
        </div>
        <div className="flex justify-between text-[16px] num mt-1"><span className="down">{downAll}</span><span className="up">{upAll}</span></div>
      </section>
    </div>
  );
}

// ---------------- 自選股 ----------------
type SortKey = "code" | "close" | "pct" | "volume";
const WatchRow = memo(function WatchRow({ code, name, q, edit, onRemove }: { code: string; name: string; q?: Quote; edit: boolean; onRemove: (c: string) => void }) {
  return (
    <div className="flex items-center row-hover" onMouseEnter={() => prefetchDaily(code)}>
      {edit && <button className="pl-3 text-up text-sm" onClick={() => onRemove(code)} aria-label="移除">移除</button>}
      <Link href={`/stock/${code}`} className="flex-1 min-w-0 grid grid-cols-[1fr_auto_auto] md:grid-cols-[minmax(0,1.4fr)_90px_90px_110px_90px_100px] items-center gap-3 px-4 py-2.5">
        <span className="min-w-0">
          <span className="block font-semibold truncate">{name || code}</span>
          <span className="block text-xs text-muted num">{code}</span>
        </span>
        <span className="hidden md:block text-right num font-semibold">{q ? q.close.toFixed(2) : "—"}</span>
        <span className={`hidden md:block text-right num ${cls(q?.chg)}`}>{q ? `${sign(q.chg)}${q.chg.toFixed(2)}` : ""}</span>
        <span className="hidden md:block text-right num text-muted">{q ? q.volume.toLocaleString() : ""}</span>
        <span className="justify-self-end"><Spark data={q?.spark ?? []} w={72} h={26} /></span>
        <span className="md:hidden text-right">
          <span className="block num font-semibold">{q ? q.close.toFixed(2) : "—"}</span>
          <Pill v={q?.pct} />
        </span>
        <span className="hidden md:block text-right"><Pill v={q?.pct} /></span>
      </Link>
    </div>
  );
});

function Watchlist() {
  const [watch, setWatch] = useState<string[] | null>(null);
  const [groups, setGroups] = useState<UserGroup[]>([]);
  const [tab, setTab] = useState("watch");
  const [names, setNames] = useState<Record<string, string>>({});
  const [quotes, setQuotes] = useState<Record<string, Quote>>({});
  const [sort, setSort] = useState<{ k: SortKey; asc: boolean } | null>(null);
  const [edit, setEdit] = useState(false);

  useEffect(() => {
    const load = () => getWatchlist().then(setWatch).catch(() => setWatch([]));
    load();
    getGroups().then(setGroups);
    allStocks().then((l) => setNames(Object.fromEntries(l.map((s) => [s.code, s.name])))).catch(() => {});
    window.addEventListener(WATCH_EVENT, load);
    return () => window.removeEventListener(WATCH_EVENT, load);
  }, []);

  const codes = useMemo(() => (tab === "watch" ? watch ?? [] : groups.find((g) => g.id === tab)?.codes ?? []), [tab, watch, groups]);
  useEffect(() => {
    const need = codes.filter((c) => !quotes[c]);
    if (need.length) getQuotes(need).then((q) => setQuotes((o) => ({ ...o, ...q }))).catch(() => {});
  }, [codes, quotes]);

  const rows = useMemo(() => {
    if (!sort) return codes;
    const val = (c: string): number | string => sort.k === "code" ? c : (quotes[c]?.[sort.k] ?? -Infinity);
    return [...codes].sort((a, b) => { const x = val(a), y = val(b); const r = x < y ? -1 : x > y ? 1 : 0; return sort.asc ? r : -r; });
  }, [codes, sort, quotes]);

  const head = (k: SortKey, label: string, align = "text-right") => (
    <button className={`${align} hover:text-text ${sort?.k === k ? "text-text" : ""}`}
      onClick={() => setSort(sort?.k === k ? (sort.asc ? { k, asc: false } : null) : { k, asc: k === "code" })}>
      {label}{sort?.k === k ? (sort.asc ? " ↑" : " ↓") : ""}
    </button>
  );

  return (
    <Card title="自選股" className="lg:col-span-2" right={
      <>
        <div className="flex gap-1 overflow-x-auto no-scrollbar max-w-[52vw]">
          {[{ id: "watch", name: "自選" }, ...groups.map((g) => ({ id: g.id, name: g.name }))].map((t) => (
            <button key={t.id} className={`chip !min-h-[26px] !py-0.5 ${tab === t.id ? "chip-on" : ""}`} onClick={() => setTab(t.id)}>{t.name}</button>
          ))}
        </div>
        {tab === "watch" && (watch?.length ?? 0) > 0 && <button className="btn btn-ghost btn-sm" onClick={() => setEdit(!edit)}>{edit ? "完成" : "編輯"}</button>}
      </>
    }>
      <div className="hidden md:grid grid-cols-[minmax(0,1.4fr)_90px_90px_110px_90px_100px] gap-3 px-4 py-1.5 text-xs text-muted border-b border-line-soft" style={{ borderColor: "var(--line-soft)" }}>
        {head("code", "股票", "text-left")}{head("close", "成交")}<span className="text-right">漲跌</span>{head("volume", "成交量(張)")}<span className="text-right">近 20 日</span>{head("pct", "漲跌幅")}
      </div>
      {watch === null ? (
        <div className="p-4 space-y-2">{[0, 1, 2].map((i) => <div key={i} className="skeleton h-10" />)}</div>
      ) : rows.length === 0 ? (
        <div className="p-6 text-center text-sm text-muted">
          {tab === "watch" ? <>還沒有自選股。<button className="text-accent" onClick={() => openSearch()}>搜尋股票</button>，在個股頁按 ☆ 加入。</> : "這個族群還沒有股票（到選股頁「自訂族群」加入）。"}
        </div>
      ) : (
        <div className="divide">
          {rows.map((c) => <WatchRow key={c} code={c} name={names[c] ?? ""} q={quotes[c]} edit={edit && tab === "watch"}
            onRemove={async (x) => { await removeWatch(x); }} />)}
        </div>
      )}
    </Card>
  );
}

// ---------------- 今日選股 + 建倉提醒 ----------------
const ALERT_NAME: Record<TradeAlert["kind"], string> = { entry1: "第一筆", entry2: "第二筆", entry3: "第三筆", stop: "停損" };
function Today() {
  const [screens, setScreens] = useState<{ id: string; name: string; date: string; count: number }[] | null>(null);
  const [alerts, setAlerts] = useState<TradeAlert[]>([]);
  useEffect(() => {
    (async () => {
      const st = await getStrategies();
      setScreens(await Promise.all(st.map(async (s) => {
        const r = (await getResults(s.id, 1))[0];
        return { id: s.id, name: s.name, date: r?.date ?? "", count: r?.items.length ?? 0 };
      })));
    })().catch(() => setScreens([]));
    getAlerts(30).then((a) => { const d = a[0]?.date; setAlerts(a.filter((x) => x.date === d)); }).catch(() => {});
  }, []);
  return (
    <Card title="今日選股" right={<Link href="/screener" className="text-sm text-accent">全部</Link>}>
      {screens === null ? <div className="p-4"><div className="skeleton h-16" /></div> : screens.length === 0 ? (
        <div className="p-4 text-sm text-muted">還沒有策略。<Link href="/screener" className="text-accent">建立策略</Link>，可以從範本開始。</div>
      ) : (
        <div className="divide">
          {screens.map((s) => (
            <Link key={s.id} href={`/screener?id=${s.id}`} className="flex items-center px-4 py-2.5 row-hover">
              <span className="flex-1 min-w-0">
                <span className="block truncate font-medium">{s.name}</span>
                <span className="block text-xs text-muted">{s.date || "尚未執行"}</span>
              </span>
              <span className="text-xl font-bold num text-accent">{s.count}</span><span className="text-xs text-muted ml-1">檔</span>
            </Link>
          ))}
        </div>
      )}
      {alerts.length > 0 && (
        <>
          <div className="card-h !border-t !border-b-0 text-sm" style={{ borderTop: "1px solid var(--line-soft)" }}>
            建倉提醒 <span className="text-xs text-muted font-normal">{alerts[0].date}</span>
            <Link href="/plan" className="ml-auto text-sm text-accent font-normal">建倉</Link>
          </div>
          <div className="divide">
            {alerts.slice(0, 8).map((a) => (
              <Link key={a.id} href={`/stock/${a.code}`} className="flex items-center gap-2 px-4 py-2 row-hover text-sm">
                <span className={`tag ${a.kind === "stop" ? "tag-down" : "tag-up"}`}>{ALERT_NAME[a.kind]}</span>
                <span className="truncate flex-1">{a.message.split("：")[0]}</span>
                <span className="num">{a.price.toFixed(2)}</span>
              </Link>
            ))}
          </div>
        </>
      )}
    </Card>
  );
}

// ---------------- 產業 ----------------
function Industries({ m }: { m: MarketSummary }) {
  const [all, setAll] = useState(false);
  const list = m.industries;
  const max = Math.max(1, ...list.map((x) => Math.abs(x.pct)));
  const shown = all ? list : [...list.slice(0, 6), ...list.slice(-4)];
  return (
    <Card title="產業漲跌" right={<span className="text-xs text-muted">市值加權</span>}>
      <div className="py-1">
        {shown.map((x, i) => (
          <div key={x.name}>
            {!all && i === 6 && list.length > 10 && <div className="text-center text-xs text-faint py-0.5">⋯</div>}
            <div className="grid grid-cols-[96px_1fr_64px] items-center gap-2 px-4 py-1.5 text-[13px]" title={`龍頭 ${x.leader.code} ${x.leader.name} ${pctTxt(x.leader.pct)}`}>
              <span className="truncate">{x.name}</span>
              <span className="relative h-3">
                <span className="absolute inset-y-0 left-1/2 w-px bg-line" />
                <span className={`absolute inset-y-0 rounded-sm ${x.pct >= 0 ? "bg-up left-1/2" : "bg-down right-1/2"}`} style={{ width: `${(Math.abs(x.pct) / max) * 50}%`, opacity: 0.85 }} />
              </span>
              <span className={`text-right num font-semibold ${cls(x.pct)}`}>{pctTxt(x.pct)}</span>
            </div>
          </div>
        ))}
      </div>
      {list.length > 10 && <button className="w-full py-2 text-sm text-accent border-t" style={{ borderColor: "var(--line-soft)" }} onClick={() => setAll(!all)}>{all ? "收合" : `全部 ${list.length} 個產業`}</button>}
    </Card>
  );
}

// ---------------- 排行 ----------------
const RANKS = [
  { id: "foreign_buy", label: "外資買超", src: "inst", col: "foreign_net", unit: "張" },
  { id: "foreign_sell", label: "外資賣超", src: "inst", col: "foreign_net", unit: "張" },
  { id: "trust_buy", label: "投信買超", src: "inst", col: "trust_net", unit: "張" },
  { id: "trust_sell", label: "投信賣超", src: "inst", col: "trust_net", unit: "張" },
  { id: "gainers", label: "漲幅", src: "movers", col: "lots", unit: "張" },
  { id: "losers", label: "跌幅", src: "movers", col: "lots", unit: "張" },
  { id: "amount", label: "成交值", src: "movers", col: "amount_e", unit: "億" },
] as const;
function Rankings({ m }: { m: MarketSummary }) {
  const [id, setId] = useState<(typeof RANKS)[number]["id"]>(() => {
    try { return (localStorage.getItem("rankTab") as (typeof RANKS)[number]["id"]) || "foreign_buy"; } catch { return "foreign_buy"; }
  });
  useEffect(() => { try { localStorage.setItem("rankTab", id); } catch { /* */ } }, [id]);
  const def = RANKS.find((r) => r.id === id)!;
  const rows: RankRow[] = (def.src === "inst" ? m.inst[def.id as keyof MarketSummary["inst"]] : m.movers[def.id as keyof MarketSummary["movers"]]) ?? [];
  return (
    <Card title="排行" className="lg:col-span-2">
      <div className="px-3 pt-2 overflow-x-auto no-scrollbar">
        <div className="seg">{RANKS.map((r) => <button key={r.id} aria-pressed={r.id === id} onClick={() => setId(r.id)}>{r.label}</button>)}</div>
      </div>
      <div className="overflow-x-auto">
        <table className="tbl mt-1">
          <thead><tr><th>#</th><th className="!text-left">股票</th><th>收盤</th><th>漲跌幅</th><th>{def.src === "inst" ? `買賣超(${def.unit})` : def.id === "amount" ? "成交值(億)" : "成交量(張)"}</th></tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={5} className="!text-center text-muted py-6">沒有資料</td></tr>}
            {rows.map((r, i) => (
              <tr key={r.code} onMouseEnter={() => prefetchDaily(r.code)}>
                <td className="text-muted w-8">{i + 1}</td>
                <td className="!text-left"><Link href={`/stock/${r.code}`} className="hover:text-accent"><b className="num mr-2">{r.code}</b>{r.name}</Link></td>
                <td>{(+r.close).toFixed(2)}</td>
                <td className={cls(+r.pct)}>{pctTxt(+r.pct)}</td>
                <td className={def.src === "inst" ? cls(+r[def.col]) : ""}>{n0(+r[def.col])}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

const JOB_LABEL: Record<string, string> = { eod: "盤後資料", minutes: "分鐘K", broker: "分點", screen: "選股",
  "screen-now": "立即選股", intraday: "盤中選股", margin: "融資融券", backup: "備份", backfill: "補資料" };

// ---------------- 頁面 ----------------
export default function Home() {
  const [m, setM] = useState<MarketSummary | null | undefined>(undefined);
  const [runs, setRuns] = useState<Awaited<ReturnType<typeof getJobRuns>>>([]);
  useEffect(() => {
    getMarketSummary().then(setM).catch(() => setM(null));
    getJobRuns(12).then(setRuns).catch(() => {});
  }, []);
  const latest = runs.find((r) => r.job === "eod" && r.status === "ok");
  // 只提醒「這項工作最近一次」還是失敗的（後來已經成功過的舊錯誤不用再顯示）
  const lastByJob = new Map<string, (typeof runs)[number]>();
  runs.forEach((r) => { if (!lastByJob.has(r.job)) lastByJob.set(r.job, r); });
  const errors = [...lastByJob.values()].filter((r) => r.status === "error").slice(0, 2);

  return (
    <div className="page space-y-4">
      <header className="flex items-center gap-3 pt-1" style={{ paddingTop: "max(4px, env(safe-area-inset-top))" }}>
        <img src="/icon-192.png" alt="" className="w-9 h-9 rounded-xl lg:hidden" />
        <h1 className="text-[22px] font-bold tracking-tight">掘股 <span className="text-muted text-sm font-normal">StockMine</span></h1>
        <span className="ml-auto text-xs text-muted">{latest ? `資料更新 ${latest.run_date}` : ""}</span>
        <button className="btn hidden lg:inline-flex text-muted" onClick={() => openSearch()}>
          <Icon name="search" className="w-4 h-4" /> 搜尋股票 <span className="kbd ml-2">Ctrl K</span>
        </button>
      </header>

      {errors.length > 0 && (
        <Link href="/settings" className="card p-3 text-sm flex gap-2 items-start" style={{ borderColor: "var(--up)" }}>
          <span className="up font-semibold shrink-0">排程錯誤</span>
          <span className="text-muted truncate">{errors[0].run_date} {JOB_LABEL[errors[0].job] ?? errors[0].job}：{errors[0].message?.slice(0, 100)}</span>
        </Link>
      )}

      <MarketStrip m={m} />

      <div className="grid gap-4 lg:grid-cols-3">
        <Watchlist />
        <Today />
        {m && <Rankings m={m} />}
        {m && m.industries.length > 0 && <Industries m={m} />}
      </div>
    </div>
  );
}
