"""個股展望：偏多 / 偏空的理由、上漲機率、風險、參考做法。

機率怎麼算（不靠 AI 猜，用自己的歷史資料回測）：
  1. 把每一檔、每一天的「狀態」分類：
       趨勢（站上 / 跌破月線、月線在季線上 / 下）× 近 20 日漲跌 × RSI × 量能 ×（有資料時）外資近 5 日買賣
  2. 統計過去 3 年全市場「同一種狀態」之後 20 個交易日（約一個月）：
       上漲的比例、報酬中位數、最差 10% 的情況、期間最大回檔
  3. 跟「全部狀態的平均」比較：差不到 3 個百分點就說「沒有明顯優勢」
  4. 準不準：用前面的資料算機率、拿最近一年實際結果對答案（校準表），網頁上看得到

理由：
  - 規則：技術面、法人籌碼、主力、融資、目標價（數字都是算出來的，準）
  - 新聞：有設定 GEMINI_API_KEY 時，請 Google Gemini（免費額度）把新聞整理成看多 / 看空理由，
          每一條都要標是哪幾則新聞，對不到新聞的理由會被丟掉
參考做法：停損（2 倍 ATR / 月線）、目標（歷史同狀態的 75 分位 / 券商目標價中位數）、風險報酬比、部位上限。
"""
from __future__ import annotations

import hashlib
import json
import math
import os
import re
import time
import xml.etree.ElementTree as ET
from datetime import date, datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from urllib.parse import quote

import numpy as np
import pandas as pd

from . import db, indicators as ind, targets as T
from .sources import http

H = 20                 # 看之後 20 個交易日（約一個月）
HIST_YEARS = 3
MIN_N = 300            # 同一種狀態至少要有這麼多個樣本才拿來用
MAX_STOCKS = 250
GOOGLE_RSS = "https://news.google.com/rss/search?q={q}&hl=zh-TW&gl=TW&ceid=TW:zh-Hant"
YAHOO_STOCK_RSS = "https://tw.stock.yahoo.com/rss?s={code}"
GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
# 免費額度：Flash-Lite 每天次數比較多；別名會自動指到最新版本。可以用 GEMINI_MODEL 換
GEMINI_MODELS = [m for m in (os.environ.get("GEMINI_MODEL") or "gemini-flash-lite-latest,gemini-flash-latest").split(",") if m]
AI_MAX_CALLS = int(os.environ.get("GEMINI_MAX_CALLS") or 40)

STATE_TEXT = {
    "trend": {0: "跌破月線、月線在季線下（空頭）", 1: "站上月線、但月線在季線下（反彈）",
              2: "跌破月線、但月線在季線上（多頭回檔）", 3: "站上月線、月線在季線上（多頭）"},
    "mom": {0: "近 20 日跌超過 10%", 1: "近 20 日小跌", 2: "近 20 日小漲", 3: "近 20 日漲超過 10%"},
    "rsi": {0: "RSI 低於 30（超賣）", 1: "RSI 30～70", 2: "RSI 高於 70（過熱）"},
    "vol": {0: "量縮（低於 20 日均量 8 成）", 1: "量正常", 2: "量增（20 日均量 1.5 倍以上）"},
    "fx": {0: "外資近 5 日賣超", 1: "外資近 5 日沒動作", 2: "外資近 5 日買超"},
}


# ------------------------------------------------------------------ 狀態與歷史統計
def features(daily: pd.DataFrame, inst: pd.DataFrame | None = None) -> pd.DataFrame:
    """daily：code, date, high, low, close, volume（依 code, date 排好）→ 每天的狀態與之後 20 日的結果。"""
    df = daily.sort_values(["code", "date"]).reset_index(drop=True)
    g = df.groupby("code", sort=False)
    c = df["close"].astype(float)
    ma20 = g["close"].transform(lambda s: s.astype(float).rolling(20).mean())
    ma60 = g["close"].transform(lambda s: s.astype(float).rolling(60).mean())
    r20 = g["close"].transform(lambda s: s.astype(float).pct_change(20))
    vma = g["volume"].transform(lambda s: s.astype(float).rolling(20).mean().shift(1))
    rsi = g["close"].transform(lambda s: ind.rsi(s.astype(float).reset_index(drop=True), 14).set_axis(s.index))
    df["trend"] = (c > ma20).astype(int) + 2 * (ma20 > ma60).astype(int)
    df["mom"] = np.select([r20 < -0.10, r20 < 0, r20 < 0.10], [0, 1, 2], 3)
    df["rsi"] = np.select([rsi < 30, rsi <= 70], [0, 1], 2)
    vr = df["volume"].astype(float) / vma
    df["vol"] = np.select([vr < 0.8, vr < 1.5], [0, 1], 2)
    df["valid"] = ma60.notna() & r20.notna() & rsi.notna() & vma.notna() & (vma > 0)
    # 之後 20 日：報酬、期間最低點（最大回檔）
    fwd = g["close"].shift(-H).astype(float)
    df["ret"] = fwd / c - 1
    low = df["low"].astype(float)
    df["mae"] = low.groupby(df["code"]).transform(
        lambda s: s[::-1].rolling(H, min_periods=H).min()[::-1].shift(-1)) / c - 1
    if inst is not None and not inst.empty:
        x = inst.sort_values(["code", "date"])
        x["f5"] = x.groupby("code")["foreign_net"].transform(lambda s: s.astype(float).rolling(5).sum())
        df = df.merge(x[["code", "date", "f5"]], on=["code", "date"], how="left")
        df["fx"] = np.where(df["f5"].isna(), -1, np.select([df["f5"] < 0, df["f5"] == 0], [0, 1], 2))
    else:
        df["fx"] = -1
    return df


