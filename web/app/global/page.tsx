"use client";
// 全球強勢族群：美 / 日 / 韓股昨晚收盤 → 哪些族群最強、強在哪一段 → 台股對應個股（最相關的排最上面）
// 資料每天台灣早上 05:40 自動更新一次，只保留最新一天
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import Icon from "@/components/ui/Icon";
import Tick from "@/components/ui/Tick";
import { getGlobalThemes, type GlobalMarket, type GlobalTheme, type GlobalThemes } from "@/lib/data";
import { livePx, useLiveQuotes } from "@/lib/useLive";

const MK: Record<GlobalMarket, string> = { US: "美", JP: "日", KR: "韓", CN: "陸", EU: "歐" };
const MK_FULL: Record<GlobalMarket, string> = { US: "美股", JP: "日股", KR: "韓股", CN: "陸股", EU: "歐股" };
const TIER = { 1: "龍頭", 2: "高度相關", 3: "相關" } as const;
const TIER_S = { 1: "龍頭", 2: "高度", 3: "相關" } as const;
const cls = (v: number | null | undefined) => (v == null ? "text-muted" : v > 0 ? "up" : v < 0 ? "down" : "text-muted");
const pct = (v: number | null | undefined, d = 2) => (v == null ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(d)}%`);
const md = (s?: string | null) => (s ? s.slice(5).replace("-", "/") : "—");
const yi = (v: number) => (v >= 1e8 ? `${(v / 1e8).toFixed(v >= 1e10 ? 0 : 1)}億` : v > 0 ? `${Math.round(v / 1e4).toLocaleString()}萬` : "—");

/** 熱力圖底色：漲紅跌綠，幅度越大越深 */
function heat(v: number | null | undefined, max = 6) {
  if (v == null || v === 0) return { background: "var(--panel-2)" };
  const a = Math.round(14 + Math.min(1, Math.abs(v) / max) * 56);
  return { background: `color-mix(in srgb, var(${v > 0 ? "--up" : "--down"}) ${a}%, var(--panel))` };
}

function MarketChips({ t, size = "sm" }: { t: GlobalTheme; size?: "sm" | "md" }) {
  const order: GlobalMarket[] = ["US", "JP", "KR", "CN", "EU"];
  return (
    <div className="flex flex-wrap gap-1">
      {order.filter((m) => t.markets[m]).map((m) => {
        const v = t.markets[m]!.avg;
        const strong = t.strong_markets.includes(m);
        return (
          <span key={m} className={`inline-flex items-center gap-0.5 rounded-md px-1.5 ${size === "md" ? "py-0.5 text-[13px]" : "text-[11px]"} num
            ${strong ? "bg-black/25 font-semibold" : "bg-black/15"}`}>
            <span className="opacity-80">{size === "md" ? MK_FULL[m] : MK[m]}</span>{pct(v, 1)}
          </span>
        );
      })}
    </div>
  );
}

export default function GlobalPage() {
  const [data, setData] = useState<GlobalThemes | null | undefined>(undefined);
  const [sel, setSel] = useState<string | null>(null);
  const [onlyLead, setOnlyLead] = useState(false);
  const detailRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    getGlobalThemes().then((d) => { setData(d); if (d?.themes.length) setSel(d.themes[0].id); }).catch(() => setData(null));
  }, []);

  const t = useMemo(() => data?.themes.find((x) => x.id === sel) ?? null, [data, sel]);
  // 台股對應清單：盤中即時價（每 5 秒）
  const live = useLiveQuotes(useMemo(() => t?.tw.map((r) => r.code) ?? [], [t]));
  const synced = data?.themes.filter((x) => x.synced) ?? [];

  function pick(id: string) {
    setSel(id); setOnlyLead(false);
    if (window.innerWidth < 1024) requestAnimationFrame(() => detailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  if (data === undefined) return <div className="page space-y-3"><div className="skeleton h-10" /><div className="skeleton h-[420px]" /></div>;
  if (!data || !data.themes.length) {
    return (
      <div className="page-narrow pt-10 text-center space-y-2">
        <Icon name="globe" className="w-10 h-10 mx-auto text-muted" />
        <div className="text-[17px] font-semibold">還沒有全球族群資料</div>
        <p className="text-sm text-muted">每天台灣早上 05:40（美股收盤後）會自動整理一次。也可以到 GitHub Actions 手動執行「全球強勢族群」。</p>
      </div>
    );
  }

  const tw = t ? (onlyLead ? t.tw.filter((r) => r.lead) : t.tw) : [];

  return (
    <div className="page space-y-3">
      {/* 標題 */}
      <header className="flex flex-wrap items-end gap-x-3 gap-y-1">
        <h1 className="text-[22px] lg:text-[26px] font-bold tracking-tight">全球強勢族群</h1>
        <div className="text-[12px] text-muted num">
          {(["US", "JP", "KR"] as GlobalMarket[]).filter((m) => data.dates[m]).map((m) => `${MK_FULL[m]} ${md(data.dates[m])}`).join("・")}
          {" "}收盤｜台股對應 {md(data.tw_date)}
        </div>
      </header>

      {/* 同步走強 */}
      {synced.length > 0 && (
        <div className="card px-3 py-2.5 flex items-start gap-2">
          <span className="shrink-0 rounded-md bg-up text-white text-[12px] font-semibold px-1.5 py-0.5 mt-0.5">資金同步</span>
          <div className="text-[14px] leading-relaxed">
            {synced.map((x, i) => (
              <button key={x.id} onClick={() => pick(x.id)} className="hover:underline">
                {i > 0 && "、"}<b>{x.name}</b>
                <span className="text-muted text-[12px] num">（{x.strong_markets.map((m) => `${MK[m]}${pct(x.markets[m]?.avg, 1)}`).join(" ")}）</span>
              </button>
            ))}
            <span className="text-muted"> 美日韓同時走強，資金方向一致。</span>
          </div>
        </div>
      )}

      <div className="lg:flex lg:gap-3 lg:items-start space-y-3 lg:space-y-0">
        {/* 族群排行（熱力圖） */}
        <section className="lg:w-[360px] lg:shrink-0 lg:sticky lg:top-3">
          <div className="section-title mb-1.5 px-0.5">族群排行・依海外平均漲幅</div>
          <div className="grid grid-cols-2 lg:grid-cols-1 gap-1.5">
            {data.themes.map((x) => (
              <button key={x.id} onClick={() => pick(x.id)} style={heat(x.avg)}
                className={`text-left rounded-xl px-2.5 py-2 transition border-2 ${x.id === sel ? "border-accent" : "border-transparent hover:brightness-110"}`}>
                <div className="flex items-baseline gap-1.5">
                  <span className="text-[11px] num opacity-70 w-4 shrink-0">{x.rank}</span>
                  <span className="font-semibold text-[14px] lg:text-[15px] leading-snug min-w-0 lg:truncate">{x.name}</span>
                  <span className="hidden lg:inline ml-auto text-[16px] font-bold num">{pct(x.avg)}</span>
                </div>
                <div className="lg:hidden flex items-center gap-1.5 pl-[22px] mt-0.5">
                  <span className="text-[16px] font-bold num">{pct(x.avg)}</span>
                  {x.synced && <span className="text-[10px] font-semibold rounded bg-white/90 text-black px-1">同步</span>}
                </div>
                <div className="mt-1 flex items-center gap-1.5 pl-[22px]">
                  {x.synced && <span className="hidden lg:inline text-[10px] font-semibold rounded bg-white/90 text-black px-1">同步</span>}
                  <MarketChips t={x} />
                  <span className="hidden lg:inline ml-auto text-[11px] opacity-75 num">{x.up}/{x.n} 漲</span>
                </div>
              </button>
            ))}
          </div>
        </section>

        {/* 族群明細 */}
        {t && (
          <div ref={detailRef} className="flex-1 min-w-0 space-y-3 scroll-mt-3">
            <section className="card overflow-hidden">
              <div className="p-3 lg:p-4 space-y-2" style={heat(t.avg, 10)}>
                <div className="flex items-baseline gap-2 flex-wrap">
                  <span className="text-[12px] num opacity-75">第 {t.rank} 名</span>
                  <h2 className="text-[20px] lg:text-[22px] font-bold">{t.name}</h2>
                  <span className="text-[22px] font-bold num">{pct(t.avg)}</span>
                  <span className="text-[12px] opacity-80 num">5 日 {pct(t.avg5, 1)}・上漲 {t.up}/{t.n}</span>
                </div>
                <MarketChips t={t} size="md" />
                <p className="text-[14px] leading-relaxed">{t.reason}</p>
              </div>

              {/* 細項強弱 */}
              {t.subs.length > 1 && (
                <div className="px-3 lg:px-4 py-2.5 border-t border-line">
                  <div className="section-title mb-1.5">強在哪一段</div>
                  <div className="space-y-1">
                    {t.subs.map((s) => {
                      const w = Math.min(100, Math.abs(s.avg) * 10);
                      return (
                        <div key={s.sub} className="flex items-center gap-2 text-[13px]">
                          <span className={`w-[7.5rem] shrink-0 truncate ${s.sub === t.lead_sub ? "font-semibold text-accent" : ""}`}>
                            {s.sub === t.lead_sub && "★ "}{s.sub}
                          </span>
                          <div className="flex-1 h-2 rounded-full bg-panel-2 overflow-hidden">
                            <div className="h-full rounded-full" style={{ width: `${Math.max(3, w)}%`, background: s.avg >= 0 ? "var(--up)" : "var(--down)" }} />
                          </div>
                          <span className={`w-16 text-right num ${cls(s.avg)}`}>{pct(s.avg, 1)}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* 海外個股熱力圖 */}
              <div className="px-3 lg:px-4 py-2.5 border-t border-line">
                <div className="section-title mb-1.5">海外個股</div>
                <div className="grid grid-cols-3 sm:grid-cols-4 xl:grid-cols-5 gap-1.5">
                  {t.movers.map((m) => (
                    <div key={m.sym} style={heat(m.pct)} className="rounded-lg px-2 py-1.5 min-w-0" title={`${m.sym}・${m.sub}`}>
                      <div className="flex items-baseline gap-1">
                        <span className="text-[13px] font-semibold truncate">{m.name}</span>
                        <span className="ml-auto text-[10px] opacity-70 shrink-0">{MK[m.market]}</span>
                      </div>
                      <div className="text-[15px] font-bold num leading-tight">{pct(m.pct)}</div>
                      <div className="text-[10px] opacity-75 truncate num">{m.sym}・{m.sub}</div>
                    </div>
                  ))}
                </div>
              </div>

              {t.news && t.news.length > 0 && (
                <div className="px-3 lg:px-4 py-2.5 border-t border-line">
                  <div className="section-title mb-1">相關新聞（英文）</div>
                  <ul className="space-y-1">
                    {t.news.map((n) => (
                      <li key={n.link} className="text-[13px] leading-snug">
                        <a href={n.link} target="_blank" rel="noopener noreferrer" className="hover:underline">
                          <span className="text-muted num mr-1">{n.sym}</span>{n.title}
                        </a>
                        {n.publisher && <span className="text-faint text-[11px]">・{n.publisher}</span>}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </section>

            {/* 台股對應 */}
            <section className="card overflow-hidden">
              <div className="card-h">
                <span>台股對應・{t.tw.length} 檔</span>
                {t.lead_sub && (
                  <div className="seg ml-auto !text-[12px]">
                    <button aria-pressed={!onlyLead} onClick={() => setOnlyLead(false)}>全部</button>
                    <button aria-pressed={onlyLead} onClick={() => setOnlyLead(true)}>只看{t.lead_sub}</button>
                  </div>
                )}
              </div>
              <div className="px-3 py-1.5 text-[11px] text-muted border-b border-line">
                排序：{t.lead_sub ? <>最強細項「<span className="text-accent">{t.lead_sub}</span>」優先 → </> : null}龍頭 → 高度相關 → 相關，同一層成交金額大的在前
              </div>
              <div className="hidden sm:grid grid-cols-[4.5rem_1fr_9rem_5rem_5.5rem_5rem] gap-2 px-3 py-1.5 text-[12px] text-muted border-b border-line">
                <span>層級</span><span>個股</span><span>細項</span><span className="text-right">收盤</span><span className="text-right">漲跌</span><span className="text-right">成交金額</span>
              </div>
              <ul>
                {tw.map((r) => { const lp = livePx(live[r.code], r.close, r.pct); return (
                  <li key={r.code} className="border-b border-line last:border-0">
                    <Link href={`/stock/${r.code}`}
                      className="grid grid-cols-[3.6rem_1fr_auto] sm:grid-cols-[4.5rem_1fr_9rem_5rem_5.5rem_5rem] gap-x-2 items-center px-3 py-2 hover:bg-panel-2 transition-colors">
                      <span className={`justify-self-start rounded-md px-1.5 py-0.5 text-[11px] font-semibold
                        ${r.tier === 1 ? "bg-accent text-[var(--accent-ink)]" : r.tier === 2 ? "bg-[var(--accent-bg)] text-accent" : "bg-panel-2 text-muted"}`}>
                        <span className="sm:hidden">{TIER_S[r.tier]}</span><span className="hidden sm:inline">{TIER[r.tier]}</span>
                      </span>
                      <span className="min-w-0">
                        <span className="font-semibold text-[15px]">{r.lead && <span className="text-accent">★</span>}{r.name}</span>
                        <span className="text-muted text-[12px] num ml-1">{r.code}</span>
                        <span className="sm:hidden block text-[11px] text-muted truncate">{r.sub}・{yi(r.amount)}</span>
                      </span>
                      <span className={`hidden sm:block text-[13px] truncate ${r.lead ? "text-accent" : "text-muted"}`}>{r.sub}</span>
                      <Tick v={lp.px} className="hidden sm:block text-right num text-[14px]">{lp.px?.toFixed(2) ?? "—"}</Tick>
                      <span className={`text-right num text-[14px] font-semibold ${cls(lp.pct)}`}>
                        <Tick v={lp.px} className="sm:hidden block text-[13px] font-normal text-text">{lp.px?.toFixed(2) ?? "—"}</Tick>
                        {pct(lp.pct)}
                      </span>
                      <span className="hidden sm:block text-right num text-[13px] text-muted">{yi(r.amount)}</span>
                    </Link>
                  </li>
                ); })}
              </ul>
            </section>

            <p className="text-[11px] text-faint leading-relaxed px-1">
              族群和台股對應是整理的公開資訊，只是參考方向，不是買賣建議。每天台灣早上 05:40 更新，前一天的資料不保留。
              {data.failed.length > 0 && <> 這次沒抓到：{data.failed.join("、")}。</>}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
