"""選股器：依照使用者在網頁上設定的條件，每天收盤後掃全市場。

策略格式（strategies.conditions，JSON）：
{
  "logic": "AND",                      # AND：全部成立；OR：任一成立
  "conditions": [
    {"kind": "compare", "tf": "60m", "left": {"src": "close"}, "op": ">", "right": {"src": "ma", "n": 60}},
    {"kind": "compare", "tf": "60m", "left": {"src": "k", "p": [60, 3, 3]}, "op": ">", "right": {"src": "value", "v": 50}},
    {"kind": "cross",   "tf": "60m", "a": {"src": "k"}, "dir": "up", "b": {"src": "d"}},
    {"kind": "deduct",  "tf": "D", "n": 20, "dir": "low"},      # 下一期扣抵值 < 收盤 → 均線易上揚
    {"kind": "deduct3low", "tf": "M", "n": 5},                  # 月扣三低
    {"kind": "inst", "who": "foreign", "days": 3, "dir": "buy"},# 外資連 3 日買超
    {"kind": "mainforce", "days": 1, "op": ">", "v": 0},        # 主力買賣超（近 N 日合計，張）
    {"kind": "volratio", "tf": "D", "n": 5, "op": ">", "v": 1.5}# 成交量 / N 日均量
  ]
}
src 可用：close open high low volume value ma(n) volma(n) k d rsi(n) dif macd osc bias(n)
        boll_up boll_mid boll_dn（n 預設 20，k 預設 2）
KD 參數：{"src": "k", "p": [60, 3, 3]}（不寫就是 9,3,3）
（日 / 週 / 月K 的成交量單位為「張」）
進階條件：ma_align ma_tangle range change new_high ma_turn inst_ratio broker_conc div_yield net_margin universe market
密集成交箱型：vp_box（mode = inside 盤整 / bottom 箱底不破 / break_top 突破箱頂 / break_bottom 跌破箱底）
型態條件：gap_break（跳空突破區間頂部）box_bottom（箱型底部不破）support_touch（回測支撐）
          source = auto（程式自動偵測）/ mine（策略主人自己畫的箱型、水平線）/ both
其他：in_group（在自訂族群裡）、group（條件群組，可巢狀，例如「① 或 ② 或 ③」；label 會標在結果上）
tf 可用：1m 3m 5m 15m 30m 60m D W M
"""
from __future__ import annotations

import operator
from typing import Callable

import numpy as np
import pandas as pd

from . import indicators as ind

OPS: dict[str, Callable] = {">": operator.gt, ">=": operator.ge, "<": operator.lt,
                            "<=": operator.le, "==": operator.eq}


class Series:
    """一檔股票某個週期的 K 線，指標算過就快取。"""

    def __init__(self, df: pd.DataFrame):
        self.df = df.reset_index(drop=True)
        self._cache: dict = {}

    def get(self, spec: dict) -> pd.Series | None:
        src = spec.get("src")
        n = int(spec.get("n") or 0)
        p = tuple(int(x) for x in (spec.get("p") or [9, 3, 3]))
        kk = float(spec.get("k") or 2)
        key = (src, n, p if src in ("k", "d") else None, kk if src.startswith("boll") else None)
        if key in self._cache:
            return self._cache[key]
        df = self.df
        if df.empty:
            return None
        c = df["close"].astype(float)
        if src in ("close", "open", "high", "low", "volume"):
            s = df[src].astype(float)
        elif src == "value":
            s = pd.Series(float(spec.get("v", 0)), index=df.index)
        elif src == "ma":
            s = ind.ma(c, n or 5)
        elif src == "volma":
            s = ind.ma(df["volume"].astype(float), n or 5)
        elif src in ("k", "d"):
            k, d = self._cache.get(("kd", p)) or ind.kd(df["high"].astype(float), df["low"].astype(float), c, *p)
            self._cache[("kd", p)] = (k, d)
            s = k if src == "k" else d
        elif src == "rsi":
            s = ind.rsi(c, n or 6)
        elif src in ("dif", "macd", "osc"):
            m = self._cache.get(("macd",)) or ind.macd(c)
            self._cache[("macd",)] = m
            s = {"dif": m[0], "macd": m[1], "osc": m[2]}[src]
        elif src in ("boll_up", "boll_mid", "boll_dn"):
            up, mid, dn = ind.boll(c, n or 20, kk)
            s = {"boll_up": up, "boll_mid": mid, "boll_dn": dn}[src]
        elif src == "bias":
            s = ind.bias(c, n or 10)
        else:
            raise ValueError(f"未知的指標：{src}")
        self._cache[key] = s
        return s


