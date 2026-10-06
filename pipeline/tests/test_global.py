"""全球強勢族群：對照表格式、Yahoo 資料解析、族群排名與台股排序。"""
import json
import os
from datetime import date

import pytest

from twstock import global_map, global_themes as gt


def test_map_is_well_formed():
    ts = global_map.themes()
    assert len(ts) >= 15
    ids = [t["id"] for t in ts]
    assert len(ids) == len(set(ids))
    for t in ts:
        assert t["foreign"] and t["tw"], t["name"]
        codes = [w["code"] for w in t["tw"]]
        assert len(codes) == len(set(codes)), f"{t['name']} 台股重複"
        syms = [f["sym"] for f in t["foreign"]]
        assert len(syms) == len(set(syms)), f"{t['name']} 海外重複"
        for w in t["tw"]:
            assert w["tier"] in (1, 2, 3) and w["code"].isdigit()
    # 使用者指定要有的族群
    names = "".join(t["name"] for t in ts)
    for k in ["記憶體", "PCB", "載板", "CCL", "被動元件", "功率元件", "矽晶圓", "散熱", "IC設計",
              "低軌衛星", "太陽能", "伺服器", "封測", "能源", "電源", "CPO"]:
        assert k in names, k
    assert global_map.market_of("6981.T") == "JP" and global_map.market_of("000660.KS") == "KR"
    assert global_map.market_of("MU") == "US" and global_map.market_of("688825.SS") == "CN"


def _chart(closes, vols=None, t0=1790000000):
    return {"chart": {"result": [{"meta": {"gmtoffset": 32400}, "timestamp": [t0 + i * 86400 for i in range(len(closes))],
                                   "indicators": {"quote": [{"close": closes, "volume": vols or [100] * len(closes)}]}}]}}


def test_parse_chart():
    q = gt.parse_chart(_chart([100, 101, None, 102, 103, 104, 110], [10, 10, 10, 10, 10, 10, 30]))
    assert q["close"] == 110 and q["pct"] == round((110 / 104 - 1) * 100, 2)
    assert q["pct5"] == round((110 / 100 - 1) * 100, 2)  # 空值不算，往前 5 根
    assert q["vol_ratio"] == 3.0
    assert gt.parse_chart(_chart([100])) is None
    assert gt.parse_chart({"chart": {"result": None}}) is None


def test_name_ok():
    assert gt.name_ok("臻鼎-KY", "臻鼎-KY")
    assert gt.name_ok("矽力*-KY", "矽力*-KY")
    assert gt.name_ok("日月光投控", "日月光投控")
    assert not gt.name_ok("南亞科", "台積電")


def test_related_subs():
    assert gt.related("雷射/磷化銦", "磷化銦基板")
    assert gt.related("NAND/SSD", "NAND控制IC")
    assert not gt.related("DRAM/HBM", "NAND/SSD")
    assert not gt.related("", "NAND/SSD")


def test_build_ranks_and_sorts():
    themes = [
        {"id": "cpo", "name": "CPO", "foreign": [
            {"sym": "AXTI", "name": "AXT", "sub": "磷化銦"}, {"sym": "LITE", "name": "LITE", "sub": "磷化銦"},
            {"sym": "FN", "name": "FN", "sub": "模組"}, {"sym": "5803.T", "name": "藤倉", "sub": "光纖"}],
         "tw": [{"code": "3450", "name": "聯鈞", "tier": 1, "sub": "模組"},
                {"code": "2455", "name": "全新", "tier": 1, "sub": "磷化銦"},
                {"code": "4971", "name": "IET-KY", "tier": 3, "sub": "磷化銦"},
                {"code": "9999", "name": "打錯", "tier": 1, "sub": "模組"},
                {"code": "1111", "name": "名字", "tier": 2, "sub": "模組"}]},
        {"id": "weak", "name": "弱", "foreign": [{"sym": "X", "name": "X", "sub": "a"}], "tw": []},
    ]
    q = lambda p: {"pct": p, "pct5": p, "close": 1, "vol_ratio": 1, "date": "2026-10-02"}  # noqa: E731
    quotes = {"AXTI": q(12), "LITE": q(8), "FN": q(2), "5803.T": q(3), "X": q(-2)}
    tw = {"3450": {"db_name": "聯鈞", "close": 1, "pct": 1, "amount": 9_000, "date": "d"},
          "2455": {"db_name": "全新", "close": 1, "pct": 1, "amount": 100, "date": "d"},
          "4971": {"db_name": "IET-KY", "close": 1, "pct": 1, "amount": 50, "date": "d"},
          "1111": {"db_name": "完全不同", "close": 1, "pct": 1, "amount": 50, "date": "d"}}
    res, bad = gt.build(themes, quotes, tw)
    assert [r["id"] for r in res] == ["cpo", "weak"] and res[0]["rank"] == 1
    c = res[0]
    assert c["lead_sub"] == "磷化銦" and c["movers"][0]["sym"] == "AXTI"
    # 最強細項（磷化銦）的台股排最前面：全新（龍頭）→ IET（相關）→ 其他細項的龍頭
    assert [r["code"] for r in c["tw"]] == ["2455", "4971", "3450"]
    assert c["synced"] and set(c["strong_markets"]) == {"US", "JP"}
    assert "磷化銦" in c["reason"] and "同步" in c["reason"]
    assert any("9999" in b for b in bad) and any("1111" in b for b in bad)
    assert res[1]["lead_sub"] is None  # 下跌的族群不標最強細項


DB = os.environ.get("TEST_DB_URL")


@pytest.mark.skipif(not DB, reason="未設定 TEST_DB_URL")
def test_update_writes_setting(monkeypatch):
    from twstock import db
    monkeypatch.setenv("SUPABASE_DB_URL", DB)
    themes = [{"id": "mem", "name": "記憶體", "foreign": [{"sym": "MU", "name": "美光", "sub": "DRAM"}],
               "tw": [{"code": "9901", "name": "測試股", "tier": 1, "sub": "DRAM"}]}]
    monkeypatch.setattr(gt.global_map, "themes", lambda: themes)
    monkeypatch.setattr(gt, "fetch_quotes", lambda syms: ({"MU": {"pct": 5.0, "pct5": 9.0, "close": 100, "vol_ratio": 2, "date": "2026-10-02"}}, []))
    monkeypatch.setattr(gt, "fetch_news", lambda sym, n=2: [{"sym": sym, "title": "t", "link": "https://x", "publisher": "p"}])
    with db.connect() as conn:
        db.execute(conn, "insert into public.stocks (code, name, market) values ('9901','測試股','TWSE') on conflict do nothing")
        db.execute(conn, """insert into public.daily_prices (code, date, close, amount) values
            ('9901','2026-10-01',100,1),('9901','2026-10-02',110,5000) on conflict (code, date) do update set close = excluded.close, amount = excluded.amount""")
        msg = gt.update(conn, date(2026, 10, 3))
        v = db.query_df(conn, "select value from public.app_settings where key = 'global_themes'")["value"][0]
        db.execute(conn, "delete from public.daily_prices where code = '9901'")
        db.execute(conn, "delete from public.stocks where code = '9901'")
    v = v if isinstance(v, dict) else json.loads(v)
    assert "記憶體" in msg
    t = v["themes"][0]
    assert t["tw"][0]["code"] == "9901" and t["tw"][0]["pct"] == 10.0 and t["tw"][0]["lead"]
    assert v["dates"]["US"] == "2026-10-02" and t["news"][0]["title"] == "t"
