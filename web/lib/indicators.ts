// 技術指標：公式與 pipeline/twstock/indicators.py 完全相同。
export type Num = number | null;

export function ma(close: number[], n: number): Num[] {
  const out: Num[] = new Array(close.length).fill(null);
  let sum = 0;
  for (let i = 0; i < close.length; i++) {
    sum += close[i];
    if (i >= n) sum -= close[i - n];
    if (i >= n - 1) out[i] = sum / n;
  }
  return out;
}

// KD(9,3,3)：起始值 50
export function kd(high: number[], low: number[], close: number[], n = 9, ks = 3, ds = 3) {
  const k: Num[] = new Array(close.length).fill(null);
  const d: Num[] = new Array(close.length).fill(null);
  let pk = 50, pd = 50;
  for (let i = n - 1; i < close.length; i++) {
    let hh = -Infinity, ll = Infinity;
    for (let j = i - n + 1; j <= i; j++) { hh = Math.max(hh, high[j]); ll = Math.min(ll, low[j]); }
    const rng = hh - ll;
    const rsv = rng === 0 ? 50 : ((close[i] - ll) / rng) * 100;
    pk = (pk * (ks - 1) + rsv) / ks;
    pd = (pd * (ds - 1) + pk) / ds;
    k[i] = pk; d[i] = pd;
  }
  return { k, d };
}

// RSI：Wilder 平滑
export function rsi(close: number[], n = 6): Num[] {
  const out: Num[] = new Array(close.length).fill(null);
  if (close.length <= n) return out;
  let au = 0, ad = 0;
  for (let i = 1; i <= n; i++) {
    const df = close[i] - close[i - 1];
    if (df > 0) au += df; else ad -= df;
  }
  au /= n; ad /= n;
  out[n] = ad === 0 ? 100 : 100 - 100 / (1 + au / ad);
  for (let i = n + 1; i < close.length; i++) {
    const df = close[i] - close[i - 1];
    au = (au * (n - 1) + (df > 0 ? df : 0)) / n;
    ad = (ad * (n - 1) + (df < 0 ? -df : 0)) / n;
    out[i] = ad === 0 ? 100 : 100 - 100 / (1 + au / ad);
  }
  return out;
}

function ema(x: number[], n: number): number[] {
  const a = 2 / (n + 1);
  const out: number[] = [];
  let e = 0;
  x.forEach((v, i) => { e = i === 0 ? v : a * v + (1 - a) * e; out.push(e); });
  return out;
}

export function macd(close: number[], fast = 12, slow = 26, sig = 9) {
  const f = ema(close, fast), s = ema(close, slow);
  const dif = f.map((v, i) => v - s[i]);
  const dea = ema(dif, sig);
  return { dif, dea, osc: dif.map((v, i) => v - dea[i]) };
}

export function bias(close: number[], n: number): Num[] {
  const m = ma(close, n);
  return close.map((c, i) => (m[i] == null ? null : ((c - (m[i] as number)) / (m[i] as number)) * 100));
}

// ---------- 扣抵 ----------
// N 期均線下一期要扣掉的那根：位置 L-n-offset（offset=1 = 上一期剛扣掉的）
export function deductIndex(len: number, n: number, offset = 0): number | null {
  const i = len - n - offset;
  return i >= 0 ? i : null;
}

export interface Deduct3Low { c0: number; d: number[]; idx: number[]; line: number; ok: boolean }

// 扣三低：本期不算，下 1、2、3 期扣抵值都低於本期收盤
export function deduct3low(close: number[], n: number, offset = 0): Deduct3Low | null {
  const L = close.length;
  if (n < 4) return null;
  const base = L - n - offset;
  if (base < 0) return null;
  const idx = [base, base + 1, base + 2];
  const c0 = close[L - 1];
  const d = idx.map((i) => close[i]);
  return { c0, d, idx, line: Math.max(...d), ok: d.every((x) => x < c0) };
}

/** 布林通道：中線 MA(n)，上下軌 ± k 倍母體標準差（和 Python 選股器一致） */
export function boll(close: number[], n = 20, k = 2) {
  const mid = ma(close, n);
  const up: Num[] = new Array(close.length).fill(null);
  const dn: Num[] = new Array(close.length).fill(null);
  for (let i = n - 1; i < close.length; i++) {
    const m = mid[i]!;
    let s = 0;
    for (let j = i - n + 1; j <= i; j++) s += (close[j] - m) ** 2;
    const sd = Math.sqrt(s / n);
    up[i] = m + k * sd; dn[i] = m - k * sd;
  }
  return { up, mid, dn };
}

/** 密集成交區箱型（分價量）。和 Python 選股器 indicators.vp_box 一樣：
 *  取前 n 根（預設不含最新一根），成交量依價格重疊比例分到 bins 格，
 *  從成交量最大的價位（籌碼峰）往上下擴大到包住 va 的成交量 → 箱頂 / 箱底。 */
export interface VpBox { top: number; bottom: number; poc: number; inside: number; height: number; start: number; profile: number[]; pmin: number; step: number }
export function vpBox(high: number[], low: number[], close: number[], volume: number[], n = 60, bins = 50, va = 0.7, skipLast = 1): VpBox | null {
  const end = close.length - skipLast, start = end - n;
  if (start < 0 || n < 5) return null;
  let pmin = Infinity, pmax = -Infinity;
  for (let i = start; i < end; i++) { pmin = Math.min(pmin, low[i]); pmax = Math.max(pmax, high[i]); }
  if (!(pmax > pmin && pmin > 0)) return null;
  const step = (pmax - pmin) / bins;
  const prof = new Array(bins).fill(0);
  for (let i = start; i < end; i++) {
    const v = volume[i], h = high[i], l = low[i];
    if (!v) continue;
    if (h <= l) { prof[Math.min(Math.floor((l - pmin) / step), bins - 1)] += v; continue; }
    let tot = 0;
    const ov: number[] = [];
    for (let k = 0; k < bins; k++) {
      const e0 = pmin + step * k, e1 = e0 + step;
      const o = Math.max(0, Math.min(e1, h) - Math.max(e0, l));
      ov.push(o); tot += o;
    }
    if (tot > 0) for (let k = 0; k < bins; k++) prof[k] += (v * ov[k]) / tot;
  }
  const total = prof.reduce((a, b) => a + b, 0);
  if (total <= 0) return null;
  let poc = 0;
  for (let k = 1; k < bins; k++) if (prof[k] > prof[poc]) poc = k;
  let a = poc, b = poc, acc = prof[poc];
  while (acc < va * total && (a > 0 || b < bins - 1)) {
    const up = b < bins - 1 ? prof[b + 1] : -1, dn = a > 0 ? prof[a - 1] : -1;
    if (up >= dn) { b++; acc += up; } else { a--; acc += dn; }
  }
  const bottom = pmin + step * a, top = pmin + step * (b + 1);
  let ins = 0;
  for (let i = start; i < end; i++) if (close[i] >= bottom && close[i] <= top) ins++;
  return { top, bottom, poc: pmin + step * (poc + 0.5), inside: (ins / n) * 100, height: ((top - bottom) / bottom) * 100, start, profile: prof, pmin, step };
}