def _stats(x: pd.DataFrame) -> dict:
    r, m = x["ret"], x["mae"]
    return {"n": int(len(x)), "win": round(float((r > 0).mean()) * 100, 1),
            "mean": round(float(r.mean()) * 100, 2), "median": round(float(r.median()) * 100, 2),
            "p10": round(float(r.quantile(0.1)) * 100, 1), "p25": round(float(r.quantile(0.25)) * 100, 1),
            "p75": round(float(r.quantile(0.75)) * 100, 1), "p90": round(float(r.quantile(0.9)) * 100, 1),
            "mae_med": round(float(m.median()) * 100, 1), "mae_p10": round(float(m.quantile(0.1)) * 100, 1)}


KEY_P = ["trend", "mom", "rsi", "vol"]
KEY_F = KEY_P + ["fx"]


def state_table(f: pd.DataFrame) -> dict:
    """{ "p|3,2,1,1": 統計, "f|3,2,1,1,2": 統計, "base": 全部平均 }（只用之後 20 日已經知道結果的）"""
    done = f[f["valid"] & f["ret"].notna() & f["mae"].notna()]
    out = {"base": _stats(done)} if len(done) else {}
    for key, cols in (("p", KEY_P), ("f", KEY_F)):
        d = done if key == "p" else done[done["fx"] >= 0]
        for k, grp in d.groupby(cols):
            if len(grp) >= 50:
                out[f"{key}|{','.join(str(int(v)) for v in (k if isinstance(k, tuple) else (k,)))}"] = _stats(grp)
    return out


def lookup(table: dict, row) -> tuple[dict | None, str]:
    kf = f"f|{','.join(str(int(row[c])) for c in KEY_F)}"
    if row.get("fx", -1) >= 0 and table.get(kf, {}).get("n", 0) >= MIN_N:
        return table[kf], "f"
    kp = f"p|{','.join(str(int(row[c])) for c in KEY_P)}"
    if table.get(kp, {}).get("n", 0) >= MIN_N:
        return table[kp], "p"
    return None, ""


def calibrate(f: pd.DataFrame, split: date) -> dict:
    """用 split 之前的資料算機率，拿之後（已知道結果）的實際漲跌對答案。"""
    done = f[f["valid"] & f["ret"].notna() & f["mae"].notna()]
    train, test = done[done["date"] < split], done[done["date"] >= split]
    if len(train) < 10000 or len(test) < 2000:
        return {}
    tab = state_table(train)
    base = tab["base"]["win"] / 100
    kp = test[KEY_P].astype(int).astype(str).agg(",".join, axis=1)
    kf = test[KEY_F].astype(int).astype(str).agg(",".join, axis=1)
    win = {k: v["win"] / 100 for k, v in tab.items() if k != "base" and v["n"] >= MIN_N}
    pf = ("f|" + kf).map(win)
    pp = ("p|" + kp).map(win)
    p = pf.where(test["fx"] >= 0).fillna(pp).fillna(base).to_numpy()
    y = (test["ret"] > 0).to_numpy().astype(float)
    bins = [0, 0.45, 0.5, 0.55, 0.6, 1.01]
    labels = ["45% 以下", "45～50%", "50～55%", "55～60%", "60% 以上"]
    rows = []
    cut = pd.cut(p, bins, labels=labels, right=False)
    for lab in labels:
        m = np.asarray(cut == lab)
        if m.sum() >= 100:
            rows.append({"bucket": lab, "n": int(m.sum()), "pred": round(float(p[m].mean()) * 100, 1),
                         "actual": round(float(y[m].mean()) * 100, 1)})
    brier = float(np.mean((p - y) ** 2))
    brier_base = float(np.mean((base - y) ** 2))
    return {"since": str(split), "n": int(len(test)), "rows": rows,
            "test_base": round(float(y.mean()) * 100, 1), "train_base": round(base * 100, 1),
            "brier": round(brier, 4), "brier_base": round(brier_base, 4),
            "skill": round((1 - brier / brier_base) * 100, 2) if brier_base else None}


# ------------------------------------------------------------------ 規則：偏多 / 偏空理由
def _lots(x: float) -> str:
    return f"{x / 1000:,.0f} 張"


