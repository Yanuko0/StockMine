"use client";
// 分點進出：1 / 5 / 20 日累計的買超、賣超前 15 名，點分點看每日明細
import { useEffect, useState } from "react";
import { brokerHistory, brokerSummary, type BrokerRow } from "@/lib/data";
import type { Bar } from "@/lib/bars";
import { cls, lots } from "./ChipsPanel";

const PERIODS = [1, 5, 10, 20, 60];

function List({ title, list, side, onPick }: { title: string; list: BrokerRow[]; side: "buy" | "sell"; onPick: (r: BrokerRow) => void }) {
return (
  <div className="min-w-0">
    <div className={`text-xs mb-1 ${side === "buy" ? "up" : "down"}`}>{title}</div>
    <table className="tbl">
      <thead><tr><th>分點</th><th>買張</th><th>賣張</th><th>{side === "buy" ? "買超" : "賣超"}</th><th>均價</th></tr></thead>
      <tbody>
        {list.map((r) => (
          <tr key={r.broker_id} onClick={() => onPick(r)} className="cursor-pointer">
            <td className="truncate max-w-[6.5rem] hover:text-accent">{r.broker_name || r.broker_id}</td>
            <td className="text-muted">{lots(r.buy)}</td>
            <td className="text-muted">{lots(r.sell)}</td>
            <td className={cls(r.net)}>{lots(Math.abs(r.net))}</td>
            <td>{r.avg_price ?? "-"}</td>
          </tr>
        ))}
        {list.length === 0 && <tr><td colSpan={5} className="text-muted">-</td></tr>}
      </tbody>
    </table>
  </div>
);
}

export default function BrokerPanel({ code, daily, market }: { code: string; daily: Bar[]; market?: string }) {
  const [days, setDays] = useState(1);
  const [rows, setRows] = useState<BrokerRow[] | null>(null);
  const [pick, setPick] = useState<BrokerRow | null>(null);
  const [hist, setHist] = useState<Awaited<ReturnType<typeof brokerHistory>>>([]);

  useEffect(() => { setRows(null); brokerSummary(code, days).then(setRows).catch(() => setRows([])); }, [code, days]);
  useEffect(() => { if (pick) brokerHistory(code, pick.broker_id, 20).then(setHist); }, [code, pick]);

  const buys = (rows ?? []).filter((r) => r.side === "buy");
  const sells = (rows ?? []).filter((r) => r.side === "sell");
  const topBuy = buys.reduce((s, r) => s + r.net, 0);
  const topSell = sells.reduce((s, r) => s + r.net, 0);
  const net = topBuy + topSell;
  const span = rows?.[0];
  const inSpan = daily.filter((b) => span && b.date! >= span.start_date && b.date! <= span.end_date);
  const n = inSpan.length;
  const vol = inSpan.reduce((s, b) => s + b.volume, 0);
  const conc = vol ? ((net / 1000) / vol) * 100 : null;

  return (
    <div className="p-3 space-y-3">
      <div className="flex items-center gap-1.5 flex-wrap">
        <div className="seg">
          {PERIODS.map((d) => <button key={d} aria-pressed={days === d} onClick={() => setDays(d)}>{d}日</button>)}
        </div>
        {span && <span className="ml-auto text-xs text-muted">{span.start_date.slice(5)}～{span.end_date.slice(5)}（{n}日）</span>}
      </div>

      {rows === null && <p className="text-muted text-sm">載入中…</p>}
      {rows && rows.length === 0 && (
        <p className="text-muted text-sm">
          {market === "TPEX"
            ? "上櫃股票的分點：櫃買中心使用 Google 驗證，免費方式沒辦法自動抓（要付費資料源才有）。"
            : "還沒有分點資料。每個交易日收盤後會自動抓全市場上市股票的分點（證交所只提供當天，從開始抓的那天起累積）。"}
        </p>
      )}

      {rows && rows.length > 0 && (
        <>
          {span && n < days && <p className="text-[11px] text-accent">目前只累積了 {n} 個交易日的分點，{days} 日的數字會隨每天累積越來越完整。</p>}
          <div className="grid grid-cols-4 gap-2 text-center">
            <div className="card p-2"><div className="text-[11px] text-muted">主力買超</div><div className="font-bold up">{lots(topBuy)}</div></div>
            <div className="card p-2"><div className="text-[11px] text-muted">主力賣超</div><div className="font-bold down">{lots(Math.abs(topSell))}</div></div>
            <div className="card p-2"><div className="text-[11px] text-muted">主力淨</div><div className={`font-bold ${cls(net)}`}>{lots(net)}</div></div>
            <div className="card p-2"><div className="text-[11px] text-muted">集中度</div><div className={`font-bold ${cls(net)}`}>{conc == null ? "-" : conc.toFixed(1) + "%"}</div></div>
          </div>
          <div className="grid grid-cols-1 gap-4">
            <List title="買超分點 前15" list={buys} side="buy" onPick={setPick} />
            <List title="賣超分點 前15" list={sells} side="sell" onPick={setPick} />
          </div>
          <p className="text-xs text-muted">張數為期間累計；點分點名稱可看它每天在這檔的進出。</p>
        </>
      )}

      {pick && (
        <div className="modal-wrap" onClick={() => { setPick(null); setHist([]); }}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center mb-2">
              <div className="font-bold">{pick.broker_name}<span className="text-muted text-xs ml-2">{pick.broker_id}</span></div>
              <button className="ml-auto text-muted" onClick={() => { setPick(null); setHist([]); }}>關閉</button>
            </div>
            <table className="tbl">
              <thead><tr><th>日期</th><th>買進</th><th>賣出</th><th>買賣超</th><th>均價</th></tr></thead>
              <tbody>
                {hist.map((h) => (
                  <tr key={h.date}>
                    <td>{h.date.slice(5)}</td><td>{lots(h.buy)}</td><td>{lots(h.sell)}</td>
                    <td className={cls(h.net)}>{lots(h.net)}</td><td>{h.avg_price ?? "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-xs text-muted mt-2">單位：張。只顯示有進出的日子（最近 20 筆，最多保留 60 個交易日）。</p>
          </div>
        </div>
      )}
    </div>
  );
}
