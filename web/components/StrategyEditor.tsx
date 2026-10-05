"use client";
import { useEffect, useState } from "react";
import type { CondKind, Condition, Src, Strategy } from "@/lib/data";
import { PRESETS, presetStrategy } from "@/lib/presets";
import { deleteTemplate, getTemplates, saveTemplate, type Template } from "@/lib/data";
import Icon from "@/components/ui/Icon";

const TFS = [["1m", "1分"], ["3m", "3分"], ["5m", "5分"], ["15m", "15分"], ["30m", "30分"], ["60m", "60分"], ["D", "日"], ["W", "週"], ["M", "月"]];
const SRCS = [
  ["close", "收盤價"], ["open", "開盤價"], ["high", "最高價"], ["low", "最低價"], ["volume", "成交量(張)"],
  ["ma", "均線 MA(n)"], ["volma", "均量 (n)"], ["k", "K 值"], ["d", "D 值"], ["rsi", "RSI(n)"],
  ["dif", "MACD DIF"], ["macd", "MACD 訊號線"], ["osc", "MACD 柱"], ["bias", "乖離率(n)"],
  ["boll_up", "布林上軌"], ["boll_mid", "布林中線"], ["boll_dn", "布林下軌"], ["value", "數值"],
];
const NEEDS_N = new Set(["ma", "volma", "rsi", "bias", "boll_up", "boll_mid", "boll_dn"]);
const IS_KD = new Set(["k", "d"]);
const IS_BOLL = new Set(["boll_up", "boll_mid", "boll_dn"]);
const OPS = [">", ">=", "<", "<="];
const WHO = [["foreign", "外資"], ["trust", "投信"], ["dealer", "自營商"], ["total", "三大法人"]];
const KINDS: [CondKind, string][] = [
  ["compare", "比較（例：60分K 收盤 > MA60、K > 50）"],
  ["cross", "交叉（例：K 黃金交叉 D）"],
  ["deduct", "均線扣抵（扣低 → 均線易上揚）"],
  ["deduct3low", "月扣三低（站上 / 突破扣三低線）"],
  ["volratio", "量比（今日量 / N 期均量）"],
  ["ma_align", "均線多頭 / 空頭排列"],
  ["ma_tangle", "均線糾結"],
  ["ma_turn", "均線翻揚 / 走平"],
  ["range", "區間振幅"],
  ["change", "漲跌幅"],
  ["new_high", "創 N 日新高 / 新低"],
  ["inst", "法人連續買賣超"],
  ["inst_ratio", "法人買超天數比例"],
  ["inst_rank", "法人買超 / 賣超排行前 N 名"],
  ["inst_turn", "法人連續賣超後轉為買方（或反過來）"],
  ["mainforce", "主力買賣超（分點）"],
  ["broker_conc", "關鍵券商買超佔成交量"],
  ["div_yield", "平均現金殖利率"],
  ["net_margin", "稅後淨利率（每年 / 平均）"],
  ["board_pct", "董監事持股比例"],
  ["op_ratio", "最新一季營業利益占稅前利益"],
  ["universe", "股票範圍（上市 / 上櫃、排除 ETF）"],
  ["market", "大盤條件（加權指數）"],
  ["vp_box", "箱型：密集成交區（盤整 / 箱底不破 / 突破箱頂 / 跌破箱底）"],
  ["gap_break", "型態：跳空突破區間頂部"],
  ["box_bottom", "型態：箱型區間底部不破"],
  ["support_touch", "型態：回測支撐位"],
  ["in_group", "在自訂族群裡（例：AI 伺服器）"],
  ["group", "條件群組（可以做「① 或 ② 或 ③」）"],
  ["unsupported", "（暫無資料的條件，不影響結果）"],
];
const SOURCES = [["both", "自動偵測＋我畫的"], ["auto", "只用自動偵測"], ["mine", "只用我畫的線"]];

