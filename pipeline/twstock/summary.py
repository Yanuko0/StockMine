"""首頁用的「大盤總覽」：每天收盤後算一次，存在 app_settings.market_summary（網頁只要讀一筆，很快）。

內容：加權指數、漲跌家數、漲停跌停、成交值、各產業漲跌（等權重 / 市值加權）、
法人買賣超排行（外資、投信）、漲幅 / 跌幅 / 成交值排行。
"""
from __future__ import annotations

import json
from datetime import date, timedelta

import pandas as pd

from . import db

TOP = 20


def _rank(df: pd.DataFrame, col: str, asc: bool, n: int = TOP, extra: tuple[str, ...] = ()) -> list[dict]:
    d = df.dropna(subset=[col]).sort_values(col, ascending=asc).head(n)
    cols = ["code", "name", "close", "pct", *extra, col]
    out = []
    for r in d[list(dict.fromkeys(cols))].to_dict("records"):
        out.append({k: (round(float(v), 2) if isinstance(v, float) else (int(v) if hasattr(v, "item") and float(v).is_integer() else v))
                    for k, v in r.items()})
    return out


def compute(conn, d: date) -> dict | None:
    prev_row = db.query_df(conn, "select max(date) as d from public.daily_prices where date < %s and code <> 'TAIEX'", (d,))
    pd_ = prev_row["d"][0] if not prev_row.empty else None
    if pd_ is None:
        return None
    px = db.query_df(conn, """select p.code, p.date, p.close, p.volume, p.amount, s.name, s.kind, s.market, s.industry, s.shares
                              from public.daily_prices p join public.stocks s on s.code = p.code
                              where p.date in (%s, %s)""", (pd_, d))
    if px.empty:
        return None
    for c in ("close", "volume", "amount", "shares"):
        px[c] = pd.to_numeric(px[c], errors="coerce")
    today = px[px["date"] == d].set_index("code")
    prev = px[px["date"] == pd_].set_index("code")["close"]
    today = today.assign(prev=prev.reindex(today.index))
    today["pct"] = (today["close"] / today["prev"] - 1) * 100
    today["chg"] = today["close"] - today["prev"]
    today = today.reset_index()

    # 加權指數
    taiex = None
    t = today[today["code"] == "TAIEX"]
    if not t.empty:
        spark = db.query_df(conn, "select close from public.daily_prices where code = 'TAIEX' and date <= %s and date > %s order by date",
                            (d, d - timedelta(days=120)))
        r = t.iloc[0]
        taiex = {"close": round(float(r["close"]), 2), "chg": round(float(r["chg"]), 2) if pd.notna(r["chg"]) else None,
                 "pct": round(float(r["pct"]), 2) if pd.notna(r["pct"]) else None,
                 "spark": [round(float(x), 2) for x in spark["close"].tail(60)]}

    st = today[(today["kind"] == "stock") & today["pct"].notna()].copy()
    st["lots"] = (st["volume"] / 1000).round()
    st["amount_e"] = (st["amount"] / 1e8).round(2)          # 成交值（億）
    st["mcap"] = st["shares"] * st["close"] / 1e8            # 市值（億）
    breadth = {
        "up": int((st["pct"] > 0).sum()), "down": int((st["pct"] < 0).sum()), "flat": int((st["pct"] == 0).sum()),
        "limit_up": int((st["pct"] >= 9.5).sum()), "limit_down": int((st["pct"] <= -9.5).sum()),
        "amount": round(float(today[today["code"] != "TAIEX"]["amount"].sum() / 1e8), 1),
        "twse_amount": round(float(today[today["market"] == "TWSE"]["amount"].sum() / 1e8), 1),
        "tpex_amount": round(float(today[today["market"] == "TPEX"]["amount"].sum() / 1e8), 1),
    }

    # 漲跌幅分布（三竹的長條圖）：<-5、-5~-3、-3~-2、-2~-1、-1~0、0、0~1、1~2、2~3、3~5、>5
    edges = [-5, -3, -2, -1, 0]
    p_ = st["pct"].round(2)
    dist = [int((p_ < -5).sum())]
    for lo, hi in zip(edges[:-1], edges[1:]):
        dist.append(int(((p_ >= lo) & (p_ < hi)).sum()))
    dist.append(int((p_ == 0).sum()))
    for lo, hi in [(0, 1), (1, 2), (2, 3), (3, 5)]:
        dist.append(int(((p_ > lo) & (p_ <= hi)).sum()))
    dist.append(int((p_ > 5).sum()))
    breadth["dist"] = dist

    # 創月新高 / 新低：今天最高（最低）超過前 20 個交易日的最高（最低）
    try:
        hl = db.query_df(conn, """select code, date, high, low from public.daily_prices
                                  where code <> 'TAIEX' and date <= %s and date > %s""", (d, d - timedelta(days=45)))
        hl["high"] = pd.to_numeric(hl["high"], errors="coerce")
        hl["low"] = pd.to_numeric(hl["low"], errors="coerce")
        days = sorted(hl["date"].unique())[-21:]
        hl = hl[hl["date"].isin(days)]
        cur = hl[hl["date"] == d].set_index("code")
        past = hl[hl["date"] != d].groupby("code").agg(h=("high", "max"), l=("low", "min"))
        j = cur.join(past, how="inner")
        j = j[j.index.isin(st["code"])]
        breadth["month_high"] = int((j["high"] > j["h"]).sum())
        breadth["month_low"] = int((j["low"] < j["l"]).sum())
    except Exception:  # noqa: BLE001
        pass

    # 產業漲跌
    inds = []
    for name, g in st[st["industry"].notna()].groupby("industry"):
        if len(g) < 3:
            continue
        w = g["mcap"].fillna(0)
        wpct = float((g["pct"] * w).sum() / w.sum()) if w.sum() > 0 else float(g["pct"].mean())
        lead = g.sort_values("mcap", ascending=False).iloc[0]
        inds.append({"name": name, "count": int(len(g)), "up": int((g["pct"] > 0).sum()), "down": int((g["pct"] < 0).sum()),
                     "pct": round(wpct, 2), "avg": round(float(g["pct"].mean()), 2),
                     "leader": {"code": lead["code"], "name": lead["name"], "pct": round(float(lead["pct"]), 2)}})
    inds.sort(key=lambda x: -x["pct"])

    # 法人排行（張）
    inst = db.query_df(conn, "select code, foreign_net, trust_net, dealer_net from public.institutional where date = %s", (d,))
    ranks = {}
    if not inst.empty:
        m = st.merge(inst, on="code", how="inner")
        for k in ("foreign_net", "trust_net", "dealer_net"):
            m[k] = (pd.to_numeric(m[k], errors="coerce") / 1000).round()
        ranks = {
            "foreign_buy": _rank(m, "foreign_net", False), "foreign_sell": _rank(m, "foreign_net", True),
            "trust_buy": _rank(m, "trust_net", False), "trust_sell": _rank(m, "trust_net", True),
        }
    movers = {
        "gainers": _rank(st, "pct", False, extra=("lots",)), "losers": _rank(st, "pct", True, extra=("lots",)),
        "amount": _rank(st, "amount_e", False, extra=("pct",)),
    }
    return {"date": d.isoformat(), "prev_date": pd_.isoformat(), "taiex": taiex, "breadth": breadth,
            "industries": inds, "inst": ranks, "movers": movers}


def _clean(o):
    """NaN / numpy 型別 → JSON 可用的值"""
    if isinstance(o, dict):
        return {k: _clean(v) for k, v in o.items()}
    if isinstance(o, list):
        return [_clean(v) for v in o]
    if hasattr(o, "item"):
        o = o.item()
    if isinstance(o, float) and o != o:
        return None
    return o


def update(conn, d: date) -> str:
    s = compute(conn, d)
    if not s:
        return "大盤總覽：沒有資料"
    db.execute(conn, """insert into public.app_settings (key, value) values ('market_summary', %s::jsonb)
                        on conflict (key) do update set value = excluded.value""", (json.dumps(_clean(s), ensure_ascii=False, allow_nan=False),))
    return f"大盤總覽（{len(s['industries'])} 個產業）"