def _last(s: pd.Series | None, back: int = 0):
    if s is None or len(s) <= back:
        return None
    v = s.iloc[-1 - back]
    return None if pd.isna(v) else float(v)


def eval_condition(cond: dict, tfs: dict[str, Series], chips: dict) -> bool:
    kind = cond.get("kind")
    if kind in ("compare", "cross", "deduct", "deduct3low", "volratio"):
        ser = tfs.get(cond.get("tf", "D"))
        if ser is None or ser.df.empty:
            return False

    if kind == "compare":
        a, b = _last(ser.get(cond["left"])), _last(ser.get(cond["right"]))
        return a is not None and b is not None and OPS[cond.get("op", ">")](a, b)

    if kind == "cross":  # within：最近幾根內有發生交叉就算（預設 1 = 只看最新一根）
        a, b = ser.get(cond["a"]), ser.get(cond["b"])
        up = cond.get("dir", "up") == "up"
        for k in range(int(cond.get("within", 1) or 1)):
            a0, a1, b0, b1 = _last(a, k), _last(a, k + 1), _last(b, k), _last(b, k + 1)
            if None in (a0, a1, b0, b1):
                continue
            if (a1 <= b1 and a0 > b0) if up else (a1 >= b1 and a0 < b0):
                return True
        return False

    if kind == "deduct":
        c = ser.df["close"].astype(float)
        v, _ = ind.deduct_value(c, int(cond.get("n", 20)), int(chips.get("offset", 0)))
        if v is None:
            return False
        return v < c.iloc[-1] if cond.get("dir", "low") == "low" else v > c.iloc[-1]

    if kind == "deduct3low":
        # 扣三低線 = max(D1, D2, D3)（用月K 算）。mode：above = 收盤站上線；break = 今天日K 收盤由下往上突破
        r = ind.deduct3low(ser.df["close"].astype(float), int(cond.get("n", 5)), int(chips.get("offset", 0)))
        if not r:
            return False
        if cond.get("mode", "above") == "break":
            d = tfs.get("D")
            if d is None or len(d.df) < 2:
                return False
            c = d.df["close"].astype(float)
            return c.iloc[-2] <= r["line"] < c.iloc[-1]
        return bool(r["ok"])

    if kind == "volratio":
        v = ser.df["volume"].astype(float)
        n = int(cond.get("n", 5))
        if len(v) < n + 1:
            return False
        base = v.iloc[-n - 1:-1].mean()
        if base <= 0:
            return False
        return OPS[cond.get("op", ">")](v.iloc[-1] / base, float(cond.get("v", 1.5)))

    if kind == "inst":
        df = chips.get("inst")
        if df is None or df.empty:
            return False
        col = {"foreign": "foreign_net", "trust": "trust_net", "dealer": "dealer_net",
               "total": "total_net"}[cond.get("who", "foreign")]
        days = int(cond.get("days", 1))
        s = df.sort_values("date")[col].tail(days)
        if len(s) < days:
            return False
        return bool((s > 0).all()) if cond.get("dir", "buy") == "buy" else bool((s < 0).all())

    if kind == "mainforce":
        df = chips.get("mf")
        if df is None or df.empty:
            return False
        days = int(cond.get("days", 1))
        s = df.sort_values("date")["net"].tail(days).sum() / 1000  # 股 → 張
        return OPS[cond.get("op", ">")](s, float(cond.get("v", 0)))

    # ---------- 進階條件 ----------
    if kind in ("ma_align", "ma_tangle", "range", "change", "new_high", "ma_turn"):
        ser = tfs.get(cond.get("tf", "D"))
        if ser is None or ser.df.empty:
            return False
        df = ser.df
        c = df["close"].astype(float)

    if kind == "ma_align":  # 均線多頭 / 空頭排列，例如 10 > 20 > 60
        vals = [_last(ser.get({"src": "ma", "n": n})) for n in cond.get("ns", [10, 20, 60])]
        if None in vals:
            return False
        pairs = list(zip(vals, vals[1:]))
        return all(a > b for a, b in pairs) if cond.get("dir", "bull") == "bull" else all(a < b for a, b in pairs)

    if kind == "ma_tangle":  # 均線糾結：最大與最小均線差距 ≤ pct%
        vals = [_last(ser.get({"src": "ma", "n": n})) for n in cond.get("ns", [20, 60, 120, 240])]
        if None in vals or min(vals) <= 0:
            return False
        return (max(vals) - min(vals)) / min(vals) * 100 <= float(cond.get("pct", 10))

    if kind == "range":  # 近 n 根的區間振幅 =（最高 − 最低）/ 最低
        n = int(cond.get("n", 60))
        if len(df) < n:
            return False
        hi, lo = df["high"].astype(float).iloc[-n:].max(), df["low"].astype(float).iloc[-n:].min()
        return lo > 0 and OPS[cond.get("op", "<")]((hi - lo) / lo * 100, float(cond.get("pct", 20)))

    if kind == "change":  # 漲跌幅 %
        if len(c) < 2 or c.iloc[-2] == 0:
            return False
        return OPS[cond.get("op", ">")]((c.iloc[-1] / c.iloc[-2] - 1) * 100, float(cond.get("pct", 7)))

    if kind == "new_high":  # 創 n 日新高（或新低）
        n = int(cond.get("n", 60))
        if len(df) < n:
            return False
        if cond.get("dir", "high") == "high":
            h = df["high"].astype(float)
            return h.iloc[-1] >= h.iloc[-n:].max()
        lo = df["low"].astype(float)
        return lo.iloc[-1] <= lo.iloc[-n:].min()

    if kind == "ma_turn":  # 均線翻揚（近 lb 根上彎、之前下彎或走平）/ 走平
        m = ser.get({"src": "ma", "n": int(cond.get("n", 120))})
        lb = int(cond.get("lookback", 5))
        a, b = _last(m), _last(m, lb)
        if None in (a, b) or b == 0:
            return False
        if cond.get("dir", "up") == "flat":
            return abs(a / b - 1) * 100 <= float(cond.get("pct", 1))
        # 翻揚：近 lb 根往上，且近 lb×4 根內出現過低點（不是一直漲上來的）
        w = m.dropna().iloc[-lb * 4:]
        return a > b and len(w) >= lb * 2 and int(np.argmin(w.to_numpy())) > 0

    if kind == "inst_ratio":  # 近 N 日法人買超天數比例
        df = chips.get("inst")
        if df is None or df.empty:
            return False
        col = {"foreign": "foreign_net", "trust": "trust_net", "dealer": "dealer_net",
               "total": "total_net"}[cond.get("who", "foreign")]
        days = int(cond.get("days", 20))
        s = df.sort_values("date")[col].tail(days)
        if len(s) < days:
            return False
        return OPS[cond.get("op", ">=")]((s > 0).sum() / days * 100, float(cond.get("pct", 70)))

    if kind == "broker_conc":  # 近 N 日主力（關鍵券商）買超 ÷ 成交量
        mf, d = chips.get("mf"), tfs.get("D")
        days = int(cond.get("days", 10))
        if mf is None or mf.empty or d is None or len(mf) < days:
            return False
        net = mf.sort_values("date")["net"].tail(days).sum() / 1000  # 張
        vol = d.df["volume"].astype(float).tail(days).sum()          # 張
        return vol > 0 and OPS[cond.get("op", ">=")](net / vol * 100, float(cond.get("pct", 5)))

    if kind == "div_yield":  # 近 N 年平均現金殖利率
        ys = (chips.get("yields") or [])[-int(cond.get("years", 5)):]
        if not ys:
            return False
        return OPS[cond.get("op", ">")](sum(ys) / len(ys), float(cond.get("pct", 3)))

    if kind == "net_margin":  # 近 N 年稅後淨利率：mode=every 每年都符合；avg 平均（三竹「平均稅後純益率」）
        ms = (chips.get("margins") or [])[-int(cond.get("years", 5)):]
        if cond.get("mode", "every") == "avg":
            ok = [m for m in ms if m is not None]
            if len(ok) < max(1, len(ms) - 1):  # 最多容許缺 1 年
                return False
            return OPS[cond.get("op", ">")](sum(ok) / len(ok), float(cond.get("pct", 10)))
        if not ms or any(m is None for m in ms):
            return False
        return all(OPS[cond.get("op", ">")](m, float(cond.get("pct", 10))) for m in ms)

    if kind == "inst_rank":  # 法人近 N 日買超（或賣超）排行前 top 名（全市場排名）
        key = f"{cond.get('who', 'foreign')}:{int(cond.get('days', 1))}:{cond.get('dir', 'buy')}"
        r = (chips.get("inst_rank") or {}).get(key)
        return r is not None and r <= int(cond.get("top", 100))

    if kind == "inst_turn":  # 法人近期連續賣超 sell 天以上，近 within 日內轉為買方（或反過來）
        df = chips.get("inst")
        if df is None or df.empty:
            return False
        col = {"foreign": "foreign_net", "trust": "trust_net", "dealer": "dealer_net", "total": "total_net"}[cond.get("who", "trust")]
        v = df.sort_values("date")[col].fillna(0).to_numpy()[::-1]  # 由新到舊
        need, within = int(cond.get("days", 3)), int(cond.get("within", 3))
        up = cond.get("dir", "buy") == "buy"
        for k in range(min(within, len(v))):
            turned = v[k] > 0 if up else v[k] < 0
            before = v[k + 1:k + 1 + need]
            if turned and len(before) == need and all((x < 0) if up else (x > 0) for x in before):
                return True
        return False

    if kind == "board_pct":  # 董監事持股比例
        b = (chips.get("meta") or {}).get("board_pct")
        return b is not None and b == b and OPS[cond.get("op", ">")](float(b), float(cond.get("pct", 20)))

    if kind == "op_ratio":  # 最新一季 營業利益 ÷ 稅前淨利（本業占比）
        q = chips.get("quarter")
        if not q or not q.get("pretax") or q.get("op_income") is None:
            return False
        if float(q["pretax"]) <= 0:
            return False
        return OPS[cond.get("op", ">")](float(q["op_income"]) / float(q["pretax"]) * 100, float(cond.get("pct", 50)))

    if kind == "universe":  # 範圍：上市 / 上櫃、只要個股（排除 ETF）
        meta = chips.get("meta") or {}
        if cond.get("type", "stock") == "stock" and meta.get("kind") != "stock":
            return False
        mk = cond.get("market", "all")
        return mk == "all" or meta.get("market") == mk

    if kind == "market":  # 大盤（加權指數）條件
        mser = chips.get("market")
        if mser is None or mser.df.empty:
            return False
        a, b = _last(mser.get(cond["left"])), _last(mser.get(cond["right"]))
        return a is not None and b is not None and OPS[cond.get("op", "<")](a, b)

    if kind == "unsupported":  # 暫時沒有資料的條件：不影響結果
        return True

    if kind == "group":  # 條件群組（可巢狀）；tag_only = 只用來標示型態，不影響是否選出
        return True if cond.get("tag_only") else eval_strategy(cond, tfs, chips)

    if kind == "in_group":  # 在自訂族群裡（族群還沒有股票時不影響結果，選股頁會提醒）
        names = [n for n in cond.get("names") or [] if n]
        sizes = chips.get("group_sizes") or {}
        active = [n for n in names if sizes.get(n)]
        if not active:
            return True
        return bool(set(active) & (chips.get("groups") or set()))

    if kind == "vp_box":  # 密集成交區箱型（分價量）
        d = tfs.get(cond.get("tf", "D"))
        if d is None or d.df.empty:
            return False
        return _vp_box(cond, d.df)

    if kind in ("gap_break", "box_bottom", "support_touch"):
        d = tfs.get(cond.get("tf", "D"))
        if d is None or len(d.df) < 3:
            return False
        return _pattern(kind, cond, d.df, chips.get("draw") or [])

    raise ValueError(f"未知的條件類型：{kind}")


