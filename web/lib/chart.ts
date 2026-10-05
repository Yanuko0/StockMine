"use client";
// KLineChart 自訂指標與樣式（台股：紅漲綠跌）
import {
  registerIndicator, registerLocale, type KLineData, type IndicatorFigure,
} from "klinecharts";
import { ma, kd, rsi, macd, bias, boll, deductIndex, deduct3low } from "./indicators";
import { registerOverlays } from "./overlays";

import { UP, DOWN, PAL, maColor } from "./colors";
export { UP, DOWN };

export interface MAExt {
  deduct: boolean;       // 標出各均線的扣抵K棒
  offset: number;        // 扣抵位置定義（0 = 下一期要扣的）
  colors?: string;       // 均線顏色（只用來觸發重畫）
  /** 扣三低：monthly = 目前是月K（畫 D1~D3 標記）；其他週期用 line（由月K 算好的價位）畫一條橫線 */
  d3: { enabled: boolean; n: number; monthly: boolean; line: number | null; status: string; poly?: boolean } | null;
  /** 自動箱型（密集成交區，用日K 算好）：所有週期都畫同一個箱子；startTs 之後才畫，右側畫分價量 */
  box?: { top: number; bottom: number; poc: number; startTs: number; profile: number[]; pmin: number; step: number; label: string; showProfile: boolean } | null;
}

/** 籌碼副圖的資料：每天一筆（ts = 當天 00:00 台灣時間的時間戳，v = 買賣超張數） */
export interface ChipExt { series: { ts: number; v: number }[]; intraday: boolean }
export const CHIP_INDS = {
  TW_MF: "主力買賣超", TW_FOREIGN: "外資買賣超", TW_TRUST: "投信買賣超", TW_DEALER: "自營商買賣超",
} as const;

export const DEFAULT_PARAMS: Record<string, number[]> = {
  TW_KD: [9, 3, 3], TW_RSI: [6, 12], TW_MACD: [12, 26, 9], TW_BIAS: [10, 20], TW_BOLL: [20, 2],
};

let registered = false;

