import numpy as np
import pandas as pd

from twstock import fundamentals, screener as sc


def ser(close, high=None, low=None, vol=1000):
    c = pd.Series(close, dtype=float)
    return sc.Series(pd.DataFrame({"close": c, "open": c, "high": c + 1 if high is None else high,
                                   "low": c - 1 if low is None else low, "volume": vol}))


def ev(cond, tfs, chips=None):
    return sc.eval_condition(cond, tfs, chips or {})


def test_ma_align_and_tangle():
    up = ser(np.linspace(50, 100, 300))
    assert ev({"kind": "ma_align", "tf": "D", "ns": [10, 20, 60], "dir": "bull"}, {"D": up})
    assert not ev({"kind": "ma_align", "tf": "D", "ns": [10, 20, 60], "dir": "bear"}, {"D": up})
    flat = ser(100 + np.sin(np.arange(300)) * 0.5)
    assert ev({"kind": "ma_tangle", "tf": "D", "ns": [20, 60, 120, 240], "pct": 3}, {"D": flat})
    assert not ev({"kind": "ma_tangle", "tf": "D", "ns": [20, 60, 120, 240], "pct": 3}, {"D": up})


def test_range_change_newhigh():
    c = [100.0] * 59 + [108.0]
    s = ser(c)
    assert ev({"kind": "change", "tf": "D", "op": ">", "pct": 7}, {"D": s})
    assert ev({"kind": "new_high", "tf": "D", "n": 60}, {"D": s})
    assert ev({"kind": "range", "tf": "D", "n": 60, "op": "<", "pct": 20}, {"D": s})
    assert not ev({"kind": "range", "tf": "D", "n": 60, "op": "<", "pct": 5}, {"D": s})


def test_ma_turn():
    c = list(np.linspace(100, 80, 200)) + list(np.linspace(80, 95, 15))
    assert not ev({"kind": "ma_turn", "tf": "D", "n": 20, "dir": "up", "lookback": 5}, {"D": ser(np.linspace(50, 100, 240))})
    assert ev({"kind": "ma_turn", "tf": "D", "n": 20, "dir": "up", "lookback": 5}, {"D": ser(c)})
    assert not ev({"kind": "ma_turn", "tf": "D", "n": 20, "dir": "up", "lookback": 5}, {"D": ser(np.linspace(100, 80, 240))})


def test_inst_ratio_broker_conc():
    inst = pd.DataFrame({"date": range(20), "foreign_net": [1] * 15 + [-1] * 5, "trust_net": 0, "dealer_net": 0, "total_net": 0})
    assert ev({"kind": "inst_ratio", "who": "foreign", "days": 20, "pct": 70}, {}, {"inst": inst})
    assert not ev({"kind": "inst_ratio", "who": "foreign", "days": 20, "pct": 80}, {}, {"inst": inst})
    mf = pd.DataFrame({"date": range(10), "net": [600_000] * 10})  # 600 張 / 天
    d = ser([100.0] * 30, vol=10000)  # 10000 張 / 天 → 6%
    assert ev({"kind": "broker_conc", "days": 10, "pct": 5}, {"D": d}, {"mf": mf})


def test_dividend_and_margin():
    div = pd.DataFrame({"code": ["A", "A", "B"], "ex_date": pd.to_datetime(["2021-07-01", "2022-07-01", "2025-07-01"]),
                        "cash": [5, 5, 1], "pre_close": [100, 100, 100]})
    y = fundamentals.yearly_yields(div, [2021, 2022, 2023, 2024, 2025])
    assert y["A"] == [5, 5, 0, 0, 0]
    assert ev({"kind": "div_yield", "years": 5, "op": ">", "pct": 1.9}, {}, {"yields": y["A"]})
    assert not ev({"kind": "div_yield", "years": 5, "op": ">", "pct": 3}, {}, {"yields": y["A"]})
    fin = pd.DataFrame({"code": "A", "year": [2021, 2022, 2023, 2024, 2025], "revenue": 100, "net_income": [12, 15, 11, 20, 9], "quarters": 4})
    m = fundamentals.yearly_margins(fin, [2021, 2022, 2023, 2024, 2025])
    assert not ev({"kind": "net_margin", "years": 5, "pct": 10}, {}, {"margins": m["A"]})
    assert ev({"kind": "net_margin", "years": 4, "pct": 10}, {}, {"margins": m["A"][:4]})


def test_universe_and_market():
    assert ev({"kind": "universe", "type": "stock"}, {}, {"meta": {"kind": "stock", "market": "TPEX"}})
    assert not ev({"kind": "universe", "type": "stock"}, {}, {"meta": {"kind": "etf", "market": "TWSE"}})
    taiex = ser(list(np.linspace(100, 120, 80)) + [90.0])
    assert ev({"kind": "market", "left": {"src": "close"}, "op": "<", "right": {"src": "ma", "n": 60}}, {}, {"market": taiex})


