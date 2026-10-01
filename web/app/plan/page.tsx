"use client";
// 分批建倉：規則、每日訊號、持倉（全部只有自己看得到）
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  addPosition, allStocks, closePosition, deletePosition, DEFAULT_PLAN, getAlerts, getPlan, getPositions,
  latestCloses, savePlan, getTemplates, type Condition, type Position, type TradeAlert, type TranchePlan,
  type Template, type TrancheRules,
} from "@/lib/data";
import { CondList } from "@/components/StrategyEditor";
import { PRESETS, presetStrategy } from "@/lib/presets";

function kindOf(kind: string, rules: TrancheRules | undefined): { label: string; cls: string; tranche?: number } {
  if (kind === "stop") return { label: rules?.stop.name || "停損", cls: "bg-down/20 down" };
  const n = +kind.replace("entry", "") || 0;
  return { label: rules?.entries[n - 1]?.name || `第${n}筆`, cls: "bg-up/20 up", tranche: n };
}

// 一組條件（某一筆的進場，或停損）的編輯區
function RuleBlock({ title, logic, conds, onChange, templates, extra }: {
  title: React.ReactNode; logic: "AND" | "OR"; conds: Condition[];
  onChange: (logic: "AND" | "OR", conds: Condition[]) => void; templates: Template[]; extra?: React.ReactNode;
}) {
  const [ver, setVer] = useState(0);
  const all = [...templates.map((t) => ({ name: t.name, c: t.conditions })),
    ...PRESETS.map((p) => ({ name: p.name, c: presetStrategy(p).conditions }))];
  return (
    <div className="border border-line rounded-xl p-3 space-y-2">
      <div className="flex items-center gap-2 flex-wrap">{title}
        <select className="ml-auto text-xs" value="" onChange={(e) => {
          const t = all[+e.target.value]; if (!t) return;
          if (conds.length && !confirm(`用「${t.name}」的條件覆蓋？`)) return;
          onChange(t.c.logic ?? "AND", structuredClone(t.c.conditions)); setVer((v) => v + 1);
        }}>
          <option value="">從選股策略範本帶入…</option>
          {all.map((t, i) => <option key={i} value={i}>{t.name}</option>)}
        </select>
      </div>
      {extra}
      <select className="text-sm" value={logic} onChange={(e) => onChange(e.target.value as "AND" | "OR", conds)}>
        <option value="AND">以下條件全部成立</option><option value="OR">以下條件任一成立</option>
      </select>
      <CondList key={ver} conds={conds} setConds={(c) => onChange(logic, c)} />
    </div>
  );
}
const today = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
const money = (v: number) => Math.round(v).toLocaleString();

function defaultShares(amount: number, price: number) {
  if (!price) return 0;
  const s = Math.floor(amount / price);
  return s >= 1000 ? Math.floor(s / 1000) * 1000 : s; // 夠一張就整張買，不夠就零股
}

