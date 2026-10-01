"use client";
import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import StrategyEditor from "@/components/StrategyEditor";
import GroupManager from "@/components/GroupManager";
import Funnel from "@/components/Funnel";
import Diagnose from "@/components/Diagnose";
import {
  deleteStrategy, getGroups, getLive, prefetchDaily, triggerScreen, getResults, getStrategies, me, saveStrategy, type ScreenItem, type Strategy, type UserGroup,
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

function ItemRow({ it, leader }: { it: ScreenItem; leader?: boolean }) {
  return (
    <Link href={`/stock/${it.code}`} onMouseEnter={() => prefetchDaily(it.code)} className="flex items-center px-4 py-2.5 gap-1 row-hover">
      <span className="font-bold w-14">{it.code}</span>
      <span className="flex-1 min-w-0">
        <span className="block truncate">
          {it.name}{leader && <span className="ml-1 text-[10px] px-1 rounded bg-accent text-accent-ink align-middle">龍頭</span>}
        </span>
        <span className="flex flex-wrap gap-1 text-[11px] text-muted">
          {fmtCap(it.mcap) && <span>市值 {fmtCap(it.mcap)}</span>}
          {it.tags?.map((t) => <span key={t} className="px-1 rounded border border-accent text-accent whitespace-nowrap">{t}</span>)}
        </span>
      </span>
      <span className="tabular-nums w-16 text-right">{it.close.toFixed(2)}</span>
      <span className={`tabular-nums w-16 text-right ${(it.chg_pct ?? 0) > 0 ? "up" : (it.chg_pct ?? 0) < 0 ? "down" : ""}`}>
        {it.chg_pct == null ? "-" : `${it.chg_pct > 0 ? "+" : ""}${it.chg_pct.toFixed(2)}%`}
      </span>
    </Link>
  );
}

function Screener() {
  const params = useSearchParams();
  const [list, setList] = useState<Strategy[]>([]);
  const [sel, setSel] = useState<string | null>(params.get("id"));
  const [editing, setEditing] = useState<Strategy | "new" | null>(null);
  const [results, setResults] = useState<(Awaited<ReturnType<typeof getResults>>[number] & { label?: string })[]>([]);
  const [running, setRunning] = useState<{ id: string; since: number } | null>(null);
  const [runMsg, setRunMsg] = useState("");
  const [dayIdx, setDayIdx] = useState(0);
  const [uid, setUid] = useState<string | null>(null);
  const [groups, setGroups] = useState<UserGroup[]>([]);
  const [grouped, setGrouped] = useState(true);
  const [groupOpen, setGroupOpen] = useState(false);
  const [tagFilter, setTagFilter] = useState<string | null>(null);
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
    setResults(out);
    return out;
  }
  useEffect(() => { if (sel) { setDayIdx(0); loadResults(sel); } }, [sel]); // eslint-disable-line react-hooks/exhaustive-deps

  // 立即選股：排程大約 2~4 分鐘跑完，每 20 秒看一次有沒有新結果
  async function runNow(id: string) {
    setRunMsg("");
    const r = await triggerScreen(id);
    if (!r.ok) { setRunMsg(`沒辦法立即選股：${r.error ?? "未知錯誤"}`); return; }
    setRunning({ id, since: Date.now() });
  }
  useEffect(() => {
    if (!running) return;
    const before = JSON.stringify(results.slice(0, 1).map((x) => [x.label ?? x.date, x.items.length, x.meta?.total]));
    const t = setInterval(async () => {
      const out = await loadResults(running.id);
      const now = JSON.stringify(out.slice(0, 1).map((x) => [x.label ?? x.date, x.items.length, x.meta?.total]));
      if (now !== before || Date.now() - running.since > 9 * 60e3) {
        setRunning(null);
        if (now === before) setRunMsg("等太久了，結果還沒出來。可以到 GitHub → Actions →「立即選股」看執行狀況。");
        setDayIdx(0);
      }
    }, 20000);
    return () => clearInterval(t);
  }, [running]); // eslint-disable-line react-hooks/exhaustive-deps

  const cur = list.find((s) => s.id === sel);
  const day = results[dayIdx];
  const tags = useMemo(() => [...new Set((day?.items ?? []).flatMap((x) => x.tags ?? []))].sort(), [day]);
  const items = useMemo(() => (day?.items ?? []).filter((x) => !tagFilter || x.tags?.includes(tagFilter)), [day, tagFilter]);
  const shownGroups = useMemo(() => groupItems(items, groups), [items, groups]);

  if (editing) {
    return (
      <div className="page-narrow">
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


  return (
    <div className="page space-y-4">
      <header className="flex items-center gap-2 pt-1" style={{ paddingTop: "max(4px, env(safe-area-inset-top))" }}>
        <h1 className="text-[22px] font-bold tracking-tight">選股</h1>
        <button className="btn ml-auto" onClick={() => setGroupOpen(true)}>自訂族群</button>
        <button className="btn btn-primary" onClick={() => setEditing("new")}>＋ 新策略</button>
      </header>

      <div className="grid gap-4 lg:grid-cols-[300px_minmax(0,1fr)] items-start">
        {/* 左：策略 */}
        <div className="space-y-3 lg:sticky lg:top-4">
          <div className="flex lg:flex-col gap-2 overflow-x-auto no-scrollbar lg:overflow-visible">
            {list.map((s) => (
              <button key={s.id} onClick={() => { setSel(s.id); setTagFilter(null); }}
                className={`shrink-0 text-left rounded-xl border px-3 py-2 lg:py-2.5 transition-colors ${sel === s.id ? "border-accent bg-panel" : "border-line bg-panel hover:border-faint"}`}
                style={sel === s.id ? { boxShadow: "0 0 0 3px var(--accent-bg)" } : undefined}>
                <span className="block font-semibold whitespace-nowrap lg:whitespace-normal">{s.name}</span>
                <span className="hidden lg:block text-xs text-muted">{s.conditions.conditions.length} 個條件{s.notify ? "・推播" : ""}</span>
              </button>
            ))}
          </div>
          {list.length === 0 && <p className="text-muted text-sm">還沒有策略。按「新策略」設定你的技術分析條件，例如：60分K 收盤 &gt; MA60、60分K KD(60,3,3) 的 K &gt; 50、月扣三低突破。也可以從範本開始。</p>}

          {cur && (
            <div className="card p-3 text-sm space-y-1.5">
              <div className="flex items-center">
                <span className="font-semibold">{cur.name}</span>
                {cur.owner === uid && (
                  <span className="ml-auto flex gap-1">
                    <button className="btn btn-sm" onClick={() => setEditing(cur)}>編輯</button>
                    <button className="btn btn-sm btn-ghost text-muted" onClick={async () => { if (confirm("確定刪除這個策略？")) { await deleteStrategy(cur.id); setSel(null); load(); } }}>刪除</button>
                  </span>
                )}
              </div>
              <div className="text-muted text-xs">{cur.conditions.logic === "OR" ? "任一成立" : "全部成立"}・{cur.conditions.conditions.length} 個條件{cur.notify ? "・推播" : ""}・只有你看得到</div>
              {cur.conditions.note && <div className="whitespace-pre-wrap text-[13px] leading-relaxed">{cur.conditions.note}</div>}
            </div>
          )}
        </div>

        {/* 右：結果 */}
        <div className="space-y-3 min-w-0">
          {results.length > 0 && (
            <div className="overflow-x-auto no-scrollbar">
              <div className="seg">
                {results.map((r, i) => (
                  <button key={r.label ?? r.date} aria-pressed={i === dayIdx} onClick={() => { setDayIdx(i); setTagFilter(null); }}>
                    {r.label ?? r.date.slice(5)} <span className="text-muted">{r.items.length}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          {cur && (
            <div className="flex items-center gap-2 flex-wrap">
              <button className="btn btn-primary btn-sm" disabled={!!running} onClick={() => runNow(cur.id)}>
                {running ? "選股中…" : "立即選股"}
              </button>
              <span className="text-xs text-muted">
                {running ? "正在用最新資料篩選，約 2~4 分鐘，完成後自動顯示" : "盤中用盤中價格、盤後用最新收盤資料，馬上篩一次"}
              </span>
            </div>
          )}
          {runMsg && <p className="text-xs up">{runMsg}</p>}
          {cur && results.length === 0 && !running && <div className="card p-6 text-center text-muted text-sm">還沒有篩選結果。按「立即選股」馬上篩一次，或等每天收盤後的排程。</div>}

          {day?.meta?.minute_codes != null && day.meta.minute_codes < day.meta.total && (
            <p className="text-xs text-accent">這個策略含分K 條件：這天只有 {day.meta.minute_codes} / {day.meta.total} 檔有分K 資料，其他股票不會被選出（補歷史分K 完成後就是全市場）。</p>
          )}
          {day?.meta?.empty_groups?.length ? (
            <p className="text-xs text-accent">自訂族群「{day.meta.empty_groups.join("、")}」還沒有股票，這個前提暫時沒有作用。按右上「自訂族群」加入股票。</p>
          ) : null}

          {day && day.items.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <div className="seg">
                <button aria-pressed={grouped} onClick={() => setGrouped(true)}>分族群</button>
                <button aria-pressed={!grouped} onClick={() => setGrouped(false)}>不分組</button>
              </div>
              {tags.length > 0 && (
                <div className="flex gap-1.5 overflow-x-auto no-scrollbar">
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
          {day && day.items.length === 0 && <div className="card p-6 text-center text-muted text-sm">這天沒有符合的股票，看下面的「條件漏斗」是哪一條刷掉的</div>}
          {day?.meta && cur && <Funnel conds={cur.conditions.conditions} logic={cur.conditions.logic} meta={day.meta} defaultOpen={day.items.length === 0} />}
          {day?.meta?.diag && cur && <Diagnose conds={cur.conditions.conditions} diag={day.meta.diag} />}
          {day && grouped && (
            <div className="grid gap-3 xl:grid-cols-2 items-start">
              {shownGroups.map((g) => (
                <div key={g.name} className="card overflow-hidden">
                  <div className="card-h text-sm">
                    <span>{g.custom ? "★ " : ""}{g.name}</span><span className="ml-auto text-muted font-normal">{g.items.length} 檔</span>
                  </div>
                  <div className="divide">
                    {g.items.map((it, i) => <ItemRow key={it.code} it={it} leader={i === 0 && g.items.length > 1 && it.mcap != null} />)}
                  </div>
                </div>
              ))}
            </div>
          )}
          {day && !grouped && items.length > 0 && (
            <div className="card divide">
              {items.map((it) => <ItemRow key={it.code} it={it} />)}
            </div>
          )}
        </div>
      </div>
      {groupOpen && <GroupManager groups={groups} onClose={() => { setGroupOpen(false); getGroups().then(setGroups); }} />}
    </div>
  );
}

export default function Page() {
  return <Suspense fallback={<div className="p-4 text-muted">載入中…</div>}><Screener /></Suspense>;
}