def rule_reasons(bars: pd.DataFrame, inst: pd.DataFrame, mf: pd.DataFrame, margin: pd.DataFrame,
                 tsum: dict | None, news_flag: dict | None) -> tuple[list[dict], list[dict]]:
    """回傳 (偏多理由, 偏空理由)，每條 {"t": 文字, "k": 類別}。"""
    bull, bear = [], []
    c = bars["close"].astype(float).reset_index(drop=True)
    if len(c) < 61:
        return bull, bear
    v = bars["volume"].astype(float).reset_index(drop=True)
    last = c.iloc[-1]
    ma20, ma60 = c.rolling(20).mean(), c.rolling(60).mean()
    ma120 = c.rolling(120).mean() if len(c) >= 120 else None
    if last > ma20.iloc[-1] > ma60.iloc[-1]:
        bull.append({"k": "技術", "t": f"多頭排列：收盤 {last:g} 在月線 {ma20.iloc[-1]:.1f}、季線 {ma60.iloc[-1]:.1f} 之上"})
    elif last < ma20.iloc[-1] < ma60.iloc[-1]:
        bear.append({"k": "技術", "t": f"空頭排列：收盤 {last:g} 在月線 {ma20.iloc[-1]:.1f}、季線 {ma60.iloc[-1]:.1f} 之下"})
    elif last < ma20.iloc[-1]:
        bear.append({"k": "技術", "t": f"跌破月線（{ma20.iloc[-1]:.1f}）"})
    elif last > ma20.iloc[-1]:
        bull.append({"k": "技術", "t": f"站上月線（{ma20.iloc[-1]:.1f}）"})
    if ma120 is not None and pd.notna(ma120.iloc[-1]):
        (bull if last > ma120.iloc[-1] else bear).append(
            {"k": "技術", "t": f"{'在' if last > ma120.iloc[-1] else '在'}半年線 {ma120.iloc[-1]:.1f} {'之上' if last > ma120.iloc[-1] else '之下'}"})
    # 月線方向：下一根的扣抵值
    if len(c) >= 21:
        ded = c.iloc[-20]
        if last > ded:
            bull.append({"k": "技術", "t": f"月線扣抵值 {ded:g} 低於現價，月線容易往上"})
        elif last < ded:
            bear.append({"k": "技術", "t": f"月線扣抵值 {ded:g} 高於現價，月線容易往下"})
    hi60 = c.iloc[-60:].max()
    if last >= hi60:
        bull.append({"k": "技術", "t": "創 60 日新高"})
    elif last <= c.iloc[-60:].min():
        bear.append({"k": "技術", "t": "創 60 日新低"})
    rsi = ind.rsi(c, 14).iloc[-1]
    if pd.notna(rsi):
        if rsi > 75:
            bear.append({"k": "技術", "t": f"RSI {rsi:.0f}，短線過熱，追高風險大"})
        elif rsi < 25:
            bull.append({"k": "技術", "t": f"RSI {rsi:.0f}，短線超賣，容易反彈"})
    vavg = v.iloc[-21:-1].mean()
    if vavg > 0 and v.iloc[-1] > vavg * 1.5:
        chg = c.iloc[-1] / c.iloc[-2] - 1
        if chg > 0.01:
            bull.append({"k": "量價", "t": f"量增價漲：成交量是 20 日均量 {v.iloc[-1] / vavg:.1f} 倍，漲 {chg * 100:.1f}%"})
        elif chg < -0.01:
            bear.append({"k": "量價", "t": f"量增價跌：成交量是 20 日均量 {v.iloc[-1] / vavg:.1f} 倍，跌 {chg * 100:.1f}%"})
    bias = (last / ma20.iloc[-1] - 1) * 100
    if bias > 15:
        bear.append({"k": "技術", "t": f"月線乖離 {bias:.0f}%，離均線太遠，容易拉回"})
    elif bias < -15:
        bull.append({"k": "技術", "t": f"月線負乖離 {bias:.0f}%，跌深"})

    # 法人
    if inst is not None and not inst.empty:
        x = inst.sort_values("date")
        for col, who in (("foreign_net", "外資"), ("trust_net", "投信")):
            s = x[col].astype(float)
            s5 = s.iloc[-5:].sum()
            streak = 0
            for val in s.iloc[::-1]:
                if val == 0 or (streak and np.sign(val) != np.sign(streak)):
                    break
                streak += int(np.sign(val))
            vol5 = v.iloc[-5:].sum() * 1000  # 股
            share = abs(s5) / vol5 * 100 if vol5 else 0
            if s5 > 0 and (abs(streak) >= 3 or share >= 5):
                bull.append({"k": "籌碼", "t": f"{who}近 5 日買超 {_lots(s5)}" + (f"（連 {streak} 日買）" if streak >= 3 else "")
                             + (f"，佔成交量 {share:.0f}%" if share >= 5 else "")})
            elif s5 < 0 and (abs(streak) >= 3 or share >= 5):
                bear.append({"k": "籌碼", "t": f"{who}近 5 日賣超 {_lots(-s5)}" + (f"（連 {-streak} 日賣）" if streak <= -3 else "")
                             + (f"，佔成交量 {share:.0f}%" if share >= 5 else "")})
    if mf is not None and not mf.empty:
        n5 = mf.sort_values("date")["net"].astype(float).iloc[-5:].sum()
        if n5 > 0:
            bull.append({"k": "籌碼", "t": f"主力（前 15 大分點）近 5 日買超 {_lots(n5)}"})
        elif n5 < 0:
            bear.append({"k": "籌碼", "t": f"主力（前 15 大分點）近 5 日賣超 {_lots(-n5)}"})
    if margin is not None and len(margin) >= 6:
        m = margin.sort_values("date")["margin_balance"].astype(float)
        if m.iloc[-6] > 0:
            chg = (m.iloc[-1] / m.iloc[-6] - 1) * 100
            pchg = (c.iloc[-1] / c.iloc[-6] - 1) * 100
            if chg > 10 and pchg < 0:
                bear.append({"k": "籌碼", "t": f"融資 5 日增加 {chg:.0f}% 但股價下跌，散戶接刀、籌碼變亂"})
            elif chg < -10 and pchg > 0:
                bull.append({"k": "籌碼", "t": f"融資 5 日減少 {-chg:.0f}% 而股價上漲，籌碼變乾淨"})
    # 目標價
    if tsum and tsum.get("n"):
        up = tsum.get("upside")
        if up is not None:
            if up >= 10:
                bull.append({"k": "目標價", "t": f"{tsum['n']} 家券商最新目標價中位數 {tsum['median']:g}，比現價高 {up:.0f}%"})
            elif up <= 0:
                bear.append({"k": "目標價", "t": f"現價已超過 {tsum['n']} 家券商目標價中位數 {tsum['median']:g}（{up:+.0f}%）"})
        if tsum.get("up90", 0) > tsum.get("down90", 0):
            bull.append({"k": "目標價", "t": f"近 90 天目標價調升 {tsum['up90']} 次、調降 {tsum['down90']} 次"})
        elif tsum.get("down90", 0) > tsum.get("up90", 0):
            bear.append({"k": "目標價", "t": f"近 90 天目標價調降 {tsum['down90']} 次、調升 {tsum['up90']} 次"})
    if news_flag:
        if news_flag.get("flag") == "hot_sell":
            bear.append({"k": "新聞", "t": f"新聞熱度高（7 日 {news_flag.get('n7')} 則）但主力賣超，小心利多出貨"})
        elif news_flag.get("spike") and news_flag["spike"] >= 3:
            bull.append({"k": "新聞", "t": f"新聞熱度突然升高（{news_flag['spike']:.1f} 倍）"})
    return bull, bear


