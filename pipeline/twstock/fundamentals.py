"""選股用的額外資料：加權指數、除權息（現金殖利率）、年度財報（稅後淨利率）。"""
from __future__ import annotations

import time
from datetime import date, datetime, timedelta, timezone

import pandas as pd

from . import db
from .sources import finmind, official
from .sources.http import get_json, to_num

TWSE = "https://www.twse.com.tw/rwd/zh"
TPEX = "https://www.tpex.org.tw/www/zh-tw"


def _roc_to_date(s: str) -> date | None:
    """'115/09/01'、'114年07月01日' → date"""
    s = str(s).strip().replace("年", "/").replace("月", "/").replace("日", "")
    try:
        y, m, d = [int(x) for x in s.split("/")[:3]]
        return date(y + 1911, m, d)
    except Exception:  # noqa: BLE001
        return None


# ---------------- 加權指數 ----------------
def taiex_month(d: date) -> pd.DataFrame:
    js = get_json(f"{TWSE}/TAIEX/MI_5MINS_HIST", {"date": d.strftime("%Y%m01"), "response": "json"})
    rows = []
    for r in js.get("data") or []:
        dt = _roc_to_date(r[0])
        if dt:
            rows.append({"code": "TAIEX", "date": dt, "open": to_num(r[1]), "high": to_num(r[2]),
                         "low": to_num(r[3]), "close": to_num(r[4]), "volume": 0, "amount": 0, "trades": 0})
    return pd.DataFrame(rows)


def update_taiex(conn, d: date) -> str:
    db.execute(conn, """insert into public.stocks (code, name, market, kind) values ('TAIEX','加權指數','TWSE','index')
                        on conflict (code) do nothing""")
    n = int(db.query_df(conn, "select count(*) as n from public.daily_prices where code = 'TAIEX'")["n"][0])
    months = 62 if n < 1000 else 1  # 第一次補 5 年
    frames = []
    m = date(d.year, d.month, 1)
    for _ in range(months):
        try:
            frames.append(taiex_month(m))
        except Exception as e:  # noqa: BLE001
            print(f"[taiex] {m} 失敗：{e}")
        m = (m - timedelta(days=1)).replace(day=1)
    df = pd.concat(frames, ignore_index=True) if frames else pd.DataFrame()
    if not df.empty:
        db.upsert(conn, "daily_prices", df, ["code", "date"])
    return f"加權指數 {len(df)} 筆"


# ---------------- 除權息 ----------------
def twse_dividends(start: date, end: date) -> pd.DataFrame:
    js = get_json(f"{TWSE}/exRight/TWT49U", {"startDate": start.strftime("%Y%m%d"),
                                             "endDate": end.strftime("%Y%m%d"), "response": "json"})
    f = js.get("fields") or []
    if not f:
        return pd.DataFrame()
    i_d, i_c, i_pre, i_v, i_t = (f.index("資料日期"), f.index("股票代號"), f.index("除權息前收盤價"),
                                 f.index("權值+息值"), f.index("權/息"))
    rows = []
    for r in js.get("data") or []:
        code = str(r[i_c]).strip()
        if not official.keep_code(code) or "息" not in str(r[i_t]):
            continue
        # 證交所的總表只給「權值+息值」；純除息時就是現金股利。除權息同時發生時會略為高估
        rows.append({"code": code, "ex_date": _roc_to_date(r[i_d]), "cash": to_num(r[i_v]), "pre_close": to_num(r[i_pre])})
    return pd.DataFrame(rows)


def tpex_dividends(start: date, end: date) -> pd.DataFrame:
    js = get_json(f"{TPEX}/bulletin/exDailyQ", {"startDate": start.strftime("%Y/%m/%d"),
                                                "endDate": end.strftime("%Y/%m/%d"), "response": "json"})
    rows = []
    for t in js.get("tables") or []:
        f = t.get("fields") or []
        if "現金股利" not in f:
            continue
        i_d, i_c, i_pre, i_cash = f.index("除權息日期"), f.index("代號"), f.index("除權息前收盤價"), f.index("現金股利")
        for r in t.get("data") or []:
            code = str(r[i_c]).strip()
            cash = to_num(r[i_cash])
            if official.keep_code(code) and cash:
                rows.append({"code": code, "ex_date": _roc_to_date(r[i_d]), "cash": cash, "pre_close": to_num(r[i_pre])})
    return pd.DataFrame(rows)


DIV_VERSION = "2"  # 版本變了就整個重抓（v2：修正同一筆除息被重複加總）


