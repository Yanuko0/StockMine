"use client";
// 電腦版個股頁左側：自選股 / 最近看過 / 自訂族群，點一下切換，↑↓ 鍵上下切換
import { memo, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import Spark from "@/components/ui/Spark";
import {
  allStocks, getGroups, getQuotes, getRecent, getWatchlist, prefetchDaily, WATCH_EVENT, type Quote, type UserGroup,
} from "@/lib/data";

const Row = memo(function Row({ code, name, q, on, onPick }: { code: string; name: string; q?: Quote; on: boolean; onPick: (c: string) => void }) {
  const c = q ? (q.chg > 0 ? "up" : q.chg < 0 ? "down" : "") : "";
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
  return (
    <aside className="hidden lg:flex flex-col w-[260px] shrink-0 border-r border-line bg-panel">
      <div className="flex gap-1 px-2 py-2 border-b border-line overflow-x-auto no-scrollbar">
        {tabs.map((t) => <button key={t.id} className={`chip ${tab === t.id ? "chip-on" : ""}`} onClick={() => setTab(t.id)}>{t.name}</button>)}
      </div>
      <div className="flex-1 overflow-y-auto scroll-thin divide">
        {codes.length === 0 && (
          <p className="p-4 text-sm text-muted">
            {tab === "watch" ? "還沒有自選股。在個股頁按 ☆ 加入。" : tab === "recent" ? "還沒有看過的股票。" : "這個族群還沒有股票。"}
          </p>
        )}
        {codes.map((c) => <Row key={c} code={c} name={names[c] ?? ""} q={quotes[c]} on={c === current} onPick={(x) => router.push(`/stock/${x}`)} />)}
      </div>
      <div className="px-3 py-2 border-t border-line text-[11px] text-muted"><span className="kbd">↑</span> <span className="kbd">↓</span> 切換股票　直接打股號搜尋</div>
    </aside>
  );
}