# ------------------------------------------------------------------ 風險與參考做法
def risk_plan(bars: pd.DataFrame, st: dict | None, base: dict, tsum: dict | None, vol_pct: float | None) -> dict:
    c = bars["close"].astype(float).reset_index(drop=True)
    h, low = bars["high"].astype(float).reset_index(drop=True), bars["low"].astype(float).reset_index(drop=True)
    last = float(c.iloc[-1])
    tr = pd.concat([h - low, (h - c.shift()).abs(), (low - c.shift()).abs()], axis=1).max(axis=1)
    atr = float(tr.rolling(14).mean().iloc[-1])
    vol = float(c.pct_change().iloc[-20:].std() * math.sqrt(250) * 100)
    ma20 = float(c.rolling(20).mean().iloc[-1])
    stop_atr = last - 2 * atr
    stop = max(stop_atr, ma20 * 0.98) if ma20 < last else stop_atr  # 月線在下方：月線稍微下面當防守
    stop_pct = (stop / last - 1) * 100
    tgt_hist = last * (1 + st["p75"] / 100) if st else None
    tgt = tgt_hist
    if tsum and tsum.get("median") and tsum["median"] > last:
        tgt = min(tgt_hist, tsum["median"]) if tgt_hist else tsum["median"]
    rr = (tgt - last) / (last - stop) if tgt and last > stop else None
    worst = st["p10"] if st else None
    score = 0
    if vol_pct is not None:
        score += 2 if vol_pct >= 70 else 0 if vol_pct <= 30 else 1
    if worst is not None:
        score += 2 if worst <= -15 else 0 if worst >= -8 else 1
    level = "高" if score >= 3 else "低" if score <= 1 else "中"
    return {"atr": round(atr, 2), "vol": round(vol, 1), "vol_pct": round(vol_pct, 0) if vol_pct is not None else None,
            "level": level, "stop": round(stop, 2), "stop_pct": round(stop_pct, 1),
            "target": round(tgt, 2) if tgt else None, "target_hist": round(tgt_hist, 2) if tgt_hist else None,
            "rr": round(rr, 2) if rr else None,
            # 單筆最多虧總資金 1% 的部位上限
            "size_1pct": round(min(100.0, 1 / abs(stop_pct) * 100), 0) if stop_pct < 0 else None}


def verdict(st: dict | None, base: dict) -> dict:
    if not st:
        return {"side": "資料不足", "p_up": None, "edge": None,
                "text": "這種狀態過去的樣本太少，不給機率。"}
    edge = round(st["win"] - base["win"], 1)
    # 同一檔連續幾天的 20 日報酬大部分重疊，不是獨立樣本：保守當作 1/10 的樣本數來算誤差
    p = st["win"] / 100
    se = math.sqrt(max(p * (1 - p), 1e-6) / max(st["n"] / 10, 1)) * 100
    z = abs(edge) / se if se else 0
    conf = "高" if z >= 3 else "中" if z >= 2 else "低"
    if conf != "低" and st["win"] >= 50 and edge >= 3:
        side = "偏多"
    elif conf != "低" and st["win"] < 50 and edge <= -3:
        side = "偏空"
    else:
        side = "中性"
    txt = (f"過去 3 年全市場跟它現在狀態一樣的 {st['n']:,} 次裡，之後 20 個交易日上漲的有 {st['win']:.0f}%"
           f"（所有股票平均 {base['win']:.0f}%，{'高' if edge > 0 else '低'} {abs(edge):.1f} 個百分點）。")
    if side == "中性":
        txt += ("跟平均差不多，沒有明顯優勢。" if abs(edge) < 3 else
                f"差距還在誤差範圍內（約 ±{2 * se:.0f} 個百分點），不算數。")
    return {"side": side, "p_up": st["win"], "p_down": round(100 - st["win"], 1), "edge": edge,
            "se": round(se, 1), "conf": conf, "text": txt}


