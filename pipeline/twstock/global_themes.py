"""全球強勢族群：每天美股收盤後（台灣早上）抓美 / 日 / 韓股收盤，算出哪些族群最強，再對應到台股。

結果只存一份（app_settings.global_themes），每天覆蓋，不保留前一天。
資料來源：Yahoo Finance 公開的日K（免費、不用金鑰）。
"""
from __future__ import annotations

import json
import math
import re
import time
from datetime import date, datetime, timedelta, timezone

from . import db, global_map
from .sources import http

CHART = "https://query1.finance.yahoo.com/v8/finance/chart/{sym}"
SEARCH = "https://query2.finance.yahoo.com/v1/finance/search"
MARKETS = {"US": "美股", "JP": "日股", "KR": "韓股", "CN": "陸股", "EU": "歐股"}
STRONG = 1.0  # 一個市場的族群平均漲幅 ≥ 1% 才算「這個市場也強」


# ------------------------------------------------------------------ 抓資料
def _get(url: str, params: dict | None = None, tries: int = 3):
    last = None
    for i in range(tries):
        try:
            r = http.client().get(url, params=params)
            if r.status_code == 404:
                return None
            r.raise_for_status()
            return r.json()
        except Exception as e:  # noqa: BLE001
            last = e
            time.sleep(1.5 * (i + 1))
    raise RuntimeError(f"{url}: {last}")


def parse_chart(js, now: float | None = None, cutoff: date | None = None) -> dict | None:
    """Yahoo 日K → 最新「已收盤」的收盤價、1 日漲跌幅、5 日漲跌幅、日期。
    那個市場正在交易時，最後一根是盤中的（還沒收盤），不算：一律用最近一個收完的交易日。"""
    try:
        res = js["chart"]["result"][0]
    except (KeyError, IndexError, TypeError):
        return None
    ts = res.get("timestamp") or []
    q = (res.get("indicators", {}).get("quote") or [{}])[0]
    closes = q.get("close") or []
    vols = q.get("volume") or []
    off = (res.get("meta") or {}).get("gmtoffset") or 0
    rows = [(t, c, (vols[i] if i < len(vols) else None)) for i, (t, c) in enumerate(zip(ts, closes))
            if c is not None and not (isinstance(c, float) and math.isnan(c))]
    if cutoff is not None:  # 只用「到昨天為止」的收盤（台股開盤前看的是昨晚美股、昨天日韓）
        rows = [r for r in rows if datetime.fromtimestamp(r[0] + off, tz=timezone.utc).date() <= cutoff]
    reg = ((res.get("meta") or {}).get("currentTradingPeriod") or {}).get("regular") or {}
    now = time.time() if now is None else now
    if rows and reg.get("start") and reg.get("end") and reg["start"] <= now < reg["end"] and rows[-1][0] >= reg["start"] - 6 * 3600:
        rows = rows[:-1]  # 盤中，這根還沒收盤
    if len(rows) < 2:
        return None
    last, prev = rows[-1][1], rows[-2][1]
    base5 = rows[-6][1] if len(rows) >= 6 else rows[0][1]
    d = datetime.fromtimestamp(rows[-1][0] + off, tz=timezone.utc).date()
    vol = rows[-1][2] or 0
    avg_vol = sum((r[2] or 0) for r in rows[-21:-1]) / max(1, len(rows[-21:-1]))
    return {
        "close": round(float(last), 4),
        "pct": round((last / prev - 1) * 100, 2) if prev else None,
        "pct5": round((last / base5 - 1) * 100, 2) if base5 else None,
        "vol_ratio": round(vol / avg_vol, 2) if avg_vol else None,
        "date": d.isoformat(),
    }


def fetch_quotes(syms: list[str], pause: float = 0.25, cutoff: date | None = None) -> tuple[dict[str, dict], list[str]]:
    out, failed = {}, []
    for s in syms:
        try:
            q = parse_chart(_get(CHART.format(sym=s), {"range": "1mo", "interval": "1d"}), cutoff=cutoff)
        except Exception as e:  # noqa: BLE001
            print(f"[global] {s} 失敗：{e}")
            q = None
        if q and q["pct"] is not None:
            out[s] = q
        else:
            failed.append(s)
        time.sleep(pause)
    return out, failed


def fetch_news(sym: str, n: int = 2) -> list[dict]:
    try:
        js = _get(SEARCH, {"q": sym, "newsCount": n, "quotesCount": 0}, tries=1)
    except Exception:  # noqa: BLE001
        return []
    out = []
    for it in (js or {}).get("news", [])[:n]:
        if it.get("title") and it.get("link"):
            out.append({"sym": sym, "title": it["title"], "link": it["link"], "publisher": it.get("publisher", "")})
    return out


