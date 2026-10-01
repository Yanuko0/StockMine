"""證交所（上市）與櫃買中心（上櫃）盤後公開資料。

欄位用「名稱關鍵字」對應，官方調整欄位順序時比較不會壞掉。
"""
from __future__ import annotations

import re
from datetime import date

import pandas as pd

from .http import get_json, to_int, to_num

TWSE = "https://www.twse.com.tw/rwd/zh"
TPEX = "https://www.tpex.org.tw/www/zh-tw"
TPEX_OPENAPI = "https://www.tpex.org.tw/openapi/v1"

CODE_RE = re.compile(r"^(\d{4}|00\d{2,4}[A-Z]?)$")


def keep_code(code: str) -> bool:
    """只保留一般股票（4 碼）和 ETF（00 開頭）；排除權證、債券等。"""
    return bool(CODE_RE.match(code.strip()))


def kind_of(code: str) -> str:
    return "etf" if code.startswith("00") else "stock"


def roc(d: date, sep: str = "/") -> str:
    return f"{d.year - 1911}{sep}{d.month:02d}{sep}{d.day:02d}"


def _find(fields: list[str], *must: str, exclude: tuple[str, ...] = (), last: bool = False) -> int | None:
    hits = [
        i for i, f in enumerate(fields)
        if all(m in f for m in must) and not any(x in f for x in exclude)
    ]
    if not hits:
        return None
    return hits[-1] if last else hits[0]


def _tables(js: dict) -> list[dict]:
    if "tables" in js:
        return js["tables"] or []
    if "fields" in js and "data" in js:
        return [{"title": js.get("title", ""), "fields": js["fields"], "data": js["data"]}]
    return []


def _table_with(js: dict, *field_names: str) -> dict | None:
    for t in _tables(js):
        fields = [str(f) for f in (t.get("fields") or [])]
        if all(any(n in f for f in fields) for n in field_names) and t.get("data"):
            return {"fields": fields, "data": t["data"]}
    return None


# ---------------- 日K ----------------
def twse_quotes(d: date) -> pd.DataFrame:
    js = get_json(f"{TWSE}/afterTrading/MI_INDEX",
                  {"date": d.strftime("%Y%m%d"), "type": "ALLBUT0999", "response": "json"})
    t = _table_with(js, "證券代號", "收盤價")
    if not t:
        return pd.DataFrame()
    f = t["fields"]
    ic, iname = _find(f, "證券代號"), _find(f, "證券名稱")
    io, ih, il, icl = _find(f, "開盤價"), _find(f, "最高價"), _find(f, "最低價"), _find(f, "收盤價")
    iv, ia, it = _find(f, "成交股數"), _find(f, "成交金額"), _find(f, "成交筆數")
    rows = []
    for r in t["data"]:
        code = str(r[ic]).strip()
        if not keep_code(code):
            continue
        rows.append({
            "code": code, "name": str(r[iname]).strip(), "market": "TWSE",
            "date": d, "open": to_num(r[io]), "high": to_num(r[ih]), "low": to_num(r[il]),
            "close": to_num(r[icl]), "volume": to_int(r[iv]), "amount": to_int(r[ia]),
            "trades": to_int(r[it]),
        })
    return pd.DataFrame(rows)