def _pattern(kind: str, cond: dict, df: pd.DataFrame, draws: list[dict]) -> bool:
    h, lo, c = (df[k].astype(float).to_numpy() for k in ("high", "low", "close"))
    src = cond.get("source", "both")
    auto, mine = src in ("auto", "both"), src in ("mine", "both")
    tol = float(cond.get("tol", 1 if kind == "box_bottom" else 2)) / 100
    hl = [float(x["points"][0]["v"]) for x in draws if x.get("kind") == "hline"]
    rects = []
    for x in draws:
        if x.get("kind") == "rect":
            v = [float(p["v"]) for p in x["points"][:2]]
            rects.append((min(v), max(v)))

    if kind == "gap_break":  # 今天跳空（最低 > 昨天最高）並收在區間頂部之上
        if not lo[-1] > h[-2]:
            return False
        levels = []
        n = int(cond.get("n", 20))
        if auto and len(h) > n + 1:
            levels.append(h[-n - 1:-1].max())       # 前 n 日區間頂部
        if mine:
            levels += [t for _, t in rects] + hl    # 自己畫的箱頂 / 壓力線
        return any(c[-2] <= L < c[-1] or (h[-2] <= L < lo[-1]) for L in levels if L > 0)

    if kind == "box_bottom":  # 在箱型底部區（箱底 ~ 箱底 + 箱高 × zone%），且最低沒有跌破箱底
        zone = float(cond.get("zone", 20)) / 100
        boxes = []
        n = int(cond.get("n", 60))
        if auto and len(h) > n + 1:
            b, t = lo[-n - 1:-1].min(), h[-n - 1:-1].max()
            if b > 0 and (t - b) / b * 100 <= float(cond.get("max_range", 25)):
                boxes.append((b, t))
        if mine:
            boxes += rects
        return any(lo[-1] >= b * (1 - tol) and c[-1] <= b + (t - b) * zone and c[-1] >= b for b, t in boxes if t > b > 0)

    if kind == "support_touch":  # 今天最低回測到支撐（tol% 內），收盤守在支撐之上
        sup = []
        n, skip = int(cond.get("n", 60)), int(cond.get("skip", 5))
        if auto and len(lo) > n:
            sup.append(lo[-n:-skip].min())          # 前波低點（排除最近 skip 根）
        if mine:
            sup += hl if cond.get("lines") == "hline" else hl + [b for b, _ in rects]
        ctol = float(cond.get("close_tol", 0)) / 100  # 收盤可以略低於支撐幾 %
        return any(lo[-1] <= S * (1 + tol) and c[-1] >= S * (1 - ctol) for S in sup if S > 0)
    return False