def plan_text(side: str, risk: dict, tsum: dict | None) -> list[str]:
    out = []
    if side == "偏多":
        out.append("偏多但不追高：可以等拉回月線附近、或分 2～3 批買")
    elif side == "偏空":
        out.append("偏空：空手先觀望；有持股的話設好停損、反彈減碼")
    else:
        out.append("中性：沒有明顯優勢，等訊號更清楚（例如站回月線且外資轉買）再說")
    out.append(f"停損參考 {risk['stop']:g}（{risk['stop_pct']:+.1f}%，2 倍 ATR / 月線下方）")
    if risk.get("target"):
        out.append(f"目標參考 {risk['target']:g}" + (f"，風險報酬比 {risk['rr']:.1f}" if risk.get("rr") else ""))
        if risk.get("rr") is not None and risk["rr"] < 1.5:
            out.append("風險報酬比不到 1.5，賺的空間不夠大，不划算")
    if risk.get("size_1pct"):
        out.append(f"如果一筆最多只願意虧總資金 1%，這檔最多買總資金的 {risk['size_1pct']:.0f}%")
    return out


# ------------------------------------------------------------------ 新聞（個股）
def parse_rss(text: str) -> list[dict]:
    out = []
    try:
        root = ET.fromstring(text)
    except ET.ParseError:
        return out
    for it in root.iter("item"):
        title = re.sub(r"\s+", " ", (it.findtext("title") or "")).strip()
        link, pub = (it.findtext("link") or "").strip(), it.findtext("pubDate")
        if not title or not pub:
            continue
        try:
            ts = parsedate_to_datetime(pub)
        except (TypeError, ValueError):
            continue
        src = (it.findtext("source") or "").strip()
        m = re.search(r"\s+-\s+([^-]{1,20})$", title)
        if m:
            src, title = src or m.group(1).strip(), title[:m.start()].strip()
        desc = re.sub(r"<[^>]+>", "", it.findtext("description") or "")
        out.append({"ts": ts if ts.tzinfo else ts.replace(tzinfo=timezone.utc), "title": title,
                    "summary": re.sub(r"\s+", " ", desc).strip()[:200], "url": link, "source": src or "Google 新聞"})
    return out


def fetch_stock_news(c, code: str, name: str, query: str, days: int) -> list[dict]:
    items = []
    q = f'"{name}" {query} when:{days}d' if query else f'"{name}" OR {code} when:{days}d'
    for url in (GOOGLE_RSS.format(q=quote(q)),) + ((YAHOO_STOCK_RSS.format(code=code),) if not query else ()):
        try:
            r = c.get(url, headers={"Accept": "application/rss+xml, */*"})
            if r.status_code == 200:
                items += parse_rss(r.text)
        except Exception:  # noqa: BLE001
            pass
        time.sleep(0.5)
    return [x for x in items if name in x["title"] or code in x["title"] or name in x["summary"]]


# ------------------------------------------------------------------ AI（免費額度）整理新聞
def ai_reasons(name: str, code: str, close: float, news: list[dict], key: str) -> dict | None:
    """請 Gemini 從新聞整理看多 / 看空理由。每條都要標新聞編號，對不到的丟掉；目標價必須在那則新聞裡找得到數字。"""
    lines = [f"[{i}] {x['ts']:%Y-%m-%d} {x.get('source') or ''}｜{x['title']}｜{(x.get('summary') or '')[:150]}"
             for i, x in enumerate(news)]
    prompt = f"""你是謹慎的台股研究助理。以下是 {name}（{code}）最近的新聞（現價 {close:g} 元）。
只根據這些新聞，整理「看多理由」和「看空理由」，各最多 4 條，每條 30 字以內，寫具體事實（營收、訂單、產品、法說、價格、外資看法…），
每條都要附上依據的新聞編號。新聞裡沒有的不要寫，不要自己推測，不要預測股價。
如果新聞有提到券商 / 外資給這檔的目標價，也列出來（券商、目標價數字、評等、新聞編號）。
只輸出 JSON：{{"bull":[{{"t":"理由","n":[編號]}}],"bear":[{{"t":"理由","n":[編號]}}],"targets":[{{"broker":"券商","target":數字,"rating":"評等或空字串","n":編號}}],"one_line":"一句話總結新聞面偏多還是偏空"}}

新聞：
""" + "\n".join(lines)
    body = {"contents": [{"parts": [{"text": prompt}]}],
            "generationConfig": {"temperature": 0.2, "responseMimeType": "application/json"}}
    c = http.client()
    last_err = None
    for model in GEMINI_MODELS:
        try:
            r = c.post(GEMINI_URL.format(model=model), json=body, headers={"x-goog-api-key": key}, timeout=60)
        except Exception as e:  # noqa: BLE001
            last_err = str(e)
            continue
        if r.status_code == 429:
            raise QuotaError("Gemini 免費額度用完了（429）")
        if r.status_code == 404:
            last_err = f"{model} 不存在"
            continue
        if r.status_code != 200:
            last_err = f"{model} HTTP {r.status_code}"
            continue
        try:
            txt = r.json()["candidates"][0]["content"]["parts"][0]["text"]
            out = json.loads(re.sub(r"^```(?:json)?|```$", "", txt.strip()).strip())
        except Exception as e:  # noqa: BLE001
            last_err = f"回傳格式不對：{e}"
            continue
        return validate_ai(out, news) | {"model": model}
    print(f"[outlook] AI 失敗：{last_err}")
    return None


class QuotaError(RuntimeError):
    pass


