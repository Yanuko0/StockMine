"use client";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import StrategyEditor from "@/components/StrategyEditor";
import GroupManager from "@/components/GroupManager";
import Funnel from "@/components/Funnel";
import Diagnose from "@/components/Diagnose";
import Icon from "@/components/ui/Icon";
import { condText } from "@/lib/condText";
import Tick from "@/components/ui/Tick";
import { livePx, useLiveQuotes } from "@/lib/useLive";
import {
  deleteStrategy, getGlobalThemes, getGroups, getLive, type GlobalThemes, type LiveQuote, screenRunStatus, prefetchDaily, triggerScreen, getResults, getStrategies, me, saveStrategy, type ScreenItem, type Strategy, type UserGroup,
} from "@/lib/data";

type Group = { name: string; custom: boolean; items: ScreenItem[] };

/** 依族群分組：自訂族群優先，其次官方產業別；組內依市值由大到小（第一檔 = 龍頭） */
function groupItems(items: ScreenItem[], groups: UserGroup[]): Group[] {
  const map = new Map<string, Group>();
  for (const it of items) {
    const g = groups.find((x) => x.codes.includes(it.code));
    const name = g?.name ?? it.industry ?? "未分類";
    if (!map.has(name)) map.set(name, { name, custom: !!g, items: [] });
    map.get(name)!.items.push(it);
  }
  const cap = (x: ScreenItem) => x.mcap ?? -1;
  const out = [...map.values()];
  out.forEach((g) => g.items.sort((a, b) => cap(b) - cap(a)));
  return out.sort((a, b) => b.items.length - a.items.length || cap(b.items[0]) - cap(a.items[0]));
}

function fmtCap(v: number | null | undefined) {
  if (v == null) return "";
  return v >= 10000 ? `${(v / 10000).toFixed(2)}兆` : `${Math.round(v).toLocaleString()}億`;
}

function ItemRow({ it, leader, live, badge }: { it: ScreenItem; leader?: boolean; live?: LiveQuote; badge?: string }) {
  const lp = livePx(live, it.close, it.chg_pct);
  const close = lp.px ?? it.close;
  const pct = lp.pct ?? 0;
  const chg = lp.pct == null ? null : close - close / (1 + pct / 100);
  const cls = pct > 0 ? "up" : pct < 0 ? "down" : "";
  return (
    <Link href={`/stock/${it.code}`} onMouseEnter={() => prefetchDaily(it.code)} className="flex items-center px-4 py-2.5 gap-3 row-hover">
      <span className="flex-1 min-w-0">
        <span className="flex items-center gap-1.5">
          <span className="text-[17px] font-semibold truncate">{it.name}</span>
          {leader && <span className="text-[10px] px-1 rounded bg-accent text-accent-ink shrink-0">龍頭</span>}
          {badge && <span className="text-[10px] px-1 rounded bg-[var(--accent-bg)] text-accent shrink-0">{badge}</span>}
        </span>
        <span className="flex items-center gap-1.5 text-[12px] text-muted mt-0.5 min-w-0">
          <span className="num">{it.code}</span>
          {it.industry && <span className="truncate border-l border-line pl-1.5">{it.industry}</span>}
          {fmtCap(it.mcap) && <span className="whitespace-nowrap">・{fmtCap(it.mcap)}</span>}
        </span>
        {it.tags && it.tags.length > 0 && (
          <span className="flex flex-wrap gap-1 mt-1">
            {it.tags.map((t) => <span key={t} className="text-[11px] px-1.5 rounded-md border border-accent text-accent whitespace-nowrap">{t}</span>)}
          </span>
        )}
      </span>
      <span className="text-right shrink-0">
        <Tick v={close} className={`block text-[19px] font-semibold num leading-tight px-0.5 ${cls}`}>{close.toFixed(2)}</Tick>
        <span className={`block text-[13px] num ${cls}`}>
          {chg == null ? "-" : `${pct > 0 ? "▲" : pct < 0 ? "▼" : ""}${Math.abs(chg).toFixed(2)}(${Math.abs(pct).toFixed(2)}%)`}
        </span>
        <span className="block text-[11px] text-muted num">總 {it.volume.toLocaleString()}</span>
      </span>
    </Link>
  );
}

