"""大表的本機快取：日K、三大法人、主力、融資。

為什麼：Supabase 免費方案每月只有 5 GB 流量（資料從資料庫傳出去就算）。
選股、盤中選股、個股展望每次都讀全市場 1～5 年的日K，一次幾十到上百 MB，很快就用完。

做法：資料存成 GitHub Actions 快取裡的 parquet 檔（pipeline/.cache/tables），每次只問資料庫
「每一天有幾筆、加總多少」（一天一列，很小），跟快取比對，只重新下載「新的日子」和「有變動的日子」。
最近 3 天一律重抓（法人晚公布、資料更正）。沒有快取時（例如本機測試）就整段從資料庫讀，結果完全一樣。

有更新時會留下 .fresh 檔，workflow 看到才把快取存回 GitHub。
"""
from __future__ import annotations

import os
import time
from datetime import date, timedelta
from pathlib import Path

import numpy as np
import pandas as pd

from . import db

CACHE_DIR = Path(os.environ.get("TABLE_CACHE_DIR") or Path(__file__).resolve().parent.parent / ".cache" / "tables")
RECENT_DAYS = 3  # 最近幾個有資料的日子一律重抓

# 表 → (欄位, 用來比對的欄位)
TABLES: dict[str, tuple[list[str], list[str]]] = {
    "daily_prices": (["open", "high", "low", "close", "volume", "amount"], ["close", "volume"]),
    "institutional": (["foreign_net", "trust_net", "dealer_net", "total_net"], ["foreign_net", "total_net"]),
    "main_force": (["top_buy", "top_sell", "net", "broker_cnt"], ["net", "top_buy"]),
    "margin": (["margin_buy", "margin_sell", "margin_balance", "short_sell", "short_buy", "short_balance"],
               ["margin_balance", "short_balance"]),
}
_MEM: dict[str, tuple[pd.DataFrame, date, date, float]] = {}  # 同一次執行內：剛同步過就不再問資料庫
_STATS = {"rows_db": 0, "rows_cache": 0}


def _file(table: str) -> Path:
    return CACHE_DIR / f"{table}.parquet"


def _read(table: str) -> pd.DataFrame | None:
    f = _file(table)
    if not f.exists():
        return None
    try:
        df = pd.read_parquet(f)
        df["date"] = pd.to_datetime(df["date"]).dt.date
        return df
    except Exception as e:  # noqa: BLE001  檔案壞了就重建
        print(f"[cache] {table} 快取讀取失敗，重建：{e}")
        return None


def _write(table: str, df: pd.DataFrame) -> None:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    tmp = _file(table).with_suffix(".tmp")
    df.to_parquet(tmp, index=False)
    tmp.replace(_file(table))
    (CACHE_DIR / ".fresh").write_text("1")


def _numeric(df: pd.DataFrame, cols: list[str]) -> pd.DataFrame:
    for c in cols:
        if c in df.columns:
            df[c] = pd.to_numeric(df[c], errors="coerce").astype("float64")
    return df


def _summary(conn, table: str, since: date, until: date) -> pd.DataFrame:
    _, check = TABLES[table]
    sums = ", ".join(f"coalesce(sum({c}), 0)::float8 as s_{c}" for c in check)
    return db.query_df(conn, f"select date, count(*) as n, {sums} from public.{table} "
                             f"where date >= %s and date <= %s group by date", (since, until))


def _local_summary(df: pd.DataFrame, check: list[str]) -> pd.DataFrame:
    if df is None or df.empty:
        return pd.DataFrame(columns=["date", "n"] + [f"s_{c}" for c in check])
    g = df.groupby("date")
    out = g.size().rename("n").to_frame()
    for c in check:
        out[f"s_{c}"] = g[c].sum()
    return out.reset_index()


def sync(conn, table: str, since: date, until: date) -> pd.DataFrame:
    """讓快取裡 since～until 的資料跟資料庫一致，回傳整份快取（所有股票）。"""
    cols, check = TABLES[table]
    mem = _MEM.get(table)
    if mem and mem[1] <= since and mem[2] >= until and time.time() - mem[3] < 600:
        return mem[0]
    cached = _read(table)
    remote = _summary(conn, table, since, until)
    remote = _numeric(remote, [f"s_{c}" for c in check])
    local = _local_summary(cached[(cached["date"] >= since) & (cached["date"] <= until)] if cached is not None else None, check)
    m = remote.merge(local, on="date", how="left", suffixes=("", "_l"))
    bad = m["n_l"].isna() | (m["n"] != m["n_l"])
    for c in check:
        a, b = m[f"s_{c}"].astype(float), m[f"s_{c}_l"].astype(float)
        bad |= ~np.isclose(a, b, rtol=1e-9, atol=1e-6)  # 快取沒有這天（NaN）也算不一樣
    recent = set(sorted(remote["date"])[-RECENT_DAYS:]) if len(remote) else set()
    need = sorted(set(m.loc[bad, "date"]) | recent)
    gone = set(local["date"]) - set(remote["date"])  # 資料庫已經刪掉的日子
    changed = False
    df = cached if cached is not None else pd.DataFrame(columns=["code", "date"] + cols)
    if gone:
        df = df[~df["date"].isin(gone)]
        changed = True
    if need:
        got = []
        for i in range(0, len(need), 60):  # 分批，避免一次太大
            chunk = need[i:i + 60]
            got.append(db.query_df(conn, f"select code, date, {', '.join(cols)} from public.{table} where date = any(%s)", (chunk,)))
        new = pd.concat(got, ignore_index=True) if got else pd.DataFrame(columns=["code", "date"] + cols)
        new = _numeric(new, cols)
        new["code"] = new["code"].astype(str)
        _STATS["rows_db"] += len(new)
        old = df[df["date"].isin(need)]
        key = ["code", "date"]
        same = len(old) == len(new) and old.sort_values(key).reset_index(drop=True)[key + cols].astype(str).equals(
            new.sort_values(key).reset_index(drop=True)[key + cols].astype(str))
        if not same:  # 重抓的最近幾天跟快取一樣就不用存（GitHub 快取不必每次重傳）
            df = pd.concat([df[~df["date"].isin(need)], new], ignore_index=True)
            changed = True
    df = _numeric(df, cols)
    df["code"] = df["code"].astype(str)
    df = df.sort_values(["code", "date"]).reset_index(drop=True)
    if changed:
        _write(table, df)
    _STATS["rows_cache"] += len(df)
    print(f"[cache] {table}：{since}～{until} 共 {len(remote)} 天，從資料庫讀 {len(need)} 天"
          + (f"、刪掉 {len(gone)} 天" if gone else ""))
    _MEM[table] = (df, since, until, time.time())
    return df


def load(conn, table: str, since: date, until: date, codes: list[str] | None = None,
         cols: list[str] | None = None) -> pd.DataFrame:
    """讀 table 在 since～until（含）的資料（可指定股票、欄位），依 code, date 排序。"""
    df = sync(conn, table, since, until)
    out = df[(df["date"] >= since) & (df["date"] <= until)]
    if codes is not None:
        out = out[out["code"].isin(set(codes))]
    keep = ["code", "date"] + (cols or TABLES[table][0])
    return out[keep].reset_index(drop=True)


def stats() -> str:
    return f"資料庫讀 {_STATS['rows_db']:,} 列"


def reset_memory() -> None:
    _MEM.clear()


def years_ago(d: date, years: float) -> date:
    return d - timedelta(days=int(365.25 * years))
