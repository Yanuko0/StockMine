"use client";
import { sb } from "./supabase";
import { Bar, dateToTs } from "./bars";

export interface Stock { code: string; name: string; market: "TWSE" | "TPEX"; kind: string; industry?: string | null }
export interface Strategy {
  id: string; name: string; notify: boolean; owner: string; owner_name: string | null;
  conditions: { logic: "AND" | "OR"; conditions: Condition[]; note?: string };
}
/** 指標來源；KD 可帶參數 p（例 [60,3,3]），布林可帶 k（倍數） */
export type Src = { src: string; n?: number; v?: number; p?: number[]; k?: number };
export type CondKind =
  | "compare" | "cross" | "deduct" | "deduct3low" | "inst" | "mainforce" | "volratio"
  | "ma_align" | "ma_tangle" | "range" | "change" | "new_high" | "ma_turn" | "inst_ratio" | "broker_conc"
  | "div_yield" | "net_margin" | "universe" | "market" | "unsupported"
  | "gap_break" | "box_bottom" | "support_touch" | "in_group" | "group" | "vp_box"
  | "inst_rank" | "inst_turn" | "board_pct" | "op_ratio";
/** 條件（欄位依 kind 不同；格式與 pipeline/twstock/screener.py 一致） */
export interface Condition {
  kind: CondKind;
  tf?: string; left?: Src; right?: Src; op?: string; a?: Src; b?: Src; dir?: string;
  n?: number; v?: number; who?: string; days?: number; ns?: number[]; pct?: number; lookback?: number;
  years?: number; type?: string; market?: string; mode?: string; label?: string;
  source?: "auto" | "mine" | "both"; zone?: number; max_range?: number; tol?: number; skip?: number;
  va?: number; bins?: number; max_height?: number; inside?: number; vol?: number; // vp_box：密集成交區箱型
  top?: number; within?: number; // inst_rank：排行前幾名；inst_turn：近幾日內轉向
  names?: string[];                                    // in_group：自訂族群名稱
  logic?: "AND" | "OR"; conditions?: Condition[];      // group：條件群組（可巢狀）
  tag_only?: boolean;                                  // group：只標示型態，不影響是否選出
}

function must<T>(r: { data: T | null; error: { message: string } | null }): T {
  if (r.error) throw new Error(r.error.message);
  return r.data as T;
}

// ---------- 股票 ----------
let stockCache: Stock[] | null = null;
let stockLoading: Promise<Stock[]> | null = null;
const STOCK_KEY = "stocks_v2";
/** 股票清單：先用這台裝置存的（12 小時內），背景再更新；搜尋可以立刻出現 */
export async function allStocks(): Promise<Stock[]> {
  if (stockCache) return stockCache;
  try {
    const raw = localStorage.getItem(STOCK_KEY);
    if (raw) {
      const { ts, list } = JSON.parse(raw) as { ts: number; list: Stock[] };
      if (list?.length) {
        stockCache = list;
        if (Date.now() - ts > 12 * 3600_000) void fetchStocks();
        return list;
      }
    }
  } catch { /* 沒有快取 */ }
  return fetchStocks();
}
function fetchStocks(): Promise<Stock[]> {
  stockLoading ??= fetchStocksNow().finally(() => { stockLoading = null; });
  return stockLoading;
}
async function fetchStocksNow(): Promise<Stock[]> {
  const out: Stock[] = [];
  for (let from = 0; ; from += 1000) {
    let r: { data: unknown; error: { message: string } | null } = await sb().from("stocks").select("code,name,market,kind,industry").order("code").range(from, from + 999);
    if (r.error) r = await sb().from("stocks").select("code,name,market,kind").order("code").range(from, from + 999);
    const rows = must(r) as Stock[];
    out.push(...(rows as Stock[]));
    if (rows.length < 1000) break;
  }
  stockCache = out;
  try { localStorage.setItem(STOCK_KEY, JSON.stringify({ ts: Date.now(), list: out })); } catch { /* 容量不足 */ }
  return out;
}