def tpex_quotes(d: date) -> pd.DataFrame:
    js = get_json(f"{TPEX}/afterTrading/dailyQuotes", {"date": d.strftime("%Y/%m/%d"), "response": "json"})
    t = _table_with(js, "代號", "收盤")
    if not t:
        return pd.DataFrame()
    # 櫃買中心在沒有資料的日子會回傳前一個交易日，要檢查日期
    js_date = str(js.get("date", "")).replace("/", "")
    if js_date and js_date not in (roc(d, ""), d.strftime("%Y%m%d")):
        return pd.DataFrame()
    f = t["fields"]
    ic, iname = _find(f, "代號"), _find(f, "名稱")
    io, ih, il, icl = _find(f, "開盤"), _find(f, "最高"), _find(f, "最低"), _find(f, "收盤")
    iv = _find(f, "成交股數")
    ia = _find(f, "成交金額")
    it = _find(f, "成交筆數")
    rows = []
    for r in t["data"]:
        code = str(r[ic]).strip()
        if not keep_code(code):
            continue
        rows.append({
            "code": code, "name": str(r[iname]).strip(), "market": "TPEX",
            "date": d, "open": to_num(r[io]), "high": to_num(r[ih]), "low": to_num(r[il]),
            "close": to_num(r[icl]), "volume": to_int(r[iv]),
            "amount": to_int(r[ia]) if ia is not None else None,
            "trades": to_int(r[it]) if it is not None else None,
        })
    return pd.DataFrame(rows)


# ---------------- 三大法人（股） ----------------
def twse_institutional(d: date) -> pd.DataFrame:
    js = get_json(f"{TWSE}/fund/T86",
                  {"date": d.strftime("%Y%m%d"), "selectType": "ALLBUT0999", "response": "json"})
    t = _table_with(js, "證券代號", "三大法人買賣超")
    if not t:
        return pd.DataFrame()
    f = t["fields"]
    ic = _find(f, "證券代號")
    # 「外陸資買賣超股數(不含外資自營商)」+「外資自營商買賣超股數」= 外資合計
    ifo = _find(f, "外陸資買賣超")
    if ifo is None:
        ifo = _find(f, "外資買賣超", exclude=("自營",))
    ifd = _find(f, "外資自營商買賣超")
    itr = _find(f, "投信買賣超")
    ide = _find(f, "自營商買賣超", exclude=("外資", "自行", "避險"))
    itot = _find(f, "三大法人買賣超")
    rows = []
    for r in t["data"]:
        code = str(r[ic]).strip()
        if not keep_code(code):
            continue
        foreign = (to_int(r[ifo]) or 0) + ((to_int(r[ifd]) or 0) if ifd is not None else 0)
        rows.append({
            "code": code, "date": d, "foreign_net": foreign,
            "trust_net": to_int(r[itr]), "dealer_net": to_int(r[ide]), "total_net": to_int(r[itot]),
        })
    return pd.DataFrame(rows)


def tpex_institutional(d: date) -> pd.DataFrame:
    rows = []
    try:
        js = get_json(f"{TPEX}/insti/dailyTrade",
                      {"type": "Daily", "sect": "EW", "date": d.strftime("%Y/%m/%d"), "response": "json"})
        t = _table_with(js, "代號")
    except Exception as e:  # noqa: BLE001
        print(f"[tpex_institutional] 網頁版失敗，改用 OpenAPI：{e}")
        t = None
    if t:
        f = t["fields"]
        ic = _find(f, "代號")
        n = len(f)
        ifo = _find(f, "外資及陸資", "買賣超", exclude=("不含",)) or _find(f, "外資", "買賣超")
        itr = _find(f, "投信", "買賣超")
        ide = _find(f, "自營商", "買賣超", last=True)
        itot = _find(f, "三大法人", "買賣超") or (n - 1)
        # 找不到欄名時用常見欄位位置
        ifo = 10 if ifo is None and n >= 24 else ifo
        itr = 13 if itr is None and n >= 24 else itr
        ide = 22 if ide is None and n >= 24 else ide
        for r in t["data"]:
            code = str(r[ic]).strip()
            if not keep_code(code):
                continue
            rows.append({"code": code, "date": d,
                         "foreign_net": to_int(r[ifo]) if ifo is not None else None,
                         "trust_net": to_int(r[itr]) if itr is not None else None,
                         "dealer_net": to_int(r[ide]) if ide is not None else None,
                         "total_net": to_int(r[itot])})
        return pd.DataFrame(rows)

    # 備援：OpenAPI 只提供最新一天
    data = get_json(f"{TPEX_OPENAPI}/tpex_3insti_daily_trading")
    for o in data:
        o = {k.strip(): v for k, v in o.items()}
        if str(o.get("Date")) != roc(d, ""):
            continue
        code = str(o.get("SecuritiesCompanyCode", "")).strip()
        if not keep_code(code):
            continue
        fo = next((v for k, v in o.items() if k.startswith("ForeignInvestorsInclude") and k.endswith("Difference")), None)
        rows.append({"code": code, "date": d, "foreign_net": to_int(fo),
                     "trust_net": to_int(o.get("SecuritiesInvestmentTrustCompanies-Difference")),
                     "dealer_net": to_int(o.get("Dealers-Difference")),
                     "total_net": to_int(o.get("TotalDifference"))})
    return pd.DataFrame(rows)


