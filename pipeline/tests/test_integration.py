"""整合測試：需要一個已套用 supabase/schema.sql 的 Postgres。
設定 TEST_DB_URL 才會執行，例如：TEST_DB_URL=postgresql://postgres@localhost:5499/app
"""
import json
import os
from datetime import date, timedelta

import numpy as np
import pandas as pd
import pytest

DB = os.environ.get("TEST_DB_URL")
pytestmark = pytest.mark.skipif(not DB, reason="未設定 TEST_DB_URL")


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    monkeypatch.setenv("SUPABASE_DB_URL", DB or "")
    monkeypatch.setattr("time.sleep", lambda *_: None)


def _twse_payload(d, rows):
    return {"stat": "OK", "tables": [
        {"title": "指數", "fields": ["指數", "收盤指數"], "data": [["加權", "1"]]},
        {"title": "每日收盤行情", "fields": ["證券代號", "證券名稱", "成交股數", "成交筆數", "成交金額", "開盤價", "最高價",
                                       "最低價", "收盤價", "漲跌(+/-)", "漲跌價差", "最後揭示買價", "最後揭示買量",
                                       "最後揭示賣價", "最後揭示賣量", "本益比"],
         "data": rows}]}


def test_eod_and_screen(monkeypatch):
    from twstock import cli, db
    from twstock.sources import official

    d = date(2026, 9, 30)

    def fake_get_json(url, params=None, **_):
        if "MI_INDEX" in url:
            return _twse_payload(d, [
                ["2330", "台積電", "30,000,000", "50,000", "30,000,000,000", "1,000.00", "1,010.00", "995.00",
                 "1,005.00", "<p>+</p>", "5.00", "1", "1", "1", "1", "20"],
                ["030001", "權證", "1", "1", "1", "1", "1", "1", "1", "", "", "", "", "", "", ""],
            ])
        if "dailyQuotes" in url:
            return {"date": "115/09/30", "tables": [{"title": "上櫃股票行情",
                    "fields": ["代號", "名稱", "收盤", "漲跌", "開盤", "最高", "最低", "均價", "成交股數", "成交金額(元)", "成交筆數"],
                    "data": [["6488", "環球晶", "400.00", "+1", "395.00", "405.00", "390.00", "399", "1,000,000", "400,000,000", "900"]]}]}
        if "T86" in url:
            return {"stat": "OK", "fields": ["證券代號", "證券名稱", "外陸資買進股數(不含外資自營商)", "外陸資賣出股數(不含外資自營商)",
                                             "外陸資買賣超股數(不含外資自營商)", "外資自營商買進股數", "外資自營商賣出股數",
                                             "外資自營商買賣超股數", "投信買進股數", "投信賣出股數", "投信買賣超股數",
                                             "自營商買賣超股數", "自營商買進股數(自行買賣)", "自營商賣出股數(自行買賣)",
                                             "自營商買賣超股數(自行買賣)", "自營商買進股數(避險)", "自營商賣出股數(避險)",
                                             "自營商買賣超股數(避險)", "三大法人買賣超股數"],
                    "data": [["2330", "台積電", "10", "5", "5,000", "0", "0", "100", "0", "0", "2,000", "300", "0", "0", "0", "0", "0", "0", "7,400"]]}
        if "insti/dailyTrade" in url:
            return {"tables": [{"fields": ["代號", "名稱"] + [f"c{i}" for i in range(21)] + ["三大法人買賣超股數合計"],
                                "data": [["6488", "環球晶"] + ["0"] * 8 + ["1,000"] + ["0"] * 2 + ["500"] + ["0"] * 8 + ["-200", "1,300"]]}]}
        raise AssertionError(url)

    monkeypatch.setattr(official, "get_json", fake_get_json)
    from twstock import fundamentals
    for fn in ("update_taiex", "update_dividends", "update_financials"):
        monkeypatch.setattr(fundamentals, fn, lambda *a, **k: "")
    from twstock import company
    monkeypatch.setattr(company, "get_json", lambda url, *a, **k: [
        {"公司代號": "2330", "產業別": "24", "已發行普通股數或TDR原股發行股數": "25930380458"}] if "twse" in url else [
        {"SecuritiesCompanyCode": "6488", "SecuritiesIndustryCode": "24", "Paidin.Capital.NTDollars": "4780000000"}])
    monkeypatch.setattr(company.finmind, "fetch", lambda *a, **k: pd.DataFrame())
    msg = cli.job_eod(d)
    assert "日K 2 筆" in msg and "三大法人 2 筆" in msg

    with db.connect() as conn:
        s = db.query_df(conn, "select * from public.stocks where kind <> 'index' order by code")
        assert s["code"].tolist() == ["2330", "6488"]
        p = db.query_df(conn, "select * from public.daily_prices where code='2330'")
        assert float(p["close"][0]) == 1005.0 and int(p["volume"][0]) == 30_000_000
        inst = db.query_df(conn, "select * from public.institutional order by code")
        assert inst["foreign_net"].tolist() == [5100, 1000]
        assert inst["total_net"].tolist() == [7400, 1300]

        # 造 7 年的日K 讓月扣三低成立：過去 5 個月價格低、本月高
        days = pd.bdate_range(d - timedelta(days=365 * 7), d - timedelta(days=1))
        close = np.linspace(50, 80, len(days))
        hist = pd.DataFrame({"code": "2330", "date": days.date, "open": close, "high": close + 1,
                             "low": close - 1, "close": close, "volume": 1000, "amount": 1, "trades": 1})
        db.upsert(conn, "daily_prices", hist, ["code", "date"])
        uid = db.query_df(conn, "insert into auth.users (email) values ('a@b.c') returning id")["id"][0]
        conn.commit()
        cond = {"logic": "AND", "conditions": [
            {"kind": "deduct3low", "tf": "M", "n": 5},
            {"kind": "compare", "tf": "D", "left": {"src": "close"}, "op": ">", "right": {"src": "ma", "n": 20}},
            {"kind": "inst", "who": "foreign", "days": 1, "dir": "buy"},
        ]}
        cond["conditions"].append({"kind": "group", "logic": "OR", "conditions": [
            {"kind": "group", "label": "②箱底", "conditions": [{"kind": "box_bottom", "source": "mine"}]},
            {"kind": "group", "label": "①多頭", "conditions": [{"kind": "ma_align", "tf": "D", "ns": [5, 20], "dir": "bull"}]}]})
        cond["conditions"].append({"kind": "in_group", "names": ["題材A"]})
        db.execute(conn, "insert into public.strategies (name, conditions, owner) values (%s, %s, %s)",
                   ("測試", json.dumps(cond), uid))
        db.execute(conn, "insert into public.user_groups (owner, name, codes) values (%s, '題材A', '{2330}')", (uid,))
        rank = {"logic": "AND", "conditions": [{"kind": "inst_rank", "who": "foreign", "days": 1, "top": 1}]}
        db.execute(conn, "insert into public.strategies (name, conditions, owner) values (%s, %s, %s)",
                   ("排行", json.dumps(rank), uid))

    msg = cli.job_screen(d)
    assert "2 個策略（1 檔；1 檔）" in msg, msg
    with db.connect() as conn:
        rr = db.query_df(conn, "select s.name, r.items from public.screen_results r join public.strategies s on s.id = r.strategy_id")
        assert [x["code"] for x in rr[rr["name"] == "排行"]["items"].iloc[0]] == ["2330"]
        r = db.query_df(conn, "select r.items from public.screen_results r join public.strategies s on s.id = r.strategy_id where s.name = '測試'")
        assert r["items"][0][0]["code"] == "2330"
        it = r["items"][0][0]
        assert it["industry"] == "半導體業" and it["mcap"] > 10000
        assert it["tags"] == ["①多頭"]
        r2 = db.query_df(conn, "select r.meta from public.screen_results r join public.strategies s on s.id = r.strategy_id where s.name = '測試'")
        fn = r2["meta"][0]["funnel"]
        assert len(fn["single"]) == len(cond["conditions"]) and fn["cumul"][-1] == 1

        # 全市場分點：mock 證交所，pool 裡的 2330 只存主力買賣超
        from twstock import config as cfg
        from twstock.sources import broker as bsrc
        monkeypatch.setattr(cfg, "today_tw", lambda: d)
        monkeypatch.setattr(cfg, "BROKER_POOL_MIN_LOTS", 1)
        monkeypatch.setattr(bsrc, "fetch_twse_broker", lambda code: pd.DataFrame(
            [{"broker_id": "1440", "broker_name": "美林", "price": 100.0, "buy": 5000, "sell": 0},
             {"broker_id": "9800", "broker_name": "元大", "price": 100.0, "buy": 0, "sell": 2000}]))
        up = {}
        monkeypatch.setattr(cli, "BROKER_CACHE_DIR", __import__("pathlib").Path(__import__("tempfile").mkdtemp()))
        from twstock import broker_files
        monkeypatch.setattr(broker_files.storage, "download_many", lambda paths: {p: None for p in paths})
        monkeypatch.setattr(broker_files.storage, "upload_many", lambda items: up.update(items))
        msg = cli.job_broker(d)
        assert set(up) == {"bk/2330.json.gz", "bk/6488.json.gz"} - {"bk/6488.json.gz"}, up.keys()
        assert "主力買賣超 1 檔" in msg, msg
        mf = db.query_df(conn, "select * from public.main_force")
        assert mf["code"].tolist() == ["2330"] and int(mf["net"][0]) == 3000
        assert db.query_df(conn, "select count(*) as n from public.broker_daily")["n"][0] == 0

        # 分批建倉：規則存在資料庫
        rules = {"entries": [{"name": "第一筆", "conditions": [{"kind": "compare", "tf": "D", "left": {"src": "close"}, "op": ">", "right": {"src": "value", "v": 1}}]}]}
        db.execute(conn, "insert into public.tranche_plans (owner, rules) values (%s, %s)", (uid, json.dumps(rules)))
        db.execute(conn, "insert into public.watchlist (code, user_id) values ('2330', %s) on conflict do nothing", (uid,))
        from twstock import tranche
        tm = tranche.run(d, lambda codes: {})
        assert "建倉提醒 1 則" in tm, tm
        al = db.query_df(conn, "select code, kind from public.trade_alerts")
        assert al.to_dict("records") == [{"code": "2330", "kind": "entry1"}]

        # 融資融券：當天 + 回補三大法人有、融資融券沒有的日子
        db.execute(conn, "insert into public.institutional (code, date, foreign_net) values ('2330', %s, 1)", (d - timedelta(days=1),))
        mk = lambda day: pd.DataFrame([{"code": "2330", "date": day, "margin_buy": 10, "margin_sell": 5, "margin_balance": 100,
                                        "short_buy": 1, "short_sell": 2, "short_balance": 9}])
        monkeypatch.setattr(official, "twse_margin", mk)
        monkeypatch.setattr(official, "tpex_margin", lambda day: pd.DataFrame())
        monkeypatch.setattr(cli, "_more_financials", lambda *a: "")
        msg = cli.job_margin(d)
        assert "融資融券 1 筆" in msg and "回補 1 天" in msg, msg
        assert db.query_df(conn, "select count(*) as n from public.margin")["n"][0] == 2

        from twstock import summary
        sm = summary.compute(conn, d)
        assert sm["breadth"]["up"] >= 1 and sm["date"] == d.isoformat()
        assert sm["inst"]["foreign_buy"][0]["code"] in ("2330", "6488")
        s2 = db.query_df(conn, "select code, industry, shares from public.stocks where code='6488'")
        assert s2["industry"][0] == "半導體業" and int(s2["shares"][0]) == 478000000