// 最近看過的股票（這台裝置）
export function getRecent(): string[] {
  try { return JSON.parse(localStorage.getItem("recent") || "[]") as string[]; } catch { return []; }
}
export function pushRecent(code: string) {
  try { localStorage.setItem("recent", JSON.stringify([code, ...getRecent().filter((c) => c !== code)].slice(0, 12))); } catch { /* */ }
}

export async function searchStocks(q: string): Promise<Stock[]> {
  const s = q.trim();
  if (!s) return [];
  const list = await allStocks();
  return list
    .filter((x) => x.code.startsWith(s) || x.name.includes(s))
    .sort((a, b) => Number(!a.code.startsWith(s)) - Number(!b.code.startsWith(s)) || a.code.localeCompare(b.code))
    .slice(0, 20);
}

// ---------- K 線 ----------
// 日K 記憶體快取：切換股票、回上一頁都不用重抓（10 分鐘）
const dailyCache = new Map<string, { ts: number; p: Promise<Bar[]> }>();
export function getDaily(code: string): Promise<Bar[]> {
  const hit = dailyCache.get(code);
  if (hit && Date.now() - hit.ts < 600_000) return hit.p;
  const p = fetchDaily(code).catch((e) => { dailyCache.delete(code); throw e; });
  dailyCache.set(code, { ts: Date.now(), p });
  if (dailyCache.size > 40) dailyCache.delete(dailyCache.keys().next().value!);
  return p;
}
/** 滑鼠移到股票上就先抓，點下去幾乎立刻出現 */
export function prefetchDaily(code: string) { void getDaily(code).catch(() => {}); }

async function fetchDaily(code: string, years = 10): Promise<Bar[]> {
  const since = new Date(Date.now() - years * 365 * 86400000).toISOString().slice(0, 10);
  const rows: { date: string; open: number; high: number; low: number; close: number; volume: number }[] = [];
  for (let from = 0; ; from += 1000) {
    const r = must(await sb().from("daily_prices").select("date,open,high,low,close,volume")
      .eq("code", code).gte("date", since).order("date").range(from, from + 999));
    rows.push(...(r as typeof rows));
    if (r.length < 1000) break;
  }
  return rows.map((r) => ({
    timestamp: dateToTs(r.date), date: r.date, open: +r.open, high: +r.high, low: +r.low,
    close: +r.close, volume: Math.round(+r.volume / 1000), // 股 → 張
  }));
}

export async function getMinute(code: string): Promise<Bar[]> {
  const { data, error } = await sb().storage.from("minute").download(`m1/${code}.json.gz`);
  if (error || !data) return [];
  let text: string;
  const buf = new Uint8Array(await data.arrayBuffer());
  if (buf[0] === 0x1f && buf[1] === 0x8b) {
    const ds = new Blob([buf]).stream().pipeThrough(new DecompressionStream("gzip"));
    text = await new Response(ds).text();
  } else text = new TextDecoder().decode(buf);
  const js = JSON.parse(text) as { t: number[]; o: number[]; h: number[]; l: number[]; c: number[]; v: number[] };
  return js.t.map((t, i) => ({ timestamp: t, open: js.o[i], high: js.h[i], low: js.l[i], close: js.c[i], volume: js.v[i] }));
}

// ---------- 籌碼 ----------
export async function getInst(code: string, limit = 30) {
  return must(await sb().from("institutional").select("*").eq("code", code).order("date", { ascending: false }).limit(limit)) as {
    date: string; foreign_net: number; trust_net: number; dealer_net: number; total_net: number;
  }[];
}
export async function getMargin(code: string, limit = 30) {
  return must(await sb().from("margin").select("*").eq("code", code).order("date", { ascending: false }).limit(limit)) as {
    date: string; margin_buy: number; margin_sell: number; margin_balance: number;
    short_sell: number; short_buy: number; short_balance: number;
  }[];
}
export async function getMainForce(code: string, limit = 30) {
  return must(await sb().from("main_force").select("*").eq("code", code).order("date", { ascending: false }).limit(limit)) as {
    date: string; top_buy: number; top_sell: number; net: number; broker_cnt: number;
  }[];
}
export async function getBrokers(code: string, date: string) {
  return must(await sb().from("broker_daily").select("*").eq("code", code).eq("date", date).order("net", { ascending: false })) as {
    broker_id: string; broker_name: string; buy: number; sell: number; net: number; avg_price: number;
  }[];
}

