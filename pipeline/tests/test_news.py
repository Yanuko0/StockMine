"""新聞熱度：來源解析、個股 / 題材 / 關鍵字辨識、熱度統計。"""
import json
import os
from datetime import date, datetime, timedelta, timezone

import pandas as pd
import pytest

from twstock import news as nw

STOCKS = pd.DataFrame([
    {"code": "2330", "name": "台積電", "industry": "半導體業"},
    {"code": "2454", "name": "聯發科", "industry": "半導體業"},
    {"code": "2455", "name": "全新", "industry": "通信網路業"},
    {"code": "2303", "name": "聯電", "industry": "半導體業"},
    {"code": "3081", "name": "聯亞", "industry": "光電業"},
    {"code": "4958", "name": "臻鼎-KY", "industry": "電子零組件業"},
])


def test_parse_cnyes():
    js = {"items": {"data": [
        {"newsId": 123, "title": "<mark>台積電</mark>擴產", "summary": "CoWoS &amp; SoIC", "publishAt": 1791200000,
         "keyword": ["台積電", "CoWoS"], "market": [{"code": "2330", "name": "台積電", "symbol": "TWS:2330:STOCK"},
                                                  {"code": "NVDA", "name": "輝達"}]},
        {"newsId": 124, "title": "", "publishAt": 1791200000}]}}
    r = nw.parse_cnyes(js)
    assert len(r) == 1 and r[0]["title"] == "台積電擴產" and r[0]["summary"] == "CoWoS & SoIC"
    assert r[0]["url"] == "https://news.cnyes.com/news/id/123" and r[0]["code_tags"] == ["2330"]
    assert r[0]["ts"].tzinfo is not None
    assert nw.parse_cnyes(None) == [] and nw.parse_cnyes({"items": None}) == []


def test_parse_rss():
    xml = """<?xml version="1.0"?><rss><channel>
      <item><title>聯發科法說會 展望樂觀 - 經濟日報</title><link>https://x/1</link>
        <pubDate>Mon, 05 Oct 2026 08:00:00 GMT</pubDate><source url="https://money.udn.com">經濟日報</source></item>
      <item><title>沒有日期</title><link>https://x/2</link></item>
    </channel></rss>"""
    r = nw.parse_rss(xml, "Google 新聞")
    assert len(r) == 1 and r[0]["title"] == "聯發科法說會 展望樂觀" and r[0]["source"] == "經濟日報"
    assert r[0]["ts"] == datetime(2026, 10, 5, 8, tzinfo=timezone.utc)
    assert nw.parse_rss("not xml", "Yahoo 股市") == []


def test_norm_title_dedupes_across_sources():
    assert nw.news_id("台積電 擴產！ - 經濟日報") == nw.news_id("【焦點】台積電擴產")


def test_tagger_stocks_themes_keywords():
    t = nw.Tagger(STOCKS)
    # 長名稱優先（聯發科 不會被當成 聯發）；常用詞「全新」單獨出現不算
    assert t.stocks_in("台積電CoWoS擴產，聯發科受惠，全新廠房完工", []) == ["2330", "2454"]
    assert t.stocks_in("全新(2455)磷化銦報價上漲", []) == ["2455"]
    assert t.stocks_in("全新股價大漲", []) == ["2455"]
    assert t.stocks_in("臻鼎 載板", []) == ["4958"]      # -KY 名稱
    assert t.stocks_in("鉅亨標籤", ["2303", "9999"]) == ["2303"]
    assert t.stocks_in("（3081-TW）", []) == ["3081"]
    th = t.themes_in("CPO 與 HBM 需求", ["2330"])
    assert "矽光子CPO／光通訊" in th and "記憶體" in th and "晶圓代工／半導體設備" in th
    kw = t.keywords_in("台積電 漲價 擴產 可轉債", ["台積電", "AI"])
    assert "台積電" not in kw and kw[0] == "AI" and {"漲價", "擴產", "可轉債"} <= set(kw)
    kw2 = t.keywords_in("AI伺服器 營收創高 現金增資", [])
    assert "AI伺服器" in kw2 and "伺服器" not in kw2 and "營收" not in kw2 and "增資" not in kw2