def _num_variants(x: float) -> list[str]:
    i = int(x) if float(x).is_integer() else None
    vs = [f"{x:g}"]
    if i is not None:
        vs += [str(i), f"{i:,}"]
    return vs


def validate_ai(out: dict, news: list[dict]) -> dict:
    """AI 回來的東西逐條檢查：沒有標新聞、標到不存在的新聞 → 丟掉；目標價數字要在那則新聞裡出現。"""
    def ok_refs(ns):
        return [int(n) for n in (ns if isinstance(ns, list) else [ns]) if str(n).isdigit() and 0 <= int(n) < len(news)]

    res = {"bull": [], "bear": [], "targets": [], "one_line": str(out.get("one_line") or "")[:80]}
    for side in ("bull", "bear"):
        for x in (out.get(side) or [])[:4]:
            if not isinstance(x, dict):
                continue
            refs = ok_refs(x.get("n") or [])
            t = str(x.get("t") or "").strip()[:60]
            if t and refs:
                res[side].append({"t": t, "n": refs})
    for x in out.get("targets") or []:
        if not isinstance(x, dict):
            continue
        refs = ok_refs(x.get("n"))
        try:
            tgt = float(x.get("target"))
        except (TypeError, ValueError):
            continue
        if not refs:
            continue
        text = news[refs[0]]["title"] + (news[refs[0]].get("summary") or "")
        if any(v in text for v in _num_variants(tgt)):
            res["targets"].append({"broker": str(x.get("broker") or "")[:20] or "法人（未具名）", "target": tgt,
                                   "rating": str(x.get("rating") or "")[:10] or None, "n": refs[0]})
    return res


# ------------------------------------------------------------------ 主程式
def pick_codes(conn, now: datetime) -> list[str]:
    """自選股（所有人的關注清單）＋最近 3 天新聞提到最多的，最多 MAX_STOCKS 檔。"""
    w = db.query_df(conn, "select distinct code from public.watchlist")["code"].tolist()
    hot = db.query_df(conn, """select c as code, count(*) as n from public.news, unnest(codes) c
                               where ts >= %s group by c order by n desc limit %s""",
                      (now - timedelta(days=3), MAX_STOCKS))["code"].tolist()
    stocks = set(db.query_df(conn, "select code from public.stocks where kind = 'stock'")["code"])
    out = []
    for c in w + hot:
        if c in stocks and c not in out:
            out.append(c)
    return out[:MAX_STOCKS]


