// 把選股條件轉成一句中文（條件漏斗、策略摘要用）
import type { Condition, Src } from "./data";

const TF: Record<string, string> = { "1m": "1分K", "3m": "3分K", "5m": "5分K", "15m": "15分K", "30m": "30分K", "60m": "60分K", D: "日K", W: "週K", M: "月K" };
const WHO: Record<string, string> = { foreign: "外資", trust: "投信", dealer: "自營商", total: "三大法人" };

export function srcText(s?: Src): string {
  if (!s) return "";
  const kd = s.p && s.p.join(",") !== "9,3,3" ? `(${s.p.join(",")})` : "";
  switch (s.src) {
    case "close": return "收盤"; case "open": return "開盤"; case "high": return "最高"; case "low": return "最低";
    case "volume": return "成交量"; case "value": return String(s.v ?? 0);
    case "ma": return `MA${s.n}`; case "volma": return `${s.n}日均量`;
    case "k": return `K${kd}`; case "d": return `D${kd}`;
    case "rsi": return `RSI${s.n}`; case "bias": return `乖離${s.n}`;
    case "dif": return "DIF"; case "macd": return "MACD"; case "osc": return "MACD柱";
    case "boll_up": return "布林上軌"; case "boll_mid": return "布林中線"; case "boll_dn": return "布林下軌";
    default: return s.src;
  }
}

export function condText(c: Condition): string {
  const tf = TF[c.tf ?? "D"] ?? c.tf ?? "";
  switch (c.kind) {
    case "compare": return `${tf} ${srcText(c.left)} ${c.op} ${srcText(c.right)}`;
    case "cross": return `${tf} ${srcText(c.a)} ${c.dir === "up" ? "向上穿過" : "向下跌破"} ${srcText(c.b)}`;
    case "deduct": return `${tf} MA${c.n} ${c.dir === "low" ? "扣低" : "扣高"}`;
    case "deduct3low": return `月扣三低（MA${c.n}）${c.mode === "break" ? "今日突破" : "站上"}`;
    case "volratio": return `${tf} 量 > ${c.n}期均量 ${c.v} 倍`;
    case "inst": return `${WHO[c.who ?? "foreign"]}連 ${c.days} 日${c.dir === "buy" ? "買超" : "賣超"}`;
    case "mainforce": return `近 ${c.days} 日主力 ${c.op} ${c.v} 張`;
    case "ma_align": return `均線${c.dir === "bull" ? "多頭" : "空頭"}排列 ${(c.ns ?? []).join(c.dir === "bull" ? ">" : "<")}`;
    case "ma_tangle": return `均線糾結 ${(c.ns ?? []).join("/")} ≤ ${c.pct}%`;
    case "ma_turn": return `MA${c.n} ${c.dir === "flat" ? "走平" : "翻揚"}`;
    case "range": return `近 ${c.n} 日振幅 ${c.op} ${c.pct}%`;
    case "change": return `漲跌幅 ${c.op} ${c.pct}%`;
    case "new_high": return `創 ${c.n} 日${c.dir === "low" ? "新低" : "新高"}`;
    case "inst_ratio": return `近 ${c.days} 日${WHO[c.who ?? "foreign"]}買超天數 ${c.op} ${c.pct}%`;
    case "broker_conc": return `近 ${c.days} 日關鍵券商買超佔量 ${c.op} ${c.pct}%`;
    case "div_yield": return `近 ${c.years} 年平均殖利率 ${c.op} ${c.pct}%`;
    case "net_margin": return `近 ${c.years} 年${c.mode === "avg" ? "平均" : "每年"}稅後淨利率 ${c.op} ${c.pct}%`;
    case "inst_rank": return `${WHO[c.who ?? "foreign"]}近 ${c.days} 日${c.dir === "sell" ? "賣超" : "買超"}排行前 ${c.top} 名`;
    case "inst_turn": return `${WHO[c.who ?? "trust"]}連續${c.dir === "sell" ? "買超" : "賣超"} ${c.days} 天以上，近 ${c.within} 日內轉為${c.dir === "sell" ? "賣方" : "買方"}`;
    case "board_pct": return `董監事持股比例 ${c.op} ${c.pct}%`;
    case "op_ratio": return `最新一季營業利益占稅前利益 ${c.op} ${c.pct}%`;
    case "universe": return c.market === "TWSE" ? "上市個股" : c.market === "TPEX" ? "上櫃個股" : "上市上櫃個股";
    case "market": return `大盤 ${srcText(c.left)} ${c.op} ${srcText(c.right)}`;
    case "vp_box": {
      const m: Record<string, string> = { inside: "箱內盤整", bottom: "箱底不破", break_top: "突破箱頂", break_bottom: "跌破箱底" };
      return `密集成交箱型（前${c.n}日 ${c.va}%）${m[c.mode ?? "inside"]}${(c.mode === "break_top" || c.mode === "break_bottom") && c.vol ? `，量 > ${c.vol} 倍` : ""}`;
    }
    case "gap_break": return "跳空突破區間頂部";
    case "box_bottom": return "箱型底部不破";
    case "support_touch": return "回測支撐";
    case "in_group": return `在族群：${(c.names ?? []).join("、")}`;
    case "group": return c.tag_only ? "型態標示（不影響選出）" : `群組：${c.label || (c.logic === "OR" ? "任一成立" : "全部成立")}`;
    case "unsupported": return `${c.label || "暫無資料"}（略過）`;
    default: return c.kind;
  }
}

/** 這條條件需要的資料（給漏斗顯示「資料不足」用） */
export function needs(c: Condition): "minute" | "mainforce" | "yields" | "margins" | null {
  if (c.tf && c.tf.endsWith("m")) return "minute";
  if (c.kind === "broker_conc" || c.kind === "mainforce") return "mainforce";
  if (c.kind === "div_yield") return "yields";
  if (c.kind === "net_margin" || c.kind === "op_ratio") return "margins";
  if (c.kind === "group") for (const x of c.conditions ?? []) { const n = needs(x); if (n) return n; }
  return null;
}