export default function PlanPage() {
  const [plan, setPlan] = useState<TranchePlan | null>(null);
  const [draft, setDraft] = useState<TranchePlan>(DEFAULT_PLAN);
  const [editing, setEditing] = useState(false);
  const [alerts, setAlerts] = useState<TradeAlert[]>([]);
  const [positions, setPositions] = useState<Position[]>([]);
  const [prices, setPrices] = useState<Record<string, { close: number; date: string }>>({});
  const [names, setNames] = useState<Record<string, string>>({});
  const [form, setForm] = useState<{ code: string; tranche: number; buy_date: string; buy_price: string; shares: string } | null>(null);
  const [showClosed, setShowClosed] = useState(false);
  const [msg, setMsg] = useState("");
  const [templates, setTemplates] = useState<Template[]>([]);
  useEffect(() => { getTemplates().then(setTemplates).catch(() => {}); }, []);

  async function load() {
    const p = await getPlan();
    setPlan(p); if (p) setDraft(p);
    const [a, pos] = await Promise.all([getAlerts(), getPositions()]);
    setAlerts(a); setPositions(pos);
    setNames(Object.fromEntries((await allStocks()).map((s) => [s.code, s.name])));
    setPrices(await latestCloses([...new Set(pos.filter((x) => x.status === "open").map((x) => x.code))]));
  }
  useEffect(() => { load(); }, []);

  const amount = (plan ?? draft).capital / (plan ?? draft).parts;
  const open = positions.filter((p) => p.status === "open");
  const closed = positions.filter((p) => p.status === "closed");
  const latestDate = alerts[0]?.date;
  const todays = alerts.filter((a) => a.date === latestDate);
  const invested = open.reduce((s, p) => s + p.buy_price * p.shares, 0);
  const byCode = useMemo(() => {
    const m: Record<string, Position[]> = {};
    positions.filter((p) => p.status === "open").forEach((p) => (m[p.code] ??= []).push(p));
    Object.values(m).forEach((l) => l.sort((a, b) => a.tranche - b.tranche));
    return m;
  }, [positions]);

  function startBuy(code: string, tranche: number, price: number) {
    setForm({ code, tranche, buy_date: today(), buy_price: String(price || ""), shares: String(defaultShares(amount, price)) });
  }

  const setRules = (r: Partial<TrancheRules>) => setDraft((d) => ({ ...d, rules: { ...d.rules, ...r } }));
  const setEntry = (i: number, e: Partial<TrancheRules["entries"][number]>) =>
    setDraft((d) => ({ ...d, rules: { ...d.rules, entries: d.rules.entries.map((x, j) => (j === i ? { ...x, ...e } : x)) } }));
  const setStop = (e: Partial<TrancheRules["stop"]>) => setDraft((d) => ({ ...d, rules: { ...d.rules, stop: { ...d.rules.stop, ...e } } }));

  async function cutStop(a: TradeAlert) {
    const stop = plan?.rules.stop;
    const tr = stop?.tranches ?? [];
    const targets = open.filter((p) => p.code === a.code && tr.includes(p.tranche));
    const trText = tr.map((t) => `第${t}筆`).join("、");
    if (!targets.length) { setMsg(`這檔目前沒有${trText}持倉`); return; }
    const v = window.prompt(`砍掉 ${a.code} ${trText}，賣出價格：`, String(a.price));
    if (!v) return;
    for (const p of targets) await closePosition(p.id, +v, stop?.name || "停損");
    load();
  }

  if (!plan && !editing) {
    return (
      <div className="page-narrow space-y-4">
        <h1 className="text-[22px] font-bold tracking-tight pt-1">分批建倉</h1>
        <div className="card p-4 space-y-2 text-sm">
          <p>把資金分成幾份，每一筆都用<b>你自己設定的條件</b>（和選股策略一樣的條件），每天收盤後自動檢查：</p>
          <ul className="list-disc pl-5 space-y-1 text-muted">
            <li>每一筆的<b className="text-text">進場條件</b>成立時提醒你買進那一筆</li>
            <li>買進後，<b className="text-text">停損條件</b>成立時提醒你砍掉指定的那幾筆</li>
            <li>條件可以用到你在 K 線圖上畫的水平線、箱型，也可以用自動判定的密集成交區箱型</li>
          </ul>
          <p className="text-muted">規則、訊號、持倉都<b className="text-text">只有你自己看得到</b>。</p>
          <button className="btn btn-primary" onClick={() => setEditing(true)}>開始設定</button>
        </div>
      </div>
    );
  }

  return (
    <div className="page-narrow space-y-4">
      <header className="flex items-center pt-2">
        <h1 className="text-[22px] font-bold tracking-tight">分批建倉</h1>
        <span className="ml-2 text-xs text-muted">🔒 只有你看得到</span>
        {plan && !editing && <button className="ml-auto text-accent text-sm" onClick={() => setEditing(true)}>設定</button>}
      </header>

      {editing && (
        <section className="card p-4 space-y-3 text-sm">
          <div className="grid grid-cols-2 gap-3">
            <label className="space-y-1"><div className="text-muted">總資金（元）</div>
              <input className="w-full" type="number" value={draft.capital} onChange={(e) => setDraft({ ...draft, capital: +e.target.value })} /></label>
            <label className="space-y-1"><div className="text-muted">分幾份</div>
              <input className="w-full" type="number" min={1} max={9} value={draft.parts} onChange={(e) => {
                const n = Math.max(1, Math.min(9, +e.target.value || 1));
                const entries = Array.from({ length: n }, (_, i) => draft.rules.entries[i] ?? { name: `第${i + 1}筆`, logic: "AND" as const, conditions: [] });
                setDraft({ ...draft, parts: n, rules: { ...draft.rules, entries } });
              }} /></label>
          </div>
          <div className="text-muted">每份 {money(draft.capital / draft.parts)} 元</div>
          <label className="block space-y-1"><div className="text-muted">檢查哪些股票</div>
            <select className="w-full" value={draft.rules.universe} onChange={(e) => setRules({ universe: e.target.value as TrancheRules["universe"] })}>
              <option value="watch">自選股＋畫過線的股票＋有持倉的股票（建議）</option>
              <option value="all">全市場</option>
            </select></label>
          {draft.rules.entries.map((en, i) => (
            <RuleBlock key={i} templates={templates} logic={en.logic} conds={en.conditions}
              title={<><span className="tag tag-up">第{i + 1}筆</span>
                <input className="flex-1 min-w-[8rem]" value={en.name} placeholder={`第${i + 1}筆`} onChange={(e) => setEntry(i, { name: e.target.value })} /></>}
              onChange={(logic, conditions) => setEntry(i, { logic, conditions })} />
          ))}
          <RuleBlock templates={templates} logic={draft.rules.stop.logic} conds={draft.rules.stop.conditions}
            title={<><span className="tag tag-down">停損</span>
              <input className="flex-1 min-w-[8rem]" value={draft.rules.stop.name} onChange={(e) => setStop({ name: e.target.value })} /></>}
            extra={<div className="flex items-center gap-3 flex-wrap text-xs"><span className="text-muted">適用</span>
              {draft.rules.entries.map((_, i) => (
                <label key={i} className="flex items-center gap-1"><input type="checkbox" checked={draft.rules.stop.tranches.includes(i + 1)} onChange={(e) => {
                  const t = new Set(draft.rules.stop.tranches); if (e.target.checked) t.add(i + 1); else t.delete(i + 1);
                  setStop({ tranches: [...t].sort() });
                }} />第{i + 1}筆</label>))}
              <span className="text-muted">（買進隔天起才檢查）</span></div>}
            onChange={(logic, conditions) => setStop({ logic, conditions })} />
          <p className="text-xs text-muted">條件留空的那一筆不會提醒。用到「自己畫的線」的條件，只會看你自己畫的水平線、箱型。</p>
          <label className="flex items-center gap-2"><input type="checkbox" checked={draft.notify} onChange={(e) => setDraft({ ...draft, notify: e.target.checked })} />有訊號時推播通知</label>
          <div className="flex gap-2">
            {plan && <button className="btn flex-1" onClick={() => { setDraft(plan); setEditing(false); }}>取消</button>}
            <button className="btn btn-primary flex-1" onClick={async () => { await savePlan(draft); setEditing(false); load(); }}>儲存</button>
          </div>
        </section>
      )}

      {plan && (
        <>
          <section className="grid grid-cols-3 gap-2 text-center">
            <div className="card p-2"><div className="text-[11px] text-muted">總資金</div><div className="font-bold">{money(plan.capital)}</div></div>
            <div className="card p-2"><div className="text-[11px] text-muted">已投入</div><div className="font-bold text-accent">{money(invested)}</div></div>
            <div className="card p-2"><div className="text-[11px] text-muted">每份</div><div className="font-bold">{money(amount)}</div></div>
          </section>

          <section>
            <h2 className="text-sm text-muted mb-2">最新訊號 {latestDate && `（${latestDate}）`}</h2>
            {todays.length === 0 && (
              <p className="text-sm text-muted">目前沒有訊號。每個交易日收盤後依你的規則更新。</p>
            )}
            <div className="space-y-2">
              {todays.map((a) => {
                const k = kindOf(a.kind, plan.rules);
                return (
                  <div key={a.id} className="card p-3 text-sm space-y-2">
                    <div className="flex items-center gap-2">
                      <span className={`px-2 py-0.5 rounded text-xs ${k.cls}`}>{k.label}</span>
                      <Link href={`/stock/${a.code}`} className="font-bold">{a.code} {names[a.code]}</Link>
                      <span className="ml-auto tabular-nums">{a.price.toFixed(2)}</span>
                    </div>
                    <div className="text-muted text-xs">{a.message.replace(/^\S+ \S+：/, "")}</div>
                    {k.tranche ? (
                      <button className="btn btn-primary text-xs" onClick={() => startBuy(a.code, k.tranche!, a.price)}>記錄買進第{k.tranche}筆</button>
                    ) : (
                      <button className="btn text-xs" onClick={() => cutStop(a)}>記錄砍掉{plan.rules.stop.tranches.map((t) => `第${t}筆`).join("、")}</button>
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          <section>
            <div className="flex items-center mb-2">
              <h2 className="text-sm text-muted">持倉</h2>
              <button className="ml-auto text-accent text-sm" onClick={() => setForm({ code: "", tranche: 1, buy_date: today(), buy_price: "", shares: "" })}>＋ 手動記錄買進</button>
            </div>
            {open.length === 0 && <p className="text-sm text-muted">還沒有持倉。</p>}
            <div className="space-y-2">
              {Object.entries(byCode).map(([code, list]) => {
                const px = prices[code]?.close;
                const cost = list.reduce((s, p) => s + p.buy_price * p.shares, 0);
                const sh = list.reduce((s, p) => s + p.shares, 0);
                const pl = px ? px * sh - cost : 0;
                return (
                  <div key={code} className="card p-3 text-sm">
                    <div className="flex items-center mb-1">
                      <Link href={`/stock/${code}`} className="font-bold">{code} {names[code]}</Link>
                      <span className="ml-2 text-xs text-muted">現價 {px?.toFixed(2) ?? "-"}</span>
                      <span className={`ml-auto tabular-nums ${pl > 0 ? "up" : pl < 0 ? "down" : ""}`}>
                        {pl > 0 ? "+" : ""}{money(pl)}（{cost ? ((pl / cost) * 100).toFixed(2) : "0"}%）
                      </span>
                    </div>
                    <table className="tbl">
                      <thead><tr><th>筆</th><th>買進日</th><th>價格</th><th>股數</th><th>損益%</th><th></th></tr></thead>
                      <tbody>
                        {list.map((p) => {
                          const r = px ? ((px - p.buy_price) / p.buy_price) * 100 : 0;
                          return (
                            <tr key={p.id}>
                              <td>第{p.tranche}筆</td><td>{p.buy_date.slice(5)}</td><td>{p.buy_price.toFixed(2)}</td>
                              <td>{p.shares.toLocaleString()}</td>
                              <td className={r > 0 ? "up" : r < 0 ? "down" : ""}>{r.toFixed(2)}</td>
                              <td><button className="text-muted text-xs" onClick={async () => {
                                const v = window.prompt("賣出價格：", String(px ?? p.buy_price));
                                if (!v) return;
                                const why = window.prompt("原因（例如：停損、獲利了結）：", "獲利了結") ?? "";
                                await closePosition(p.id, +v, why); load();
                              }}>賣出</button></td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    {list.length < plan.parts && (
                      <div className="text-xs text-muted mt-1">
                        尚未買進：{Array.from({ length: plan.parts }, (_, i) => i + 1).filter((t) => !list.some((p) => p.tranche === t)).map((t) => `第${t}筆`).join("、")}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          <section>
            <button className="text-sm text-muted" onClick={() => setShowClosed(!showClosed)}>{showClosed ? "▾" : "▸"} 已出場紀錄（{closed.length}）</button>
            {showClosed && (
              <table className="tbl mt-2">
                <thead><tr><th>股票</th><th>筆</th><th>買</th><th>賣</th><th>損益%</th><th>原因</th><th></th></tr></thead>
                <tbody>
                  {closed.map((p) => {
                    const r = p.close_price ? ((p.close_price - p.buy_price) / p.buy_price) * 100 : 0;
                    return (
                      <tr key={p.id}>
                        <td>{p.code}</td><td>{p.tranche}</td><td>{p.buy_price.toFixed(2)}</td><td>{p.close_price?.toFixed(2)}</td>
                        <td className={r > 0 ? "up" : r < 0 ? "down" : ""}>{r.toFixed(2)}</td>
                        <td className="text-left! truncate max-w-[6rem]">{p.close_reason}</td>
                        <td><button className="text-muted text-xs" onClick={async () => { if (confirm("刪除這筆紀錄？")) { await deletePosition(p.id); load(); } }}>刪除</button></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </section>

          <p className="text-xs text-muted">提醒只是依照你設定的規則自動檢查，不構成投資建議；實際買賣請自行判斷。</p>
        </>
      )}

      {form && (
        <div className="modal-wrap" onClick={() => setForm(null)}>
          <div className="modal space-y-3" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-bold">記錄買進</h3>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <label className="space-y-1"><div className="text-muted">股票代號</div>
                <input className="w-full" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.trim() })} /></label>
              <label className="space-y-1"><div className="text-muted">第幾筆</div>
                <select className="w-full" value={form.tranche} onChange={(e) => setForm({ ...form, tranche: +e.target.value })}>
                  {Array.from({ length: plan?.parts ?? 3 }, (_, i) => i + 1).map((t) => <option key={t} value={t}>第{t}筆</option>)}
                </select></label>
              <label className="space-y-1"><div className="text-muted">買進日</div>
                <input className="w-full" type="date" value={form.buy_date} onChange={(e) => setForm({ ...form, buy_date: e.target.value })} /></label>
              <label className="space-y-1"><div className="text-muted">買進價</div>
                <input className="w-full" type="number" step="0.01" value={form.buy_price}
                  onChange={(e) => setForm({ ...form, buy_price: e.target.value, shares: String(defaultShares(amount, +e.target.value)) })} /></label>
              <label className="space-y-1 col-span-2"><div className="text-muted">股數（1 張 = 1000 股）</div>
                <input className="w-full" type="number" value={form.shares} onChange={(e) => setForm({ ...form, shares: e.target.value })} /></label>
            </div>
            <div className="text-xs text-muted">金額約 {money(+form.buy_price * +form.shares)} 元（每份 {money(amount)} 元）</div>
            {msg && <div className="text-xs up">{msg}</div>}
            <div className="flex gap-2">
              <button className="btn flex-1" onClick={() => setForm(null)}>取消</button>
              <button className="btn btn-primary flex-1" onClick={async () => {
                if (!form.code || !+form.buy_price || !+form.shares) { setMsg("請填股票代號、價格和股數"); return; }
                await addPosition({ code: form.code, tranche: form.tranche, buy_date: form.buy_date, buy_price: +form.buy_price, shares: +form.shares });
                setForm(null); setMsg(""); load();
              }}>儲存</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
