import gzip
import json
from datetime import date

import numpy as np
import pandas as pd
import pytest

from twstock import bars, indicators as ind, screener
from twstock.sources import broker, official


def make_1m(day="2026-09-30", n=270, start_price=100.0):
    # Shioaji 風格：結束時間標示，09:01 ~ 13:30
    ts = pd.date_range(f"{day} 09:01", periods=n, freq="1min")
    ts = ts.where(ts <= pd.Timestamp(f"{day} 13:30"))
    close = start_price + np.arange(n) * 0.1
    return pd.DataFrame({"ts": ts, "open": close - 0.05, "high": close + 0.2, "low": close - 0.2,
                         "close": close, "volume": np.ones(n, dtype=int)})


def test_resample_60m_has_5_bars_last_half_hour():
    df = make_1m()
    out = bars.resample_minutes(df, 60)
    assert len(out) == 5
    assert [t.strftime("%H:%M") for t in out["ts"]] == ["09:00", "10:00", "11:00", "12:00", "13:00"]
    assert out["volume"].tolist() == [60, 60, 60, 60, 30]
    assert out["open"].iloc[0] == df["open"].iloc[0]
    assert out["close"].iloc[-1] == df["close"].iloc[-1]


@pytest.mark.parametrize("n,count", [(3, 90), (5, 54), (15, 18), (30, 9), (1, 270)])
def test_resample_counts(n, count):
    assert len(bars.resample_minutes(make_1m(), n)) == count


def test_minute_file_roundtrip():
    df = make_1m()
    raw = bars.to_minute_file("2330", df)
    js = json.loads(gzip.decompress(raw))
    # 第一根的開始時間 = 2026-09-30 09:00 台灣時間 = 01:00 UTC
    assert pd.to_datetime(js["t"][0], unit="ms") == pd.Timestamp("2026-09-30 01:00")
    back = bars.from_minute_file(raw)
    pd.testing.assert_series_equal(back["ts"], df["ts"], check_names=False, check_dtype=False)
    assert bars.resample_minutes(back, 60)["volume"].tolist() == [60, 60, 60, 60, 30]


def test_resample_week_month():
    d = pd.bdate_range("2026-08-03", "2026-09-30")
    daily = pd.DataFrame({"date": d.date, "open": 1.0, "high": 2.0, "low": 0.5,
                          "close": np.arange(len(d), dtype=float), "volume": 10})
    m = bars.resample_daily(daily, "M")
    assert len(m) == 2 and m["close"].iloc[-1] == len(d) - 1
    w = bars.resample_daily(daily, "W")
    assert w["date"].iloc[0] == date(2026, 8, 3)
    assert w["volume"].iloc[0] == 50


def test_kd_matches_formula():
    h = pd.Series([10, 11, 12, 13, 14, 15, 16, 17, 18, 19], dtype=float)
    l = h - 2
    c = h - 1
    k, d = ind.kd(h, l, c)
    # 第 9 根：最高 18、最低 8、收 17 → RSV = 90；K = 50*2/3 + 90/3
    assert np.isnan(k.iloc[7])
    assert k.iloc[8] == pytest.approx(50 * 2 / 3 + 90 / 3)
    assert d.iloc[8] == pytest.approx(50 * 2 / 3 + k.iloc[8] / 3)


def test_rsi_all_up_is_100():
    s = pd.Series(np.arange(1, 20, dtype=float))
    assert ind.rsi(s, 6).iloc[-1] == 100


def test_macd_constant_is_zero():
    dif, dea, osc = ind.macd(pd.Series([50.0] * 40))
    assert abs(dif.iloc[-1]) < 1e-9 and abs(osc.iloc[-1]) < 1e-9


def test_deduct_value():
    c = pd.Series([1, 2, 3, 4, 5, 6, 7], dtype=float)
    v, i = ind.deduct_value(c, 5)
    # 5MA 目前 = 3..7 的平均，下一期扣掉 3（位置 2）
    assert (v, i) == (3.0, 2)
    v1, i1 = ind.deduct_value(c, 5, offset=1)
    assert (v1, i1) == (2.0, 1)


