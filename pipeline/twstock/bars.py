"""K 線週期轉換。網頁端 web/lib/bars.ts 使用完全相同的規則。

分鐘K 切法（台股 09:00–13:30，共 270 分鐘）：
- 每根 1分K 依「距離 09:00 的第幾分鐘」m（1..270）歸入第 ceil(m / N) 根
- 例：60分K → 09:00-10:00、10:00-11:00、11:00-12:00、12:00-13:00、13:00-13:30（最後一根半小時）
- K 棒時間標示為「該根的開始時間」
"""
from __future__ import annotations

import gzip
import json
import math

import numpy as np
import pandas as pd

MINUTE_TFS = {"1m": 1, "3m": 3, "5m": 5, "15m": 15, "30m": 30, "60m": 60}
TW_OFFSET_MS = 8 * 3600 * 1000


def minute_index(ts: pd.Series) -> pd.Series:
    """ts 為 Shioaji 的台灣時間。Shioaji 1分K 以「結束時間」標示（09:01 = 09:00~09:01）。
    若資料最早時間是 09:00，視為以開始時間標示。"""
    mins = ts.dt.hour * 60 + ts.dt.minute - 9 * 60
    start_labeled = (mins.groupby(ts.dt.date).transform("min") == 0)
    m = mins + start_labeled.astype(int)
    return m.clip(lower=1, upper=270)


def resample_minutes(df1: pd.DataFrame, n: int) -> pd.DataFrame:
    """df1：ts, open, high, low, close, volume（1分K）。回傳 n 分K，ts 為開始時間。"""
    if df1.empty:
        return df1
    df = df1.sort_values("ts").copy()
    df["m"] = minute_index(df["ts"])
    df["b"] = np.ceil(df["m"] / n).astype(int)
    df["d"] = df["ts"].dt.normalize()
    g = df.groupby(["d", "b"], sort=True)
    out = g.agg(open=("open", "first"), high=("high", "max"), low=("low", "min"),
                close=("close", "last"), volume=("volume", "sum")).reset_index()
    out["ts"] = out["d"] + pd.Timedelta(hours=9) + pd.to_timedelta((out["b"] - 1) * n, unit="m")
    return out[["ts", "open", "high", "low", "close", "volume"]]


def resample_daily(daily: pd.DataFrame, rule: str) -> pd.DataFrame:
    """daily：date, open, high, low, close, volume。rule='W'（週，週一為一週開始）或 'M'（月）。
    回傳的 date 為該週 / 月第一個交易日。"""
    if daily.empty:
        return daily
    df = daily.sort_values("date").copy()
    dt = pd.to_datetime(df["date"])
    if rule == "W":
        key = (dt - pd.to_timedelta(dt.dt.weekday, unit="D")).dt.date
    elif rule == "M":
        key = dt.dt.to_period("M").astype(str)
    else:
        raise ValueError(rule)
    df["k"] = key.values
    g = df.groupby("k", sort=True)
    out = g.agg(date=("date", "first"), last_date=("date", "last"), open=("open", "first"),
                high=("high", "max"), low=("low", "min"), close=("close", "last"),
                volume=("volume", "sum")).reset_index(drop=True)
    return out


# ---------- 分鐘K 檔案格式（Supabase Storage：minute/m1/{code}.json.gz） ----------
def to_minute_file(code: str, df1: pd.DataFrame) -> bytes:
    """t 為 UTC 毫秒（K 棒開始時間）。"""
    df = df1.sort_values("ts")
    m = minute_index(df["ts"])  # 結束時間 → 第幾分鐘 → 開始時間
    start_ts = df["ts"].dt.normalize() + pd.Timedelta(hours=9) + pd.to_timedelta(m - 1, unit="m")
    t = ((start_ts - pd.Timestamp("1970-01-01")) // pd.Timedelta(milliseconds=1) - TW_OFFSET_MS).astype("int64").tolist()
    payload = {
        "code": code, "tf": "1m", "t": t,
        "o": [float(x) for x in df["open"]], "h": [float(x) for x in df["high"]],
        "l": [float(x) for x in df["low"]], "c": [float(x) for x in df["close"]],
        "v": [int(x) for x in df["volume"]],
    }
    return gzip.compress(json.dumps(payload, separators=(",", ":")).encode())


def from_minute_file(raw: bytes) -> pd.DataFrame:
    """讀回來的 ts 是「開始時間」；轉回 Shioaji 的結束時間標示，讓 resample 規則一致。"""
    js = json.loads(gzip.decompress(raw))
    if not js.get("t"):
        return pd.DataFrame(columns=["ts", "open", "high", "low", "close", "volume"])
    ts = pd.to_datetime(pd.Series(js["t"]) + TW_OFFSET_MS, unit="ms") + pd.Timedelta(minutes=1)
    return pd.DataFrame({"ts": ts, "open": js["o"], "high": js["h"], "low": js["l"],
                         "close": js["c"], "volume": js["v"]})


def keep_last_days(df1: pd.DataFrame, days: int) -> pd.DataFrame:
    if df1.empty:
        return df1
    d = df1["ts"].dt.normalize()
    keep = sorted(d.unique())[-days:]
    return df1[d.isin(keep)].reset_index(drop=True)


def safe(v):
    return None if v is None or (isinstance(v, float) and math.isnan(v)) else v
