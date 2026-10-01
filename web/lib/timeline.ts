// 時間 ↔ K 棒位置 的換算。
// 畫線用「時間 + 價格」存，換週期時用這裡換算成該週期的 K 棒位置，
// 所以在 1分K 畫的趨勢線，切到日K / 週K / 月K 會畫在對應的日期上；反過來也一樣。
// 資料範圍以外的時間，用「交易日」推算（週一到週五），不會因為晚上、週末而拉得很長。
import { MINUTES, type Bar, type TF } from "./bars";

const TW = 8 * 3600 * 1000;
const DAY = 86400000;

const twDate = (t: number) => new Date(t + TW).toISOString().slice(0, 10);
const dayStart = (date: string) => Date.parse(date + "T09:00:00Z") - TW; // 台灣時間 09:00
const minuteOfSession = (t: number) => {
  const d = new Date(t + TW);
  return d.getUTCHours() * 60 + d.getUTCMinutes() - 9 * 60; // 0..269
};

function weekdaysBetween(a: string, b: string): number {
  // a < b：a 之後到 b（含 b）有幾個週一到週五
  const s = Date.parse(a + "T00:00:00Z"), e = Date.parse(b + "T00:00:00Z");
  let n = 0;
  for (let t = s + DAY; t <= e; t += DAY) { const w = new Date(t).getUTCDay(); if (w !== 0 && w !== 6) n++; }
  return n;
}
function addWeekdays(date: string, k: number): string {
  let t = Date.parse(date + "T00:00:00Z");
  const step = k >= 0 ? DAY : -DAY;
  let left = Math.abs(k);
  while (left > 0) { t += step; const w = new Date(t).getUTCDay(); if (w !== 0 && w !== 6) left--; }
  return new Date(t).toISOString().slice(0, 10);
}
const mondayOf = (date: string) => {
  const t = Date.parse(date + "T00:00:00Z");
  return t - ((new Date(t).getUTCDay() + 6) % 7) * DAY;
};
const MONDAY0 = Date.UTC(1970, 0, 5); // 1970-01-05 是週一
const monthNo = (date: string) => +date.slice(0, 4) * 12 + (+date.slice(5, 7) - 1);

export class TimeMapper {
  private bars: Bar[];
  private tf: TF;
  private days: string[]; // 已知的交易日（日K 的日期）
  private n: number;      // 分鐘K 的分鐘數
  private bpd: number;    // 分鐘K 每天幾根

  constructor(bars: Bar[], tf: TF, tradingDays: string[]) {
    this.bars = bars;
    this.tf = tf;
    this.days = tradingDays;
    this.n = MINUTES[tf] ?? 0;
    this.bpd = this.n ? Math.ceil(270 / this.n) : 1;
  }

  // 交易日序號（範圍外用週一到週五推算）
  private dayIdx(date: string): number {
    const d = this.days;
    if (!d.length) return Math.round(Date.parse(date) / DAY);
    if (date < d[0]) return -weekdaysBetween(date, d[0]);
    if (date > d[d.length - 1]) return d.length - 1 + weekdaysBetween(d[d.length - 1], date);
    let lo = 0, hi = d.length - 1;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (d[m] <= date) lo = m; else hi = m - 1; }
    return lo;
  }
  private dayAt(idx: number): string {
    const d = this.days;
    if (!d.length) return new Date(idx * DAY).toISOString().slice(0, 10);
    if (idx < 0) return addWeekdays(d[0], idx);
    if (idx > d.length - 1) return addWeekdays(d[d.length - 1], idx - (d.length - 1));
    return d[idx];
  }

  // 把任意時間換成這個週期的「連續序號」（不一定剛好對到有資料的 K 棒）
  private slot(t: number): number {
    const date = twDate(t);
    switch (this.tf) {
      case "W": return Math.round((mondayOf(date) - MONDAY0) / (7 * DAY));
      case "M": return monthNo(date);
      case "D": return this.dayIdx(date);
      default: {
        const m = Math.min(Math.max(minuteOfSession(t), 0), 269);
        return this.dayIdx(date) * this.bpd + Math.floor(m / this.n);
      }
    }
  }
  private slotToTime(s: number): number {
    switch (this.tf) {
      case "W": return MONDAY0 + s * 7 * DAY + 9 * 3600000 - TW;
      case "M": { const y = Math.floor(s / 12), mo = s % 12 + 1; return dayStart(`${y}-${String(mo).padStart(2, "0")}-01`); }
      case "D": return dayStart(this.dayAt(s));
      default: {
        const di = Math.floor(s / this.bpd), b = s - di * this.bpd;
        return dayStart(this.dayAt(di)) + b * this.n * 60000;
      }
    }
  }

  /** 時間 → K 棒位置（可為負數或超過最後一根，代表資料範圍外） */
  toIndex(t: number): number {
    const B = this.bars;
    if (!B.length) return 0;
    const first = B[0].timestamp, last = B[B.length - 1].timestamp;
    if (t >= first && t <= last) {
      let lo = 0, hi = B.length - 1;
      while (lo < hi) { const m = (lo + hi + 1) >> 1; if (B[m].timestamp <= t) lo = m; else hi = m - 1; }
      return lo;
    }
    if (t < first) return this.slot(t) - this.slot(first);
    return B.length - 1 + (this.slot(t) - this.slot(last));
  }

  /** K 棒位置 → 時間 */
  toTime(idx: number): number {
    const B = this.bars;
    const i = Math.round(idx);
    if (!B.length) return Date.now();
    if (i >= 0 && i < B.length) return B[i].timestamp;
    if (i < 0) return this.slotToTime(this.slot(B[0].timestamp) + i);
    return this.slotToTime(this.slot(B[B.length - 1].timestamp) + (i - (B.length - 1)));
  }
}
