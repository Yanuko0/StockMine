"""個股展望：目標價抓取、AI 結果檢查、機率的誤差判斷、之後 20 日結果計算。"""
from datetime import date, datetime, timedelta, timezone

import numpy as np
import pandas as pd

from twstock import outlook as O, targets as T

NAMES = {"2330": "台積電", "2454": "聯發科", "3008": "大立光", "2303": "聯電", "2317": "鴻海"}
CLOSE = {"2330": 1000, "2454": 1300, "3008": 2500, "2303": 50, "2317": 200}


def ex(title, codes):
    return T.extract(title, "", NAMES, codes, CLOSE)


def test_target_basic():
    r = ex("大摩調升台積電目標價至1,400元 維持優於大盤評等", ["2330"])
    assert r == [{"code": "2330", "broker": "摩根士丹利", "target": 1400.0, "prev": None,
                  "rating": "優於大盤", "stance": "多", "action": "up"}]


def test_target_from_to_and_down():
    r = ex("高盛將聯發科目標價從1,500元下修至1,350元，評等中立", ["2454"])[0]
    assert (r["broker"], r["target"], r["prev"], r["action"], r["stance"]) == ("高盛", 1350, 1500, "down", "中")


def test_target_multi_stock_each_own():
    r = ex("美銀：台積電目標價1500元、聯電目標價60元", ["2330", "2303"])
    assert {(x["code"], x["target"]) for x in r} == {("2330", 1500), ("2303", 60)}


def test_target_reject_ambiguous_and_years():
    assert ex("外資一口氣調升 聯發科等三檔千金股目標價", ["2454"]) == []
    assert ex("台積電2026年目標價成長", ["2330"]) == []
    assert ex("台積電目標價 30 元", ["2330"]) == []  # 跟現價差太多：不合理


def test_target_local_broker_and_factset():
    assert ex("凱基投顧看好大立光，目標價上看3,000元", ["3008"])[0]["broker"] == "凱基"
    assert ex("FactSet 調查：台積電目標價中位數 1,350 元", ["2330"])[0]["broker"] == "FactSet 共識"
    r = ex("里昂首評鴻海 給予買進評等 目標價250元", ["2317"])[0]
    assert (r["action"], r["stance"]) == ("init", "多")


def test_dedupe_reprints():
    df = pd.DataFrame([{"code": "2330", "broker": "高盛", "target": 1400.0, "date": date(2026, 11, 1)},
                       {"code": "2330", "broker": "高盛", "target": 1400.0, "date": date(2026, 11, 5)},
                       {"code": "2330", "broker": "高盛", "target": 1400.0, "date": date(2026, 12, 1)}])
    assert T.dedupe(df)["date"].tolist() == [date(2026, 11, 1), date(2026, 12, 1)]
    have = pd.DataFrame([{"code": "2330", "broker": "高盛", "target": 1400, "date": date(2026, 10, 28)}])
    assert T.dedupe(df, have)["date"].tolist() == [date(2026, 12, 1)]


def test_summarize_latest_per_broker():
    tp = pd.DataFrame([
        {"broker": "高盛", "target": 1200.0, "date": date(2026, 9, 1), "action": "up", "stance": "多"},
        {"broker": "高盛", "target": 1400.0, "date": date(2026, 11, 1), "action": "up", "stance": "多"},
        {"broker": "瑞銀", "target": 900.0, "date": date(2026, 10, 1), "action": "down", "stance": "空"},
        {"broker": "外資（未具名）", "target": 5000.0, "date": date(2026, 11, 2), "action": None, "stance": None}])
    s = T.summarize(tp, 1000, date(2026, 11, 10))
    assert s["n"] == 2 and s["median"] == 1150 and s["upside"] == 15.0  # 未具名不算進中位數
    assert (s["up90"], s["down90"]) == (2, 1)


def test_validate_ai_drops_unsourced():
    news = [{"title": "台積電 美銀目標價 1,500 元", "summary": ""}, {"title": "台積電法說", "summary": ""}]
    out = O.validate_ai({"bull": [{"t": "AI 需求", "n": [1]}, {"t": "亂編", "n": [9]}, {"t": "沒來源"}],
                         "bear": [{"t": "匯率", "n": "1"}],
                         "targets": [{"broker": "美銀", "target": 1500, "n": 0}, {"broker": "花旗", "target": 1800, "n": 0}],
                         "one_line": "偏多"}, news)
    assert out["bull"] == [{"t": "AI 需求", "n": [1]}]
    assert out["bear"] == [{"t": "匯率", "n": [1]}]
    assert [x["target"] for x in out["targets"]] == [1500.0]  # 1800 新聞裡沒有：丟掉


def test_verdict_needs_enough_evidence():
    base = {"win": 52.0}
    small = O.verdict({"n": 300, "win": 46.0}, base)   # 樣本少：差 6 個百分點也不算
    assert small["side"] == "中性" and small["conf"] == "低"
    big = O.verdict({"n": 20000, "win": 58.0}, base)
    assert big["side"] == "偏多" and big["conf"] == "高"
    assert O.verdict(None, base)["side"] == "資料不足"


def test_features_forward_outcome():
    n = 100
    days = pd.bdate_range("2026-01-01", periods=n).date
    close = np.arange(100, 100 + n, dtype=float)
    df = pd.DataFrame({"code": "1", "date": days, "high": close + 1, "low": close - 1, "close": close, "volume": 1000})
    f = O.features(df)
    r = f.iloc[10]
    assert abs(r["ret"] - (close[30] / close[10] - 1)) < 1e-9
    assert abs(r["mae"] - ((close[11] - 1) / close[10] - 1)) < 1e-9  # 之後 20 天最低點
    assert np.isnan(f.iloc[-1]["ret"])
    assert int(f.iloc[-1]["trend"]) == 3 and int(f.iloc[-1]["rsi"]) == 2