def test_deduct3low_break():
    m = ser([82, 87, 93, 95, 100])  # 線 = 93
    d_break = ser([92.0, 94.0])
    d_above = ser([95.0, 96.0])
    cond = {"kind": "deduct3low", "tf": "M", "n": 5, "mode": "break"}
    assert ev(cond, {"M": m, "D": d_break})
    assert not ev(cond, {"M": m, "D": d_above})
    assert ev(dict(cond, mode="above"), {"M": m, "D": d_above})


def test_fundamentals_parsers():
    assert fundamentals._roc_to_date("115/09/01").isoformat() == "2026-09-01"
    assert fundamentals._roc_to_date("114年07月01日").isoformat() == "2025-07-01"


def test_kd_params_and_boll():
    rng = np.random.default_rng(1)
    c = 100 + np.cumsum(rng.normal(0, 1, 400))
    s = ser(c)
    k9, k60 = s.get({"src": "k"}), s.get({"src": "k", "p": [60, 3, 3]})
    assert not np.allclose(k9.iloc[-50:], k60.iloc[-50:])
    up, mid, dn = (s.get({"src": f"boll_{x}"}) for x in ("up", "mid", "dn"))
    last = pd.Series(c).iloc[-20:]
    assert abs(mid.iloc[-1] - last.mean()) < 1e-9
    assert abs(up.iloc[-1] - (last.mean() + 2 * last.std(ddof=0))) < 1e-9
    assert dn.iloc[-1] < mid.iloc[-1] < up.iloc[-1]


def ohlc(rows):
    df = pd.DataFrame(rows, columns=["open", "high", "low", "close"], dtype=float)
    df["volume"] = 1000.0
    return sc.Series(df)


def test_gap_break():
    box = [[100, 105, 98, 101]] * 25
    gap = box + [[107, 110, 106, 109]]          # 跳空（106 > 105）並站上區間頂 105
    nogap = box + [[104, 110, 103, 109]]        # 沒有缺口
    cond = {"kind": "gap_break", "n": 20, "source": "auto"}
    assert ev(cond, {"D": ohlc(gap)})
    assert not ev(cond, {"D": ohlc(nogap)})
    # 自己畫的箱頂 108：跳空後收 109 突破
    mine = {"kind": "gap_break", "source": "mine"}
    rect = [{"kind": "rect", "points": [{"t": 0, "v": 95}, {"t": 1, "v": 108}]}]
    assert ev(mine, {"D": ohlc(gap)}, {"draw": rect})
    assert not ev(mine, {"D": ohlc(gap)}, {"draw": []})


def test_box_bottom_and_support():
    rows = [[100, 110, 95, 105] for _ in range(70)] + [[97, 98, 95.5, 96.5]]
    s = ohlc(rows)
    assert ev({"kind": "box_bottom", "n": 60, "max_range": 25, "zone": 20, "source": "auto"}, {"D": s})
    broken = ohlc(rows[:-1] + [[96, 97, 92, 93]])
    assert not ev({"kind": "box_bottom", "n": 60, "source": "auto"}, {"D": broken})
    assert ev({"kind": "support_touch", "n": 60, "skip": 5, "tol": 2, "source": "auto"}, {"D": s})
    hl = [{"kind": "hline", "points": [{"t": 0, "v": 96}]}]
    assert ev({"kind": "support_touch", "source": "mine"}, {"D": s}, {"draw": hl})


def test_group_tags_and_in_group():
    up = ser(np.linspace(50, 100, 300))
    strat = {"logic": "AND", "conditions": [
        {"kind": "in_group", "names": ["題材A"]},
        {"kind": "group", "logic": "OR", "conditions": [
            {"kind": "group", "label": "①", "conditions": [{"kind": "ma_align", "tf": "D", "ns": [5, 10, 20, 60], "dir": "bull"}]},
            {"kind": "group", "label": "②", "conditions": [{"kind": "ma_align", "tf": "D", "ns": [5, 10], "dir": "bear"}]},
        ]},
    ]}
    tfs = {"D": up}
    # 族群還沒有股票 → 前提不影響
    assert sc.eval_strategy(strat, tfs, {"group_sizes": {}})
    # 族群有股票但這檔不在裡面 → 不符合
    assert not sc.eval_strategy(strat, tfs, {"group_sizes": {"題材A": 3}, "groups": set()})
    ch = {"group_sizes": {"題材A": 3}, "groups": {"題材A"}}
    assert sc.eval_strategy(strat, tfs, ch)
    assert sc.matched_labels(strat, tfs, ch) == ["①"]
    assert sc.needed_timeframes([strat]) == {"D"}


