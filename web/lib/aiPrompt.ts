// 「複製 AI 分析提示詞」：把這檔的價格、技術指標、法人籌碼、目標價、新聞、我們的歷史統計整理成一段文字，
// 讓使用者貼到 ChatGPT / Claude / Gemini 自己問。全部在瀏覽器裡組，不會送到我們的伺服器。
import type { Bar } from "./bars";
import { ma, rsi } from "./indicators";
import type { Outlook, StockNews, TargetPrice } from "./data";

type Inst = { date: string; foreign_net: number; trust_net: number; dealer_net: number };
type MF = { date: string; net: number };
type Margin = { date: string; margin_balance: number };

const r1 = (x: number | null | undefined, d = 1) => (x == null || !isFinite(x) ? "-" : x.toFixed(d));
const lots = (s: number) => Math.round(s / 1000).toLocaleString();
const pct = (a: number, b: number) => (b ? ((a / b - 1) * 100).toFixed(1) + "%" : "-");

export function buildPrompt(p: {
  code: string; name: string; industry?: string | null; daily: Bar[]; inst: Inst[]; mf: MF[]; margin: Margin[];
  targets: TargetPrice[]; news: StockNews[]; outlook: Outlook | null; horizon?: string;
}): string {
  const d = p.daily;
  const c = d.map((b) => b.close);
  const n = c.length;
  const last = d[n - 1];
  const m5 = ma(c, 5), m20 = ma(c, 20), m60 = ma(c, 60), m120 = ma(c, 120), m240 = ma(c, 240);
  const rs = rsi(c, 14);
  const hi60 = Math.max(...c.slice(-60)), lo60 = Math.min(...c.slice(-60));
  const vol20 = d.slice(-21, -1).reduce((s, b) => s + b.volume, 0) / 20;
  const lines: string[] = [];
  lines.push(`請你當一位謹慎、講求證據的台股研究員，幫我分析 ${p.name}（${p.code}${p.industry ? `，${p.industry}` : ""}）未來 ${p.horizon ?? "1 個月（約 20 個交易日）"} 的走勢。`);
  lines.push("");
  lines.push("【要求】");
  lines.push("1. 分成「偏多理由」和「偏空理由」，每條都要說明依據（引用下面的數據或新聞編號），沒有依據的不要寫。");
  lines.push("2. 估計上漲 / 下跌的機率，並說明你怎麼估的；資料不夠就直接說不確定，不要給假精確的數字。");
  lines.push("3. 評估風險高低（波動、籌碼、事件），列出最可能讓判斷出錯的情況。");
  lines.push("4. 給出參考做法：進場條件、停損價位、目標價位、風險報酬比、部位大小原則；分「空手」和「已持有」兩種情況。");
  lines.push("5. 下面的資料可能不完整或過時；如果你能上網，請補查最新新聞、月營收、法說會內容，並標明哪些是你補查的。");
  lines.push("6. 最後用一句話總結，並提醒這不是投資建議。");
  lines.push("");
  lines.push(`【價格與技術面】（資料日期 ${last?.date ?? "-"}）`);
  lines.push(`收盤 ${last?.close}，近 5 日 ${pct(c[n - 1], c[n - 6])}、近 20 日 ${pct(c[n - 1], c[n - 21])}、近 60 日 ${pct(c[n - 1], c[n - 61])}`);
  lines.push(`均線：5 日 ${r1(m5[n - 1], 2)}、20 日 ${r1(m20[n - 1], 2)}、60 日 ${r1(m60[n - 1], 2)}、120 日 ${r1(m120[n - 1], 2)}、240 日 ${r1(m240[n - 1], 2)}`);
  lines.push(`RSI(14) ${r1(rs[n - 1])}；60 日最高 ${hi60}、最低 ${lo60}；今日成交 ${Math.round(last?.volume ?? 0).toLocaleString()} 張（20 日均量 ${Math.round(vol20).toLocaleString()} 張）`);
  lines.push("近 10 日收盤：" + d.slice(-10).map((b) => `${b.date?.slice(5)} ${b.close}`).join("、"));
  if (p.inst.length) {
    const x = [...p.inst].sort((a, b) => a.date.localeCompare(b.date));
    const s = (k: keyof Inst, k2: number) => lots(x.slice(-k2).reduce((t, r) => t + Number(r[k] || 0), 0));
    lines.push("");
    lines.push("【法人籌碼】（張；正數買超）");
    lines.push(`外資 近 5 日 ${s("foreign_net", 5)}、近 20 日 ${s("foreign_net", 20)}；投信 近 5 日 ${s("trust_net", 5)}、近 20 日 ${s("trust_net", 20)}；自營商 近 5 日 ${s("dealer_net", 5)}`);
    lines.push("近 10 日外資：" + x.slice(-10).map((r) => `${r.date.slice(5)} ${lots(r.foreign_net)}`).join("、"));
  }
  if (p.mf.length) {
    const x = [...p.mf].sort((a, b) => a.date.localeCompare(b.date));
    lines.push(`主力（前 15 大分點買賣超）近 5 日 ${lots(x.slice(-5).reduce((t, r) => t + r.net, 0))} 張、近 20 日 ${lots(x.slice(-20).reduce((t, r) => t + r.net, 0))} 張`);
  }
  if (p.margin.length >= 6) {
    const x = [...p.margin].sort((a, b) => a.date.localeCompare(b.date));
    lines.push(`融資餘額 ${x[x.length - 1].margin_balance.toLocaleString()} 張（5 日前 ${x[x.length - 6].margin_balance.toLocaleString()} 張）`);
  }
  if (p.targets.length) {
    lines.push("");
    lines.push("【券商 / 外資目標價】（從新聞整理，新的在前；可能有遺漏）");
    for (const t of p.targets.slice(0, 15)) {
      lines.push(`- ${t.date} ${t.broker}${t.rating ? ` ${t.rating}` : ""} 目標價 ${t.prev ? `${t.prev} → ` : ""}${t.target}${t.title ? `（${t.title}）` : ""}`);
    }
  }
  if (p.news.length) {
    lines.push("");
    lines.push("【近期新聞標題】（新的在前，編號供你引用）");
    p.news.slice(0, 25).forEach((x, i) => lines.push(`[${i + 1}] ${x.ts.slice(0, 10)} ${x.source}｜${x.title}`));
  }
  const o = p.outlook;
  if (o) {
    lines.push("");
    lines.push("【歷史統計參考】（同一個網站用過去 3 年全市場資料回測，只看價格 / 量 / 外資狀態，不含基本面）");
    lines.push(`目前狀態：${Object.values(o.state).join("、")}`);
    if (o.stats) {
      lines.push(`過去同狀態 ${o.stats.n.toLocaleString()} 次，之後 20 個交易日上漲比例 ${o.stats.win}%（全部股票平均 ${o.base.win}%），報酬中位數 ${o.stats.median}%，最差 10% 的情況 ${o.stats.p10}%，期間最大回檔中位數 ${o.stats.mae_med}%`);
    }
    lines.push(`20 日年化波動 ${o.risk.vol}%（全市場排第 ${o.risk.vol_pct ?? "-"} 百分位）、ATR ${o.risk.atr}`);
  }
  lines.push("");
  lines.push("請開始分析。");
  return lines.join("\n");
}
