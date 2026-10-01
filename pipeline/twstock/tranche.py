"""分批建倉提醒：每天收盤後，依每個人自己設定的規則（tranche_plans.rules）檢查進場訊號與停損。

規則格式（用選股條件的語法，存在資料庫，只有自己看得到）：
{
  "universe": "watch",                       # watch = 自選股 + 自己畫過線 + 有持倉的股票；all = 全市場
  "entries": [                               # 第 1、2、3… 筆的進場條件
    {"name": "第一筆", "logic": "AND", "conditions": [...], "note": "..."},
    ...
  ],
  "stop": {"name": "停損", "tranches": [1, 2], "logic": "OR", "conditions": [...]}  # 買進隔天起才檢查
}
條件裡用到「自己畫的線」（source = mine）時，只會用到規則主人自己畫的水平線、箱型。
結果只存給自己、只推播給自己。
"""
from __future__ import annotations

from datetime import date, timedelta

import pandas as pd

from . import bars, db, push, screener

MINUTE_TFS = set(bars.MINUTE_TFS)


def size_text(amount: float, price: float) -> str:
    """一份資金大約可以買多少。"""
    if price <= 0:
        return ""
    shares = int(amount // price)
    lots, odd = divmod(shares, 1000)
    if lots and odd:
        return f"約 {lots} 張 + {odd} 股"
    if lots:
        return f"約 {lots} 張"
    return f"約 {shares} 股（零股）"


def evaluate(rules: dict, d: date, close: float, tfs: dict, chips: dict, open_pos: pd.DataFrame, plan: dict) -> list[dict]:
    """回傳這檔股票今天的提醒（不含資料庫寫入）。"""
    out = []
    held = set(open_pos["tranche"].astype(int)) if not open_pos.empty else set()
    parts = max(1, int(plan.get("parts") or len(rules.get("entries") or []) or 1))
    amount = float(plan.get("capital") or 0) / parts
    for i, e in enumerate(rules.get("entries") or [], start=1):
        if i in held or not e.get("conditions"):
            continue
        if screener.eval_strategy(e, tfs, chips):
            name = e.get("name") or f"第{i}筆"
            out.append({"kind": f"entry{i}", "level": close,
                        "message": f"{name}：收 {close:.2f}；一份 {amount:,.0f} 元 {size_text(amount, close)}"})
    stop = rules.get("stop") or {}
    applies = set(int(x) for x in stop.get("tranches") or [])
    sp = open_pos[open_pos["tranche"].astype(int).isin(applies)] if not open_pos.empty else open_pos
    if stop.get("conditions") and not sp.empty:
        buy_day = min(pd.to_datetime(sp["buy_date"]).dt.date)
        if d > buy_day and screener.eval_strategy(stop, tfs, chips):
            tr = "、".join(f"第{int(t)}筆" for t in sorted(sp["tranche"].astype(int).unique()))
            out.append({"kind": "stop", "level": close,
                        "message": f"{stop.get('name') or '停損'}：收 {close:.2f}，{tr} 不如預期，考慮砍掉"})
    return out


def run(d: date, load_minutes) -> str:
    """load_minutes：給股票代號清單，回傳 {code: 1分K 檔案內容}（cli.load_minute_files）。"""
    with db.connect() as conn:
        try:
            plans = db.query_df(conn, "select * from public.tranche_plans where rules is not null")
        except Exception:  # noqa: BLE001  還沒跑 009 升級
            conn.rollback()
            return "建倉規則：請先執行 009 升級"
        if plans.empty:
            return "沒有人設定建倉規則"
        offset = int(db.get_setting(conn, "deduct_offset", 0) or 0)
        draws = db.query_df(conn, """select code, kind, points, created_by from public.drawings
                                     where kind in ('hline','rect')""")
        pos = db.query_df(conn, "select * from public.positions where status = 'open'")
        watch = db.query_df(conn, "select user_id, code from public.watchlist")
        names = db.query_df(conn, "select code, name from public.stocks").set_index("code")["name"].to_dict()
        traded = db.query_df(conn, "select code from public.daily_prices where date = %s and code <> 'TAIEX'", (d,))["code"].tolist()

    plist = plans.to_dict("records")
    universe: dict = {}
    for p in plist:
        o, rules = p["owner"], p["rules"] or {}
        u = set(traded) if rules.get("universe") == "all" else set(watch[watch["user_id"] == o]["code"])
        u |= set(draws[draws["created_by"] == o]["code"])
        if not pos.empty:
            u |= set(pos[pos["owner"] == o]["code"])
        universe[o] = u
    codes = sorted(set().union(*universe.values()) & set(traded)) if universe else []
    if not codes:
        return "建倉：沒有要檢查的股票"
    all_rules = [r for p in plist for r in (p["rules"].get("entries") or []) + [p["rules"].get("stop") or {}]]
    tfs_needed = screener.needed_timeframes(all_rules) | {"D"}

    with db.connect() as conn:
        daily = db.query_df(conn, """select code, date, open, high, low, close, volume from public.daily_prices
                                     where code = any(%s) and date > %s and date <= %s order by code, date""",
                            (codes, d - timedelta(days=int(365.25 * 5)), d))
    for c in ("open", "high", "low", "close"):
        daily[c] = daily[c].astype(float)
    daily["volume"] = daily["volume"].astype(float) / 1000
    daily_g = dict(tuple(daily.groupby("code")))
    raw = load_minutes(codes) if tfs_needed & MINUTE_TFS else {}

    rows = []
    for code in codes:
        g = daily_g.get(code)
        if g is None or g["date"].iloc[-1] != d:
            continue
        tfs = {"D": screener.Series(g)}
        if "W" in tfs_needed:
            tfs["W"] = screener.Series(bars.resample_daily(g, "W"))
        if "M" in tfs_needed:
            tfs["M"] = screener.Series(bars.resample_daily(g, "M"))
        if raw.get(code):
            m1 = bars.from_minute_file(raw[code])
            for tf in tfs_needed & MINUTE_TFS:
                n = bars.MINUTE_TFS[tf]
                df = m1 if n == 1 else bars.resample_minutes(m1, n)
                tfs[tf] = screener.Series(df)
        close = float(g["close"].iloc[-1])
        for p in plist:
            o = p["owner"]
            if code not in universe[o]:
                continue
            chips = {"offset": offset, "draw": draws[(draws["code"] == code) & (draws["created_by"] == o)].to_dict("records")}
            op = pos[(pos["owner"] == o) & (pos["code"] == code)] if not pos.empty else pos
            for a in evaluate(p["rules"], d, close, tfs, chips, op, p):
                rows.append({"owner": o, "date": d, "code": code, "kind": a["kind"], "price": close,
                             "level": a["level"], "message": f"{code} {names.get(code, '')}：{a['message']}"})

    with db.connect() as conn:
        # 同一天重跑時，只推播「新出現」的提醒
        seen = db.query_df(conn, "select owner, code, kind from public.trade_alerts where date = %s", (d,))
        old_keys = {(r.owner, r.code, r.kind) for r in seen.itertuples()}
        per_owner: dict = {}
        for r in rows:
            if (r["owner"], r["code"], r["kind"]) not in old_keys:
                per_owner.setdefault(r["owner"], []).append(r["kind"])
        if rows:
            db.upsert(conn, "trade_alerts", pd.DataFrame(rows), ["owner", "date", "code", "kind"])
        db.execute(conn, "delete from public.trade_alerts where date < %s", (d - timedelta(days=60),))
        for o, kinds in per_owner.items():
            p = next(x for x in plist if x["owner"] == o)
            if not p.get("notify", True):
                continue
            cnt = pd.Series(kinds).value_counts()
            body = "、".join(f"{'停損' if k == 'stop' else f'第{k[5:]}筆'} {n} 檔" for k, n in cnt.items())
            push.send_to_user(conn, o, f"{d:%m/%d} 建倉提醒", body, "/plan")
    return f"建倉提醒 {len(rows)} 則（新 {sum(len(v) for v in per_owner.values())} 則）"