def _vp_box(cond: dict, df: pd.DataFrame) -> bool:
    """mode：
    inside = 箱型盤整中（收盤在箱內，且前 n 根有 inside% 以上的天數收在箱內）
    bottom = 箱底不破（收盤在箱底 ~ 箱底 + 箱高 × zone%，最低沒有跌破箱底 tol%）
    break_top = 突破箱頂（昨天收盤 ≤ 箱頂 < 今天收盤；vol > 0 時還要量 > 前 n 根均量 × vol 倍）
    break_bottom = 跌破箱底（做空用）
    共同條件：箱高 ≤ max_height%（太寬就不算箱型）
    """
    r = ind.vp_box(df["high"], df["low"], df["close"], df["volume"], n=int(cond.get("n", 60)),
                   bins=int(cond.get("bins", 50)), va=float(cond.get("va", 70)) / 100)
    if not r:
        return False
    if r["height"] > float(cond.get("max_height", 20)):
        return False
    c = df["close"].astype(float).to_numpy()
    lo = df["low"].astype(float).to_numpy()
    top, bot = r["top"], r["bottom"]
    mode = cond.get("mode", "inside")
    if mode == "inside":
        return bot <= c[-1] <= top and r["inside"] >= float(cond.get("inside", 70))
    if mode == "bottom":
        tol, zone = float(cond.get("tol", 1)) / 100, float(cond.get("zone", 20)) / 100
        return lo[-1] >= bot * (1 - tol) and bot <= c[-1] <= bot + (top - bot) * zone
    if len(c) < 2:
        return False
    vol_x = float(cond.get("vol", 0) or 0)
    if vol_x > 0:
        v = df["volume"].astype(float).to_numpy()
        n = int(cond.get("n", 60))
        base = v[-n - 1:-1].mean() if len(v) > n else 0
        if not (base > 0 and v[-1] > base * vol_x):
            return False
    if mode == "break_top":
        return c[-2] <= top < c[-1]
    if mode == "break_bottom":
        return c[-2] >= bot > c[-1]
    return False


