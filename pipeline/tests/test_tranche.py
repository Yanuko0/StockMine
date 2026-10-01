from datetime import date

import numpy as np
import pandas as pd

from twstock import screener as sc
from twstock import tranche

PLAN = {"capital": 300000, "parts": 3}
RULES = {
    "entries": [
        {"name": "第一筆", "conditions": [{"kind": "support_touch", "source": "mine", "lines": "hline", "tol": 2, "close_tol": 2}]},
        {"name": "第二筆", "conditions": [{"kind": "compare", "tf": "D", "left": {"src": "close"}, "op": ">", "right": {"src": "ma", "n": 5}}]},
    ],
    "stop": {"name": "停損", "tranches": [1], "logic": "OR",
             "conditions": [{"kind": "compare", "tf": "D", "left": {"src": "close"}, "op": "<", "right": {"src": "ma", "n": 5}}]},
}


def daily(closes):
    c = pd.Series(closes, dtype=float)
    return sc.Series(pd.DataFrame({"close": c, "open": c, "high": c + 0.5, "low": c - 0.5, "volume": 1000.0}))


def test_entries_and_held():
    tfs = {"D": daily([110, 108, 105, 103, 101, 100.6])}  # 回測到 100 的支撐
    chips = {"draw": [{"kind": "hline", "points": [{"t": 0, "v": 100}]}]}
    out = tranche.evaluate(RULES, date(2026, 9, 30), 100.6, tfs, chips, pd.DataFrame(), PLAN)
    assert [o["kind"] for o in out] == ["entry1"] and "約 0 張" not in out[0]["message"]
    held = pd.DataFrame({"tranche": [1], "buy_date": [date(2026, 9, 30)]})
    assert tranche.evaluate(RULES, date(2026, 9, 30), 100.6, tfs, chips, held, PLAN) == []  # 已買、當天不停損


def test_stop_after_buy_day():
    tfs = {"D": daily(list(np.linspace(100, 110, 10)) + [100])}
    held = pd.DataFrame({"tranche": [1], "buy_date": [date(2026, 9, 1)]})
    out = tranche.evaluate(RULES, date(2026, 9, 30), 100, tfs, {"draw": []}, held, PLAN)
    assert "stop" in [o["kind"] for o in out]


def test_cross_within():
    s = daily([10, 10, 10, 10, 12, 12, 12])  # 收盤在倒數第 3 根向上穿過 MA3
    cond = {"kind": "cross", "tf": "D", "a": {"src": "close"}, "dir": "up", "b": {"src": "ma", "n": 3}}
    assert not sc.eval_condition(cond, {"D": s}, {})
    assert sc.eval_condition(dict(cond, within=3), {"D": s}, {})


def test_size_text():
    assert tranche.size_text(100000, 50) == "約 2 張"
    assert tranche.size_text(100000, 1000) == "約 100 股（零股）"
    assert tranche.size_text(100000, 30) == "約 3 張 + 333 股"