def test_compute_heat_and_flags():
    now = datetime(2026, 10, 6, 12, tzinfo=timezone.utc)
    rows = []
    # 台積電：7 天內每天 1 則，最近 24 小時 4 則 → 熱度急升；主力 5 日賣超 → 熱度高、主力賣超
    for i in range(1, 7):
        rows.append({"id": f"a{i}", "ts": now - timedelta(days=i, hours=1), "source": f"s{i}", "codes": ["2330"],
                     "themes": ["記憶體"], "keywords": ["擴產"]})
    for i in range(4):
        rows.append({"id": f"b{i}", "ts": now - timedelta(hours=i + 1), "source": "鉅亨網", "codes": ["2330", "2454"],
                     "themes": ["記憶體"], "keywords": ["擴產", "漲價"]})
    df = pd.DataFrame(rows)
    df["ts"] = pd.to_datetime(df["ts"], utc=True)
    prices = pd.DataFrame([{"code": "2330", "date": date(2026, 9, 28) + timedelta(days=i), "close": 100 + i} for i in range(7)])
    mf = pd.DataFrame([{"code": "2330", "date": date(2026, 10, 1) + timedelta(days=i), "net": -2_000_000} for i in range(5)])
    s = nw.compute(df, STOCKS, prices, mf, now)
    assert s["total"] == 10 and s["n24"] == 4 and len(s["days"]) == 7 and s["days"][-1] == "2026-10-06"
    tsmc = s["stocks"][0]
    assert tsmc["code"] == "2330" and tsmc["n7"] == 10 and tsmc["n24"] == 4 and sum(tsmc["series"]) == 10
    assert tsmc["spike"] == 4.0 and tsmc["mf5"] == -10000 and tsmc["pct5"] == round((106 / 101 - 1) * 100, 2)
    assert "熱度高、主力賣超" in tsmc["flags"] and "熱度急升" in tsmc["flags"]
    assert tsmc["co"][0]["code"] == "2454" and "擴產" in tsmc["kw"]
    g = {x["name"]: x for x in s["groups"]}
    assert g["記憶體"]["kind"] == "題材" and g["半導體業"]["kind"] == "產業" and g["半導體業"]["n7"] == 10
    assert g["半導體業"]["codes"] == ["2330", "2454"] and "codes" not in g["記憶體"]
    k = {x["k"]: x for x in s["keywords"]}
    assert k["擴產"]["n7"] == 10 and k["漲價"]["n24"] == 4
    json.dumps(s, ensure_ascii=False, allow_nan=False, default=str)  # 存得進 jsonb
    assert nw.compute(df.iloc[0:0], STOCKS, prices, mf, now)["total"] == 0


DB = os.environ.get("TEST_DB_URL")


@pytest.mark.skipif(not DB, reason="未設定 TEST_DB_URL")
def test_update_stores_and_prunes(monkeypatch):
    from twstock import db
    monkeypatch.setenv("SUPABASE_DB_URL", DB)
    now = datetime(2026, 10, 6, 12, tzinfo=timezone.utc)
    items = [
        {"ts": now - timedelta(hours=2), "source": "鉅亨網", "title": "台積電 擴產 \"CoWoS\"", "summary": "反斜線 \\ 測試",
         "url": "https://x/1", "tags": ["AI"], "code_tags": ["2330"]},
        {"ts": now - timedelta(hours=3), "source": "經濟日報", "title": "台積電擴產CoWoS", "summary": "", "url": "https://x/2",
         "tags": [], "code_tags": []},  # 同一則：不重複算
    ]
    monkeypatch.setattr(nw, "fetch_all", lambda since: (items, ["Google：timeout"]))
    with db.connect() as conn:
        db.execute(conn, "insert into public.stocks (code, name, market, kind) values ('2330','台積電','TWSE','stock') on conflict do nothing")
        db.execute(conn, """insert into public.news (id, ts, title) values ('old', %s, '舊新聞')""", (now - timedelta(days=9),))
        msg = nw.update(conn, now)
        assert "新增 1 則" in msg and "1 個來源失敗" in msg, msg
        r = db.query_df(conn, "select id, title, summary, codes, keywords from public.news")
        assert len(r) == 1 and r["codes"][0] == ["2330"] and "AI" in r["keywords"][0] and r["summary"][0] == "反斜線 \\ 測試"
        assert nw.update(conn, now).startswith("新增 0 則")  # 再跑一次不會重複
        v = db.query_df(conn, "select value from public.app_settings where key = 'news_stats'")["value"][0]
        v = v if isinstance(v, dict) else json.loads(v)
        assert v["total"] == 1 and v["stocks"][0]["code"] == "2330" and v["errors"] == ["Google：timeout"]
        db.execute(conn, "delete from public.news")
        db.execute(conn, "delete from public.app_settings where key = 'news_stats'")
