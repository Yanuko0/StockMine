"""技術指標。公式與網頁端 web/lib/indicators.ts 完全相同，兩邊算出來的數字會一致。

- MA(n)：收盤價簡單平均
- KD(9,3,3)：RSV = (C - 最低9) / (最高9 - 最低9) * 100；K = 2/3·K前 + 1/3·RSV；D = 2/3·D前 + 1/3·K；起始值 50
- RSI(n)：Wilder 平滑（前 n 根取平均，之後 (前值·(n-1) + 本期) / n）
- MACD(12,26,9)：DIF = EMA12 - EMA26；MACD = DIF 的 EMA9；OSC = DIF - MACD（EMA 以第一筆為起始值）
- BIAS(n)：(C - MA(n)) / MA(n) * 100
"""
from __future__ import annotations

import numpy as np
import pandas as pd


def ma(close: pd.Series, n: int) -> pd.Series:
    return close.rolling(n, min_periods=n).mean()


def kd(high: pd.Series, low: pd.Series, close: pd.Series, n: int = 9, k_s: int = 3, d_s: int = 3):
    hh = high.rolling(n, min_periods=n).max().to_numpy()
    ll = low.rolling(n, min_periods=n).min().to_numpy()
    c = close.to_numpy(dtype=float)
    k = np.full(len(c), np.nan)
    d = np.full(len(c), np.nan)
    pk, pd_ = 50.0, 50.0
    for i in range(len(c)):
        if np.isnan(hh[i]):
            continue
        rng = hh[i] - ll[i]
        rsv = 50.0 if rng == 0 else (c[i] - ll[i]) / rng * 100
        pk = (pk * (k_s - 1) + rsv) / k_s
        pd_ = (pd_ * (d_s - 1) + pk) / d_s
        k[i], d[i] = pk, pd_
    return pd.Series(k, index=close.index), pd.Series(d, index=close.index)


def rsi(close: pd.Series, n: int = 6) -> pd.Series:
    c = close.to_numpy(dtype=float)
    out = np.full(len(c), np.nan)
    if len(c) <= n:
        return pd.Series(out, index=close.index)
    diff = np.diff(c)
    up = np.where(diff > 0, diff, 0.0)
    dn = np.where(diff < 0, -diff, 0.0)
    au, ad = up[:n].mean(), dn[:n].mean()
    out[n] = 100.0 if ad == 0 else 100 - 100 / (1 + au / ad)
    for i in range(n + 1, len(c)):
        au = (au * (n - 1) + up[i - 1]) / n
        ad = (ad * (n - 1) + dn[i - 1]) / n
        out[i] = 100.0 if ad == 0 else 100 - 100 / (1 + au / ad)
    return pd.Series(out, index=close.index)


def _ema(x: np.ndarray, n: int) -> np.ndarray:
    out = np.full(len(x), np.nan)
    if len(x) == 0:
        return out
    a = 2 / (n + 1)
    e = x[0]
    for i, v in enumerate(x):
        e = v if i == 0 else a * v + (1 - a) * e
        out[i] = e
    return out


def macd(close: pd.Series, fast: int = 12, slow: int = 26, sig: int = 9):
    c = close.to_numpy(dtype=float)
    dif = _ema(c, fast) - _ema(c, slow)
    dea = _ema(dif, sig)
    idx = close.index
    return pd.Series(dif, index=idx), pd.Series(dea, index=idx), pd.Series(dif - dea, index=idx)


def bias(close: pd.Series, n: int) -> pd.Series:
    m = ma(close, n)
    return (close - m) / m * 100


# ---------- 扣抵 ----------
def boll(close: pd.Series, n: int = 20, k: float = 2.0):
    """布林通道：中線 = MA(n)，上下軌 = 中線 ± k × 標準差（母體標準差）。"""
    mid = close.rolling(n).mean()
    sd = close.rolling(n).std(ddof=0)
    return mid + k * sd, mid, mid - k * sd


def deduct_value(close: pd.Series, n: int, offset: int = 0):
    """N 期均線「下一期要扣掉的價格」與位置。
    目前均線 = 最後 n 根的平均（位置 L-n .. L-1），下一期會扣掉位置 L-n 那根。
    offset=1 時改用「上一期剛扣掉的」（位置 L-n-1），用來對齊不同看盤軟體的定義。"""
    L = len(close)
    i = L - n - offset
    if i < 0:
        return None, None
    return float(close.iloc[i]), i