// ---------- 使用者 ----------
export async function me() {
  const { data } = await sb().auth.getUser();
  return data.user;
}
export async function myName(): Promise<string> {
  const u = await me();
  if (!u) return "";
  const { data } = await sb().from("profiles").select("display_name").eq("id", u.id).maybeSingle();
  return data?.display_name || u.email?.split("@")[0] || "";
}

// ---------- 畫線 ----------
export interface DrawPoint { t: number; v: number }
export interface Drawing {
  id: string; code: string; kind: import("./tools").DrawKind; points: DrawPoint[];
  color: string; label: string | null; created_by: string; created_by_name: string | null; created_at: string;
  is_private?: boolean;
}
export async function getDrawings(code: string): Promise<Drawing[]> {
  const rows = must(await sb().from("drawings").select("*").eq("code", code).order("created_at")) as Drawing[];
  return rows.map((r) => ({ ...r, points: r.points.map((p) => ({ t: +p.t, v: +p.v })) }));
}
export async function addDrawing(d: Pick<Drawing, "code" | "kind" | "points" | "color" | "label"> & { is_private?: boolean }) {
  return must(await sb().from("drawings").insert({ ...d, created_by_name: await myName() }).select().single()) as Drawing;
}
export async function updateDrawing(id: string, patch: Partial<Pick<Drawing, "points" | "color" | "label" | "is_private">>) {
  must(await sb().from("drawings").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id));
}
export async function deleteDrawing(id: string) {
  must(await sb().from("drawings").delete().eq("id", id));
}
export function subscribeDrawings(code: string, onChange: () => void) {
  const ch = sb().channel(`drawings-${code}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "drawings", filter: `code=eq.${code}` }, onChange)
    .subscribe();
  return () => { sb().removeChannel(ch); };
}

// ---------- 分點 ----------
export interface BrokerRow {
  side: "buy" | "sell"; rank: number; broker_id: string; broker_name: string;
  buy: number; sell: number; net: number; avg_price: number | null; days: number;
  start_date: string; end_date: string;
}
// 全市場分點明細檔（bk/{code}.json.gz，最近 60 個交易日）；沒有檔案時改用資料庫（舊版，只有自選股）
type BkFile = { v: number; code: string; days: { d: string; b: [string, string, number, number, number | null][] }[] };
const bkCache = new Map<string, Promise<BkFile | null>>();
function getBrokerFile(code: string): Promise<BkFile | null> {
  if (!bkCache.has(code)) {
    bkCache.set(code, (async () => {
      const { data, error } = await sb().storage.from("minute").download(`bk/${code}.json.gz`);
      if (error || !data) return null;
      const buf = new Uint8Array(await data.arrayBuffer());
      let text: string;
      if (buf[0] === 0x1f && buf[1] === 0x8b) {
        const ds = new Blob([buf]).stream().pipeThrough(new DecompressionStream("gzip"));
        text = await new Response(ds).text();
      } else text = new TextDecoder().decode(buf);
      return JSON.parse(text) as BkFile;
    })().catch(() => null));
    setTimeout(() => bkCache.delete(code), 600_000);
  }
  return bkCache.get(code)!;
}

// 分點名稱表 bk/_names.json（每天用最新抓到的正確名稱更新）：舊資料的名稱有亂碼時用這張表顯示
let brokerNamesP: Promise<Record<string, string>> | null = null;
function brokerNames(): Promise<Record<string, string>> {
  brokerNamesP ??= (async () => {
    const { data, error } = await sb().storage.from("minute").download("bk/_names.json");
    if (error || !data) return {};
    return JSON.parse(await data.text()) as Record<string, string>;
  })().catch(() => ({}));
  return brokerNamesP;
}

export async function brokerSummary(code: string, days: number): Promise<BrokerRow[]> {
  const [f, names] = await Promise.all([getBrokerFile(code), brokerNames()]);
  if (f && f.days.length) {
    const span = f.days.slice(-days);
    const acc = new Map<string, { name: string; buy: number; sell: number; amt: number; qty: number }>();
    for (const day of span) {
      for (const [id, name, buy, sell, avg] of day.b) {
        const a = acc.get(id) ?? { name: names[id] || name, buy: 0, sell: 0, amt: 0, qty: 0 };
        a.buy += buy; a.sell += sell;
        if (avg != null) { a.amt += avg * (buy + sell); a.qty += buy + sell; }
        acc.set(id, a);
      }
    }
    const all = [...acc.entries()].map(([id, a]) => ({
      broker_id: id, broker_name: a.name, buy: a.buy, sell: a.sell, net: a.buy - a.sell,
      avg_price: a.qty ? Math.round((a.amt / a.qty) * 100) / 100 : null,
    }));
    const base = { days: span.length, start_date: span[0].d, end_date: span[span.length - 1].d };
    const buys = all.filter((x) => x.net > 0).sort((a, b) => b.net - a.net).slice(0, 15)
      .map((x, i) => ({ ...x, ...base, side: "buy" as const, rank: i + 1 }));
    const sells = all.filter((x) => x.net < 0).sort((a, b) => a.net - b.net).slice(0, 15)
      .map((x, i) => ({ ...x, ...base, side: "sell" as const, rank: i + 1 }));
    return [...buys, ...sells];
  }
  const r = must(await sb().rpc("broker_summary", { p_code: code, p_days: days, p_top: 15 })) as BrokerRow[];
  return r.map((x) => ({ ...x, broker_name: names[x.broker_id] || x.broker_name, buy: +x.buy, sell: +x.sell, net: +x.net, avg_price: x.avg_price == null ? null : +x.avg_price }));
}
export async function brokerHistory(code: string, broker: string, days = 20) {
  const f = await getBrokerFile(code);
  if (f && f.days.length) {
    const out: { date: string; buy: number; sell: number; net: number; avg_price: number | null }[] = [];
    for (const day of [...f.days].reverse()) {
      const r = day.b.find((x) => x[0] === broker);
      if (r) out.push({ date: day.d, buy: r[2], sell: r[3], net: r[2] - r[3], avg_price: r[4] });
      if (out.length >= days) break;
    }
    return out;
  }
  return must(await sb().rpc("broker_history", { p_code: code, p_broker: broker, p_days: days })) as {
    date: string; buy: number; sell: number; net: number; avg_price: number | null;
  }[];
}

// ---------- 關注清單 ----------
let watchCache: { ts: number; p: Promise<string[]> } | null = null;
export function getWatchlist(): Promise<string[]> {
  if (watchCache && Date.now() - watchCache.ts < 60_000) return watchCache.p;
  const p = (async () => {
    const r = must(await sb().from("watchlist").select("code").order("created_at"));
    return (r as { code: string }[]).map((x) => x.code);
  })();
  watchCache = { ts: Date.now(), p };
  p.catch(() => { watchCache = null; });
  return p;
}
export const WATCH_EVENT = "stockmine-watch";
function watchChanged() { watchCache = null; window.dispatchEvent(new Event(WATCH_EVENT)); }

/** 報價（盤後）：最新收盤、漲跌、量，以及近 20 日收盤（走勢小圖） */
export interface Quote { code: string; date: string; close: number; prev: number | null; chg: number; pct: number; volume: number; spark: number[] }
export async function getQuotes(codes: string[]): Promise<Record<string, Quote>> {
  if (!codes.length) return {};
  const since = new Date(Date.now() - 45 * 86400000).toISOString().slice(0, 10);
  const rows: { code: string; date: string; close: number; volume: number }[] = [];
  for (let i = 0; i < codes.length; i += 30) {
    const part = codes.slice(i, i + 30);
    for (let from = 0; ; from += 1000) {
      const r = must(await sb().from("daily_prices").select("code,date,close,volume").in("code", part).gte("date", since)
        .order("code").order("date").range(from, from + 999)) as typeof rows;
      rows.push(...r);
      if (r.length < 1000) break;
    }
  }
  const by: Record<string, typeof rows> = {};
  rows.forEach((r) => (by[r.code] ??= []).push(r));
  const out: Record<string, Quote> = {};
  for (const [code, a] of Object.entries(by)) {
    const last = a[a.length - 1], prev = a[a.length - 2];
    const close = +last.close, pc = prev ? +prev.close : null;
    const chg = pc != null ? close - pc : 0;
    out[code] = { code, date: last.date, close, prev: pc, chg, pct: pc ? (chg / pc) * 100 : 0,
      volume: Math.round(+last.volume / 1000), spark: a.slice(-20).map((x) => +x.close) };
  }
  return out;
}

export async function addWatch(code: string) {
  must(await sb().from("watchlist").upsert({ code }));
  watchChanged();
  // 請後端馬上抓今天的分點（失敗不影響）
  try {
    const { data } = await sb().auth.getSession();
    await fetch("/api/trigger-broker", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${data.session?.access_token}` },
      body: JSON.stringify({ code }),
    });
  } catch { /* ignore */ }
}
export async function removeWatch(code: string) {
  must(await sb().from("watchlist").delete().eq("code", code));
  watchChanged();
}