# ---------------- 融資融券（張） ----------------
def twse_margin(d: date) -> pd.DataFrame:
    js = get_json(f"{TWSE}/marginTrading/MI_MARGN",
                  {"date": d.strftime("%Y%m%d"), "selectType": "ALL", "response": "json"})
    t = _table_with(js, "代號", "今日餘額")
    if not t:
        return pd.DataFrame()
    rows = []
    for r in t["data"]:
        code = str(r[0]).strip()
        if not keep_code(code) or len(r) < 13:
            continue
        # 欄位：代號,名稱,資買,資賣,現金償還,前日餘額,今日餘額,限額,券買,券賣,現券償還,前日餘額,今日餘額,...
        rows.append({"code": code, "date": d,
                     "margin_buy": to_int(r[2]), "margin_sell": to_int(r[3]), "margin_balance": to_int(r[6]),
                     "short_buy": to_int(r[8]), "short_sell": to_int(r[9]), "short_balance": to_int(r[12])})
    return pd.DataFrame(rows)


def tpex_margin(d: date) -> pd.DataFrame:
    rows = []
    t = None
    try:
        js = get_json(f"{TPEX}/margin/balance", {"date": d.strftime("%Y/%m/%d"), "response": "json"})
        t = _table_with(js, "代號")
    except Exception as e:  # noqa: BLE001
        print(f"[tpex_margin] 網頁版失敗，改用 OpenAPI：{e}")
    if t:
        f = t["fields"]
        ic = _find(f, "代號")
        ib, isl = _find(f, "資買"), _find(f, "資賣")
        imb = _find(f, "資餘額", exclude=("前",))
        ssl, sby = _find(f, "券賣"), _find(f, "券買")
        isb = _find(f, "券餘額", exclude=("前",))
        for r in t["data"]:
            code = str(r[ic]).strip()
            if not keep_code(code):
                continue
            g = lambda i: to_int(r[i]) if i is not None else None  # noqa: E731
            rows.append({"code": code, "date": d, "margin_buy": g(ib), "margin_sell": g(isl),
                         "margin_balance": g(imb), "short_sell": g(ssl), "short_buy": g(sby),
                         "short_balance": g(isb)})
        return pd.DataFrame(rows)

    for name in ("tpex_mainborad_margin_balance", "tpex_mainboard_margin_balance"):
        try:
            data = get_json(f"{TPEX_OPENAPI}/{name}")
            break
        except Exception:  # noqa: BLE001
            data = []
    for o in data:
        o = {k.strip(): v for k, v in o.items()}
        if str(o.get("Date")) != roc(d, ""):
            continue
        code = str(o.get("SecuritiesCompanyCode", "")).strip()
        if not keep_code(code):
            continue
        low = {k.lower(): v for k, v in o.items()}
        pick = lambda *ks: next((to_int(v) for k, v in low.items() if all(x in k for x in ks)), None)  # noqa: E731
        rows.append({"code": code, "date": d,
                     "margin_buy": pick("marginpurchase"),
                     "margin_sell": pick("marginsales"),
                     "margin_balance": pick("margin", "balance"),
                     "short_sell": pick("shortsale"),
                     "short_buy": pick("shortcovering"),
                     "short_balance": pick("short", "balance")})
    return pd.DataFrame(rows)