# ------------------------------------------------------------------ 台股
def _norm(s: str) -> str:
    return re.sub(r"[\s*＊\-]|KY", "", s or "")


def name_ok(expected: str, actual: str) -> bool:
    """對照表寫的名稱和資料庫的名稱大致一樣（避免代號打錯對到別家公司）。"""
    a, b = _norm(expected), _norm(actual)
    return bool(a and b) and (a in b or b in a or a[:2] == b[:2])


def tw_quotes(conn, codes: list[str], d: date) -> dict[str, dict]:
    df = db.query_df(conn, """
        with x as (
          select p.code, p.date, p.close, p.amount,
                 lag(p.close) over (partition by p.code order by p.date) as pc
          from public.daily_prices p
          where p.code = any(%s) and p.date between %s and %s)
        select distinct on (x.code) x.code, x.date, x.close, x.pc, x.amount, s.name
        from x join public.stocks s on s.code = x.code
        order by x.code, x.date desc""", (codes, d - timedelta(days=20), d))
    out = {}
    for r in df.itertuples(index=False):
        c, pc = (float(r.close) if r.close is not None else None), (float(r.pc) if r.pc is not None else None)
        out[r.code] = {
            "db_name": r.name, "date": r.date.isoformat() if hasattr(r.date, "isoformat") else str(r.date),
            "close": c, "pct": round((c / pc - 1) * 100, 2) if c and pc else None,
            "amount": int(r.amount) if r.amount is not None and not (isinstance(r.amount, float) and math.isnan(r.amount)) else 0,
        }
    return out


# ------------------------------------------------------------------ 計算
def _tokens(sub: str) -> list[str]:
    return [x for x in re.split(r"[/／、]", sub or "") if x]


def related(a: str, b: str) -> bool:
    """細項是不是同一段：完全一樣，或有共同的關鍵字（例如「雷射/磷化銦」和「磷化銦基板」、「NAND/SSD」和「NAND控制IC」）。"""
    if not a or not b:
        return False
    if a == b:
        return True
    return any(x in y or y in x for x in _tokens(a) for y in _tokens(b) if len(x) >= 2 and len(y) >= 2)


def _avg(xs: list[float]) -> float | None:
    xs = [x for x in xs if x is not None]
    return round(sum(xs) / len(xs), 2) if xs else None


