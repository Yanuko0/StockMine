"""大表快取：第一次整段讀、之後只補新的 / 有變動的日子，結果跟直接查資料庫一樣。"""
import os
from datetime import date, timedelta

import pandas as pd
import pytest

from twstock import db, localcache

DB = os.environ.get("TEST_DB_URL")
pytestmark = pytest.mark.skipif(not DB, reason="未設定 TEST_DB_URL")
CODES = ["9801", "9802"]


def _direct(conn, since, until):
    x = db.query_df(conn, "select code, date, open, high, low, close, volume, amount from public.daily_prices "
                          "where code = any(%s) and date between %s and %s order by code, date", (CODES, since, until))
    return localcache._numeric(x, localcache.TABLES["daily_prices"][0]).reset_index(drop=True)


def test_sync_incremental(monkeypatch):
    monkeypatch.setenv("SUPABASE_DB_URL", DB)
    days = list(pd.bdate_range("2025-03-03", periods=30).date)
    rows = [dict(code=c, date=x, open=10 + i, high=11 + i, low=9 + i, close=10 + i, volume=1000 * (i + 1), amount=1)
            for c in CODES for i, x in enumerate(days)]
    calls = []
    real = db.query_df

    def spy(conn, sql, params=None):
        if "from public.daily_prices where date = any" in sql:
            calls.extend(params[0])
        return real(conn, sql, params)
    monkeypatch.setattr(db, "query_df", spy)
    since, until = days[0], days[-1]
    with db.connect() as conn:
        try:
            db.execute(conn, "insert into public.stocks (code, name, market) values ('9801','快一','TWSE'),('9802','快二','TWSE') on conflict do nothing")
            db.upsert(conn, "daily_prices", pd.DataFrame([r for r in rows if r["date"] != days[-1]]), ["code", "date"])  # 最後一天先不放
            a = localcache.load(conn, "daily_prices", since, until, codes=CODES)
            pd.testing.assert_frame_equal(a, _direct(conn, since, until))
            assert set(days[:-1]) <= set(calls)  # 第一次：全部讀

            # 新的一天、舊的一天被更正、一天被刪掉
            localcache.reset_memory()
            calls.clear()
            db.upsert(conn, "daily_prices", pd.DataFrame([r for r in rows if r["date"] == days[-1]]), ["code", "date"])
            db.execute(conn, "update public.daily_prices set close = 99 where code = '9801' and date = %s", (days[5],))
            db.execute(conn, "delete from public.daily_prices where date = %s and code = any(%s)", (days[10], CODES))
            b = localcache.load(conn, "daily_prices", since, until, codes=CODES)
            pd.testing.assert_frame_equal(b, _direct(conn, since, until))
            assert {days[5], days[10], *days[-3:]} <= set(calls) and len(calls) <= 6  # 只讀：更正、刪掉的那天＋最近 3 天
            assert float(b[(b.code == "9801") & (b.date == days[5])]["close"].iloc[0]) == 99

            # 同一次執行內再讀：不問資料庫
            calls.clear()
            localcache.load(conn, "daily_prices", since + timedelta(days=3), until, codes=CODES)
            assert calls == []
            assert (localcache.CACHE_DIR / ".fresh").exists()

            # 下一次執行、資料庫沒變：只重抓最近 3 天比對，不用重存快取
            (localcache.CACHE_DIR / ".fresh").unlink()
            localcache.reset_memory()
            calls.clear()
            c = localcache.load(conn, "daily_prices", since, until, codes=CODES)
            pd.testing.assert_frame_equal(c, b)
            assert set(calls) == set(days[-3:]) and not (localcache.CACHE_DIR / ".fresh").exists()
        finally:
            db.execute(conn, "delete from public.daily_prices where code = any(%s)", (CODES,))
            db.execute(conn, "delete from public.stocks where code = any(%s)", (CODES,))
