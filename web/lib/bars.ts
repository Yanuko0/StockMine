// K 線週期轉換：規則與 pipeline/twstock/bars.py 相同。
export interface Bar {
  timestamp: number; // UTC 毫秒（K 棒開始時間）
  open: number; high: number; low: number; close: number; volume: number;
  date?: string;     // 日K 以上才有：YYYY-MM-DD
  partial?: boolean; // 週 / 月K：本期尚未結束
}

export type TF = "1m" | "3m" | "5m" | "15m" | "30m" | "60m" | "D" | "W" | "M";
export const TF_LIST: { tf: TF; label: string }[] = [
  // 跟三竹一樣：日 / 週 / 月在前，再來是分K
  { tf: "D", label: "日" }, { tf: "W", label: "週" }, { tf: "M", label: "月" },
  { tf: "60m", label: "60分" }, { tf: "30m", label: "30分" }, { tf: "15m", label: "15分" },
  { tf: "5m", label: "5分" }, { tf: "3m", label: "3分" }, { tf: "1m", label: "1分" },
];
export const MINUTES: Partial<Record<TF, number>> = { "1m": 1, "3m": 3, "5m": 5, "15m": 15, "30m": 30, "60m": 60 };

const TW = 8 * 3600 * 1000;

// 1分K（開始時間）→ N 分K。09:00 起每 N 分鐘一根，60分K 最後一根為 13:00-13:30
export function resampleMinutes(bars: Bar[], n: number): Bar[] {
  if (n === 1) return bars;
  const out: Bar[] = [];
  let cur: Bar | null = null;
  let curKey = "";
  for (const b of bars) {
    const t = new Date(b.timestamp + TW);
    const day = t.toISOString().slice(0, 10);
    const m = t.getUTCHours() * 60 + t.getUTCMinutes() - 9 * 60 + 1; // 第幾分鐘 1..270
    const bucket = Math.ceil(Math.min(Math.max(m, 1), 270) / n);
    const key = `${day}#${bucket}`;
    if (key !== curKey) {
      if (cur) out.push(cur);
      const start = Date.parse(`${day}T09:00:00Z`) - TW + (bucket - 1) * n * 60000;
      cur = { timestamp: start, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume };
      curKey = key;
    } else if (cur) {
      cur.high = Math.max(cur.high, b.high);
      cur.low = Math.min(cur.low, b.low);
      cur.close = b.close;
      cur.volume += b.volume;
    }
  }
  if (cur) out.push(cur);
  return out;
}

// 日K → 週K（週一開始）/ 月K；標示為該期第一個交易日
export function resampleDaily(daily: Bar[], rule: "W" | "M", today = new Date()): Bar[] {
  const out: Bar[] = [];
  let cur: Bar | null = null;
  let curKey = "";
  for (const b of daily) {
    const d = new Date(b.date + "T00:00:00Z");
    let key: string;
    if (rule === "W") {
      const monday = new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * 86400000);
      key = monday.toISOString().slice(0, 10);
    } else key = b.date!.slice(0, 7);
    if (key !== curKey) {
      if (cur) out.push(cur);
      cur = { ...b };
      curKey = key;
    } else if (cur) {
      cur.high = Math.max(cur.high, b.high);
      cur.low = Math.min(cur.low, b.low);
      cur.close = b.close;
      cur.volume += b.volume;
    }
  }
  if (cur) {
    // 本期是否還沒結束（月K：同一個月；週K：同一週）
    const t = new Date(today.getTime() + TW).toISOString().slice(0, 10);
    const lastKey = rule === "M" ? t.slice(0, 7) : (() => {
      const d = new Date(t + "T00:00:00Z");
      return new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * 86400000).toISOString().slice(0, 10);
    })();
    cur.partial = curKey === lastKey;
    out.push(cur);
  }
  return out;
}

export function dateToTs(date: string): number {
  return Date.parse(date + "T09:00:00Z") - TW; // 台灣時間 09:00
}

export function fmtTs(ts: number, tf: TF): string {
  const t = new Date(ts + TW).toISOString();
  if (MINUTES[tf]) return `${t.slice(5, 10)} ${t.slice(11, 16)}`;
  if (tf === "M") return t.slice(0, 7);
  return t.slice(0, 10);
}
