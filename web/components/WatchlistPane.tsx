"use client";
// 電腦版個股頁左側：自選股 / 最近看過 / 自訂族群，點一下切換，↑↓ 鍵上下切換
import { memo, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import Spark from "@/components/ui/Spark";
import Icon from "@/components/ui/Icon";
import {
  allStocks, getGroups, getQuotes, getRecent, getWatchlist, prefetchDaily, WATCH_EVENT, type Quote, type UserGroup,
} from "@/lib/data";

const Row = memo(function Row({ code, name, q, on, onPick, mini }: { code: string; name: string; q?: Quote; on: boolean; onPick: (c: string) => void; mini?: boolean }) {
  const c = q ? (q.chg > 0 ? "up" : q.chg < 0 ? "down" : "") : "";
  if (mini) {
    // 縮小模式：只留名稱 / 代號 / 漲跌幅
    return (
      <button data-code={code} onClick={() => onPick(code)} onMouseEnter={() => prefetchDaily(code)} title={`${code} ${name}`}
        className={`w-full px-2 py-1.5 text-left row-hover border-l-2 ${on ? "bg-panel-2 border-accent" : "border-transparent"}`}>
        <span className="block truncate text-[13px] font-semibold">{name || code}</span>
        <span className="flex items-center justify-between gap-1">
          <span className="num text-[11px] text-muted">{code}</span>
          <span className={`num text-[11px] font-semibold ${c}`}>{q ? `${q.pct > 0 ? "+" : ""}${q.pct.toFixed(1)}%` : ""}</span>
        </span>
      </button>
    );
  }
  return (
    <button data-code={code} onClick={() => onPick(code)} onMouseEnter={() => prefetchDaily(code)}
      className={`w-full grid grid-cols-[1fr_auto] gap-x-2 px-3 py-2 text-left row-hover border-l-2 ${on ? "bg-panel-2 border-accent" : "border-transparent"}`}>
      <span className="min-w-0">
        <span className="block font-semibold num text-[13px]">{code}</span>
        <span className="block truncate text-xs text-muted">{name}</span>
      </span>
      <span className="text-right">
        <span className={`block num text-[13px] font-semibold ${c}`}>{q ? q.close.toFixed(2) : "—"}</span>
        <span className={`block num text-xs ${c}`}>{q ? `${q.pct > 0 ? "+" : ""}${q.pct.toFixed(2)}%` : ""}</span>
      </span>
      {q && <span className="col-span-2 mt-1 opacity-80"><Spark data={q.spark} w={220} h={14} /></span>}
    </button>
  );
});

export default function WatchlistPane() {
  const router = useRouter();
  const current = decodeURIComponent(usePathname().split("/")[2] ?? "");
  const [tab, setTab] = useState<string>("watch");
  const [watch, setWatch] = useState<string[]>([]);
  const [groups, setGroups] = useState<UserGroup[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [quotes, setQuotes] = useState<Record<string, Quote>>({});
  const [recent, setRecent] = useState<string[]>([]);
  // 顯示方式：展開 / 縮小 / 收起（記在這台電腦）
  const [mode, setModeS] = useState<"full" | "mini" | "hidden">("full");
  useEffect(() => { try { const v = localStorage.getItem("watchPane"); if (v === "mini" || v === "hidden") setModeS(v); } catch { /* */ } }, []);
  const setMode = (m: "full" | "mini" | "hidden") => { setModeS(m); try { localStorage.setItem("watchPane", m); } catch { /* */ } };

  useEffect(() => {
    const load = () => getWatchlist().then(setWatch).catch(() => {});
    load();
    getGroups().then(setGroups);
    allStocks().then((l) => setNames(Object.fromEntries(l.map((s) => [s.code, s.name])))).catch(() => {});
    window.addEventListener(WATCH_EVENT, load);
    return () => window.removeEventListener(WATCH_EVENT, load);
  }, []);
  useEffect(() => { setRecent(getRecent()); }, [current]);

  const codes = useMemo(() => {
    if (tab === "watch") return watch;
    if (tab === "recent") return recent;
    return groups.find((g) => g.id === tab)?.codes ?? [];
  }, [tab, watch, recent, groups]);

  useEffect(() => {
    const need = codes.filter((c) => !quotes[c]);
    if (need.length) getQuotes(need).then((q) => setQuotes((o) => ({ ...o, ...q }))).catch(() => {});
  }, [codes, quotes]);

  // ↑ ↓ 切換股票
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName) || document.querySelector(".modal-wrap")) return;
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      if (!codes.length) return;
      e.preventDefault();
      const i = codes.indexOf(current);
      const n = e.key === "ArrowDown" ? (i + 1) % codes.length : (i - 1 + codes.length) % codes.length;
      router.push(`/stock/${codes[i < 0 ? 0 : n]}`);
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [codes, current, router]);

  // 目前這檔捲到看得見
  useEffect(() => { document.querySelector(`[data-code="${current}"]`)?.scrollIntoView({ block: "nearest" }); }, [current, codes]);

  const tabs = [{ id: "watch", name: "自選" }, { id: "recent", name: "最近" }, ...groups.map((g) => ({ id: g.id, name: g.name }))];

  // 收起：只剩一條窄邊，點一下展開
  if (mode === "hidden") {
    return (
      <aside className="hidden lg:flex flex-col items-center w-7 shrink-0 border-r border-line bg-panel">
        <button className="w-7 h-full flex flex-col items-center pt-3 gap-2 text-muted hover:text-text hover:bg-panel-2" title="展開自選清單" onClick={() => setMode("full")}>
          <Icon name="dblRight" className="w-4 h-4" />
          <span className="text-[11px] [writing-mode:vertical-rl] tracking-widest">自選</span>
        </button>
      </aside>
    );
  }
  const mini = mode === "mini";
  return (
    <aside className={`hidden lg:flex flex-col ${mini ? "w-[118px]" : "w-[260px]"} shrink-0 border-r border-line bg-panel transition-[width] duration-200`}>
      <div className={`flex ${mini ? "flex-col-reverse items-stretch" : "items-center"} gap-1 px-1.5 py-2 border-b border-line`}>
        <div className="flex-1 min-w-0 flex gap-1 overflow-x-auto no-scrollbar">
          {tabs.map((t) => <button key={t.id} className={`chip shrink-0 ${mini ? "!px-2 !text-[12px]" : ""} ${tab === t.id ? "chip-on" : ""}`} onClick={() => setTab(t.id)}>{t.name}</button>)}
        </div>
        <div className={`flex shrink-0 ${mini ? "justify-end" : ""}`}>
          <button className="icon-btn !w-7 !h-7" title={mini ? "展開" : "縮小"} onClick={() => setMode(mini ? "full" : "mini")}>
            <Icon name={mini ? "chevron" : "back"} className="w-4 h-4" />
          </button>
          <button className="icon-btn !w-7 !h-7" title="收起" onClick={() => setMode("hidden")}><Icon name="dblLeft" className="w-4 h-4" /></button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto scroll-thin divide">
        {codes.length === 0 && (
          <p className="p-4 text-sm text-muted">
            {tab === "watch" ? "還沒有自選股。在個股頁按 ☆ 加入。" : tab === "recent" ? "還沒有看過的股票。" : "這個族群還沒有股票。"}
          </p>
        )}
        {codes.map((c) => <Row key={c} code={c} name={names[c] ?? ""} q={quotes[c]} on={c === current} mini={mini} onPick={(x) => router.push(`/stock/${x}`)} />)}
      </div>
      {!mini && <div className="px-3 py-2 border-t border-line text-[11px] text-muted"><span className="kbd">↑</span> <span className="kbd">↓</span> 切換股票　直接打股號搜尋</div>}
    </aside>
  );
}