/** 條件文字裡的數字用黃色標出來（三竹的樣子） */
function HL({ text }: { text: string }) {
  const parts = text.split(/(\d[\d,.]*)/);
  return <>{parts.map((p, i) => (i % 2 ? <span key={i} className="param num">{p}</span> : <span key={i}>{p}</span>))}</>;
}

function Screener() {
  const params = useSearchParams();
  const [list, setList] = useState<Strategy[]>([]);
  const [sel, setSel] = useState<string | null>(params.get("id"));
  const [editing, setEditing] = useState<Strategy | "new" | null>(null);
  const [results, setResults] = useState<(Awaited<ReturnType<typeof getResults>>[number] & { label?: string })[]>([]);
  const [resultsFor, setResultsFor] = useState<string | null>(null); // 目前畫面上的結果是哪個策略的
  const selRef = useRef<string | null>(sel);
  useEffect(() => { selRef.current = sel; }, [sel]);
  const [running, setRunning] = useState<{ id: string; since: number } | null>(null);
  const [runMsg, setRunMsg] = useState("");
  const [dayIdx, setDayIdx] = useState(0);
  const [uid, setUid] = useState<string | null>(null);
  const [groups, setGroups] = useState<UserGroup[]>([]);
  const [grouped, setGrouped] = useState(true);
  const [groupOpen, setGroupOpen] = useState(false);
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  // 額外篩選：只看「全球強勢族群」前 N 名對應的台股（直接用現有結果篩，不用重跑選股）
  const [gTop, setGTop] = useState(0);
  const [gData, setGData] = useState<GlobalThemes | null>(null);
  useEffect(() => { if (gTop && !gData) getGlobalThemes().then(setGData).catch(() => {}); }, [gTop, gData]);
  useEffect(() => { getGroups().then(setGroups); }, []);

  async function load() {
    const l = await getStrategies();
    setList(l);
    if (!sel && l[0]) setSel(l[0].id);
  }
  useEffect(() => { load(); me().then((u) => setUid(u?.id ?? null)); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // 結果：盤中最新一次（如果比最新收盤結果新）放最前面，再來是每天收盤
  async function loadResults(id: string) {
    const [daily, live] = await Promise.all([getResults(id), getLive(id).catch(() => null)]);
    const out: typeof results = [...daily];
    if (live) {
      const t = new Date(live.ts);
      const tw = new Date(t.getTime() + 8 * 3600e3);
      const liveDay = tw.toISOString().slice(0, 10);
      if (!daily[0] || daily[0].date < liveDay) {
        out.unshift({ date: liveDay, items: live.items, meta: live.meta, label: `盤中 ${tw.toISOString().slice(11, 16)}` });
      }
    }
    // 切換策略很快時，舊策略的結果可能比較晚回來：不是目前選的就不要顯示
    if (selRef.current === id) { setResults(out); setResultsFor(id); }
    return out;
  }
  useEffect(() => { if (sel) { setDayIdx(0); loadResults(sel).catch(() => {}); } }, [sel]); // eslint-disable-line react-hooks/exhaustive-deps

  // 立即選股：排程大約 2~4 分鐘跑完，每 10 秒看一次有沒有新結果
  async function runNow(id: string) {
    setRunMsg("");
    const r = await triggerScreen(id);
    if (!r.ok) { setRunMsg(`沒辦法立即選股：${r.error ?? "未知錯誤"}`); return; }
    setRunning({ id, since: Date.now() - 30_000 }); // 往前抓 30 秒，避免和 GitHub 的時間差
  }
  useEffect(() => {
    if (!running) return;
    const before = JSON.stringify(results.slice(0, 1).map((x) => [x.label ?? x.date, x.items.length, x.meta?.total, x.meta?.run_at]));
    const t = setInterval(async () => {
      const out = await loadResults(running.id).catch(() => null);
      if (!out) return;
      const now = JSON.stringify(out.slice(0, 1).map((x) => [x.label ?? x.date, x.items.length, x.meta?.total, x.meta?.run_at]));
      if (now !== before) { setRunning(null); setDayIdx(0); return; }
      // 結果還沒變：問 GitHub 這次跑得怎樣，失敗就馬上說
      const run = await screenRunStatus(new Date(running.since).toISOString()).catch(() => null);
      if (run?.status === "completed" && run.conclusion !== "success") {
        setRunning(null);
        setRunMsg(`這次選股在 GitHub 執行失敗（${run.conclusion}）。到 GitHub → Actions →「立即選股」點最新一筆看原因：${run.url}`);
        return;
      }
      if (run?.status === "completed" && run.conclusion === "success") {
        await loadResults(running.id).catch(() => null);
        setRunning(null); setDayIdx(0);
        return;
      }
      if (Date.now() - running.since > 12 * 60e3) {
        setRunning(null);
        setRunMsg(run ? `還在 GitHub 排隊或執行中（${run.status}），晚點重新整理就會看到結果。` : "等太久了，結果還沒出來。可以到 GitHub → Actions →「立即選股」看執行狀況。");
        setDayIdx(0);
      }
    }, 10000);
    return () => clearInterval(t);
  }, [running]); // eslint-disable-line react-hooks/exhaustive-deps

  const cur = list.find((s) => s.id === sel);
  const shown = resultsFor === sel ? results : [];
  const day = shown[dayIdx];
  const tags = useMemo(() => [...new Set((day?.items ?? []).flatMap((x) => x.tags ?? []))].sort(), [day]);
  // 全球族群：代號 → 最好的那個族群（名次最前）與在台股清單裡的順序
  const gMap = useMemo(() => {
    const m = new Map<string, { rank: number; theme: string; tier: 1 | 2 | 3; order: number; avg: number }>();
    if (!gTop || !gData) return m;
    for (const t of gData.themes) {
      if (t.rank > gTop) continue;
      t.tw.forEach((r, i) => { if (!m.has(r.code)) m.set(r.code, { rank: t.rank, theme: t.name, tier: r.tier, order: i, avg: t.avg }); });
    }
    return m;
  }, [gTop, gData]);
  const items = useMemo(() => (day?.items ?? []).filter((x) => (!tagFilter || x.tags?.includes(tagFilter)) && (!gTop || gMap.has(x.code))),
    [day, tagFilter, gTop, gMap]);
  const shownGroups = useMemo<Group[]>(() => {
    if (!gTop) return groupItems(items, groups);
    // 依全球族群名次分組；組內依關聯度（龍頭 → 高度相關 → 相關、成交金額）
    const by = new Map<string, Group & { rank: number }>();
    for (const it of items) {
      const g = gMap.get(it.code)!;
      const name = `全球 #${g.rank} ${g.theme}（${g.avg > 0 ? "+" : ""}${g.avg.toFixed(2)}%）`;
      if (!by.has(name)) by.set(name, { name, custom: false, items: [], rank: g.rank });
      by.get(name)!.items.push(it);
    }
    const out = [...by.values()].sort((a, b) => a.rank - b.rank);
    out.forEach((g) => g.items.sort((a, b) => gMap.get(a.code)!.order - gMap.get(b.code)!.order));
    return out;
  }, [items, groups, gTop, gMap]);
  const live = useLiveQuotes(useMemo(() => items.slice(0, 150).map((x) => x.code), [items]));
  const TIER_S = ["", "龍頭", "高度相關", "相關"];

  if (editing) {
    return (
      <div>
        <StrategyEditor initial={editing === "new" ? undefined : editing} onCancel={() => setEditing(null)}
          onSave={async (s) => {
            const id = await saveStrategy(s);
            setEditing(null);
            await load();
            if (id) { setSel(id); runNow(id); }
          }} />
      </div>
    );
  }


  const runAt = day?.meta?.run_at ? new Date(day.meta.run_at) : null;
  const tw = runAt ? new Date(runAt.getTime() + 8 * 3600e3).toISOString() : "";
  const stamp = day ? (day.label ?? (tw ? `${tw.slice(5, 10).replace("-", "/")} ${tw.slice(11, 16)} 更新` : day.date.slice(5).replace("-", "/"))) : "";

  return (
    <div className="max-w-[900px] mx-auto pb-4">
      <header className="flex items-center gap-2 px-4 pb-1" style={{ paddingTop: "max(10px, env(safe-area-inset-top))" }}>
        <h1 className="text-[22px] font-bold tracking-tight">選股</h1>
        <button className="btn btn-sm ml-auto" onClick={() => setGroupOpen(true)}>自訂族群</button>
      </header>

      {/* 策略：橫向一排（三竹的樣子） */}
      <div className="flex gap-2 overflow-x-auto no-scrollbar px-4 py-2 border-b border-line">
        <button onClick={() => setEditing("new")} title="新策略"
          className="shrink-0 w-[72px] h-[64px] rounded-xl bg-panel-2 flex items-center justify-center text-muted">
          <Icon name="plus" className="w-7 h-7" />
        </button>
        {list.map((s) => (
          <button key={s.id} onClick={() => { setSel(s.id); setTagFilter(null); }}
            className={`shrink-0 w-[84px] h-[64px] rounded-xl px-2 text-[15px] leading-tight font-medium border transition-colors ${sel === s.id ? "border-accent text-accent bg-[var(--accent-bg)]" : "border-transparent bg-panel-2"}`}>
            <span className="line-clamp-2 break-all">{s.name}</span>
          </button>
        ))}
      </div>
      {list.length === 0 && <p className="text-muted text-sm px-4 py-4">還沒有策略。按左上的「＋」設定你的條件，或從範本開始。</p>}

      {cur && (
        <>
          {/* 條件列表：數字黃色、點一下可以編輯 */}
          <div className="divide border-b border-line">
            {cur.conditions.conditions.map((c, i) => (
              <button key={i} className="w-full flex items-center gap-2 px-4 py-3 text-left text-[16px] row-hover" onClick={() => cur.owner === uid && setEditing(cur)}>
                <span className="flex-1 min-w-0"><HL text={condText(c)} /></span>
                <Icon name="chevron" className="w-5 h-5 text-accent shrink-0" />
              </button>
            ))}
          </div>
          {cur.conditions.note && <p className="px-4 py-2 text-[13px] text-muted whitespace-pre-wrap border-b border-line">{cur.conditions.note}</p>}

          {/* 時間、立即選股、編輯 */}
          <div className="flex items-center gap-2 px-4 py-2.5 border-b border-line">
            <button className="btn btn-primary btn-sm" disabled={!!running} onClick={() => runNow(cur.id)}>
              {running?.id === cur.id ? "選股中…" : "立即選股"}
            </button>
            <span className="text-xs text-muted min-w-0 truncate">
              {running?.id === cur.id ? "用最新資料篩選中，約 1~4 分鐘"
                : running ? `「${list.find((x) => x.id === running.id)?.name ?? ""}」選股中`
                : cur.conditions.logic === "OR" ? "任一條件成立" : "全部條件成立"}
            </span>
            <span className="ml-auto text-[13px] num text-muted whitespace-nowrap">{stamp}</span>
            {cur.owner === uid && (
              <>
                <button className="btn btn-sm btn-ghost" onClick={() => setEditing(cur)}>編輯</button>
                <button className="btn btn-sm btn-ghost text-muted" onClick={async () => { if (confirm("確定刪除這個策略？")) { await deleteStrategy(cur.id); setSel(null); load(); } }}>刪除</button>
              </>
            )}
          </div>
          {runMsg && <p className="text-xs up px-4 pt-2">{runMsg}</p>}

          {/* 歷史日期 */}
          {shown.length > 1 && (
            <div className="overflow-x-auto no-scrollbar px-4 pt-2.5">
              <div className="seg">
                {shown.map((r, i) => (
                  <button key={r.label ?? r.date} aria-pressed={i === dayIdx} onClick={() => { setDayIdx(i); setTagFilter(null); }}>
                    {r.label ?? r.date.slice(5)} <span className="text-muted">{r.items.length}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {shown.length === 0 && !running && <div className="px-4 py-8 text-center text-muted text-sm">還沒有篩選結果。按「立即選股」馬上篩一次，或等每天收盤後的排程。</div>}

          {day?.meta?.minute_codes != null && day.meta.minute_codes < day.meta.total && (
            <p className="text-xs text-accent px-4 pt-2">這個策略含分K 條件：這天只有 {day.meta.minute_codes} / {day.meta.total} 檔有分K 資料，其他股票不會被選出。</p>
          )}
          {day?.meta?.empty_groups?.length ? (
            <p className="text-xs text-accent px-4 pt-2">自訂族群「{day.meta.empty_groups.join("、")}」還沒有股票，這個前提暫時沒有作用。按右上「自訂族群」加入股票。</p>
          ) : null}

          {/* 共 N 檔 */}
          {day && (
            <div className="flex items-center gap-2 px-4 py-2.5 flex-wrap">
              <span className="text-[16px]">共 <span className="param num font-semibold">{items.length}</span> 檔</span>
              {day.items.length > 0 && (
                <select className={`chip !pr-6 ${gTop ? "chip-on" : ""}`} value={gTop} onChange={(e) => setGTop(+e.target.value)}
                  title="只看全球強勢族群對應的台股（用目前的結果直接篩，不用重跑）">
                  <option value={0}>全球強勢：不篩</option>
                  <option value={3}>全球強勢前 3 名</option>
                  <option value={5}>全球強勢前 5 名</option>
                  <option value={10}>全球強勢前 10 名</option>
                </select>
              )}
              {day.items.length > 0 && (
                <div className="seg ml-auto">
                  <button aria-pressed={grouped} onClick={() => setGrouped(true)}>分族群</button>
                  <button aria-pressed={!grouped} onClick={() => setGrouped(false)}>不分組</button>
                </div>
              )}
              {tags.length > 0 && (
                <div className="w-full flex gap-1.5 overflow-x-auto no-scrollbar">
                  <button className={`chip ${!tagFilter ? "chip-on" : ""}`} onClick={() => setTagFilter(null)}>全部 {day.items.length}</button>
                  {tags.map((t) => (
                    <button key={t} className={`chip ${tagFilter === t ? "chip-on" : ""}`} onClick={() => setTagFilter(tagFilter === t ? null : t)}>
                      {t} {day.items.filter((x) => x.tags?.includes(t)).length}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {day && day.items.length === 0 && <div className="px-4 pb-4 text-center text-muted text-sm">這天沒有符合的股票，看下面的「條件漏斗」是哪一條刷掉的</div>}

          {gTop > 0 && !gData && <p className="px-4 text-xs text-muted">讀取全球強勢族群…</p>}
          {gTop > 0 && gData && items.length === 0 && day && day.items.length > 0 && (
            <p className="px-4 pb-2 text-sm text-muted text-center">這次的結果裡沒有全球前 {gTop} 名族群的股票</p>
          )}
          {day && (grouped || gTop > 0) && (
            <div className="space-y-3 px-3">
              {shownGroups.map((g) => (
                <div key={g.name} className="card overflow-hidden">
                  <div className="card-h text-sm">
                    <span>{g.custom ? "★ " : ""}{g.name}</span><span className="ml-auto text-muted font-normal">{g.items.length} 檔</span>
                  </div>
                  <div className="divide">
                    {g.items.map((it, i) => gTop
                      ? <ItemRow key={it.code} it={it} live={live[it.code]} badge={TIER_S[gMap.get(it.code)?.tier ?? 0]} />
                      : <ItemRow key={it.code} it={it} live={live[it.code]} leader={i === 0 && g.items.length > 1 && it.mcap != null} />)}
                  </div>
                </div>
              ))}
            </div>
          )}
          {day && !grouped && !gTop && items.length > 0 && (
            <div className="divide border-y border-line bg-panel">
              {items.map((it) => <ItemRow key={it.code} it={it} live={live[it.code]} />)}
            </div>
          )}

          <div className="space-y-3 px-3 pt-3">
            {day?.meta && <Funnel conds={cur.conditions.conditions} logic={cur.conditions.logic} meta={day.meta} defaultOpen={day.items.length === 0} />}
            {day?.meta?.diag && <Diagnose conds={cur.conditions.conditions} diag={day.meta.diag} />}
          </div>
        </>
      )}
      {groupOpen && <GroupManager groups={groups} onClose={() => { setGroupOpen(false); getGroups().then(setGroups); }} />}
    </div>
  );
}

export default function Page() {
  return <Suspense fallback={<div className="p-4 text-muted">載入中…</div>}><Screener /></Suspense>;
}