def test_rss_parse():
    xml = """<rss><channel><item><title>台積電 目標價 1500 元 - 經濟日報</title><link>https://x</link>
    <pubDate>Mon, 16 Nov 2026 01:00:00 GMT</pubDate><description>&lt;b&gt;摘要&lt;/b&gt;</description></item></channel></rss>"""
    r = O.parse_rss(xml)[0]
    assert (r["title"], r["source"], r["summary"]) == ("台積電 目標價 1500 元", "經濟日報", "摘要")
    assert r["ts"] == datetime(2026, 11, 16, 1, tzinfo=timezone.utc)


import os  # noqa: E402

import pytest  # noqa: E402

DB = os.environ.get("TEST_DB_URL")


@pytest.mark.skipif(not DB, reason="未設定 TEST_DB_URL")
def test_update_end_to_end(monkeypatch):
    """假資料跑一次：寫出展望、目標價（規則＋AI 核對過的）、模型校準；2 小時內再跑會略過。"""
    from twstock import db
    monkeypatch.setenv("SUPABASE_DB_URL", DB)
    monkeypatch.setenv("OUTLOOK_REBUILD", "1")
    monkeypatch.setenv("GEMINI_API_KEY", "x")
    monkeypatch.delenv("OUTLOOK_FORCE", raising=False)
    monkeypatch.setattr(O.time, "sleep", lambda *_: None)
    rng = np.random.default_rng(0)
    d = date(2026, 11, 16)
    days = pd.bdate_range(end=d, periods=900).date
    codes = [f"97{i:02d}" for i in range(40)]
    hot = codes[0]
    monkeypatch.setattr(O, "pick_codes", lambda conn, now: [hot, codes[1]])
    rows, inst = [], []
    for c in codes:
        p = 100 * np.exp(np.cumsum(rng.normal(0.0004, 0.022, len(days))))
        for i, (x, pp) in enumerate(zip(days, p)):
            rows.append(dict(code=c, date=x, open=pp, high=pp * 1.01, low=pp * 0.99, close=round(pp, 2), volume=2_000_000))
            if i >= len(days) - 380:
                inst.append(dict(code=c, date=x, foreign_net=int(rng.normal(0, 3e5)), trust_net=0, dealer_net=0, total_net=0))
    close = rows[len(days) - 1]["close"]
    news_ts = datetime.now(timezone.utc) - timedelta(days=1)

    def fake_news(c, code, name, query, days_):
        if query:
            return [{"ts": news_ts - timedelta(days=30), "title": f"高盛將{name}目標價從{round(close * 1.1)}元調升至{round(close * 1.25)}元",
                     "summary": "", "url": "g1", "source": "工商時報"}] if code == hot else []
        return [{"ts": news_ts, "title": f"{name}接大單 外資目標價 {round(close * 1.4)} 元", "summary": "", "url": "n0", "source": "X"}]

    calls = []

    def fake_ai(name, code, close_, news, key):
        calls.append(code)
        return O.validate_ai({"bull": [{"t": "接大單", "n": [0]}], "bear": [],
                              "targets": [{"broker": "花旗", "target": round(close * 1.4), "n": 0},
                                          {"broker": "瑞銀", "target": 99999, "n": 0}], "one_line": "偏多"}, news)
    monkeypatch.setattr(O, "fetch_stock_news", fake_news)
    monkeypatch.setattr(O, "ai_reasons", fake_ai)
    with db.connect() as conn:
        try:
            db.upsert(conn, "stocks", pd.DataFrame([dict(code=c, name=f"測{c}", market="TWSE", kind="stock") for c in codes]), ["code"])
            db.upsert(conn, "daily_prices", pd.DataFrame(rows), ["code", "date"])
            db.upsert(conn, "institutional", pd.DataFrame(inst), ["code", "date"])
            db.execute(conn, "delete from public.app_settings where key = 'targets_fetched'")
            msg = O.update(conn, d)
            assert "2 檔" in msg, msg
            out = db.query_df(conn, "select code, data from public.stock_outlook where code = any(%s)", (codes,))
            data = out.set_index("code")["data"][hot]
            assert data["verdict"]["side"] in ("偏多", "偏空", "中性", "資料不足")
            assert data["risk"]["stop"] < data["close"] and data["plan"]
            assert data["ai"]["bull"] == [{"t": "接大單", "n": [0]}] and data["ai"]["news"][0]["url"] == "n0"
            tp = db.query_df(conn, "select broker, target, prev, action, origin from public.target_prices where code = %s order by date", (hot,))
            assert ("高盛", "up", "rule") in {(r.broker, r.action, r.origin) for r in tp.itertuples()}
            assert 99999 not in tp["target"].astype(float).tolist()
            model = db.get_setting(conn, "outlook_model", {})
            assert model["base"]["n"] > 10000 and model["calib"]["rows"]
            assert "略過" in O.update(conn, d)  # 2 小時內跑過
            assert len(calls) == 2
        finally:
            for t in ("stock_outlook", "outlook_log", "target_prices", "institutional", "daily_prices"):
                db.execute(conn, f"delete from public.{t} where code = any(%s)", (codes,))
            db.execute(conn, "delete from public.stocks where code = any(%s)", (codes,))