def update(conn, d: date, now: datetime | None = None) -> str:
    now = now or datetime.now(timezone.utc)
    t0 = time.time()
    # GitHub 排程和 Vercel Cron 都會叫：2 小時內跑過就不再跑（手動執行加 OUTLOOK_FORCE=1）
    last = db.query_df(conn, "select max(updated_at) as t from public.stock_outlook where date = %s", (d,))
    if not os.environ.get("OUTLOOK_FORCE") and not last.empty and last["t"][0] is not None \
            and now - pd.Timestamp(last["t"][0]).to_pydatetime() < timedelta(hours=2):
        return f"{pd.Timestamp(last['t'][0]).tz_convert('Asia/Taipei'):%H:%M} 剛跑過，略過"
    meta = db.query_df(conn, "select code, name from public.stocks")
    names = dict(zip(meta["code"], meta["name"]))
    codes = pick_codes(conn, now)

    # 1) 歷史狀態統計（全市場 3 年）：一週重算一次就好（每天讀 3 年全市場會吃掉 Supabase 免費的流量額度）
    model = db.get_setting(conn, "outlook_model", {}) or {}
    tab_saved = db.get_setting(conn, "outlook_table", {}) or {}
    fresh = model.get("built") and str(model["built"]) >= str(d - timedelta(days=7)) and tab_saved.get("base")
    if fresh and not os.environ.get("OUTLOOK_REBUILD"):
        table, calib, built = tab_saved, model.get("calib") or {}, model["built"]
    else:
        since = d - timedelta(days=int(365.25 * HIST_YEARS) + 120)
        hist = db.query_df(conn, """select p.code, p.date, p.high, p.low, p.close, p.volume from public.daily_prices p
                                    join public.stocks s on s.code = p.code
                                    where s.kind = 'stock' and p.date >= %s and p.date <= %s and p.close > 0""", (since, d))
        hinst = db.query_df(conn, "select code, date, foreign_net from public.institutional where date >= %s",
                            (d - timedelta(days=420),))
        f = features(hist, hinst)
        table = state_table(f)
        dates = sorted(f["date"].unique())
        split = dates[-250] if len(dates) > 400 else None
        calib = calibrate(f, split) if split else {}
        built = str(d)
        del hist, f
        db.execute(conn, """insert into public.app_settings (key, value) values ('outlook_table', %s::jsonb)
                            on conflict (key) do update set value = excluded.value""",
                   (json.dumps(_finite(table)),))
    base = table.get("base")
    if not base:
        raise RuntimeError("歷史資料不夠，算不出統計")
    # 今天的狀態：只讀要算的股票近 200 天；波動排名、最新收盤讀全市場近 40 天
    daily = db.query_df(conn, """select code, date, high, low, close, volume from public.daily_prices
                                 where code = any(%s) and date >= %s and date <= %s and close > 0""",
                        (codes, d - timedelta(days=200), d))
    daily = daily.sort_values(["code", "date"]).reset_index(drop=True)
    inst = db.query_df(conn, "select code, date, foreign_net, trust_net from public.institutional where code = any(%s) and date >= %s",
                       (codes, d - timedelta(days=60)))
    f = features(daily, inst)
    today = f[f["date"] == f.groupby("code")["date"].transform("max")]
    recent = db.query_df(conn, """select p.code, p.date, p.close from public.daily_prices p join public.stocks s on s.code = p.code
                                  where s.kind = 'stock' and p.date >= %s and p.date <= %s and p.close > 0""",
                         (d - timedelta(days=40), d)).sort_values(["code", "date"])
    vol20 = recent.groupby("code")["close"].apply(lambda s: s.astype(float).pct_change().iloc[-20:].std())
    vol_rank = vol20.rank(pct=True) * 100
    closes = recent.groupby("code")["close"].last().astype(float).to_dict()

    # 2) 目標價：新聞表（全部）＋這些股票各自查一次 Google 新聞「股名 目標價」
    news7 = db.query_df(conn, "select id, ts, source, title, summary, url, codes from public.news where ts >= %s",
                        (now - timedelta(days=8),))
    c = http.client()
    per_news: dict[str, list[dict]] = {}
    tp_rows = []
    if not news7.empty:
        news7["ts"] = pd.to_datetime(news7["ts"], utc=True)
        tp_rows.append(T.from_news(news7, names, closes))
    fetched = db.get_setting(conn, "targets_fetched", {}) or {}
    for code in codes:
        nm = names.get(code)
        if not nm:
            continue
        per_news[code] = fetch_stock_news(c, code, nm, "", 30)
        need_hist = fetched.get(code) is None or str(fetched[code]) < str(d - timedelta(days=7))
        items = per_news[code] + (fetch_stock_news(c, code, nm, "目標價", 365 if code not in fetched else 30)
                                  if need_hist else [])
        fetched[code] = str(d) if need_hist else fetched[code]
        x = pd.DataFrame([{"id": "", "ts": it["ts"], "source": it["source"], "title": it["title"],
                           "summary": it["summary"], "url": it["url"], "codes": [code]} for it in items
                          if "目標價" in it["title"] + it["summary"]])
        if not x.empty:
            x["ts"] = pd.to_datetime(x["ts"], utc=True)
            tp_rows.append(T.from_news(x, names, closes))
    new_tp = pd.concat([x for x in tp_rows if not x.empty], ignore_index=True) if any(not x.empty for x in tp_rows) else pd.DataFrame()
    n_tp = 0
    if not new_tp.empty:
        have = db.query_df(conn, "select code, broker, target, date from public.target_prices where code = any(%s)",
                           (new_tp["code"].unique().tolist(),))
        new_tp = T.dedupe(new_tp, have)
        if not new_tp.empty:
            new_tp = new_tp.assign(origin="rule")
            n_tp = db.upsert(conn, "target_prices", new_tp, ["code", "broker", "target", "date"])
    db.execute(conn, """insert into public.app_settings (key, value) values ('targets_fetched', %s::jsonb)
                        on conflict (key) do update set value = excluded.value""", (json.dumps(fetched),))

    # 3) 每一檔：規則理由、機率、風險、做法；AI 整理新聞（新聞有變才重問）
    tp_all = db.query_df(conn, "select * from public.target_prices where code = any(%s) and date >= %s",
                         (codes, d - timedelta(days=400)))
    inst_s = inst[inst["code"].isin(codes)]
    mf = db.query_df(conn, "select code, date, net from public.main_force where code = any(%s) and date >= %s",
                     (codes, d - timedelta(days=20)))
    margin = db.query_df(conn, "select code, date, margin_balance from public.margin where code = any(%s) and date >= %s",
                         (codes, d - timedelta(days=20)))
    stats = db.get_setting(conn, "news_stats", {}) or {}
    flags = {s["code"]: s for s in stats.get("stocks", []) if isinstance(s, dict) and s.get("code")}
    prev = db.query_df(conn, "select code, data from public.stock_outlook where code = any(%s)", (codes,))
    prev_ai = {r.code: (r.data or {}).get("ai") for r in prev.itertuples()}
    key = os.environ.get("GEMINI_API_KEY", "").strip()
    ai_calls, ai_note = 0, "" if key else "沒設定 GEMINI_API_KEY，新聞理由只用規則"
    daily_g = dict(tuple(daily[daily["code"].isin(codes)].groupby("code")))
    rows, logs = [], []
    for code in codes:
        bars = daily_g.get(code)
        trow = today[today["code"] == code]
        if bars is None or len(bars) < 61 or trow.empty or not bool(trow["valid"].iloc[0]):
            continue
        bars = bars.sort_values("date")
        tr = trow.iloc[0]
        st, basis = lookup(table, tr)
        tp = tp_all[tp_all["code"] == code] if not tp_all.empty else pd.DataFrame()
        if not tp.empty:
            tp = tp.assign(date=pd.to_datetime(tp["date"]).dt.date)
        tsum = T.summarize(tp, closes.get(code), d) if not tp.empty else None
        bull, bear = rule_reasons(bars, inst_s[inst_s["code"] == code], mf[mf["code"] == code],
                                  margin[margin["code"] == code], tsum, flags.get(code))
        risk = risk_plan(bars, st, base, tsum, float(vol_rank.get(code)) if code in vol_rank else None)
        v = verdict(st, base)
        state = {k: STATE_TEXT[k][int(tr[k])] for k in KEY_P}
        if basis == "f":
            state["fx"] = STATE_TEXT["fx"][int(tr["fx"])]
        # 新聞＋AI
        nl = sorted({x["title"]: x for x in per_news.get(code, [])}.values(), key=lambda x: x["ts"], reverse=True)[:25]
        h = hashlib.sha1("|".join(x["title"] for x in nl).encode()).hexdigest()[:12]
        ai = prev_ai.get(code)
        if key and nl and (not ai or ai.get("hash") != h) and ai_calls < AI_MAX_CALLS:
            try:
                got = ai_reasons(names[code], code, closes[code], nl, key)
                ai_calls += 1
                if got:
                    got["news"] = [{"ts": x["ts"].isoformat(), "title": x["title"], "url": x["url"], "source": x["source"]} for x in nl]
                    ai = got | {"hash": h, "at": now.isoformat(timespec="minutes")}
                time.sleep(4.5)  # 免費額度每分鐘次數有限
            except QuotaError as e:
                ai_note = str(e)
                ai_calls = AI_MAX_CALLS
        if ai and ai.get("targets"):
            extra = [{"code": code, "broker": x["broker"], "target": x["target"], "prev": None, "rating": x.get("rating"),
                      "stance": next((s for r, s in T.RATINGS if r == x.get("rating")), None), "action": None,
                      "date": pd.Timestamp(ai["news"][x["n"]]["ts"]).tz_convert("Asia/Taipei").date(),
                      "title": ai["news"][x["n"]]["title"], "url": ai["news"][x["n"]]["url"],
                      "source": ai["news"][x["n"]]["source"], "origin": "ai"}
                     for x in ai["targets"] if x["n"] < len(ai.get("news", []))]
            if extra:
                ex = T.dedupe(pd.DataFrame(extra), tp if not tp.empty else None)
                if not ex.empty:
                    db.upsert(conn, "target_prices", ex, ["code", "broker", "target", "date"])
        data = {"date": str(tr["date"]), "close": closes[code], "state": state, "basis": basis,
                "stats": st, "base": base, "verdict": v, "bull": bull, "bear": bear,
                "risk": risk, "plan": plan_text(v["side"], risk, tsum), "targets": tsum, "ai": ai}
        rows.append({"code": code, "date": d, "data": json.dumps(_finite(data), ensure_ascii=False, default=str),
                     "updated_at": now})
        if v.get("p_up") is not None:
            logs.append({"code": code, "date": d, "p_up": v["p_up"], "base": base["win"], "close": closes[code]})

    if rows:
        db.upsert(conn, "stock_outlook", pd.DataFrame(rows), ["code"])
    if logs:
        db.upsert(conn, "outlook_log", pd.DataFrame(logs), ["code", "date"])
    track = live_track(conn)
    db.execute(conn, """insert into public.app_settings (key, value) values ('outlook_model', %s::jsonb)
                        on conflict (key) do update set value = excluded.value""",
               (json.dumps(_finite({"at": now.isoformat(timespec="minutes"), "built": built, "base": base, "calib": calib,
                                    "track": track, "horizon": H, "years": HIST_YEARS, "ai_note": ai_note}),
                           ensure_ascii=False, default=str),))
    db.execute(conn, "delete from public.stock_outlook where date < %s", (d - timedelta(days=30),))
    return (f"{len(rows)} 檔；新目標價 {n_tp} 筆；AI 呼叫 {ai_calls} 次{('（' + ai_note + '）') if ai_note else ''}；"
            f"全市場平均上漲機率 {base['win']:.0f}%；花 {time.time() - t0:.0f} 秒")


