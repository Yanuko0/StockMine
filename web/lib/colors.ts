// 顏色（不依賴 klinecharts）。圖表的線色會跟著主題換：這些物件在切換主題時「原地」更新，
// 圖表繪製時才讀取，所以不用重新建立指標。
export const UP = "#ff4d4f";
export const DOWN = "#1fc77e";

/** 均線預設：5 黃、10 藍、20 紫、60 綠、120 白、240 紅（可以在「參數」裡改） */
export interface MaLine { n: number; color: string; on: boolean }
export const DEFAULT_MA: MaLine[] = [
  { n: 5, color: "#ffd400", on: true },
  { n: 10, color: "#3b82f6", on: true },
  { n: 20, color: "#a855f7", on: true },
  { n: 60, color: "#22c55e", on: true },
  { n: 120, color: "#ffffff", on: true },
  { n: 240, color: "#ef4444", on: true },
];
/** 選色用的色票 */
export const MA_SWATCHES = ["#ffd400", "#f59e0b", "#3b82f6", "#06b6d4", "#a855f7", "#ec4899", "#22c55e", "#ffffff", "#9ca3af", "#ef4444"];

const MA_FALLBACK: Record<number, string> = Object.fromEntries(DEFAULT_MA.map((m) => [m.n, m.color]));
/** 目前使用者設定的均線顏色（期數 → 顏色） */
export const MA_COLORS: Record<number, string> = { ...MA_FALLBACK };
export function setMaColors(lines: MaLine[]) {
  for (const k of Object.keys(MA_COLORS)) delete MA_COLORS[+k];
  Object.assign(MA_COLORS, MA_FALLBACK, Object.fromEntries(lines.map((m) => [m.n, m.color])));
}

let theme: "dark" | "light" = "dark";
// 淺色主題時，太淺的顏色（白、黃）換成看得清楚的深色版本
const LIGHT_MAP: Record<string, string> = { "#ffffff": "#3a3f47", "#ffd400": "#c99a00", "#9ca3af": "#6b7280" };
export function maColor(n: number): string {
  const c = (MA_COLORS[n] ?? "#9ca3af").toLowerCase();
  return theme === "light" ? LIGHT_MAP[c] ?? c : c;
}

const PAL_DARK = { l1: "#ffd400", l2: "#33ccff", l3: "#ff66cc", boll: "#c08cff", mid: "#bbbbbb", d3: "#ffa940", d3bg: "rgba(10,12,16,0.85)", text: "#d9dde3", box: "#38bdf8" };
const PAL_LIGHT = { l1: "#c99a00", l2: "#0b8fd6", l3: "#d63384", boll: "#8a5cf6", mid: "#868e96", d3: "#e8590c", d3bg: "rgba(255,255,255,0.9)", text: "#2b3038", box: "#0284c7" };
export const PAL = { ...PAL_DARK };

export function setPalette(t: "dark" | "light") {
  theme = t;
  Object.assign(PAL, t === "light" ? PAL_LIGHT : PAL_DARK);
}