def update_dividends(conn, d: date, force: bool = False) -> str:
    """每 7 天更新一次；第一次（或資料版本更新）抓近 6 年。"""
    ver = str(db.get_setting(conn, "dividends_version", "") or "").strip('"')
    full = ver != DIV_VERSION
    last = db.get_setting(conn, "dividends_updated", None)
    if not force and not full and last and (d - date.fromisoformat(str(last).strip('"'))).days < 7:
        return "除權息：本週已更新"
    have = int(db.query_df(conn, "select count(*) as n from public.dividends")["n"][0])
    full = full or have < 1000
    start = date(d.year - 6, 1, 1) if full else d - timedelta(days=120)
    frames = []
    s = start
    while s <= d:
        e = min(s + timedelta(days=89), d)  # 一次查一季
        for fn in (twse_dividends, tpex_dividends):
            try:
                x = fn(s, e)
                if not x.empty:  # 網站有時會回傳查詢區間以外的資料：只留這一段的，避免重複
                    x = x[(pd.to_datetime(x["ex_date"]).dt.date >= s) & (pd.to_datetime(x["ex_date"]).dt.date <= e)]
                frames.append(x)
            except Exception as ex:  # noqa: BLE001
                print(f"[dividends] {fn.__name__} {s}~{e} 失敗：{ex}")
        s = e + timedelta(days=1)
    df = pd.concat(frames, ignore_index=True) if frames else pd.DataFrame()
    if not df.empty:
        # 同一筆除息（同代號、同日、同金額）只算一次；同一天真的有兩筆不同的才加總
        df = df.dropna(subset=["ex_date"]).drop_duplicates(["code", "ex_date", "cash"])
        df = df.groupby(["code", "ex_date"], as_index=False).agg(cash=("cash", "sum"), pre_close=("pre_close", "first"))
        if full:
            db.execute(conn, "delete from public.dividends where ex_date >= %s", (start,))
        db.upsert(conn, "dividends", df, ["code", "ex_date"])
        if full:
            db.execute(conn, """insert into public.app_settings (key, value) values ('dividends_version', to_jsonb(%s::text))
                                on conflict (key) do update set value = excluded.value""", (DIV_VERSION,))
    db.execute(conn, """insert into public.app_settings (key, value) values ('dividends_updated', to_jsonb(%s::text))
                        on conflict (key) do update set value = excluded.value""", (d.isoformat(),))
    return f"除權息 {len(df)} 筆"


# ---------------- 年度財報（FinMind，每天輪流更新） ----------------
def update_financials(conn, d: date, budget_sec: int = 600) -> str:
    stocks = db.query_df(conn, """select s.code from public.stocks s
                                  left join public.fin_status f on f.code = s.code
                                  where s.kind = 'stock' and (f.updated_at is null or f.updated_at < now() - interval '45 days'
                                        or not exists (select 1 from public.fin_quarter q where q.code = s.code))
                                  order by f.updated_at nulls first, s.code""")
    t0 = time.time()
    done = 0
    limited = False
    for code in stocks["code"]:
        if time.time() - t0 > budget_sec:
            break
        try:
            df = finmind.fetch("TaiwanStockFinancialStatements", code, date(d.year - 6, 1, 1), d, wait_on_limit=False)
        except finmind.LimitReached:
            limited = True
            break
        except Exception as e:  # noqa: BLE001
            print(f"[fin] {code} 失敗：{e}")
            continue
        rows = []
        if not df.empty:
            df["year"] = pd.to_datetime(df["date"]).dt.year
            p = df[df["type"].isin(["Revenue", "IncomeAfterTaxes"])].pivot_table(
                index=["year", "date"], columns="type", values="value", aggfunc="sum").reset_index()
            for y, g in p.groupby("year"):
                rows.append({"code": code, "year": int(y),
                             "revenue": float(g["Revenue"].sum()) if "Revenue" in g else None,
                             "net_income": float(g["IncomeAfterTaxes"].sum()) if "IncomeAfterTaxes" in g else None,
                             "quarters": int(len(g))})
        if rows:
            db.upsert(conn, "fin_yearly", pd.DataFrame(rows), ["code", "year"])
        # 每季：營收、營業利益、稅前淨利、稅後淨利（最近 8 季）
        if not df.empty:
            q = df[df["type"].isin(["Revenue", "OperatingIncome", "PreTaxIncome", "IncomeAfterTaxes"])].pivot_table(
                index="date", columns="type", values="value", aggfunc="sum").reset_index().tail(8)
            qrows = [{"code": code, "date": pd.to_datetime(r["date"]).date(),
                      "revenue": r.get("Revenue"), "op_income": r.get("OperatingIncome"),
                      "pretax": r.get("PreTaxIncome"), "net_income": r.get("IncomeAfterTaxes")} for _, r in q.iterrows()]
            if qrows:
                db.upsert(conn, "fin_quarter", pd.DataFrame(qrows), ["code", "date"])
        db.upsert(conn, "fin_status", [{"code": code, "updated_at": datetime.now(timezone.utc)}], ["code"])
        done += 1
    left = max(len(stocks) - done, 0)
    return f"財報 {done} 檔（還有 {left} 檔待更新）" + ("；FinMind 本小時額度已用完，下次再繼續" if limited else "")


# ---------------- 給選股器用的彙總 ----------------
def yearly_yields(div: pd.DataFrame, years: list[int]) -> dict[str, list[float]]:
    """每檔股票每年的現金殖利率（%）＝ 當年每次除息的 現金股利 / 除息前收盤 加總；沒配息的年份算 0。"""
    out: dict[str, list[float]] = {}
    if div.empty:
        return out
    div = div.copy()
    div["year"] = pd.to_datetime(div["ex_date"]).dt.year
    div["y"] = div["cash"].astype(float) / div["pre_close"].astype(float) * 100
    g = div[div["year"].isin(years)].groupby(["code", "year"])["y"].sum()
    for code in div["code"].unique():
        out[code] = [float(g.get((code, y), 0.0)) for y in years]
    return out


def yearly_margins(fin: pd.DataFrame, years: list[int]) -> dict[str, list[float | None]]:
    """每年稅後淨利率（%）；資料不足四季的年份當作沒有資料（None）。"""
    out: dict[str, list[float | None]] = {}
    if fin.empty:
        return out
    for code, g in fin.groupby("code"):
        m = {}
        for r in g.itertuples():
            if r.quarters and r.quarters >= 4 and r.revenue and float(r.revenue) != 0 and r.net_income is not None:
                m[int(r.year)] = float(r.net_income) / float(r.revenue) * 100
        out[code] = [m.get(y) for y in years]
    return out