function defaults(kind: CondKind): Condition {
  switch (kind) {
    case "compare": return { kind, tf: "60m", left: { src: "close" }, op: ">", right: { src: "ma", n: 60 } };
    case "cross": return { kind, tf: "60m", a: { src: "k" }, dir: "up", b: { src: "d" } };
    case "deduct": return { kind, tf: "D", n: 20, dir: "low" };
    case "deduct3low": return { kind, tf: "M", n: 5, mode: "break" };
    case "volratio": return { kind, tf: "D", n: 5, op: ">", v: 1.5 };
    case "inst": return { kind, who: "foreign", days: 3, dir: "buy" };
    case "mainforce": return { kind, days: 1, op: ">", v: 0 };
    case "ma_align": return { kind, tf: "D", ns: [10, 20, 60], dir: "bull" };
    case "ma_tangle": return { kind, tf: "D", ns: [20, 60, 120, 240], pct: 10 };
    case "ma_turn": return { kind, tf: "D", n: 120, lookback: 5, dir: "up" };
    case "range": return { kind, tf: "D", n: 60, op: "<", pct: 20 };
    case "change": return { kind, tf: "D", op: ">", pct: 7 };
    case "new_high": return { kind, tf: "D", n: 60, dir: "high" };
    case "inst_ratio": return { kind, who: "foreign", days: 20, op: ">=", pct: 70 };
    case "broker_conc": return { kind, days: 10, op: ">=", pct: 5 };
    case "div_yield": return { kind, years: 5, op: ">", pct: 3 };
    case "net_margin": return { kind, years: 5, op: ">", pct: 10, mode: "avg" };
    case "inst_rank": return { kind, who: "foreign", days: 20, dir: "buy", top: 100 };
    case "inst_turn": return { kind, who: "trust", days: 3, within: 3, dir: "buy" };
    case "board_pct": return { kind, op: ">", pct: 20 };
    case "op_ratio": return { kind, op: ">", pct: 50 };
    case "universe": return { kind, type: "stock", market: "all" };
    case "market": return { kind, left: { src: "close" }, op: "<", right: { src: "ma", n: 60 } };
    case "unsupported": return { kind, label: "" };
    case "gap_break": return { kind, tf: "D", n: 20, source: "both" };
    case "vp_box": return { kind, tf: "D", mode: "break_top", n: 60, va: 70, max_height: 20, inside: 70, zone: 20, tol: 1, vol: 1.5 };
    case "box_bottom": return { kind, tf: "D", n: 60, max_range: 25, zone: 20, tol: 1, source: "both" };
    case "support_touch": return { kind, tf: "D", n: 60, skip: 5, tol: 2, source: "both" };
    case "in_group": return { kind, names: [] };
    case "group": return { kind, label: "", logic: "AND", conditions: [defaults("compare")] };
  }
}

/** 數字欄位：寬度跟著數字長度（不會把字擠掉），數字用黃色 */
const Num = ({ v, set, step }: { v: number | undefined; set: (n: number) => void; w?: string; step?: string }) => {
  const [txt, setTxt] = useState(String(v ?? 0));
  useEffect(() => { if (+txt !== (v ?? 0)) setTxt(String(v ?? 0)); }, [v]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <input className="tok tok-num" type="number" inputMode={step === "1" ? "numeric" : "decimal"} step={step ?? "any"}
      style={{ width: `calc(${Math.max(2, txt.length)}ch + 22px)` }} value={txt}
      onFocus={(e) => e.target.select()}
      onChange={(e) => { setTxt(e.target.value); if (e.target.value !== "" && !isNaN(+e.target.value)) set(+e.target.value); }}
      onBlur={() => { if (txt === "" || isNaN(+txt)) setTxt(String(v ?? 0)); }} />
  );
};
const Op = ({ v, set }: { v: string | undefined; set: (s: string) => void }) =>
  <select className="tok" value={v ?? ">"} onChange={(e) => set(e.target.value)}>{OPS.map((o) => <option key={o}>{o}</option>)}</select>;