def test_tag_only_group():
    up = ser(np.linspace(50, 100, 300))
    strat = {"logic": "AND", "conditions": [
        {"kind": "ma_align", "tf": "D", "ns": [5, 20], "dir": "bull"},
        {"kind": "group", "logic": "OR", "tag_only": True, "conditions": [
            {"kind": "group", "label": "② 跳空", "conditions": [{"kind": "gap_break", "source": "auto"}]},
            {"kind": "group", "label": "① 多頭", "conditions": [{"kind": "ma_align", "tf": "D", "ns": [5, 10, 20, 60], "dir": "bull"}]},
        ]},
    ]}
    # 型態都不成立也照樣選出（只是不標）
    assert sc.eval_strategy(strat, {"D": up}, {})
    assert sc.matched_labels(strat, {"D": up}, {}) == ["① 多頭"]


def test_vp_box():
    from twstock import indicators as ind
    rng = np.random.default_rng(3)
    # 60 天在 100~108 盤整（量集中在 103~105），再一天放量突破 110
    c = list(104 + rng.normal(0, 1.2, 60).clip(-3.5, 3.5)) + [111.0]
    df = pd.DataFrame({"close": c, "open": c, "high": [x + 0.8 for x in c], "low": [x - 0.8 for x in c],
                       "volume": [1000.0] * 60 + [5000.0]})
    r = ind.vp_box(df["high"], df["low"], df["close"], df["volume"], n=60)
    assert 99 < r["bottom"] < r["poc"] < r["top"] < 109 and r["inside"] >= 60
    s = sc.Series(df)
    assert ev({"kind": "vp_box", "mode": "break_top", "n": 60, "vol": 2}, {"D": s})
    assert not ev({"kind": "vp_box", "mode": "inside", "n": 60}, {"D": s})          # 今天已經在箱外
    inside = sc.Series(df.iloc[:-1].assign())
    assert ev({"kind": "vp_box", "mode": "inside", "n": 50, "inside": 60}, {"D": inside})
    # 箱底：最後一天收在箱底附近
    r2 = ind.vp_box(df["high"][:-1], df["low"][:-1], df["close"][:-1], df["volume"][:-1], n=59)
    b = r2["bottom"]
    d2 = pd.concat([df.iloc[:-1], pd.DataFrame([{"close": b + 0.3, "open": b + 0.5, "high": b + 1, "low": b + 0.1, "volume": 1000.0}])], ignore_index=True)
    assert ev({"kind": "vp_box", "mode": "bottom", "n": 59, "zone": 30}, {"D": sc.Series(d2)})
    assert not ev({"kind": "vp_box", "mode": "inside", "n": 59, "max_height": 1}, {"D": sc.Series(d2)})


def test_mitake_kinds():
    inst = pd.DataFrame({"date": range(8), "foreign_net": 0, "dealer_net": 0, "total_net": 0,
                         "trust_net": [5, 5, -1, -2, -3, -4, 3, -1]})  # 由舊到新：連賣 4 天後，倒數第 2 天轉買
    assert ev({"kind": "inst_turn", "who": "trust", "days": 3, "within": 3}, {}, {"inst": inst})
    assert not ev({"kind": "inst_turn", "who": "trust", "days": 5, "within": 3}, {}, {"inst": inst})
    assert ev({"kind": "inst_rank", "who": "foreign", "days": 20, "top": 100}, {}, {"inst_rank": {"foreign:20:buy": 37}})
    assert not ev({"kind": "inst_rank", "who": "foreign", "days": 20, "top": 30}, {}, {"inst_rank": {"foreign:20:buy": 37}})
    assert not ev({"kind": "inst_rank", "who": "foreign", "days": 20, "top": 100}, {}, {"inst_rank": {}})
    assert ev({"kind": "board_pct", "op": ">", "pct": 20}, {}, {"meta": {"board_pct": 25.1}})
    assert not ev({"kind": "board_pct", "op": ">", "pct": 20}, {}, {"meta": {"board_pct": None}})
    assert ev({"kind": "op_ratio", "pct": 50}, {}, {"quarter": {"op_income": 80, "pretax": 100}})
    assert not ev({"kind": "op_ratio", "pct": 50}, {}, {"quarter": {"op_income": 30, "pretax": 100}})
    assert ev({"kind": "net_margin", "years": 5, "pct": 10, "mode": "avg"}, {}, {"margins": [12, 8, None, 15, 11]})
    assert not ev({"kind": "net_margin", "years": 5, "pct": 10, "mode": "every"}, {}, {"margins": [12, 8, None, 15, 11]})


def test_board_holdings():
    from twstock import company
    rows = [{"公司代號": "1101", "職稱": "董事長本人", "目前持股": "1,000"},
            {"公司代號": "1101", "職稱": "董事之法人代表人", "目前持股": "500"},
            {"公司代號": "1101", "職稱": "經理人", "目前持股": "300"},
            {"公司代號": "1101", "職稱": "監察人", "目前持股": "200"}]
    assert company.board_holdings(rows) == {"1101": 1200}
