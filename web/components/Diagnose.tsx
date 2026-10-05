"use client";
// 逐檔診斷：查某一檔為什麼沒被選到；列出「只差一條」就符合的股票
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { condText } from "@/lib/condText";
import { allStocks, type Condition } from "@/lib/data";

function parse(v: string) {
  const [bits, n, m] = v.split("|");
  return { bits: bits.split("").map((x) => x === "1"), bars: +n || 0, minute: m === "m" };
}

export default function Diagnose({ conds, diag }: { conds: Condition[]; diag: Record<string, string> }) {
  const [q, setQ] = useState("");
  const [names, setNames] = useState<Record<string, string>>({});
  useEffect(() => { allStocks().then((l) => setNames(Object.fromEntries(l.map((s) => [s.code, s.name])))).catch(() => {}); }, []);

  const near = useMemo(() => {
    const out: { code: string; fail: number }[] = [];
    for (const [code, v] of Object.entries(diag)) {
      const { bits } = parse(v);
      const f = bits.map((b, i) => (b ? -1 : i)).filter((i) => i >= 0);
      if (f.length === 1 && f[0] < conds.length) out.push({ code, fail: f[0] });
    }
    return out;
  }, [diag, conds.length]);
  const byFail = useMemo(() => {
    const m = new Map<number, string[]>();
    near.forEach((x) => m.set(x.fail, [...(m.get(x.fail) ?? []), x.code]));
    return [...m.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [near]);

  const code = q.trim();
  const realCode = !code ? "" : diag[code] ? code : (Object.entries(names).find(([, n]) => n === code)?.[0] ?? code);
  const hit = realCode ? diag[realCode] : null;
  const r = hit ? parse(hit) : null;

  return (
    <div className="card overflow-hidden">
      <div className="card-h text-sm">逐檔診斷 <span className="text-xs text-muted font-normal">查某一檔為什麼沒選到</span></div>
      <div className="p-3 space-y-3">
        <input className="w-full" placeholder="輸入股號或名稱，例如 2330 或 台積電" value={q} onChange={(e) => setQ(e.target.value)} inputMode="search" />
        {code && !r && <p className="text-sm text-muted">這天的選股沒有掃到「{code}」：可能這天沒有成交、是 ETF / 指數、或股票代號不存在。</p>}
        {r && (
          <div className="space-y-1">
            <div className="text-sm"><b>{realCode} {names[realCode]}</b>
              <span className="text-xs text-muted ml-2">日K {r.bars} 根{r.bars < 250 ? "（不足 250 根，半年線 / 年線算不出來）" : ""}・{r.minute ? "有分K" : "沒有分K 資料"}</span></div>
            {conds.map((c, i) => (
              <div key={i} className="flex gap-2 text-[13px]">
                <span className={r.bits[i] ? "down" : "up"}>{r.bits[i] ? "✓" : "✗"}</span>
                <span className={r.bits[i] ? "" : "font-semibold"}>{i + 1}. {condText(c)}</span>
              </div>
            ))}
            <p className="text-[11px] text-muted">✗ 的條件就是沒選到的原因。日K 不夠長、沒有分K 時，相關條件一定是 ✗。</p>
          </div>
        )}
        {byFail.length > 0 && (
          <div className="space-y-2">
            <div className="text-xs text-muted">只差一條就符合（共 {near.length} 檔）</div>
            {byFail.map(([i, codes]) => (
              <div key={i} className="text-[13px]">
                <div className="mb-1">卡在 <b className="up">{i + 1}. {condText(conds[i])}</b>：{codes.length} 檔</div>
                <div className="flex flex-wrap gap-1.5">
                  {codes.slice(0, 40).map((c) => (
                    <Link key={c} href={`/stock/${c}`} className="chip !min-h-[24px] !py-0.5 text-xs">{c} {names[c] ?? ""}</Link>
                  ))}
                  {codes.length > 40 && <span className="text-xs text-muted">…還有 {codes.length - 40} 檔</span>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