// ---------- 策略 ----------
export async function getStrategies(): Promise<Strategy[]> {
  return must(await sb().from("strategies").select("*").order("created_at")) as Strategy[];
}
/** 儲存策略；回傳策略 ID（新增時是新的 ID） */
export async function saveStrategy(s: Partial<Strategy> & { name: string; conditions: Strategy["conditions"] }): Promise<string | null> {
  if (s.id) {
    must(await sb().from("strategies").update({ name: s.name, conditions: s.conditions, notify: s.notify ?? false,
      updated_at: new Date().toISOString() }).eq("id", s.id));
    return s.id;
  }
  const r = must(await sb().from("strategies").insert({ name: s.name, conditions: s.conditions, notify: s.notify ?? false,
    owner_name: await myName() }).select("id").single()) as { id: string };
  return r?.id ?? null;
}
// 個人範本（存在資料庫，只有自己看得到）
export type Template = { id: string; name: string; conditions: Strategy["conditions"] };
export async function getTemplates(): Promise<Template[]> {
  const r = await sb().from("strategy_templates").select("id,name,conditions").order("sort").order("created_at");
  if (r.error) return []; // 還沒跑 009 時不要整頁壞掉
  return (r.data ?? []) as Template[];
}
export async function saveTemplate(name: string, conditions: Strategy["conditions"]) {
  const cur = await sb().from("strategy_templates").select("id").eq("name", name).limit(1);
  const id = (cur.data?.[0] as { id: string } | undefined)?.id;
  if (id) must(await sb().from("strategy_templates").update({ conditions }).eq("id", id));
  else must(await sb().from("strategy_templates").insert({ name, conditions }));
}
export async function deleteTemplate(id: string) {
  must(await sb().from("strategy_templates").delete().eq("id", id));
}
export async function deleteStrategy(id: string) {
  must(await sb().from("strategies").delete().eq("id", id));
}
export async function getResults(strategyId: string, limit = 20) {
  return must(await sb().from("screen_results").select("date,items,meta").eq("strategy_id", strategyId)
    .order("date", { ascending: false }).limit(limit)) as {
    date: string; items: ScreenItem[];
    meta: {
      total: number; minute_codes: number | null; empty_groups?: string[];
      funnel?: { single: number[]; cumul: number[] };
      diag?: Record<string, string>; // 逐檔：每條條件 1/0 | 日K 根數 | m=有分K
      coverage?: { minute: number; inst: number; mainforce: number; yields: number; margins: number };
    } | null;
  }[];
}