export function registerAll() {
  if (registered) return;
  registered = true;

  registerLocale("zh-TW", {
    time: "時間：", open: "開：", high: "高：", low: "低：", close: "收：", volume: "量：",
    change: "漲跌：", turnover: "額：", second: "秒", minute: "分", hour: "時", day: "日",
    week: "週", month: "月", year: "年",
  });

  const lineFig = (key: string, title: string, i = 0): IndicatorFigure<Record<string, number | null>> =>
    ({ key, title, type: "line", styles: () => ({ color: [PAL.l1, PAL.l2, PAL.l3][i % 3] }) });

  // ---- 均線 + 扣抵標記 + 扣三低 ----
  registerIndicator<Record<string, number | null>, number, MAExt>({
    name: "TW_MA",
    shortName: "MA",
    series: "price",
    precision: 2,
    calcParams: [5, 10, 20, 60],
    shouldOhlc: true,
    extendData: { deduct: true, offset: 0, d3: null },
    regenerateFigures: (params) => params.map((n) => ({
      key: `ma${n}`, title: `${n}T:`, type: "line",
      styles: () => ({ color: maColor(n) }),
    })),
    figures: [5, 10, 20, 60].map((n) => ({
      key: `ma${n}`, title: `${n}T:`, type: "line", styles: () => ({ color: maColor(n) }),
    })),
    calc: (data: KLineData[], ind) => {
      const close = data.map((d) => d.close);
      const cols = ind.calcParams.map((n) => ma(close, n));
      return data.map((_, i) => Object.fromEntries(ind.calcParams.map((n, j) => [`ma${n}`, cols[j][i]])));
    },
    draw: ({ ctx, chart, indicator, xAxis, yAxis, bounding }) => {
      const data = chart.getDataList();
      const ext = indicator.extendData;
      const L = data.length;
      if (!L || !ext) return false;
      ctx.font = `10px ${CHART_FONT}`;
      ctx.textAlign = "center";
      if (ext.deduct) {
        indicator.calcParams.forEach((n, j) => {
          const i = deductIndex(L, n, ext.offset);
          if (i == null) return;
          const x = xAxis.convertToPixel(i);
          if (x < 0 || x > bounding.width) return;
          const y = yAxis.convertToPixel(data[i].low) + 6 + j * 11;
          ctx.fillStyle = maColor(n);
          ctx.beginPath();
          ctx.moveTo(x, y); ctx.lineTo(x - 4, y + 6); ctx.lineTo(x + 4, y + 6); ctx.closePath(); ctx.fill();
          ctx.fillText(`扣${n}`, x, y + 16);
        });
      }
      if (ext.box) {
        const bx = ext.box;
        const yT = yAxis.convertToPixel(bx.top), yB = yAxis.convertToPixel(bx.bottom), yP = yAxis.convertToPixel(bx.poc);
        let i0 = data.findIndex((d) => d.timestamp >= bx.startTs);
        if (i0 < 0) i0 = L - 1;
        const x0 = Math.max(0, xAxis.convertToPixel(i0));
        const W = bounding.width;
        // 淡黃色、很透明：不要蓋住 K 棒
        const small = W < 520;
        const BOX = PAL.box;
        // 分價量（右側橫條）
        if (bx.showProfile) {
          const max = Math.max(...bx.profile) || 1;
          const pw = W * (small ? 0.12 : 0.16);
          bx.profile.forEach((v, k) => {
            const y1 = yAxis.convertToPixel(bx.pmin + bx.step * (k + 1)), y0 = yAxis.convertToPixel(bx.pmin + bx.step * k);
            const w = (v / max) * pw;
            const p0 = bx.pmin + bx.step * k;
            ctx.fillStyle = p0 >= bx.bottom - 1e-9 && p0 < bx.top - 1e-9 ? BOX + "2e" : BOX + "14";
            ctx.fillRect(W - w, Math.min(y0, y1), w, Math.max(1, Math.abs(y0 - y1) - 1));
          });
        }
        ctx.fillStyle = BOX + "0b";
        ctx.fillRect(x0, Math.min(yT, yB), W - x0, Math.abs(yB - yT));
        ctx.strokeStyle = BOX + "b3";
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.beginPath(); ctx.moveTo(x0, yT); ctx.lineTo(W, yT); ctx.moveTo(x0, yB); ctx.lineTo(W, yB); ctx.stroke();
        ctx.strokeStyle = BOX + "66";
        ctx.setLineDash([1, 4]);
        ctx.beginPath(); ctx.moveTo(x0, yP); ctx.lineTo(W, yP); ctx.stroke();
        ctx.setLineDash([]);
        // 文字靠右、加底色，避開左邊的均線 / 水平線標籤
        const tag = (t: string, y: number, size: number) => {
          ctx.font = `600 ${size}px ${CHART_FONT}`;
          const tw = ctx.measureText(t).width;
          const x = W - tw - 8 - (bx.showProfile ? W * (small ? 0.12 : 0.16) * 0.15 : 0);
          ctx.fillStyle = PAL.d3bg;
          ctx.fillRect(x - 3, y - size, tw + 6, size + 4);
          ctx.fillStyle = BOX;
          ctx.textAlign = "left";
          ctx.fillText(t, x, y);
        };
        tag(`箱頂 ${bx.top.toFixed(2)}`, yT - 4, small ? 10 : 11);
        tag(`箱底 ${bx.bottom.toFixed(2)}`, yB + 13, small ? 10 : 11);
        if (!small) tag(`籌碼峰 ${bx.poc.toFixed(2)}・${bx.label}`, yP - 3, 10);
        ctx.textAlign = "center";
        ctx.font = `10px ${CHART_FONT}`;
      }
      if (ext.d3?.enabled && !ext.d3.monthly && ext.d3.line != null) {
        let y = yAxis.convertToPixel(ext.d3.line);
        // 線在畫面外：貼在上 / 下緣，標示方向，才不會以為沒畫
        const off = y < 0 ? "↑" : y > bounding.height ? "↓" : "";
        if (off) y = off === "↑" ? 56 : bounding.height - 4;
        // 線在畫面外：手機不畫提示字（會蓋到 K 棒），下方的扣抵列已經有寫
        if (!(off && bounding.width < 520)) {
          if (!off) {
            ctx.strokeStyle = PAL.d3;
            ctx.lineWidth = 1.5;
            ctx.setLineDash([6, 4]);
            ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(bounding.width, y); ctx.stroke();
            ctx.setLineDash([]);
          }
          ctx.textAlign = "right";
          ctx.fillStyle = PAL.d3;
          ctx.font = `600 11px ${CHART_FONT}`;
          const txt = `月扣三低線 ${ext.d3.line.toFixed(2)} ${ext.d3.status}${off ? `（在畫面${off === "↑" ? "上方" : "下方"} ${off}）` : ""}`;
          const w = ctx.measureText(txt).width;
          ctx.fillStyle = PAL.d3bg;
          ctx.fillRect(bounding.width - w - 8, y - 17, w + 8, 15);
          ctx.fillStyle = PAL.d3;
          ctx.fillText(txt, bounding.width - 4, y - 5);
        }
      }
      // 扣三低折線（3AI）：每一期均線要扣掉的那根收盤 = 收盤往右移 n 期；
      // 最右邊延伸到未來 3 期 = 扣1低 / 扣2低 / 扣3低。本期收盤站在這 3 點之上 = 扣三低成立
      if (ext.d3?.poly && ext.d3.monthly && data.length > ext.d3.n + ext.offset) {
        const n = ext.d3.n + ext.offset, L = data.length, c0 = data[L - 1].close;
        ctx.strokeStyle = PAL.d3;
        ctx.lineWidth = 2;
        ctx.setLineDash([]);
        ctx.beginPath();
        for (let t = n; t <= L + 2; t++) {
          const x = xAxis.convertToPixel(t), y = yAxis.convertToPixel(data[t - n].close);
          if (t === n) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();
        // 現在這一期：一條直的虛線
        const xNow = xAxis.convertToPixel(L - 1);
        ctx.strokeStyle = "rgba(255,102,204,0.7)";
        ctx.setLineDash([3, 3]);
        ctx.beginPath(); ctx.moveTo(xNow, 0); ctx.lineTo(xNow, bounding.height); ctx.stroke();
        ctx.setLineDash([]);
        ctx.font = `600 11px ${CHART_FONT}`;
        for (let k = 0; k < 3; k++) {
          const v = data[L - n + k].close;
          const x = xAxis.convertToPixel(L + k), y = yAxis.convertToPixel(v);
          const low = v < c0; // 扣低：扣掉的比現在收盤低 → 均線會往上
          ctx.fillStyle = low ? UP : DOWN;
          ctx.beginPath(); ctx.arc(x, y, 4.5, 0, Math.PI * 2); ctx.fill();
          ctx.textAlign = "left";
          ctx.fillText(`扣${k + 1}${low ? "低" : "高"} ${v.toFixed(2)}`, x + 7, y + (k - 1) * 13 + 4);
        }
        ctx.textAlign = "center";
      }
      if (ext.d3?.enabled && ext.d3.monthly) {
        const r = deduct3low(data.map((d) => d.close), ext.d3.n, ext.offset);
        if (r) {
          const x0 = xAxis.convertToPixel(r.idx[0]);
          const y = yAxis.convertToPixel(r.line);
          ctx.strokeStyle = PAL.d3;
          ctx.lineWidth = 1.5;
          ctx.setLineDash([6, 4]);
          ctx.beginPath(); ctx.moveTo(Math.max(0, x0), y); ctx.lineTo(bounding.width, y); ctx.stroke();
          ctx.setLineDash([]);
          if (!ext.d3.poly) r.idx.forEach((i, k) => {
            const x = xAxis.convertToPixel(i);
            const yy = yAxis.convertToPixel(data[i].high) - 8;
            ctx.fillStyle = PAL.d3;
            ctx.beginPath(); ctx.arc(x, yy, 7, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = "#000";
            ctx.fillText(`D${k + 1}`, x, yy + 3);
          });
          ctx.textAlign = "right";
          ctx.fillStyle = PAL.d3;
          ctx.font = `600 11px ${CHART_FONT}`;
          // 開折線時，未來 3 點旁邊已經有數字：線的說明改放左邊，才不會疊在一起
          // 開折線時，未來 3 點旁邊已經有數字，線的說明就不寫（下方扣抵列有），才不會疊在一起
          if (!ext.d3.poly) ctx.fillText(`扣三低線(${ext.d3.n}) ${r.line.toFixed(2)} ${ext.d3.status}`, bounding.width - 4, y - 4);
        }
      }
      return false; // 均線本身照常畫
    },
  });

  registerIndicator<{ k: number | null; d: number | null }>({
    name: "TW_KD", shortName: "KD", calcParams: [9, 3, 3], precision: 2, minValue: 0, maxValue: 100,
    figures: [
      { key: "k", title: "K: ", type: "line", styles: () => ({ color: PAL.l1 }) },
      { key: "d", title: "D: ", type: "line", styles: () => ({ color: PAL.l2 }) },
    ],
    calc: (data, ind) => {
      const [n, a, b] = ind.calcParams as number[];
      const r = kd(data.map((x) => x.high), data.map((x) => x.low), data.map((x) => x.close), n, a, b);
      return data.map((_, i) => ({ k: r.k[i], d: r.d[i] }));
    },
  });

  registerIndicator<Record<string, number | null>, number>({
    name: "TW_RSI", shortName: "RSI", calcParams: [6, 12], precision: 2, minValue: 0, maxValue: 100,
    regenerateFigures: (p) => p.map((n, i) => ({ key: `rsi${n}`, title: `RSI${n}: `, type: "line",
      styles: () => ({ color: [PAL.l1, PAL.l2, PAL.l3][i % 3] }) })),
    figures: [lineFig("rsi6", "RSI6: "), lineFig("rsi12", "RSI12: ", 1)],
    calc: (data, ind) => {
      const close = data.map((x) => x.close);
      const cols = ind.calcParams.map((n) => rsi(close, n));
      return data.map((_, i) => Object.fromEntries(ind.calcParams.map((n, j) => [`rsi${n}`, cols[j][i]])));
    },
  });

  registerIndicator<{ dif: number; dea: number; osc: number }>({
    name: "TW_MACD", shortName: "MACD", calcParams: [12, 26, 9], precision: 2,
    figures: [
      { key: "dif", title: "DIF: ", type: "line", styles: () => ({ color: PAL.l1 }) },
      { key: "dea", title: "MACD: ", type: "line", styles: () => ({ color: PAL.l2 }) },
      { key: "osc", title: "OSC: ", type: "bar", baseValue: 0,
        styles: ({ data }) => ({ color: (data.current?.osc ?? 0) >= 0 ? UP : DOWN }) },
    ],
    calc: (data, ind) => {
      const [f, s, g] = ind.calcParams as number[];
      const r = macd(data.map((x) => x.close), f, s, g);
      return data.map((_, i) => ({ dif: r.dif[i], dea: r.dea[i], osc: r.osc[i] }));
    },
  });

  registerIndicator<Record<string, number | null>, number>({
    name: "TW_BIAS", shortName: "BIAS", calcParams: [10, 20], precision: 2,
    regenerateFigures: (p) => p.map((n, i) => ({ key: `b${n}`, title: `BIAS${n}: `, type: "line",
      styles: () => ({ color: [PAL.l1, PAL.l2, PAL.l3][i % 3] }) })),
    figures: [lineFig("b10", "BIAS10: "), lineFig("b20", "BIAS20: ", 1)],
    calc: (data, ind) => {
      const close = data.map((x) => x.close);
      const cols = ind.calcParams.map((n) => bias(close, n));
      return data.map((_, i) => Object.fromEntries(ind.calcParams.map((n, j) => [`b${n}`, cols[j][i]])));
    },
  });

  // ---- 布林通道（主圖） ----
  registerIndicator<{ up: number | null; mid: number | null; dn: number | null }>({
    name: "TW_BOLL", shortName: "BOLL", series: "price", precision: 2, calcParams: [20, 2], shouldOhlc: true,
    figures: [
      { key: "up", title: "上: ", type: "line", styles: () => ({ color: PAL.boll }) },
      { key: "mid", title: "中: ", type: "line", styles: () => ({ color: PAL.mid }) },
      { key: "dn", title: "下: ", type: "line", styles: () => ({ color: PAL.boll }) },
    ],
    calc: (data, ind) => {
      const [n, k] = ind.calcParams as number[];
      const r = boll(data.map((x) => x.close), n, k);
      return data.map((_, i) => ({ up: r.up[i], mid: r.mid[i], dn: r.dn[i] }));
    },
  });

  // ---- 籌碼副圖：主力 / 外資 / 投信 / 自營商（張）。週K、月K 自動加總；分K 不適用 ----
  for (const [name, title] of Object.entries(CHIP_INDS)) {
    registerIndicator<{ net: number | null }, number, ChipExt>({
      name, shortName: title, precision: 0,
      extendData: { series: [], intraday: false },
      figures: [
        { key: "net", title: "張: ", type: "bar", baseValue: 0,
          styles: ({ data }) => ({ color: (data.current?.net ?? 0) >= 0 ? UP : DOWN }) },
      ],
      calc: (data, ind) => {
        const ext = ind.extendData;
        const s = ext?.series ?? [];
        const out = data.map(() => ({ net: null as number | null }));
        if (!s.length || ext?.intraday) return out;
        let j = 0;
        while (j < s.length && s[j].ts < (data[0]?.timestamp ?? 0)) j++;
        for (let i = 0; i < data.length; i++) {
          const end = i + 1 < data.length ? data[i + 1].timestamp : Infinity;
          let sum: number | null = null;
          while (j < s.length && s[j].ts < end) { sum = (sum ?? 0) + s[j].v; j++; }
          out[i] = { net: sum };
        }
        return out;
      },
    });
  }

  registerOverlays();
}

export const CHART_FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang TC", "Noto Sans TC", "Microsoft JhengHei", "Segoe UI", sans-serif';
function stylesOf(t: "dark" | "light") {
  const L = t === "light";
  const grid = L ? "#eef0f3" : "#262626";
  const axis = L ? "#d5d9de" : "#333333";
  const tick = L ? "#6b7480" : "#9b9b9b";
  const tip = L ? "#2b3038" : "#e6e6e6";
  const cross = L ? "#5c6470" : "#4a4a4a";
  const f = CHART_FONT;
  // 手機：字小一點、間距緊一點，指標數值才排得下一行、不會蓋到 K 棒
  const sm = typeof window !== "undefined" && window.innerWidth < 640;
  const fs = sm ? 11 : 12;
  const txt = { color: tip, family: f, size: fs };
  return {
    grid: { horizontal: { color: grid }, vertical: { color: grid } },
    candle: {
      bar: { upColor: UP, downColor: DOWN, noChangeColor: tick, upBorderColor: UP, downBorderColor: DOWN,
        noChangeBorderColor: tick, upWickColor: UP, downWickColor: DOWN, noChangeWickColor: tick },
      priceMark: {
        last: { upColor: UP, downColor: DOWN, text: { family: f } },
        high: { color: tip, textFamily: f }, low: { color: tip, textFamily: f },
      },
      // 開高低收只在手指 / 滑鼠移到 K 棒時顯示，畫面比較乾淨
      tooltip: { showRule: "follow_cross", title: { ...txt }, legend: { ...txt } },
    },
    indicator: {
      bars: [{ upColor: "rgba(255,59,59,0.78)", downColor: "rgba(47,213,90,0.78)", noChangeColor: tick }],
      // 指標數值（例如 5T:178.70）用各條線自己的顏色，跟三竹一樣
      tooltip: {
        title: { ...txt, color: tick, showParams: false, ...(sm ? { marginLeft: 6, marginRight: 4 } : {}) },
        legend: { family: f, size: fs, ...(sm ? { marginLeft: 4, marginRight: 4, marginTop: 4 } : {}) },
      },
      lastValueMark: { text: { family: f } },
    },
    xAxis: { tickText: { color: tick, family: f, size: sm ? 10 : 11 }, axisLine: { color: axis }, tickLine: { color: axis } },
    yAxis: { tickText: { color: tick, family: f, size: 11 }, axisLine: { color: axis }, tickLine: { color: axis } },
    separator: { color: axis },
    crosshair: {
      horizontal: { line: { color: cross }, text: { backgroundColor: cross, borderColor: cross, family: f } },
      vertical: { line: { color: cross }, text: { backgroundColor: cross, borderColor: cross, family: f } },
    },
    overlay: { text: { family: f } },
  };
}
export const chartStyles = (t: "dark" | "light") => stylesOf(t);