const Who = ({ v, set }: { v: string | undefined; set: (s: string) => void }) =>
  <select className="tok" value={v ?? "foreign"} onChange={(e) => set(e.target.value)}>{WHO.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>;
const Ns = ({ v, set }: { v: number[] | undefined; set: (n: number[]) => void }) => {
  const [txt, setTxt] = useState((v ?? []).join(","));
  return <input className="tok tok-num" style={{ width: `calc(${Math.max(8, txt.length)}ch + 22px)` }} value={txt} placeholder="20,60,120,240"
    onChange={(e) => { setTxt(e.target.value); const a = e.target.value.split(/[,，\s]+/).map(Number).filter((x) => x > 0); if (a.length >= 2) set(a); }} />;
};

function SrcPick({ v, onChange }: { v: Src; onChange: (s: Src) => void }) {
  const kdKey = (v.p ?? [9, 3, 3]).join(",");
  return (
    <span className="inline-flex gap-1 flex-wrap">
      <select className="tok" value={v.src} onChange={(e) => {
        const src = e.target.value;
        onChange({ src, n: NEEDS_N.has(src) ? v.n ?? (IS_BOLL.has(src) ? 20 : 20) : undefined, v: src === "value" ? v.v ?? 0 : undefined,
          p: IS_KD.has(src) ? v.p : undefined, k: IS_BOLL.has(src) ? v.k ?? 2 : undefined });
      }}>
        {SRCS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
      </select>
      {NEEDS_N.has(v.src) && <Num v={v.n ?? 20} set={(n) => onChange({ ...v, n })} w="w-16" step="1" />}
      {IS_BOLL.has(v.src) && <><span>×</span><Num v={v.k ?? 2} set={(k) => onChange({ ...v, k })} w="w-14" step="0.1" /></>}
      {IS_KD.has(v.src) && (
        <select className="tok" value={kdKey} title="KD 參數" onChange={(e) => onChange({ ...v, p: e.target.value === "9,3,3" ? undefined : e.target.value.split(",").map(Number) })}>
          {["9,3,3", "60,3,3", "5,3,3", "14,3,3", "36,3,3"].map((k) => <option key={k} value={k}>KD({k})</option>)}
        </select>
      )}
      {v.src === "value" && <Num v={v.v ?? 0} set={(x) => onChange({ ...v, v: x })} w="w-20" />}
    </span>
  );
}

function TfPick({ v, onChange }: { v: string | undefined; onChange: (s: string) => void }) {
  return <select className="tok" value={v ?? "D"} onChange={(e) => onChange(e.target.value)}>{TFS.map(([k, l]) => <option key={k} value={k}>{l}K</option>)}</select>;
}

const Source = ({ v, set }: { v: string | undefined; set: (s: Condition["source"]) => void }) =>
  <select className="tok" value={v ?? "both"} onChange={(e) => set(e.target.value as Condition["source"])}>{SOURCES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>;

function Names({ v, set }: { v: string[] | undefined; set: (n: string[]) => void }) {
  const [txt, setTxt] = useState((v ?? []).join("、"));
  return <input className="tok flex-1 min-w-[10rem]" value={txt} placeholder="族群名稱，多個用頓號分開"
    onChange={(e) => { setTxt(e.target.value); set(e.target.value.split(/[、,，]+/).map((x) => x.trim()).filter(Boolean)); }} />;
}

const KIND_SHORT = Object.fromEntries(KINDS.map(([k, l]) => [k, l.split("（")[0]])) as Record<CondKind, string>;
const KIND_HINT = Object.fromEntries(KINDS.map(([k, l]) => [k, l.includes("（") ? l.slice(l.indexOf("（") + 1).replace(/）$/, "") : ""])) as Record<CondKind, string>;

/** 條件清單（最外層與群組裡共用）：每條一張卡片，上面是條件種類、下面是一句可以改數字的句子 */
export function CondList({ conds, setConds, depth = 0 }: { conds: Condition[]; setConds: (c: Condition[]) => void; depth?: number }) {
  const [ver, setVer] = useState(0);
  const move = (i: number, d: number) => {
    const j = i + d; if (j < 0 || j >= conds.length) return;
    const a = [...conds]; [a[i], a[j]] = [a[j], a[i]]; setConds(a); setVer(ver + 1);
  };
  return (
    <div className="space-y-2.5 w-full">
      {conds.map((c, i) => (
        <div key={`${ver}-${i}-${c.kind}`}
          className={`rounded-2xl border ${c.kind === "group" ? "border-accent/50 bg-[var(--accent-bg)]" : "border-line bg-panel"} ${depth ? "" : "shadow-[0_1px_0_rgba(0,0,0,.2)]"}`}>
          <div className="flex items-center gap-2 pl-3 pr-1.5 pt-2.5">
            <span className="w-6 h-6 rounded-full bg-panel-2 text-[12px] font-semibold text-muted flex items-center justify-center num shrink-0">{i + 1}</span>
            {/* 條件種類：看起來是標題，點一下可以換（下面疊一個透明的原生選單，手機會跳系統選單） */}
            <label className="flex-1 min-w-0 relative flex items-center gap-1 cursor-pointer">
              <span className="font-semibold text-[16px] truncate">{KIND_SHORT[c.kind]}</span>
              <Icon name="down" className="w-3.5 h-3.5 text-muted shrink-0" stroke={2.4} />
              <select className="absolute inset-0 opacity-0 cursor-pointer" value={c.kind} aria-label="條件種類"
                onChange={(e) => setConds(conds.map((x, j) => (j === i ? defaults(e.target.value as CondKind) : x)))}>
                {KINDS.filter(([k]) => k !== "group" || depth < 3).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </label>
            <div className="flex items-center shrink-0">
              {conds.length > 1 && <>
                <button className="icon-btn !w-8 !h-8" title="往上移" disabled={i === 0} onClick={() => move(i, -1)}><Icon name="up" className="w-4 h-4" /></button>
                <button className="icon-btn !w-8 !h-8" title="往下移" disabled={i === conds.length - 1} onClick={() => move(i, 1)}><Icon name="down" className="w-4 h-4" /></button>
              </>}
              <button className="icon-btn !w-8 !h-8 hover:!text-up" title="刪除這條" onClick={() => { setConds(conds.filter((_, j) => j !== i)); setVer(ver + 1); }}>
                <Icon name="close" className="w-4 h-4" />
              </button>
            </div>
          </div>
          {KIND_HINT[c.kind] && <div className="text-[12px] text-muted pl-11 pr-3 -mt-0.5">{KIND_HINT[c.kind]}</div>}
          <div className="sentence px-3 pb-3 pt-2.5">
            <Row c={c} depth={depth} set={(nc) => setConds(conds.map((x, j) => (j === i ? nc : x)))} />
          </div>
        </div>
      ))}
      <button className={`w-full rounded-2xl border border-dashed border-line text-accent font-medium flex items-center justify-center gap-1.5 hover:bg-panel-2 transition-colors ${depth ? "py-2 text-sm" : "py-3"}`}
        onClick={() => setConds([...conds, defaults("compare")])}>
        <Icon name="plus" className="w-4 h-4" stroke={2.4} /> 新增條件
      </button>
    </div>
  );
}

function Row({ c, set, depth = 0 }: { c: Condition; set: (c: Condition) => void; depth?: number }) {
  const tf = <TfPick v={c.tf} onChange={(x) => set({ ...c, tf: x })} />;
  switch (c.kind) {
    case "compare":
      return <>{tf}<SrcPick v={c.left!} onChange={(left) => set({ ...c, left })} /><Op v={c.op} set={(op) => set({ ...c, op })} />
        <SrcPick v={c.right!} onChange={(right) => set({ ...c, right })} /></>;
    case "cross":
      return <>{tf}<SrcPick v={c.a!} onChange={(a) => set({ ...c, a })} />
        <select className="tok" value={c.dir} onChange={(e) => set({ ...c, dir: e.target.value })}><option value="up">往上穿過</option><option value="down">往下跌破</option></select>
        <SrcPick v={c.b!} onChange={(b) => set({ ...c, b })} /></>;
    case "deduct":
      return <>{tf}<span>MA</span><Num v={c.n} set={(n) => set({ ...c, n })} step="1" />
        <select className="tok" value={c.dir} onChange={(e) => set({ ...c, dir: e.target.value })}><option value="low">扣低（扣抵值 &lt; 收盤）</option><option value="high">扣高（扣抵值 &gt; 收盤）</option></select></>;
    case "deduct3low":
      return <><span>月K MA</span><Num v={c.n} set={(n) => set({ ...c, n })} step="1" />
        <select className="tok" value={c.mode ?? "above"} onChange={(e) => set({ ...c, mode: e.target.value })}>
          <option value="break">今天日K 收盤突破扣三低線</option><option value="above">收盤在扣三低線之上（成立）</option></select></>;
    case "volratio":
      return <>{tf}<span>量 / </span><Num v={c.n} set={(n) => set({ ...c, n })} w="w-14" step="1" /><span>期均量</span>
        <Op v={c.op} set={(op) => set({ ...c, op })} /><Num v={c.v} set={(v) => set({ ...c, v })} step="0.1" /><span>倍</span></>;
    case "inst":
      return <><Who v={c.who} set={(who) => set({ ...c, who })} />
        <span>連續</span><Num v={c.days} set={(days) => set({ ...c, days })} w="w-14" step="1" /><span>日</span>
        <select className="tok" value={c.dir} onChange={(e) => set({ ...c, dir: e.target.value })}><option value="buy">買超</option><option value="sell">賣超</option></select></>;
    case "mainforce":
      return <><span>近</span><Num v={c.days} set={(days) => set({ ...c, days })} w="w-14" step="1" /><span>日主力合計</span>
        <Op v={c.op} set={(op) => set({ ...c, op })} /><Num v={c.v} set={(v) => set({ ...c, v })} w="w-20" /><span>張</span></>;
    case "ma_align":
      return <>{tf}<span>均線</span><Ns v={c.ns} set={(ns) => set({ ...c, ns })} />
        <select className="tok" value={c.dir} onChange={(e) => set({ ...c, dir: e.target.value })}><option value="bull">多頭排列（短 &gt; 長）</option><option value="bear">空頭排列（短 &lt; 長）</option></select></>;
    case "ma_tangle":
      return <>{tf}<span>均線</span><Ns v={c.ns} set={(ns) => set({ ...c, ns })} /><span>最大最小差距 ≤</span>
        <Num v={c.pct} set={(pct) => set({ ...c, pct })} w="w-14" /><span>%</span></>;
    case "ma_turn":
      return <>{tf}<span>MA</span><Num v={c.n} set={(n) => set({ ...c, n })} w="w-16" step="1" />
        <select className="tok" value={c.dir} onChange={(e) => set({ ...c, dir: e.target.value })}><option value="up">翻揚（由彎轉上）</option><option value="flat">走平</option></select>
        <span>看近</span><Num v={c.lookback} set={(lookback) => set({ ...c, lookback })} w="w-14" step="1" /><span>根</span></>;
    case "range":
      return <>{tf}<span>近</span><Num v={c.n} set={(n) => set({ ...c, n })} w="w-14" step="1" /><span>根振幅</span>
        <Op v={c.op} set={(op) => set({ ...c, op })} /><Num v={c.pct} set={(pct) => set({ ...c, pct })} w="w-14" /><span>%</span></>;
    case "change":
      return <>{tf}<span>漲跌幅</span><Op v={c.op} set={(op) => set({ ...c, op })} /><Num v={c.pct} set={(pct) => set({ ...c, pct })} w="w-14" /><span>%</span></>;
    case "new_high":
      return <>{tf}<span>創</span><Num v={c.n} set={(n) => set({ ...c, n })} w="w-14" step="1" /><span>根</span>
        <select className="tok" value={c.dir} onChange={(e) => set({ ...c, dir: e.target.value })}><option value="high">新高</option><option value="low">新低</option></select></>;
    case "inst_ratio":
      return <><span>近</span><Num v={c.days} set={(days) => set({ ...c, days })} w="w-14" step="1" /><span>日</span>
        <Who v={c.who} set={(who) => set({ ...c, who })} /><span>買超天數</span>
        <Op v={c.op} set={(op) => set({ ...c, op })} /><Num v={c.pct} set={(pct) => set({ ...c, pct })} w="w-14" /><span>%</span></>;
    case "broker_conc":
      return <><span>近</span><Num v={c.days} set={(days) => set({ ...c, days })} w="w-14" step="1" /><span>日關鍵券商買超 / 成交量</span>
        <Op v={c.op} set={(op) => set({ ...c, op })} /><Num v={c.pct} set={(pct) => set({ ...c, pct })} w="w-14" /><span>%</span>
        <span className="text-xs text-muted w-full">主力 = 每天全市場分點買超前 15 名合計</span></>;
    case "div_yield":
      return <><span>近</span><Num v={c.years} set={(years) => set({ ...c, years })} w="w-14" step="1" /><span>年平均現金殖利率</span>
        <Op v={c.op} set={(op) => set({ ...c, op })} /><Num v={c.pct} set={(pct) => set({ ...c, pct })} w="w-14" /><span>%</span></>;
    case "inst_rank":
      return <><Who v={c.who} set={(who) => set({ ...c, who })} /><span>近</span><Num v={c.days} set={(days) => set({ ...c, days })} w="w-14" step="1" />
        <span>日</span><select className="tok" value={c.dir ?? "buy"} onChange={(e) => set({ ...c, dir: e.target.value })}><option value="buy">買超</option><option value="sell">賣超</option></select>
        <span>排行前</span><Num v={c.top} set={(top) => set({ ...c, top })} w="w-16" step="1" /><span>名（全市場）</span></>;
    case "inst_turn":
      return <><Who v={c.who} set={(who) => set({ ...c, who })} /><span>近期連續</span>
        <select className="tok" value={c.dir ?? "buy"} onChange={(e) => set({ ...c, dir: e.target.value })}><option value="buy">賣超</option><option value="sell">買超</option></select>
        <Num v={c.days} set={(days) => set({ ...c, days })} w="w-14" step="1" /><span>天以上，近</span>
        <Num v={c.within} set={(within) => set({ ...c, within })} w="w-14" step="1" /><span>日內轉為{c.dir === "sell" ? "賣方" : "買方"}</span></>;
    case "board_pct":
      return <><span>董監事持股比例</span><Op v={c.op} set={(op) => set({ ...c, op })} /><Num v={c.pct} set={(pct) => set({ ...c, pct })} w="w-14" /><span>%</span></>;
    case "op_ratio":
      return <><span>最新一季 營業利益占稅前利益</span><Op v={c.op} set={(op) => set({ ...c, op })} /><Num v={c.pct} set={(pct) => set({ ...c, pct })} w="w-14" /><span>%</span></>;
    case "net_margin":
      return <><span>近</span><Num v={c.years} set={(years) => set({ ...c, years })} w="w-14" step="1" /><span>年稅後淨利率</span>
        <select className="tok" value={c.mode ?? "every"} onChange={(e) => set({ ...c, mode: e.target.value })}><option value="avg">平均</option><option value="every">每年都要</option></select>
        <Op v={c.op} set={(op) => set({ ...c, op })} /><Num v={c.pct} set={(pct) => set({ ...c, pct })} w="w-14" /><span>%</span></>;
    case "universe":
      return <><select className="tok" value={c.market} onChange={(e) => set({ ...c, market: e.target.value })}>
          <option value="all">上市 + 上櫃</option><option value="TWSE">只要上市</option><option value="TPEX">只要上櫃</option></select>
        <select className="tok" value={c.type} onChange={(e) => set({ ...c, type: e.target.value })}><option value="stock">只要個股（排除 ETF）</option><option value="all">含 ETF</option></select></>;
    case "market":
      return <><span>加權指數（日K）</span><SrcPick v={c.left!} onChange={(left) => set({ ...c, left })} /><Op v={c.op} set={(op) => set({ ...c, op })} />
        <SrcPick v={c.right!} onChange={(right) => set({ ...c, right })} /></>;
    case "vp_box":
      return <>{tf}
        <select className="tok" value={c.mode ?? "inside"} onChange={(e) => set({ ...c, mode: e.target.value })}>
          <option value="inside">箱內盤整</option><option value="bottom">箱底不破</option>
          <option value="break_top">突破箱頂</option><option value="break_bottom">跌破箱底（做空）</option></select>
        <span>箱型 = 前</span><Num v={c.n} set={(n) => set({ ...c, n })} w="w-14" step="1" /><span>根、包住</span>
        <Num v={c.va} set={(va) => set({ ...c, va })} w="w-14" /><span>% 成交量，箱高 ≤</span>
        <Num v={c.max_height} set={(max_height) => set({ ...c, max_height })} w="w-14" /><span>%</span>
        {c.mode === "inside" && <><span className="basis-full h-0" /><span>前 n 根有</span><Num v={c.inside} set={(inside) => set({ ...c, inside })} w="w-14" /><span>% 天數收在箱內</span></>}
        {c.mode === "bottom" && <><span className="basis-full h-0" /><span>收盤在箱底上方</span><Num v={c.zone} set={(zone) => set({ ...c, zone })} w="w-14" />
          <span>% 箱高內，最低不破箱底（容許</span><Num v={c.tol} set={(tol) => set({ ...c, tol })} w="w-12" /><span>%）</span></>}
        {(c.mode === "break_top" || c.mode === "break_bottom") && <><span className="basis-full h-0" /><span>成交量 &gt; 前 n 根均量</span>
          <Num v={c.vol} set={(vol) => set({ ...c, vol })} w="w-14" step="0.1" /><span>倍（0 = 不看量）</span></>}
      </>;
    case "gap_break":
      return <>{tf}<span>今天跳空（最低 &gt; 昨天最高）並突破</span><Source v={c.source} set={(source) => set({ ...c, source })} />
        <span>的區間頂部／壓力</span><span className="basis-full h-0" /><span>自動 = 前</span><Num v={c.n} set={(n) => set({ ...c, n })} w="w-14" step="1" /><span>根最高</span></>;
    case "box_bottom":
      return <>{tf}<Source v={c.source} set={(source) => set({ ...c, source })} /><span>箱型：自動 = 前</span>
        <Num v={c.n} set={(n) => set({ ...c, n })} w="w-14" step="1" /><span>根、振幅 ≤</span><Num v={c.max_range} set={(max_range) => set({ ...c, max_range })} w="w-14" /><span>%</span><span className="basis-full h-0" />
        <span>收盤在箱底上方</span><Num v={c.zone} set={(zone) => set({ ...c, zone })} w="w-14" /><span>% 箱高內，最低不破箱底（容許</span>
        <Num v={c.tol} set={(tol) => set({ ...c, tol })} w="w-12" /><span>%）</span></>;
    case "support_touch":
      return <>{tf}<Source v={c.source} set={(source) => set({ ...c, source })} /><span>支撐：自動 = 近</span>
        <Num v={c.n} set={(n) => set({ ...c, n })} w="w-14" step="1" /><span>根前波低點（排除最近</span><Num v={c.skip} set={(skip) => set({ ...c, skip })} w="w-12" step="1" />
        <span>根）</span><span className="basis-full h-0" /><span>今天最低回測到支撐</span><Num v={c.tol} set={(tol) => set({ ...c, tol })} w="w-12" /><span>% 內、收盤守住</span></>;
    case "in_group":
      return <><span>在自訂族群</span><Names v={c.names} set={(names) => set({ ...c, names })} />
        <span className="text-xs text-muted w-full">族群還沒有股票時這條不作用；到選股頁「自訂族群」加入股票</span></>;
    case "group":
      return <>
        <input className="tok w-40" placeholder="標籤（例：① 突破）" value={c.label ?? ""} onChange={(e) => set({ ...c, label: e.target.value })} />
        <select className="tok" value={c.logic ?? "AND"} onChange={(e) => set({ ...c, logic: e.target.value as "AND" | "OR" })}>
          <option value="AND">群組內全部成立</option><option value="OR">群組內任一成立</option></select>
        <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={!!c.tag_only} onChange={(e) => set({ ...c, tag_only: e.target.checked })} />只標示型態（不影響選出）</label>
        <div className="w-full pt-1">
          <CondList conds={c.conditions ?? []} setConds={(conditions) => set({ ...c, conditions })} depth={depth + 1} />
        </div>
      </>;
    case "unsupported":
      return <input className="tok flex-1" placeholder="說明（例：董監持股比率 > 20%）" value={c.label ?? ""} onChange={(e) => set({ ...c, label: e.target.value })} />;
  }
}

export default function StrategyEditor({ initial, onSave, onCancel }: {
  initial?: Pick<Strategy, "name" | "conditions"> & Partial<Strategy>; onSave: (s: { id?: string; name: string; notify: boolean; conditions: Strategy["conditions"] }) => Promise<void>; onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [notify, setNotify] = useState(initial?.notify ?? true);
  const [logic, setLogic] = useState<"AND" | "OR">(initial?.conditions.logic ?? "AND");
  const [conds, setConds] = useState<Condition[]>(initial?.conditions.conditions ?? [defaults("compare")]);
  const [note, setNote] = useState(initial?.conditions.note ?? "");
  const [busy, setBusy] = useState(false);
  const [ver, setVer] = useState(0); // 換範本 / 刪除時讓輸入框重新載入
  const isNew = !initial?.id;
  const [mine, setMine] = useState<Template[]>([]);
  const [msg, setMsg] = useState("");
  useEffect(() => { getTemplates().then(setMine).catch(() => {}); }, []);

  function apply(p: Pick<Strategy, "name" | "conditions">) {
    setName(p.name); setLogic(p.conditions.logic ?? "AND"); setConds(structuredClone(p.conditions.conditions));
    setNote(p.conditions.note ?? ""); setVer((v) => v + 1);
  }
  const pick = (p: Pick<Strategy, "name" | "conditions">) => {
    if (isNew || confirm(`用「${p.name}」範本覆蓋目前的條件？`)) apply(p);
  };
  const current = (): Strategy["conditions"] => ({ logic, conditions: conds, ...(note.trim() ? { note: note.trim() } : {}) });

  const canSave = !busy && !!name.trim() && conds.length > 0;
  const save = async () => {
    setBusy(true);
    try { await onSave({ id: initial?.id, name: name.trim(), notify, conditions: current() }); } finally { setBusy(false); }
  };

  return (
    <div className="min-h-full">
      {/* 頂部列：取消 / 標題 / 儲存（iOS 的導覽列） */}
      <div className="sticky top-0 z-20 glass border-b border-line" style={{ paddingTop: "env(safe-area-inset-top)" }}>
        <div className="max-w-[760px] mx-auto h-14 px-2 flex items-center">
          <button className="btn btn-ghost text-accent px-3" onClick={onCancel}>取消</button>
          <div className="flex-1 text-center font-semibold text-[17px] truncate">{isNew ? "新增策略" : "編輯策略"}</div>
          <button className="btn btn-primary btn-sm !px-4 !min-h-[34px] mr-1" disabled={!canSave} onClick={save}>{busy ? "儲存中…" : "儲存"}</button>
        </div>
      </div>

      <div className="max-w-[760px] mx-auto px-4 pt-4 pb-10 space-y-6">
        {/* 名稱 */}
        <section>
          <div className="group-title">策略名稱</div>
          <input className="w-full !text-[18px] !font-semibold !min-h-[48px] !rounded-xl" placeholder="例如：趨勢選股" value={name} onChange={(e) => setName(e.target.value)} />
        </section>

        {/* 範本 */}
        <section>
          <div className="group-title">{isNew ? "從範本開始（套用後可以再改）" : "用範本覆蓋條件"}</div>
          <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-4 px-4 pb-0.5">
            {mine.map((t) => (
              <span key={t.id} className="chip !min-h-[34px] !pr-1 shrink-0">
                <button onClick={() => pick(t)}>{t.name}</button>
                <button className="text-faint hover:text-up w-6 h-6 flex items-center justify-center" title="刪除這個範本" onClick={async () => {
                  if (!confirm(`刪除範本「${t.name}」？（已經建立的策略不受影響）`)) return;
                  await deleteTemplate(t.id); setMine(await getTemplates());
                }}><Icon name="close" className="w-3.5 h-3.5" /></button>
              </span>
            ))}
            {PRESETS.map((p) => <button key={p.name} className="chip !min-h-[34px] shrink-0 text-muted" onClick={() => pick(presetStrategy(p))}>{p.name}</button>)}
          </div>
        </section>

        {/* 條件 */}
        <section>
          <div className="flex items-center justify-between gap-3 pb-2">
            <div className="group-title !p-0 !pl-1">條件 <span className="num">{conds.length}</span></div>
            <div className="seg">
              <button aria-pressed={logic === "AND"} onClick={() => setLogic("AND")}>全部成立</button>
              <button aria-pressed={logic === "OR"} onClick={() => setLogic("OR")}>任一成立</button>
            </div>
          </div>
          <CondList key={ver} conds={conds} setConds={setConds} />
        </section>

        {/* 備註 */}
        <section>
          <div className="group-title">備註</div>
          <textarea className="w-full !rounded-xl text-[15px]" rows={3} placeholder="策略說明、進出場想法…只有你看得到" value={note} onChange={(e) => setNote(e.target.value)} />
        </section>

        {/* 選項 */}
        <section>
          <div className="group-list">
            <div className="flex items-center gap-3 px-4 py-3">
              <div className="flex-1">
                <div className="text-[15px]">有結果時推播</div>
                <div className="text-[12px] text-muted">盤中新選到的股票、每天收盤的結果會通知你</div>
              </div>
              <button role="switch" aria-checked={notify} className="switch" onClick={() => setNotify(!notify)} aria-label="有結果時推播" />
            </div>
            <button className="w-full flex items-center gap-3 px-4 py-3 text-left disabled:opacity-40" disabled={!name.trim() || conds.length === 0}
              onClick={async () => {
                try { await saveTemplate(name.trim(), current()); setMine(await getTemplates()); setMsg(`已存成範本「${name.trim()}」`); }
                catch (e) { setMsg(`存範本失敗：${(e as Error).message}`); }
              }}>
              <span className="flex-1 text-[15px] text-accent">存成範本</span>
              {msg ? <span className="text-[12px] text-muted">{msg}</span> : <Icon name="chevron" className="w-4 h-4 text-faint" />}
            </button>
          </div>
          <p className="text-[12px] text-muted px-1 pt-2 leading-relaxed">策略只有你看得到。儲存後會馬上用最新資料篩一次；之後每個交易日收盤後自動掃全市場。成交量單位都是「張」。</p>
        </section>
      </div>
    </div>
  );
}