def deduct3low(close: pd.Series, n: int, offset: int = 0) -> dict | None:
    """扣三低：以最後一根收盤價 C0 為基準（本期不算），
    下 1、2、3 期的扣抵值 D1、D2、D3 都低於 C0 即成立。
    D1 = 位置 L-n, D2 = L-n+1, D3 = L-n+2（n 必須 ≥ 4，否則 D3 會是本期自己）。"""
    L = len(close)
    if n < 4 or L < n + offset:
        return None
    base = L - n - offset
    idx = [base, base + 1, base + 2]
    if idx[0] < 0:
        return None
    c0 = float(close.iloc[-1])
    ds = [float(close.iloc[i]) for i in idx]
    return {"c0": c0, "d": ds, "idx": idx, "line": max(ds), "ok": all(x < c0 for x in ds)}


def compute_all(df: pd.DataFrame) -> pd.DataFrame:
    """給選股器用：在 K 線表上加上常用指標欄位。"""
    out = df.copy()
    c, h, l = out["close"].astype(float), out["high"].astype(float), out["low"].astype(float)
    for n in (5, 10, 20, 60, 120, 240):
        out[f"ma{n}"] = ma(c, n)
    out["k"], out["d"] = kd(h, l, c)
    for n in (6, 12, 14):
        out[f"rsi{n}"] = rsi(c, n)
    out["dif"], out["macd"], out["osc"] = macd(c)
    return out


def vp_box(high, low, close, volume, n: int = 60, bins: int = 50, va: float = 0.70, skip_last: int = 1) -> dict | None:
    """密集成交區箱型（分價量 / Volume Profile）。

    取「前 n 根」（預設不含最新一根，這樣才能判斷今天有沒有突破）：
    1. 把每根 K 棒的成交量，依價格重疊比例分到 bins 個價格格子
    2. 成交量最大的格子 = 籌碼峰（poc）
    3. 從籌碼峰往上下擴大（每次加量比較大的那一邊），直到包住 va（70%）的成交量 → 箱頂 / 箱底
    回傳 top, bottom, poc, inside（收盤在箱內的比例 %）, height（箱高 %）, start（第幾根開始）
    """
    import numpy as np

    h = np.asarray(high, dtype=float)
    lo = np.asarray(low, dtype=float)
    c = np.asarray(close, dtype=float)
    v = np.asarray(volume, dtype=float)
    end = len(c) - skip_last
    start = end - n
    if start < 0 or n < 5:
        return None
    h, lo, c, v = h[start:end], lo[start:end], c[start:end], v[start:end]
    pmin, pmax = float(np.nanmin(lo)), float(np.nanmax(h))
    if not pmax > pmin > 0:
        return None
    step = (pmax - pmin) / bins
    prof = np.zeros(bins)
    edges = pmin + step * np.arange(bins + 1)
    for hi_, lo_, vol in zip(h, lo, v):
        if not vol or vol != vol:
            continue
        if hi_ <= lo_:  # 一字線：全部放進那一格
            prof[min(int((lo_ - pmin) / step), bins - 1)] += vol
            continue
        ov = np.clip(np.minimum(edges[1:], hi_) - np.maximum(edges[:-1], lo_), 0, None)
        if ov.sum() > 0:
            prof += vol * ov / ov.sum()
    total = prof.sum()
    if total <= 0:
        return None
    poc = int(prof.argmax())
    a = b = poc
    acc = prof[poc]
    while acc < va * total and (a > 0 or b < bins - 1):
        up = prof[b + 1] if b < bins - 1 else -1
        dn = prof[a - 1] if a > 0 else -1
        if up >= dn:
            b += 1
            acc += up
        else:
            a -= 1
            acc += dn
    bottom, top = float(edges[a]), float(edges[b + 1])
    inside = float(((c >= bottom) & (c <= top)).mean() * 100)
    return {"top": top, "bottom": bottom, "poc": float((edges[poc] + edges[poc + 1]) / 2),
            "inside": inside, "height": (top - bottom) / bottom * 100, "start": start,
            "profile": prof.tolist(), "pmin": pmin, "step": step}