def build(themes: list[dict], quotes: dict[str, dict], tw: dict[str, dict]) -> tuple[list[dict], list[str]]:
    bad: list[str] = []
    out = []
    for t in themes:
        movers = []
        for f in t["foreign"]:
            q = quotes.get(f["sym"])
            if q:
                movers.append({**f, **q, "market": global_map.market_of(f["sym"])})
        if not movers:
            continue
        movers.sort(key=lambda m: m["pct"], reverse=True)
        avg = _avg([m["pct"] for m in movers])
        avg5 = _avg([m["pct5"] for m in movers])
        up = sum(1 for m in movers if m["pct"] > 0)

        markets = {}
        for mk in MARKETS:
            ms = [m["pct"] for m in movers if m["market"] == mk]
            if ms:
                markets[mk] = {"avg": _avg(ms), "n": len(ms)}
        strong_mk = [mk for mk, v in markets.items() if v["avg"] is not None and v["avg"] >= STRONG]
        # 排名看「昨晚美股」：台股開盤前最新的消息是昨晚美股；日韓是昨天白天的盤（台股昨天已經反映過），當作確認
        us = [m for m in movers if m["market"] == "US"]
        basis = "US" if us else "ALL"
        score = markets["US"]["avg"] if us else avg
        # 資金同步：美股強，而且日 / 韓（或其他市場）也強；沒有美股的族群看兩個市場以上都強
        synced = ("US" in strong_mk and len(strong_mk) >= 2) if us else len(strong_mk) >= 2

        subs: dict[str, list[float]] = {}
        for m in (us or movers):  # 最強細項也以美股為主
            subs.setdefault(m["sub"], []).append(m["pct"])
        sub_rank = sorted(({"sub": k, "avg": _avg(v), "n": len(v)} for k, v in subs.items()),
                          key=lambda x: x["avg"] if x["avg"] is not None else -999, reverse=True)
        lead = sub_rank[0]["sub"] if sub_rank and score is not None and score > 0 and sub_rank[0]["avg"] > 0 else None

        rows = []
        for w in t["tw"]:
            q = tw.get(w["code"])
            if not q:
                bad.append(f"{w['code']}{w['name']}（資料庫沒有）")
                continue
            if not name_ok(w["name"], q["db_name"]):
                bad.append(f"{w['code']}{w['name']}（資料庫是 {q['db_name']}）")
                continue
            rows.append({"code": w["code"], "name": q["db_name"], "tier": w["tier"], "sub": w["sub"],
                         "lead": lead is not None and related(w["sub"], lead),
                         "close": q["close"], "pct": q["pct"], "amount": q["amount"]})
        # 最相關的優先：最強細項 → 龍頭 / 高度相關 / 相關 → 成交金額大到小
        rows.sort(key=lambda r: (0 if r["lead"] else 1, r["tier"], -(r["amount"] or 0)))

        lead_list = sorted(us, key=lambda m: m["pct"], reverse=True) if us else movers
        top = "、".join(f"{m['name']} {m['pct']:+.1f}%" for m in lead_list[:3])
        if us:
            us_up = sum(1 for m in us if m["pct"] > 0)
            reason = f"昨晚美股{t['name']}平均 {score:+.2f}%，上漲 {us_up}/{len(us)} 檔；領漲：{top}。"
            asia = [f"{MARKETS[mk]} {markets[mk]['avg']:+.1f}%" for mk in ("JP", "KR", "CN", "EU") if mk in markets]
            if asia:
                reason += "其他市場（前一天收盤）：" + "、".join(asia) + "。"
        else:
            reason = f"{t['name']}（沒有美股成分股，看前一天收盤）平均 {score:+.2f}%，上漲 {up}/{len(movers)} 檔；領漲：{top}。"
        if lead:
            lead_names = "、".join([m["name"] for m in lead_list if m["sub"] == lead][:3])
            reason += f"最強的是「{lead}」（{lead_names}），台股同一段的個股排在最前面。"
        if synced:
            reason += "、".join(f"{MARKETS[mk]} {markets[mk]['avg']:+.1f}%" for mk in strong_mk) + " 同步走強，資金流向一致。"
        out.append({
            # avg = 排名用的漲幅（有美股看昨晚美股，沒有才看全部）；avg_all = 全部海外成分股平均
            "id": t["id"], "name": t["name"], "avg": score, "avg_all": avg, "basis": basis, "avg5": avg5, "up": up, "n": len(movers),
            "markets": markets, "synced": synced, "strong_markets": strong_mk,
            "lead_sub": lead, "subs": sub_rank, "reason": reason,
            "movers": [{k: m[k] for k in ("sym", "name", "sub", "market", "pct", "pct5", "close", "vol_ratio", "date")} for m in movers],
            "tw": rows,
        })
    out.sort(key=lambda x: x["avg"] if x["avg"] is not None else -999, reverse=True)
    for i, x in enumerate(out):
        x["rank"] = i + 1
    return out, sorted(set(bad))


def update(conn, d: date, news_top: int = 5) -> str:
    themes = global_map.themes()
    syms = sorted({f["sym"] for t in themes for f in t["foreign"]})
    # 台灣時間的「昨天」為止：早上跑 = 昨晚美股收盤 + 昨天日韓收盤；白天重跑也不會混進今天日韓的盤
    quotes, failed = fetch_quotes(syms, cutoff=d - timedelta(days=1))
    if len(quotes) < len(syms) * 0.5:
        raise RuntimeError(f"海外股價只抓到 {len(quotes)}/{len(syms)} 檔，可能是 Yahoo 暫時擋住，稍後再試")
    codes = sorted({w["code"] for t in themes for w in t["tw"]})
    tw = tw_quotes(conn, codes, d)
    res, bad = build(themes, quotes, tw)

    for x in res[:news_top]:
        news = []
        for m in x["movers"][:2]:
            news += fetch_news(m["sym"])
        x["news"] = news

    dates = {}
    for s, q in quotes.items():
        mk = global_map.market_of(s)
        dates[mk] = max(dates.get(mk, ""), q["date"])
    tw_date = max((q["date"] for q in tw.values()), default=None)
    payload = {
        "asof": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "dates": dates, "tw_date": tw_date, "themes": res,
        "failed": failed, "bad_codes": bad,
    }
    db.execute(conn, """insert into public.app_settings (key, value) values ('global_themes', %s::jsonb)
                        on conflict (key) do update set value = excluded.value""",
               (json.dumps(payload, ensure_ascii=False, allow_nan=False),))
    conn.commit()
    msg = f"{len(res)} 個族群、海外 {len(quotes)}/{len(syms)} 檔"
    if res:
        msg += f"；最強：{res[0]['name']} {res[0]['avg']:+.2f}%"
    if failed:
        msg += f"；沒抓到 {len(failed)} 檔（{', '.join(failed[:6])}{'…' if len(failed) > 6 else ''}）"
    if bad:
        msg += f"；對照表代號要檢查 {len(bad)} 檔（{'、'.join(bad[:4])}{'…' if len(bad) > 4 else ''}）"
    return msg