def test_deduct3low_example_from_spec():
    # 5 月均線：本月收 100；下三個月扣抵 82、87、93
    c = pd.Series([82, 87, 93, 95, 100], dtype=float)
    r = ind.deduct3low(c, 5)
    assert r["d"] == [82, 87, 93] and r["ok"] and r["line"] == 93
    c2 = pd.Series([82, 105, 93, 95, 100], dtype=float)
    assert not ind.deduct3low(c2, 5)["ok"]
    assert ind.deduct3low(c, 3) is None  # n < 4 不成立


def test_screener_compare_and_cross():
    n = 80
    close = pd.Series(np.r_[np.linspace(100, 80, n - 5), np.linspace(81, 95, 5)])
    df = pd.DataFrame({"close": close, "open": close, "high": close + 1, "low": close - 1, "volume": 1000})
    tfs = {"60m": screener.Series(df)}
    cond_up = {"kind": "compare", "tf": "60m", "left": {"src": "close"}, "op": ">", "right": {"src": "ma", "n": 5}}
    assert screener.eval_condition(cond_up, tfs, {})
    strat = {"logic": "AND", "conditions": [cond_up,
             {"kind": "compare", "tf": "60m", "left": {"src": "k"}, "op": ">", "right": {"src": "value", "v": 20}}]}
    assert screener.eval_strategy(strat, tfs, {})
    assert not screener.eval_strategy({"conditions": [dict(cond_up, op="<")]}, tfs, {})


def test_screener_inst_and_mainforce():
    inst = pd.DataFrame({"date": pd.date_range("2026-09-24", periods=3).date,
                         "foreign_net": [100, 200, 300], "trust_net": [1, -1, 1],
                         "dealer_net": 0, "total_net": 1})
    mf = pd.DataFrame({"date": [date(2026, 9, 30)], "net": [500_000]})
    chips = {"inst": inst, "mf": mf}
    assert screener.eval_condition({"kind": "inst", "who": "foreign", "days": 3, "dir": "buy"}, {}, chips)
    assert not screener.eval_condition({"kind": "inst", "who": "trust", "days": 3, "dir": "buy"}, {}, chips)
    assert screener.eval_condition({"kind": "mainforce", "days": 1, "op": ">", "v": 400}, {}, chips)


def test_broker_csv_parse_and_mainforce():
    text = (
        "券商買賣股票成交價量資訊\n股票代碼,=\"2330\"\n"
        "序號,券商,價格,買進股數,賣出股數,,序號,券商,價格,買進股數,賣出股數\n"
        "1,1020合　　庫,1000.00,2000,0,,2,1020合　　庫,1005.00,0,1000\n"
        "3,9A00永豐金,1001.00,5000,0,,4,8440摩根大通,1002.00,0,3000\n"
    )
    t = broker.parse_bsr_csv(text)
    assert len(t) == 4 and set(t["broker_id"]) == {"1020", "9A00", "8440"}
    per, mf = broker.aggregate(t, "2330", date(2026, 9, 30))
    row = per.set_index("broker_id").loc["1020"]
    assert row["net"] == 1000 and row["avg_price"] == pytest.approx((1000 * 2000 + 1005 * 1000) / 3000, abs=0.01)
    assert mf["top_buy"] == 6000 and mf["top_sell"] == -3000 and mf["net"] == 3000


def test_keep_code():
    assert official.keep_code("2330") and official.keep_code("0050") and official.keep_code("00981A")
    assert not official.keep_code("030001") and not official.keep_code("2330A")


def test_broker_files_merge(tmp_path, monkeypatch):
    from datetime import date
    import pandas as pd
    from twstock import broker_files as bf

    per = pd.DataFrame([{"broker_id": "1440", "broker_name": "美林", "buy": 5000, "sell": 0, "net": 5000, "avg_price": 100.5},
                        {"broker_id": "9800", "broker_name": "元大", "buy": 0, "sell": 2000, "net": -2000, "avg_price": float("nan")}])
    up = {}
    monkeypatch.setattr(bf.storage, "download_many", lambda paths: {p: None for p in paths})
    monkeypatch.setattr(bf.storage, "upload_many", lambda items: up.update(items))
    monkeypatch.setattr(bf.storage, "download", lambda path: None)
    assert bf.update({"2330": per}, date(2026, 10, 1), tmp_path) == 1
    f = bf.decode(up["bk/2330.json.gz"])
    assert f["days"][0]["b"][0] == ["1440", "美林", 5000, 0, 100.5] and f["days"][0]["b"][1][4] is None
    # 隔天：從本機快取讀，同一天重跑會覆蓋，最多保留 60 天
    for i in range(70):
        bf.update({"2330": per}, date(2026, 10, 2) + pd.Timedelta(days=i), tmp_path)
    bf.update({"2330": per}, date(2026, 10, 2) + pd.Timedelta(days=69), tmp_path)
    f = bf.decode(up["bk/2330.json.gz"])
    assert len(f["days"]) == 60 and len({x["d"] for x in f["days"]}) == 60


