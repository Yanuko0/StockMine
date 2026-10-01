"""FinMind：免費版用來「一次補齊歷史日K / 法人 / 融資融券」。
免費會員每小時 600 次，程式會自動放慢速度。
分點資料（TaiwanStockTradingDailyReport）需要 Sponsor 付費方案才能用。
"""
from __future__ import annotations

import time
from datetime import date

import pandas as pd

from .. import config
from .http import client

API = "https://api.finmindtrade.com/api/v4/data"
_last_call = 0.0
MIN_INTERVAL = 6.2  # 3600 / 600 ≈ 6 秒一次，不會超過免費額度


class LimitReached(RuntimeError):
    """FinMind 這個小時的免費額度用完了"""


def fetch(dataset: str, data_id: str | None = None, start: date | None = None,
          end: date | None = None, wait_on_limit: bool = True) -> pd.DataFrame:
    global _last_call
    wait = MIN_INTERVAL - (time.time() - _last_call)
    if wait > 0:
        time.sleep(wait)
    params = {"dataset": dataset}
    if data_id:
        params["data_id"] = data_id
    if start:
        params["start_date"] = start.isoformat()
    if end:
        params["end_date"] = end.isoformat()
    headers = {}
    if config.FINMIND_TOKEN:
        headers["Authorization"] = f"Bearer {config.FINMIND_TOKEN}"
    for attempt in range(5):
        _last_call = time.time()
        r = client().get(API, params=params, headers=headers)
        if r.status_code == 402 or (r.status_code == 200 and r.json().get("status") == 402):
            if not wait_on_limit:
                raise LimitReached("FinMind 每小時額度用完")
            print("[finmind] 達到每小時上限，等 10 分鐘…")
            time.sleep(600)
            continue
        r.raise_for_status()
        js = r.json()
        if js.get("status") not in (200, None):
            raise RuntimeError(f"FinMind 錯誤：{js.get('msg')}")
        return pd.DataFrame(js.get("data", []))
    raise RuntimeError("FinMind 重試多次仍失敗")


def stock_info() -> pd.DataFrame:
    df = fetch("TaiwanStockInfo")
    if df.empty:
        return df
    df = df[df["type"].isin(["twse", "tpex"])]
    df = df.drop_duplicates("stock_id", keep="last")
    return pd.DataFrame({
        "code": df["stock_id"], "name": df["stock_name"],
        "market": df["type"].map({"twse": "TWSE", "tpex": "TPEX"}),
    })


def daily_prices(code: str, start: date, end: date) -> pd.DataFrame:
    df = fetch("TaiwanStockPrice", code, start, end)
    if df.empty:
        return df
    return pd.DataFrame({
        "code": code, "date": pd.to_datetime(df["date"]).dt.date,
        "open": df["open"], "high": df["max"], "low": df["min"], "close": df["close"],
        "volume": df["Trading_Volume"].astype("int64"), "amount": df["Trading_money"].astype("int64"),
        "trades": df["Trading_turnover"].astype("int64"),
    })


def institutional(code: str, start: date, end: date) -> pd.DataFrame:
    df = fetch("TaiwanStockInstitutionalInvestorsBuySell", code, start, end)
    if df.empty:
        return df
    df["net"] = df["buy"] - df["sell"]
    p = df.pivot_table(index="date", columns="name", values="net", aggfunc="sum").fillna(0)
    g = lambda *cols: sum(p[c] for c in cols if c in p.columns)  # noqa: E731
    out = pd.DataFrame({
        "foreign_net": g("Foreign_Investor", "Foreign_Dealer_Self"),
        "trust_net": g("Investment_Trust"),
        "dealer_net": g("Dealer_self", "Dealer_Hedging"),
    })
    out["total_net"] = out.sum(axis=1)
    out = out.reset_index()
    out["date"] = pd.to_datetime(out["date"]).dt.date
    out.insert(0, "code", code)
    return out.astype({c: "int64" for c in ["foreign_net", "trust_net", "dealer_net", "total_net"]})


def margin(code: str, start: date, end: date) -> pd.DataFrame:
    df = fetch("TaiwanStockMarginPurchaseShortSale", code, start, end)
    if df.empty:
        return df
    return pd.DataFrame({
        "code": code, "date": pd.to_datetime(df["date"]).dt.date,
        "margin_buy": df["MarginPurchaseBuy"], "margin_sell": df["MarginPurchaseSell"],
        "margin_balance": df["MarginPurchaseTodayBalance"],
        "short_sell": df["ShortSaleSell"], "short_buy": df["ShortSaleBuy"],
        "short_balance": df["ShortSaleTodayBalance"],
    })


def broker_report(code: str, d: date) -> pd.DataFrame:
    """分點（需要 FinMind Sponsor）。回傳：broker_id, broker_name, price, buy, sell（股）。"""
    df = fetch("TaiwanStockTradingDailyReport", code, d, d)
    if df.empty:
        return df
    return pd.DataFrame({
        "broker_id": df["securities_trader_id"].astype(str), "broker_name": df["securities_trader"],
        "price": df["price"].astype(float), "buy": df["buy"].astype("int64"), "sell": df["sell"].astype("int64"),
    })
