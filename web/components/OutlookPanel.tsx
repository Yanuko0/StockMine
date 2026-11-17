"use client";
// 展望：偏多 / 偏空理由、上漲機率（歷史回測）、風險、參考做法；券商目標價（依時間）；個股新聞；複製 AI 分析提示詞
import { useEffect, useMemo, useState } from "react";
import type { Bar } from "@/lib/bars";
import {
  getInst, getMainForce, getMargin, getOutlook, getOutlookModel, getStockNews, getTargets,
  type Outlook, type OutlookModel, type StockNews, type TargetPrice,
} from "@/lib/data";
import { buildPrompt } from "@/lib/aiPrompt";

const SIDE_CLS: Record<string, string> = { 偏多: "tag-up", 偏空: "tag-down", 中性: "tag-muted", 資料不足: "tag-muted" };
const RISK_CLS: Record<string, string> = { 高: "tag-up", 中: "tag-accent", 低: "tag-down" };
const ACT: Record<string, string> = { up: "調升", down: "調降", keep: "維持", init: "首評" };
const fmtDate = (s: string) => s.slice(5, 10).replace("-", "/");
const ago = (iso: string, now: number) => {
  if (!now) return "";
  const h = (now - new Date(iso).getTime()) / 3600e3;
  return h < 1 ? "剛剛" : h < 24 ? `${Math.floor(h)} 小時前` : `${Math.floor(h / 24)} 天前`;
};

function Section({ title, right, children }: { title: React.ReactNode; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="card overflow-hidden">
      <div className="card-h text-sm">{title}<span className="ml-auto font-normal">{right}</span></div>
      {children}
    </div>
  );
}