def test_broker_csv_encoding_and_names():
    from twstock import broker_files
    csv_text = "1,9800元大,100,1000,0,,2,1440美林,100,0,500\n"
    for enc in ("utf-8", "cp950"):
        t = broker.parse_bsr_csv(broker.decode_csv(csv_text.encode(enc)))
        assert t["broker_name"].tolist() == ["元大", "美林"], enc
    assert not broker.good_name("\ufffd大") and broker.good_name("元大")
    obj = {"days": [{"d": "2026-10-01", "b": [["9800", "憭", 1, 0, None]]}]}
    assert broker_files.fix_names(obj, {"9800": "元大"})["days"][0]["b"][0][1] == "元大"


def test_live_extend_with_snapshot_and_cache(tmp_path, monkeypatch):
    from datetime import datetime, timedelta
    from types import SimpleNamespace
    from twstock import cli, config
    m1 = pd.DataFrame({"ts": pd.to_datetime(["2026-10-05 09:01", "2026-10-05 09:02"]),
                       "open": [10.0, 10.1], "high": [10.2, 10.3], "low": [9.9, 10.0], "close": [10.1, 10.2], "volume": [5.0, 7.0]})
    now = datetime(2026, 10, 5, 9, 40, 30, tzinfo=config.TW_TZ)
    # 這段時間創新高 10.8：算進新的一根；收盤用快照
    out = cli.extend_with_snapshot(m1, SimpleNamespace(open=10.0, high=10.8, low=9.9, close=10.5, volume=20_000), now)
    last = out.iloc[-1]
    assert str(last["ts"]) == "2026-10-05 09:40:00" and last["close"] == 10.5 and last["high"] == 10.8 and last["low"] == 10.5
    assert last["volume"] == 8.0
    # 沒有創新高 / 新低：高低就是收盤價
    out2 = cli.extend_with_snapshot(m1, SimpleNamespace(open=10.0, high=10.3, low=9.9, close=10.15, volume=12_000), now)
    assert out2.iloc[-1]["high"] == 10.15 and out2.iloc[-1]["low"] == 10.15
    # 快取：40 分鐘內才沿用
    monkeypatch.setattr(cli, "LIVE_DIR", tmp_path)
    d = now.date()
    cli.save_live_m1(d, {"2330": m1}, datetime.now(config.TW_TZ))
    got = cli.load_live_m1(d)["m1"]["2330"]
    pd.testing.assert_frame_equal(got[m1.columns], m1, check_dtype=False)
    cli.save_live_m1(d, {"2330": m1}, datetime.now(config.TW_TZ) - timedelta(minutes=50))
    assert cli.load_live_m1(d) is None


def test_session_date_handles_late_github_runs():
    from datetime import datetime
    from twstock import cli, config
    tw = config.TW_TZ
    # 週一 16:10 正常跑 → 週一
    assert cli.session_date(datetime(2026, 10, 5, 16, 10, tzinfo=tw)) == date(2026, 10, 5)
    # 被 GitHub 延到週二凌晨 01:05 才跑 → 還是處理週一
    assert cli.session_date(datetime(2026, 10, 6, 1, 5, tzinfo=tw)) == date(2026, 10, 5)
    # 週一凌晨 → 上週五
    assert cli.session_date(datetime(2026, 10, 5, 2, 0, tzinfo=tw)) == date(2026, 10, 2)
    # 週六凌晨 → 週五
    assert cli.session_date(datetime(2026, 10, 10, 3, 0, tzinfo=tw)) == date(2026, 10, 9)