/** 請排程馬上用現有資料跑這個策略（盤中 → 盤中價；盤後 → 最新收盤） */
export async function triggerScreen(strategy: string): Promise<{ ok: boolean; error?: string }> {
  const { data } = await sb().auth.getSession();
  const r = await fetch("/api/screen-now", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${data.session?.access_token}` },
    body: JSON.stringify({ strategy }),
  });
  return r.json().catch(() => ({ ok: false, error: `HTTP ${r.status}` }));
}
/** 今天最新一次的盤中選股結果 */
export async function getLive(strategy: string) {
  const since = new Date(Date.now() - 20 * 3600e3).toISOString();
  const r = await sb().from("screen_live").select("ts,items,meta").eq("strategy_id", strategy).gte("ts", since)
    .order("ts", { ascending: false }).limit(1);
  if (r.error || !r.data?.length) return null;
  return r.data[0] as { ts: string; items: ScreenItem[]; meta: Awaited<ReturnType<typeof getResults>>[number]["meta"] };
}

export interface ScreenItem {
  code: string; name: string; close: number; chg_pct: number | null; volume: number;
  industry?: string | null; mcap?: number | null; // 市值（億）
  tags?: string[];                                // 符合哪幾個進場型態（例：① 突破）
}

// ---------- 自訂族群（只有自己看得到） ----------
export interface UserGroup { id: string; name: string; codes: string[]; sort: number }
export async function getGroups(): Promise<UserGroup[]> {
  try {
    return must(await sb().from("user_groups").select("id,name,codes,sort").order("sort").order("name")) as UserGroup[];
  } catch { return []; } // 還沒跑 006 升級時
}
export async function saveGroup(g: { id?: string; name: string; codes: string[]; sort?: number }) {
  const row = { name: g.name, codes: g.codes, sort: g.sort ?? 0, updated_at: new Date().toISOString() };
  if (g.id) must(await sb().from("user_groups").update(row).eq("id", g.id));
  else must(await sb().from("user_groups").insert(row));
}
export async function deleteGroup(id: string) {
  must(await sb().from("user_groups").delete().eq("id", id));
}

// ---------- 設定 / 狀態 ----------
export async function getSetting<T>(key: string, def: T): Promise<T> {
  const { data } = await sb().from("app_settings").select("value").eq("key", key).maybeSingle();
  return (data?.value as T) ?? def;
}
export async function setSetting(key: string, value: unknown) {
  must(await sb().from("app_settings").upsert({ key, value }));
}
export async function getJobRuns(limit = 20) {
  return must(await sb().from("job_runs").select("*").order("created_at", { ascending: false }).limit(limit)) as {
    id: number; job: string; run_date: string; status: string; message: string; created_at: string;
  }[];
}

// ---------- 分批建倉（私人） ----------
// 分批建倉規則：每一筆的進場條件、停損條件，用選股條件的格式（存在資料庫，只有自己看得到）
export interface TrancheEntry { name: string; logic: "AND" | "OR"; conditions: Condition[]; note?: string }
export interface TrancheRules {
  universe: "watch" | "all";
  entries: TrancheEntry[];
  stop: { name: string; tranches: number[]; logic: "AND" | "OR"; conditions: Condition[] };
}
export const DEFAULT_RULES: TrancheRules = {
  universe: "watch",
  entries: [
    { name: "第一筆", logic: "AND", conditions: [] },
    { name: "第二筆", logic: "AND", conditions: [] },
    { name: "第三筆", logic: "AND", conditions: [] },
  ],
  stop: { name: "停損", tranches: [1, 2], logic: "OR", conditions: [] },
};
export interface TranchePlan { capital: number; parts: number; notify: boolean; rules: TrancheRules }
export const DEFAULT_PLAN: TranchePlan = { capital: 300000, parts: 3, notify: true, rules: DEFAULT_RULES };

export async function getPlan(): Promise<TranchePlan | null> {
  const { data } = await sb().from("tranche_plans").select("*").maybeSingle();
  if (!data) return null;
  const r = (data.rules ?? null) as Partial<TrancheRules> | null;
  return { capital: +data.capital, parts: +data.parts, notify: data.notify,
    rules: r ? { ...DEFAULT_RULES, ...r, stop: { ...DEFAULT_RULES.stop, ...(r.stop ?? {}) } } : structuredClone(DEFAULT_RULES) };
}
export async function savePlan(p: TranchePlan) {
  const u = await me();
  must(await sb().from("tranche_plans").upsert({ owner: u?.id, capital: p.capital, parts: p.parts, notify: p.notify,
    rules: p.rules, updated_at: new Date().toISOString() }));
}

export interface Position {
  id: string; code: string; tranche: number; buy_date: string; buy_price: number; shares: number;
  status: "open" | "closed"; close_date: string | null; close_price: number | null; close_reason: string | null; note: string | null;
}
export async function getPositions(): Promise<Position[]> {
  const r = must(await sb().from("positions").select("*").order("buy_date", { ascending: false })) as Position[];
  return r.map((p) => ({ ...p, buy_price: +p.buy_price, close_price: p.close_price == null ? null : +p.close_price }));
}
export async function addPosition(p: Pick<Position, "code" | "tranche" | "buy_date" | "buy_price" | "shares"> & { note?: string }) {
  must(await sb().from("positions").insert(p));
}
export async function closePosition(id: string, price: number, reason: string, date = new Date().toISOString().slice(0, 10)) {
  must(await sb().from("positions").update({ status: "closed", close_price: price, close_reason: reason, close_date: date }).eq("id", id));
}
export async function deletePosition(id: string) {
  must(await sb().from("positions").delete().eq("id", id));
}

export interface TradeAlert { id: number; date: string; code: string; kind: string /* entry1、entry2…（第幾筆）或 stop */; price: number; level: number; message: string }
export async function getAlerts(limit = 100): Promise<TradeAlert[]> {
  const r = must(await sb().from("trade_alerts").select("*").order("date", { ascending: false }).order("kind").limit(limit)) as TradeAlert[];
  return r.map((a) => ({ ...a, price: +a.price, level: +a.level }));
}

export async function latestCloses(codes: string[]): Promise<Record<string, { close: number; date: string }>> {
  if (!codes.length) return {};
  const since = new Date(Date.now() - 14 * 86400000).toISOString().slice(0, 10);
  const r = must(await sb().from("daily_prices").select("code,date,close").in("code", codes).gte("date", since).order("date")) as
    { code: string; date: string; close: number }[];
  const out: Record<string, { close: number; date: string }> = {};
  r.forEach((x) => { out[x.code] = { close: +x.close, date: x.date }; });
  return out;
}

// ---------- 首頁：大盤總覽（排程每天算好一份） ----------
export interface RankRow { code: string; name: string; close: number; pct: number; [k: string]: number | string }
export interface MarketSummary {
  date: string; prev_date: string;
  taiex: { close: number; chg: number | null; pct: number | null; spark: number[] } | null;
  breadth: { up: number; down: number; flat: number; limit_up: number; limit_down: number; amount: number; twse_amount: number; tpex_amount: number };
  industries: { name: string; count: number; up: number; down: number; pct: number; avg: number; leader: { code: string; name: string; pct: number } }[];
  inst: Partial<Record<"foreign_buy" | "foreign_sell" | "trust_buy" | "trust_sell", RankRow[]>>;
  movers: Partial<Record<"gainers" | "losers" | "amount", RankRow[]>>;
}
export function getMarketSummary(): Promise<MarketSummary | null> {
  return getSetting<MarketSummary | null>("market_summary", null);
}
