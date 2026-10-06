"use client";
// 全域搜尋（鍵盤精靈）：Ctrl/⌘+K、「/」，或在任何地方直接打股號 / 名稱就會跳出來
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Icon from "@/components/ui/Icon";
import Tick from "@/components/ui/Tick";
import { allStocks, getRecent, getWatchlist, prefetchDaily, searchStocks, type Stock } from "@/lib/data";
import { livePx, useLiveQuotes } from "@/lib/useLive";

export const OPEN_SEARCH = "stockmine-search";
export function openSearch(initial = "") {
  window.dispatchEvent(new CustomEvent(OPEN_SEARCH, { detail: initial }));
}

function isTyping(el: EventTarget | null) {
  const t = el as HTMLElement | null;
  return !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
}

export default function SearchPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [list, setList] = useState<Stock[]>([]);
  const [idx, setIdx] = useState(0);
  const [watch, setWatch] = useState<Set<string>>(new Set());
  const input = useRef<HTMLInputElement>(null);
  const openRef = useRef(false);
  useEffect(() => { openRef.current = open; }, [open]);
  // 一打開就立刻把焦點放到輸入框，連續快速打字也不會漏字
  useLayoutEffect(() => { if (open) input.current?.focus(); }, [open]);

  const show = useCallback((initial: string) => {
    if (openRef.current) return;
    openRef.current = true;
    setQ(initial); setIdx(0); setOpen(true);
    getWatchlist().then((w) => setWatch(new Set(w))).catch(() => {});
  }, []);

  useEffect(() => {
    const onOpen = (e: Event) => show((e as CustomEvent<string>).detail ?? "");
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); show(""); return; }
      if (openRef.current) return;
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target) || document.querySelector(".modal-wrap")) return;
      if (e.key === "/") { e.preventDefault(); show(""); return; }
      // 直接打數字 / 英文字母 → 開啟並帶入（看盤軟體的鍵盤精靈）
      if (/^[0-9a-zA-Z]$/.test(e.key)) { e.preventDefault(); show(e.key); }
    };
    window.addEventListener(OPEN_SEARCH, onOpen);
    window.addEventListener("keydown", onKey);
    void allStocks().catch(() => {}); // 先載入清單，搜尋才會快
    return () => { window.removeEventListener(OPEN_SEARCH, onOpen); window.removeEventListener("keydown", onKey); };
  }, [show]);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    (async () => {
      const s = q.trim();
      let r: Stock[];
      if (s) r = await searchStocks(s);
      else {
        const all = await allStocks();
        const by = new Map(all.map((x) => [x.code, x]));
        r = getRecent().map((c) => by.get(c)).filter(Boolean) as Stock[];
      }
      if (alive) { setList(r); setIdx(0); }
    })().catch(() => {});
    return () => { alive = false; };
  }, [q, open]);

  useEffect(() => { if (list[idx]) prefetchDaily(list[idx].code); }, [list, idx]);
  // 搜尋結果的即時價（打開時才抓；盤中每 5 秒更新）
  const live = useLiveQuotes(useMemo(() => (open ? list.slice(0, 20).map((x) => x.code) : []), [open, list]));

  if (!open) return null;
  const close = () => { openRef.current = false; setOpen(false); };
  const go = (code: string) => { close(); router.push(`/stock/${code}`); };

  return (
    <div className="modal-wrap !items-start sm:!items-start pt-[max(12px,env(safe-area-inset-top))] sm:pt-[12vh]" onClick={() => close()}>
      <div className="modal !p-0 !rounded-2xl mx-3 sm:mx-0 !animate-none" style={{ animation: "pop .14s ease-out" }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-4 border-b border-line">
          <Icon name="search" className="w-5 h-5 text-muted shrink-0" />
          <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} placeholder="股號或名稱，例如 2330、台積電"
            className="bare flex-1 text-[17px] py-4 px-0" inputMode="search" autoComplete="off" enterKeyHint="go"
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") { e.preventDefault(); setIdx((i) => Math.min(i + 1, list.length - 1)); }
              else if (e.key === "ArrowUp") { e.preventDefault(); setIdx((i) => Math.max(i - 1, 0)); }
              else if (e.key === "Enter" && list[idx]) go(list[idx].code);
              else if (e.key === "Escape") close();
            }} />
          <button className="kbd hidden sm:inline" onClick={() => close()}>Esc</button>
          <button className="sm:hidden text-muted text-sm" onClick={() => close()}>取消</button>
        </div>
        <div className="max-h-[60vh] overflow-y-auto scroll-thin py-1">
          {!q.trim() && list.length > 0 && <div className="section-title px-4 pt-2 pb-1">最近看過</div>}
          {q.trim() && list.length === 0 && <div className="px-4 py-6 text-center text-muted text-sm">找不到「{q}」</div>}
          {!q.trim() && list.length === 0 && <div className="px-4 py-6 text-center text-muted text-sm">輸入股號或名稱</div>}
          {list.map((s, i) => (
            <button key={s.code} onMouseEnter={() => setIdx(i)} onClick={() => go(s.code)}
              className={`w-full flex items-center gap-3 px-4 py-2.5 text-left ${i === idx ? "bg-panel-2" : ""}`}>
              <span className="font-semibold num w-14">{s.code}</span>
              <span className="flex-1 truncate">{s.name}</span>
              {watch.has(s.code) && <Icon name="star" className="w-4 h-4 text-accent" fill="currentColor" stroke={0} />}
              {(() => {
                const lp = livePx(live[s.code], null, null);
                if (lp.px == null) return null;
                const c = (lp.pct ?? 0) > 0 ? "up" : (lp.pct ?? 0) < 0 ? "down" : "text-muted";
                return (
                  <span className={`text-right num leading-tight ${c}`}>
                    <Tick v={lp.px} className="block text-[14px] font-semibold">{lp.px.toFixed(2)}</Tick>
                    <span className="block text-[11px]">{(lp.pct ?? 0) > 0 ? "+" : ""}{(lp.pct ?? 0).toFixed(2)}%</span>
                  </span>
                );
              })()}
              <span className="tag tag-muted">{s.market === "TWSE" ? "上市" : "上櫃"}{s.kind === "etf" ? "・ETF" : ""}</span>
            </button>
          ))}
        </div>
        <div className="hidden sm:flex gap-3 px-4 py-2 border-t border-line text-[11px] text-muted">
          <span><span className="kbd">↑</span> <span className="kbd">↓</span> 選擇</span>
          <span><span className="kbd">Enter</span> 開啟</span>
          <span className="ml-auto">在任何頁面直接打股號就能搜尋</span>
        </div>
      </div>
    </div>
  );
}