function Prob({ o }: { o: Outlook }) {
  const v = o.verdict;
  if (v.p_up == null || !o.stats) return <p className="text-sm text-muted">{v.text}</p>;
  const up = v.p_up, base = o.base.win;
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline gap-2">
        <span className="text-[13px]">之後 20 個交易日</span>
        <span className="up font-semibold num">上漲 {up.toFixed(0)}%</span>
        <span className="down font-semibold num">下跌 {(100 - up).toFixed(0)}%</span>
        {v.conf && <span className="text-[11px] text-muted ml-auto">可信度 {v.conf}</span>}
      </div>
      <div className="relative h-2.5 rounded-full overflow-hidden flex" aria-hidden>
        <div className="h-full" style={{ width: `${up}%`, background: "var(--up)" }} />
        <div className="h-full flex-1" style={{ background: "var(--down)" }} />
        <div className="absolute top-0 bottom-0 w-0.5 bg-[var(--text)]" style={{ left: `${base}%` }} title={`全市場平均 ${base}%`} />
      </div>
      <p className="text-[12px] text-muted leading-relaxed">{v.text}</p>
      <div className="grid grid-cols-4 gap-1 text-center text-[11px]">
        {([["報酬中位數", o.stats.median], ["好的 25%", o.stats.p75], ["差的 10%", o.stats.p10], ["期間最大回檔", o.stats.mae_med]] as const).map(([l, x]) => (
          <div key={l} className="rounded-lg bg-panel-2 py-1">
            <div className="text-muted">{l}</div>
            <div className={`num font-semibold ${x > 0 ? "up" : x < 0 ? "down" : ""}`}>{x > 0 ? "+" : ""}{x}%</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Reasons({ side, rules, ai, news }: { side: "bull" | "bear"; rules: Outlook["bull"]; ai: { t: string; n: number[] }[]; news: { title: string; url: string }[] }) {
  const cls = side === "bull" ? "up" : "down";
  return (
    <div className="min-w-0">
      <div className={`text-xs font-semibold mb-1 ${cls}`}>{side === "bull" ? "偏多理由" : "偏空理由"}</div>
      <ul className="space-y-1 text-[13px]">
        {rules.map((r, i) => (
          <li key={`r${i}`} className="flex gap-1.5"><span className="tag tag-muted shrink-0">{r.k}</span><span>{r.t}</span></li>
        ))}
        {ai.map((r, i) => (
          <li key={`a${i}`} className="flex gap-1.5">
            <span className="tag tag-accent shrink-0">新聞</span>
            <span>{r.t}{r.n.map((k) => news[k] && (
              <a key={k} href={news[k].url} target="_blank" rel="noreferrer" className="text-accent text-[11px] ml-1" title={news[k].title}>[{k + 1}]</a>
            ))}</span>
          </li>
        ))}
        {!rules.length && !ai.length && <li className="text-muted text-xs">沒有明顯的{side === "bull" ? "偏多" : "偏空"}理由</li>}
      </ul>
    </div>
  );
}

function Accuracy({ m }: { m: OutlookModel }) {
  const [open, setOpen] = useState(false);
  const c = m.calib;
  const skill = c.skill;
  return (
    <div className="text-[11px] text-muted">
      <button className="underline decoration-dotted" onClick={() => setOpen(!open)}>這個機率準不準？</button>
      {open && (
        <div className="mt-1.5 space-y-1.5 leading-relaxed">
          <p>做法：把每一檔每一天依「趨勢、近 20 日漲跌、RSI、量能、外資近 5 日」分類，統計過去 {m.years} 年全市場同一類之後 {m.horizon} 個交易日的結果。只看價量籌碼，不含基本面和新聞。</p>
          {c.rows?.length ? (
            <>
              <p>回測對答案（用 {c.since} 以前的資料算機率，對 {c.since} 之後的實際結果，{c.n?.toLocaleString()} 筆）：</p>
              <table className="tbl">
                <thead><tr><th>當時說上漲機率</th><th>筆數</th><th>平均說</th><th>實際上漲</th></tr></thead>
                <tbody>{c.rows.map((r) => <tr key={r.bucket}><td>{r.bucket}</td><td>{r.n.toLocaleString()}</td><td>{r.pred}%</td><td>{r.actual}%</td></tr>)}</tbody>
              </table>
              <p>
                {skill != null && skill > 1 ? `比「每檔都猜平均值」準 ${skill.toFixed(1)}%（Brier 分數），有一點參考價值，但不大。`
                  : "跟「每檔都猜平均值」差不多準，代表光看價量籌碼很難預測一個月後漲跌，機率只能當參考。"}
                {c.test_base != null && ` 這段期間全市場實際上漲比例 ${c.test_base}%，大盤多空會讓所有機率一起偏掉。`}
              </p>
            </>
          ) : <p>歷史資料還不夠，還沒有回測結果。</p>}
          {m.track?.n ? (
            <p>上線後實際成績：{m.track.n} 筆已到期{m.track.bull_n ? `；說偏多的 ${m.track.bull_n} 筆，實際上漲 ${m.track.bull_up}%` : ""}{m.track.bear_n ? `；說偏空的 ${m.track.bear_n} 筆，實際上漲 ${m.track.bear_up}%` : ""}（全部 {m.track.all_up ?? "-"}%）。</p>
          ) : null}
          <p>想更準：多看基本面（月營收、毛利、法說會）、產業循環與大盤方向；用「複製 AI 提示詞」讓 AI 幫你補查最新資料。這些都不是投資建議。</p>
        </div>
      )}
    </div>
  );
}

export default function OutlookPanel({ code, name, industry, daily }: { code: string; name?: string; industry?: string | null; daily: Bar[] }) {
  const [o, setO] = useState<(Outlook & { updated_at: string }) | null | undefined>(undefined);
  const [model, setModel] = useState<OutlookModel | null>(null);
  const [tps, setTps] = useState<TargetPrice[] | null>(null);
  const [news, setNews] = useState<StockNews[] | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [copied, setCopied] = useState<string>("");
  const [days, setDays] = useState(30);
  const [now, setNow] = useState(0);
  useEffect(() => { setNow(Date.now()); }, [code]);

  useEffect(() => {
    setO(undefined); setTps(null);
    getOutlook(code).then(setO).catch(() => setO(null));
    getTargets(code).then(setTps).catch(() => setTps([]));
    getOutlookModel().then(setModel).catch(() => {});
  }, [code]);
  useEffect(() => {
    if (!name) return;
    setNews(null);
    getStockNews(code, name, days).then(setNews).catch(() => setNews([]));
  }, [code, name, days]);

  const close = daily[daily.length - 1]?.close;
  const tsum = useMemo(() => {
    if (!tps?.length || !now) return null;
    const since = new Date(now - 180 * 864e5).toISOString().slice(0, 10);
    const latest = new Map<string, TargetPrice>();
    for (const t of tps) if (t.date >= since && !t.broker.includes("未具名") && !latest.has(t.broker)) latest.set(t.broker, t);
    const xs = [...latest.values()].map((t) => Number(t.target)).sort((a, b) => a - b);
    if (!xs.length) return null;
    const med = xs.length % 2 ? xs[(xs.length - 1) / 2] : (xs[xs.length / 2 - 1] + xs[xs.length / 2]) / 2;
    return { n: xs.length, med, hi: xs[xs.length - 1], lo: xs[0] };
  }, [tps, now]);

  async function copyPrompt() {
    setCopied("整理中…");
    try {
      const [inst, mf, margin] = await Promise.all([
        getInst(code, 20).catch(() => []), getMainForce(code, 20).catch(() => []), getMargin(code, 10).catch(() => []),
      ]);
      const text = buildPrompt({ code, name: name ?? code, industry, daily, inst, mf, margin, targets: tps ?? [], news: news ?? [], outlook: o ?? null });
      await navigator.clipboard.writeText(text);
      setCopied(`已複製（${text.length.toLocaleString()} 字），貼到下面任一個 AI`);
    } catch {
      setCopied("複製失敗：瀏覽器不允許，請改用電腦版或允許剪貼簿");
    }
  }

  const aiNews = o?.ai?.news ?? [];
  return (
    <div className="p-3 space-y-3">
      {/* 多空展望 */}
      <Section
        title={<>多空展望 {o && <span className={`tag ${SIDE_CLS[o.verdict.side]}`}>{o.verdict.side}</span>}</>}
        right={o ? <span className="text-[11px] text-muted">{o.date} 收盤後・{ago(o.updated_at, now)}</span> : null}>
        <div className="p-3 space-y-3">
          {o === undefined && <p className="text-sm text-muted">載入中…</p>}
          {o === null && (
            <p className="text-sm text-muted leading-relaxed">這檔還沒有每日分析。每天收盤後只幫「自選股」和「最近有新聞的股票」算；把這檔加入自選股（右上角星號），下一次收盤後就會有。現在可以先用下面的「複製 AI 提示詞」自己問 AI。</p>
          )}
          {o && (
            <>
              <Prob o={o} />
              <div className="flex flex-wrap gap-1">
                {Object.values(o.state).map((s) => <span key={s} className="tag tag-muted">{s}</span>)}
              </div>
              {o.ai?.one_line && <p className="text-[13px]"><span className="tag tag-accent mr-1">新聞面</span>{o.ai.one_line}</p>}
              <div className="grid grid-cols-1 gap-3">
                <Reasons side="bull" rules={o.bull} ai={o.ai?.bull ?? []} news={aiNews} />
                <Reasons side="bear" rules={o.bear} ai={o.ai?.bear ?? []} news={aiNews} />
              </div>
            </>
          )}
        </div>
      </Section>

      {o && (
        <Section title={<>風險 <span className={`tag ${RISK_CLS[o.risk.level]}`}>{o.risk.level}</span></>}>
          <div className="p-3 space-y-2 text-[13px]">
            <div className="grid grid-cols-3 gap-1 text-center text-[11px]">
              <div className="rounded-lg bg-panel-2 py-1"><div className="text-muted">年化波動</div><div className="num font-semibold">{o.risk.vol}%</div></div>
              <div className="rounded-lg bg-panel-2 py-1"><div className="text-muted">比全市場波動大</div><div className="num font-semibold">{o.risk.vol_pct ?? "-"}%</div></div>
              <div className="rounded-lg bg-panel-2 py-1"><div className="text-muted">每天平均振幅</div><div className="num font-semibold">{o.risk.atr}</div></div>
            </div>
            {o.stats && <p className="text-[12px] text-muted">同狀態歷史：最差 10% 的情況一個月內 {o.stats.p10}%，期間最大回檔常見 {o.stats.mae_med}%、最差 10% 到 {o.stats.mae_p10}%。</p>}
            <div className="text-xs font-semibold pt-1">參考做法</div>
            <ul className="list-disc pl-5 space-y-0.5">{o.plan.map((p) => <li key={p}>{p}</li>)}</ul>
            {model && <Accuracy m={model} />}
            <p className="text-[11px] text-muted">以上都是用公開資料和規則算的參考，不是投資建議；機率是「過去類似情況」的統計，不代表這次一定會這樣。</p>
          </div>
        </Section>
      )}

      {/* AI 提示詞 */}
      <Section title="自己問 AI">
        <div className="p-3 space-y-2">
          <p className="text-[12px] text-muted">把這檔的價格、均線、法人、主力、融資、目標價、新聞標題和上面的統計整理成一段提示詞，貼到任何 AI 就能請它分析（它能上網的話還會補查最新資料）。</p>
          <div className="flex flex-wrap gap-2 items-center">
            <button className="btn btn-primary btn-sm" onClick={copyPrompt} disabled={!daily.length}>複製 AI 提示詞</button>
            <a className="btn btn-sm" href="https://chatgpt.com/" target="_blank" rel="noreferrer">ChatGPT</a>
            <a className="btn btn-sm" href="https://claude.ai/new" target="_blank" rel="noreferrer">Claude</a>
            <a className="btn btn-sm" href="https://gemini.google.com/app" target="_blank" rel="noreferrer">Gemini</a>
          </div>
          {copied && <p className="text-[12px] text-accent">{copied}</p>}
        </div>
      </Section>

      {/* 目標價 */}
      <Section title="券商 / 外資目標價" right={<span className="text-[11px] text-muted">從新聞整理・新的在前</span>}>
        <div className="p-3 space-y-2">
          {tsum && (
            <div className="grid grid-cols-4 gap-1 text-center text-[11px]">
              {([["中位數", tsum.med], ["最高", tsum.hi], ["最低", tsum.lo]] as const).map(([l, x]) => (
                <div key={l} className="rounded-lg bg-panel-2 py-1">
                  <div className="text-muted">{l}</div>
                  <div className="num font-semibold">{x.toLocaleString()}</div>
                  {close ? <div className={`num ${x > close ? "up" : "down"}`}>{x > close ? "+" : ""}{((x / close - 1) * 100).toFixed(0)}%</div> : null}
                </div>
              ))}
              <div className="rounded-lg bg-panel-2 py-1"><div className="text-muted">家數</div><div className="num font-semibold">{tsum.n}</div><div className="text-muted">近半年</div></div>
            </div>
          )}
          {tps === null && <p className="text-sm text-muted">載入中…</p>}
          {tps?.length === 0 && <p className="text-sm text-muted">還沒有從新聞抓到這檔的目標價（只抓得到有上新聞的；加入自選股後每週會往前查一年）。</p>}
          {!!tps?.length && (
            <table className="tbl text-[12px]">
              <thead><tr><th>日期</th><th>券商</th><th>評等</th><th>目標價</th><th>vs 現價</th></tr></thead>
              <tbody>
                {(showAll ? tps : tps.slice(0, 12)).map((t) => {
                  const tg = Number(t.target);
                  return (
                    <tr key={`${t.broker}${t.target}${t.date}`}>
                      <td className="text-muted whitespace-nowrap">{t.date.slice(2).replace(/-/g, "/")}</td>
                      <td className="truncate max-w-[6rem]">
                        {t.url ? <a href={t.url} target="_blank" rel="noreferrer" className="hover:text-accent" title={t.title ?? ""}>{t.broker}</a> : t.broker}
                        {t.origin === "ai" && <span className="text-[10px] text-muted ml-0.5" title="AI 從新聞整理，數字有核對過">AI</span>}
                      </td>
                      <td className={t.stance === "多" ? "up" : t.stance === "空" ? "down" : "text-muted"}>{t.rating ?? (t.action ? ACT[t.action] : "-")}</td>
                      <td className="num whitespace-nowrap">
                        {t.prev ? <span className="text-muted">{Number(t.prev).toLocaleString()}→</span> : null}
                        <span className={t.action === "up" ? "up" : t.action === "down" ? "down" : ""}>{tg.toLocaleString()}</span>
                      </td>
                      <td className={`num ${close && tg > close ? "up" : "down"}`}>{close ? `${tg > close ? "+" : ""}${((tg / close - 1) * 100).toFixed(0)}%` : "-"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          {!!tps && tps.length > 12 && <button className="btn btn-ghost btn-sm w-full" onClick={() => setShowAll(!showAll)}>{showAll ? "收合" : `看全部 ${tps.length} 筆`}</button>}
          <p className="text-[11px] text-muted">券商報告原文要付費，這裡只整理新聞有報導的；標「未具名」的不算進中位數。點券商名稱看原新聞。</p>
        </div>
      </Section>

      {/* 新聞 */}
      <Section title="個股新聞" right={
        <div className="seg">
          {[7, 30, 90].map((d) => <button key={d} aria-pressed={days === d} onClick={() => setDays(d)}>{d} 天</button>)}
        </div>}>
        <div className="divide">
          {news === null && <p className="p-3 text-sm text-muted">載入中…</p>}
          {news?.length === 0 && <p className="p-3 text-sm text-muted">這段期間沒有找到新聞。</p>}
          {news?.slice(0, 40).map((x) => (
            <a key={x.title + x.ts} href={x.url || undefined} target="_blank" rel="noreferrer" className="block px-3 py-2 row-hover">
              <div className="text-[13px] leading-snug">{x.title}</div>
              <div className="text-[11px] text-muted mt-0.5">{fmtDate(new Date(new Date(x.ts).getTime() + 8 * 3600e3).toISOString())}・{x.source}</div>
            </a>
          ))}
        </div>
      </Section>
    </div>
  );
}