def matched_labels(strategy: dict, tfs: dict[str, Series], chips: dict) -> list[str]:
    """哪些有標籤的群組成立（例如「① 突破」），顯示在選股結果上。"""
    out = []
    for c in strategy.get("conditions") or []:
        if c.get("kind") == "group":
            try:
                if c.get("label") and eval_strategy(c, tfs, chips):
                    out.append(c["label"])
            except Exception:  # noqa: BLE001
                pass
            out += matched_labels(c, tfs, chips)
    return out


def iter_conditions(strategy: dict):
    for c in strategy.get("conditions") or []:
        yield c
        if c.get("kind") == "group":
            yield from iter_conditions(c)


def eval_parts(strategy: dict, tfs: dict[str, Series], chips: dict) -> list[bool]:
    """最外層每一個條件各自成不成立（用來做「條件漏斗」：看是哪一條把股票都刷掉）。"""
    out = []
    for c in strategy.get("conditions") or []:
        try:
            out.append(bool(eval_condition(c, tfs, chips)))
        except Exception as e:  # noqa: BLE001
            print(f"[screener] {c} 條件判斷失敗（{type(e).__name__}）")  # 公開 repo 的 log 大家看得到：不印條件內容
            out.append(False)
    return out


def combine(strategy: dict, parts: list[bool]) -> bool:
    if not parts:
        return False
    return any(parts) if strategy.get("logic") == "OR" else all(parts)


def eval_strategy(strategy: dict, tfs: dict[str, Series], chips: dict) -> bool:
    conds = strategy.get("conditions") or []
    if not conds:
        return False
    results = []
    for c in conds:
        try:
            results.append(eval_condition(c, tfs, chips))
        except Exception as e:  # noqa: BLE001
            print(f"[screener] {c} 條件判斷失敗（{type(e).__name__}）")  # 公開 repo 的 log 大家看得到：不印條件內容
            results.append(False)
    return any(results) if strategy.get("logic") == "OR" else all(results)


def needed_timeframes(strategies: list[dict]) -> set[str]:
    tfs = set()
    for s in strategies:
        for c in iter_conditions(s):
            if "tf" in c:
                tfs.add(c["tf"])
    return tfs