def live_track(conn) -> dict:
    """實際上線後的成績：以前給的機率，20 個交易日後真的漲了沒。"""
    log = db.query_df(conn, "select code, date, p_up, base, close from public.outlook_log")
    if log.empty:
        return {}
    daily = db.query_df(conn, "select code, date, close from public.daily_prices where code = any(%s) and date >= %s",
                        (log["code"].unique().tolist(), log["date"].min()))
    dates = sorted(daily["date"].unique())
    if len(dates) <= H:
        return {}
    pos = {dt: i for i, dt in enumerate(dates)}
    px = daily.set_index(["code", "date"])["close"].astype(float)
    rows = []
    for r in log.itertuples():
        i = pos.get(r.date)
        if i is None or i + H >= len(dates):
            continue
        later = px.get((r.code, dates[i + H]))
        if later is None or not r.close:
            continue
        rows.append({"p": float(r.p_up), "base": float(r.base), "up": later > float(r.close)})
    if len(rows) < 30:
        return {"n": len(rows)}
    x = pd.DataFrame(rows)
    hi, lo = x[x["p"] >= x["base"] + 3], x[x["p"] <= x["base"] - 3]
    return {"n": len(x), "all_up": round(x["up"].mean() * 100, 1),
            "bull_n": len(hi), "bull_up": round(hi["up"].mean() * 100, 1) if len(hi) else None,
            "bear_n": len(lo), "bear_up": round(lo["up"].mean() * 100, 1) if len(lo) else None}


def _finite(o):
    if isinstance(o, float):
        return o if math.isfinite(o) else None
    if isinstance(o, (np.floating,)):
        return float(o) if math.isfinite(float(o)) else None
    if isinstance(o, (np.integer,)):
        return int(o)
    if isinstance(o, dict):
        return {k: _finite(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [_finite(v) for v in o]
    return o
