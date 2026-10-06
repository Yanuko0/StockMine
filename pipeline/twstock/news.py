"""台股新聞熱度：抓最近 7 天的台股 / 產業新聞，統計「哪些標的、產業、關鍵字被提到最多」。

來源（都是公開、免費、不用金鑰）：
  - 鉅亨網 新聞列表 API（有編輯下的關鍵字標籤）
  - Yahoo 股市 RSS（台股動態、最新新聞、研究報告）
  - Google 新聞 RSS（搜尋「台股」「概念股」，涵蓋經濟日報、工商時報、MoneyDJ…）
只存標題、摘要前 200 字、連結和分析結果（不轉載全文），超過 7 天自動刪除。

統計（存 app_settings.news_stats，網頁讀一筆就好）：
  - 標的：7 日 / 24 小時提及次數、每日走勢、熱度變化（近 24 小時 ÷ 前 6 天平均）、來源數、
          5 日漲跌、主力 5 日買賣超 → 「熱度高但主力賣超」標示（留意買新聞出貨）
  - 產業 / 題材：官方產業別＋全球族群題材（記憶體、CPO…）
  - 關鍵字：鉅亨網標籤＋財經詞庫（漲價、擴產、可轉債、處置…）
"""
from __future__ import annotations

import hashlib
import html
import json
import re
import time
import xml.etree.ElementTree as ET
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from urllib.parse import quote

import pandas as pd

from . import db, global_map
from .sources import http

TW = timezone(timedelta(hours=8))
KEEP_DAYS = 7

CNYES = "https://api.cnyes.com/media/api/v1/newslist/category/{slug}"
CNYES_SLUGS = ["tw_stock", "tw_quo", "headline"]
YAHOO_RSS = ["https://tw.stock.yahoo.com/rss?category=tw-market",
             "https://tw.stock.yahoo.com/rss?category=news",
             "https://tw.stock.yahoo.com/rss?category=research"]
GOOGLE_RSS = "https://news.google.com/rss/search?q={q}&hl=zh-TW&gl=TW&ceid=TW:zh-Hant"
GOOGLE_QUERIES = ["台股 when:1d", "概念股 when:1d", "營收 創新高 when:1d", "法說會 when:2d"]

# 財經 / 產業關鍵字詞庫（鉅亨網的標籤之外，從標題、摘要裡找）
KEYWORDS = """
AI 輝達 NVIDIA 黃仁勳 GB300 Rubin ASIC GPU HBM CoWoS SoIC 先進封裝 2奈米 3奈米 晶圓代工 半導體設備
CPO 矽光子 光通訊 磷化銦 800G 1.6T 交換器 AI伺服器 伺服器 機櫃 液冷 散熱 水冷板
記憶體 DRAM NAND DDR5 DDR4 SSD 快閃記憶體
PCB 載板 ABF CCL 銅箔基板 玻纖布 銅箔 HDI
被動元件 MLCC 電感 電阻 功率元件 SiC GaN 碳化矽 氮化鎵 MOSFET 矽晶圓
低軌衛星 衛星 SpaceX 太空 無人機 國防 軍工 機器人 人形機器人 自駕車 電動車 特斯拉
重電 電網 變壓器 儲能 太陽能 綠能 風電 核能 燃料電池 電源供應器 BBU
蘋果 iPhone 手機 PC 筆電 Wi-Fi 網通 5G 車用 工業電腦 邊緣運算
漲價 調漲 缺貨 供不應求 擴產 新廠 產能滿載 接單 訂單 出貨 拉貨 庫存 去化 減產 砍單
營收創高 營收 月增 年增 獲利 EPS 毛利率 財報 法說會 財測 展望 下修 上修 目標價 調升 降評 買進評等
外資 投信 自營商 主力 融資 融券 當沖 漲停 跌停 創新高 填息 除息 股利 配息
增資 現金增資 可轉債 CB 私募 庫藏股 合併 收購 併購 處置 注意股 警示 董監 大股東 申報轉讓
關稅 川普 降息 升息 聯準會 Fed 匯率 新台幣 美元 通膨 CPI 非農 中國 出口
""".split()
_KW_RE = [(k, re.compile(re.escape(k), re.I if k.isascii() else 0)) for k in KEYWORDS]

# 公司名稱剛好是常用詞：只認「名稱(代號)」或鉅亨網的標的標籤，不單看名稱
AMBIGUOUS = set("""全新 大成 合一 中華 統一 大同 世界 開發 長興 大江 美食 台灣大 新光 光環 遠東 宏全 亞洲 國際 聯合 興業 新興
中天 大眾 一詮 正道 元大 富邦 國泰 永豐 凱基 群益 統一超 中信 第一 華南 兆豐 台新 日盛 康和 大華 宏遠 力麗""".split())


# ------------------------------------------------------------------ 抓資料
def _strip(s: str | None) -> str:
    s = html.unescape(re.sub(r"<[^>]+>", "", s or ""))
    return re.sub(r"\s+", " ", s).strip()


def norm_title(t: str) -> str:
    """去掉來源、標點、空白，用來判斷不同來源的同一則新聞。"""
    t = re.sub(r"\s+-\s+[^-]{1,20}$", "", t)  # Google 新聞的「 - 經濟日報」
    t = re.sub(r"【[^】]*】|〈[^〉]*〉|《[^》]*》", "", t)
    return re.sub(r"[\W_]+", "", t).lower()


def news_id(title: str) -> str:
    return hashlib.sha1(norm_title(title).encode()).hexdigest()[:16]


def parse_cnyes(js) -> list[dict]:
    out = []
    for it in ((js or {}).get("items") or {}).get("data") or []:
        title = _strip(it.get("title"))
        if not title or not it.get("publishAt"):
            continue
        tags = [str(m.get("code")) for key in ("market", "stock") for m in (it.get(key) or [])
                if isinstance(m, dict) and re.fullmatch(r"\d{4,6}", str(m.get("code", "")))]
        out.append({
            "ts": datetime.fromtimestamp(int(it["publishAt"]), tz=timezone.utc),
            "source": "鉅亨網", "title": title,
            "summary": _strip(it.get("summary") or it.get("content"))[:200],
            "url": f"https://news.cnyes.com/news/id/{it.get('newsId')}",
            "tags": [str(k) for k in (it.get("keyword") or []) if k][:10],
            "code_tags": tags,
        })
    return out


def parse_rss(text: str, default_source: str) -> list[dict]:
    out = []
    try:
        root = ET.fromstring(text)
    except ET.ParseError:
        return out
    for it in root.iter("item"):
        title = _strip(it.findtext("title"))
        link = (it.findtext("link") or "").strip()
        pub = it.findtext("pubDate")
        if not title or not link or not pub:
            continue
        try:
            ts = parsedate_to_datetime(pub)
        except (TypeError, ValueError):
            continue
        if ts.tzinfo is None:
            ts = ts.replace(tzinfo=timezone.utc)
        src = _strip(it.findtext("source")) or default_source
        m = re.search(r"\s+-\s+([^-]{1,20})$", title)
        if default_source == "Google 新聞" and m:
            src, title = m.group(1).strip(), title[:m.start()].strip()
        out.append({"ts": ts.astimezone(timezone.utc), "source": src, "title": title,
                    "summary": _strip(it.findtext("description"))[:200], "url": link, "tags": [], "code_tags": []})
    return out


def fetch_all(since: datetime) -> tuple[list[dict], list[str]]:
    items, errors = [], []
    c = http.client()
    for slug in CNYES_SLUGS:
        for page in range(1, 11):
            try:
                r = c.get(CNYES.format(slug=slug), params={"page": page, "limit": 30})
                if r.status_code == 404:
                    break
                r.raise_for_status()
                got = parse_cnyes(r.json())
            except Exception as e:  # noqa: BLE001
                errors.append(f"鉅亨 {slug}：{e}"[:120])
                break
            items += got
            if not got or min(x["ts"] for x in got) < since:
                break
            time.sleep(0.6)
    for url in YAHOO_RSS:
        try:
            r = c.get(url, headers={"Accept": "application/rss+xml, application/xml, text/xml, */*"})
            r.raise_for_status()
            items += parse_rss(r.text, "Yahoo 股市")
        except Exception as e:  # noqa: BLE001
            errors.append(f"Yahoo：{e}"[:120])
        time.sleep(0.6)
    for q in GOOGLE_QUERIES:
        try:
            r = c.get(GOOGLE_RSS.format(q=quote(q)), headers={"Accept": "application/rss+xml, */*"})
            r.raise_for_status()
            items += parse_rss(r.text, "Google 新聞")
        except Exception as e:  # noqa: BLE001
            errors.append(f"Google：{e}"[:120])
        time.sleep(0.6)
    return [x for x in items if x["ts"] >= since], errors


# ------------------------------------------------------------------ 分析
class Tagger:
    """在標題 / 摘要裡找個股、題材、關鍵字。"""

    def __init__(self, stocks: pd.DataFrame):
        # stocks: code, name, industry（只要個股）
        self.names: dict[str, str] = {}
        for r in stocks.itertuples():
            nm = re.sub(r"[*＊]|-KY$|-DR$", "", str(r.name)).strip()
            if len(nm) >= 2:
                self.names.setdefault(nm, r.code)
        self.by_len = sorted(self.names, key=len, reverse=True)
        self.valid = set(stocks["code"])
        self.industry = dict(zip(stocks["code"], stocks["industry"]))
        self.theme_of: dict[str, set[str]] = defaultdict(set)
        theme_words = []
        for t in global_map.themes():
            for w in t["tw"]:
                self.theme_of[w["code"]].add(t["name"])
            # 題材名稱拆開當關鍵字：「矽光子CPO／光通訊」→ 矽光子CPO、光通訊
            for part in re.split(r"[／/]", t["name"]):
                theme_words.append((part, t["name"]))
        extra = {"CPO": "矽光子CPO／光通訊", "矽光子": "矽光子CPO／光通訊", "HBM": "記憶體", "DRAM": "記憶體",
                 "NAND": "記憶體", "CoWoS": "封測／先進封裝", "先進封裝": "封測／先進封裝", "MLCC": "被動元件",
                 "液冷": "散熱／液冷", "散熱": "散熱／液冷", "載板": "ABF載板", "ABF": "ABF載板", "CCL": "CCL銅箔基板／玻纖布",
                 "玻纖布": "CCL銅箔基板／玻纖布", "PCB": "PCB印刷電路板", "低軌衛星": "低軌衛星／太空", "SpaceX": "低軌衛星／太空",
                 "重電": "能源／重電／電網", "變壓器": "能源／重電／電網", "儲能": "能源／重電／電網", "太陽能": "太陽能",
                 "機器人": "機器人／自駕車", "AI伺服器": "AI伺服器／算力", "SiC": "主動／功率元件", "GaN": "主動／功率元件",
                 "矽晶圓": "矽晶圓", "BBU": "電源供應／BBU", "電源供應器": "電源供應／BBU", "ASIC": "IC設計"}
        theme_words += list(extra.items())
        self.theme_words = [(w, t, re.compile(re.escape(w), re.I if w.isascii() else 0)) for w, t in theme_words if len(w) >= 2]

    def stocks_in(self, text: str, code_tags: list[str]) -> list[str]:
        found: list[str] = [c for c in code_tags if c in self.valid]
        # 「名稱(2330)」「(2330-TW)」「2330」帶括號的代號
        for m in re.finditer(r"[（(]\s*(\d{4,6})(?:\s*[-.]?\s*(?:TW|TWO|TT))?\s*[)）]|(\d{4,6})-TW", text):
            c = m.group(1) or m.group(2)
            if c in self.valid:
                found.append(c)
        used = [False] * len(text)
        for nm in self.by_len:
            start = 0
            while (i := text.find(nm, start)) >= 0:
                start = i + len(nm)
                if any(used[i:i + len(nm)]):
                    continue
                for k in range(i, i + len(nm)):
                    used[k] = True
                code = self.names[nm]
                if nm in AMBIGUOUS and code not in found:
                    # 常用詞名稱：後面要緊接代號或「股」「公司」才算
                    tail = text[i + len(nm):i + len(nm) + 8]
                    if not re.match(r"\s*[（(]?\s*" + code + r"|\s*(股價|公司|董事長|總經理|營收|法說)", tail):
                        continue
                found.append(code)
        return list(dict.fromkeys(found))

    def themes_in(self, text: str, codes: list[str]) -> list[str]:
        ts = []
        for w, t, rx in self.theme_words:
            if rx.search(text):
                ts.append(t)
        for c in codes:
            ts += sorted(self.theme_of.get(c, ()))
        return list(dict.fromkeys(ts))

    def keywords_in(self, text: str, tags: list[str]) -> list[str]:
        # 鉅亨網的標籤常常就是公司名稱：公司已經算在「標的」，這裡不重複
        ks = [t.strip() for t in tags if 1 < len(t.strip()) <= 12 and t.strip() not in self.names]
        hit = [k for k, rx in _KW_RE if rx.search(text)]
        # 「AI伺服器」已經算了，就不另外算「伺服器」（「營收創高」與「營收」同理）
        ks += [k for k in hit if not any(k != o and k.lower() in o.lower() for o in hit)]
        out, seen = [], set()
        for k in ks:
            key = k.lower()
            if key not in seen:
                seen.add(key)
                out.append(k)
        return out[:15]


def pg_array(xs: list[str]) -> str:
    """Python list → Postgres text[] 字串（COPY 用）"""
    return "{" + ",".join('"' + str(x).replace("\\", "\\\\").replace('"', '\\"') + '"' for x in xs) + "}"


def tag_items(items: list[dict], tagger: Tagger) -> pd.DataFrame:
    # 同一則新聞被不同來源轉載：只算一次（保留最早的時間和來源，標籤合併）
    merged: dict[str, dict] = {}
    for it in sorted(items, key=lambda x: x["ts"]):
        nid = news_id(it["title"])
        if nid not in merged:
            merged[nid] = {**it, "tags": list(it.get("tags") or []), "code_tags": list(it.get("code_tags") or [])}
        else:
            m = merged[nid]
            m["tags"] += [t for t in it.get("tags") or [] if t not in m["tags"]]
            m["code_tags"] += [c for c in it.get("code_tags") or [] if c not in m["code_tags"]]
            if not m["summary"] and it["summary"]:
                m["summary"] = it["summary"]
    rows = []
    for nid, it in merged.items():
        text = f"{it['title']} {it['summary']}"
        codes = tagger.stocks_in(text, it["code_tags"])
        rows.append({"id": nid, "ts": it["ts"], "source": it["source"][:30], "title": it["title"][:300],
                     "summary": it["summary"], "url": it["url"][:1000], "codes": codes,
                     "themes": tagger.themes_in(text, codes), "keywords": tagger.keywords_in(text, it["tags"])})
    return pd.DataFrame(rows, columns=["id", "ts", "source", "title", "summary", "url", "codes", "themes", "keywords"])


# ------------------------------------------------------------------ 統計
def _days(now: datetime) -> list[str]:
    d0 = now.astimezone(TW).date()
    return [(d0 - timedelta(days=i)).isoformat() for i in range(KEEP_DAYS - 1, -1, -1)]


def _spike(n24: int, n7: int) -> float | None:
    """近 24 小時 ÷ 前 6 天每天平均。前面幾乎沒人提 → 用 0.5 當底，避免 1 則就變成無限大。"""
    base = max((n7 - n24) / 6, 0.5)
    return round(n24 / base, 1) if n24 else 0.0


def compute(news: pd.DataFrame, stocks: pd.DataFrame, prices: pd.DataFrame, mf: pd.DataFrame, now: datetime) -> dict:
    days = _days(now)
    cut24 = now - timedelta(hours=24)
    if news.empty:
        return {"asof": now.isoformat(timespec="seconds"), "days": days, "total": 0, "n24": 0,
                "sources": [], "stocks": [], "groups": [], "keywords": []}
    news = news.copy()
    news["day"] = news["ts"].dt.tz_convert(TW).dt.date.astype(str)
    news["recent"] = news["ts"] >= cut24
    name = dict(zip(stocks["code"], stocks["name"]))
    industry = dict(zip(stocks["code"], stocks["industry"]))

    def agg(explode_col: str) -> dict[str, dict]:
        out: dict[str, dict] = {}
        for r in news.itertuples():
            for k in getattr(r, explode_col) or []:
                o = out.setdefault(k, {"n7": 0, "n24": 0, "series": Counter(), "src": Counter(), "co": Counter(), "kw": Counter()})
                o["n7"] += 1
                o["n24"] += int(r.recent)
                o["series"][r.day] += 1
                o["src"][r.source] += 1
                for c in r.codes or []:
                    if c != k:
                        o["co"][c] += 1
                for kw in r.keywords or []:
                    if kw != k:
                        o["kw"][kw] += 1
        return out

    def finish(k: str, o: dict) -> dict:
        tot = sum(o["src"].values()) or 1
        return {"n7": o["n7"], "n24": o["n24"], "series": [o["series"].get(d, 0) for d in days],
                "spike": _spike(o["n24"], o["n7"]), "sources": len(o["src"]),
                "top_source": o["src"].most_common(1)[0][0] if o["src"] else None,
                "top_share": round(o["src"].most_common(1)[0][1] / tot, 2) if o["src"] else None,
                "kw": [w for w, _ in o["kw"].most_common(6)],
                "co": [{"code": c, "name": name.get(c, c), "n": n} for c, n in o["co"].most_common(6)]}

    # 5 日漲跌、主力 5 日買賣超（張）
    pct5, close = {}, {}
    if not prices.empty:
        for code, g in prices.sort_values("date").groupby("code"):
            c = g["close"].astype(float).tolist()
            close[code] = c[-1]
            if len(c) >= 6 and c[-6]:
                pct5[code] = round((c[-1] / c[-6] - 1) * 100, 2)
    mf5 = {}
    if not mf.empty:
        last5 = sorted(mf["date"].unique())[-5:]
        mf5 = (mf[mf["date"].isin(last5)].groupby("code")["net"].sum() / 1000).round().astype(int).to_dict()

    st = agg("codes")
    stock_rows = []
    for code, o in st.items():
        r = finish(code, o)
        r.update({"code": code, "name": name.get(code, code), "industry": industry.get(code),
                  "close": close.get(code), "pct5": pct5.get(code), "mf5": mf5.get(code)})
        stock_rows.append(r)
    stock_rows.sort(key=lambda x: (-x["n7"], -x["n24"]))
    # 熱度前段班、但主力 5 日賣超 → 標示（媒體一直報、主力在賣：留意是不是買新聞出貨）
    hot_cut = stock_rows[min(29, len(stock_rows) - 1)]["n7"] if stock_rows else 0
    for r in stock_rows:
        flags = []
        if r["mf5"] is not None and r["mf5"] < 0 and r["n7"] >= max(3, hot_cut):
            flags.append("熱度高、主力賣超")
        if r["spike"] and r["spike"] >= 3 and r["n24"] >= 3:
            flags.append("熱度急升")
        if r["top_share"] is not None and r["top_share"] >= 0.7 and r["n7"] >= 5:
            flags.append("來源集中")
        r["flags"] = flags
    for i, r in enumerate(stock_rows):
        r["rank"] = i + 1

    # 產業（官方產業別）＋ 題材（全球族群 / 關鍵字）
    news["industries"] = news["codes"].map(lambda cs: list(dict.fromkeys(industry.get(c) for c in cs or [] if industry.get(c))))
    groups = []
    ind_codes: dict[str, set[str]] = defaultdict(set)
    for cs in news["codes"]:
        for c in cs or []:
            if industry.get(c):
                ind_codes[industry[c]].add(c)
    for col, kind in (("themes", "題材"), ("industries", "產業")):
        for k, o in agg(col).items():
            r = finish(k, o)
            r.update({"name": k, "kind": kind})
            if kind == "產業":  # 網頁用這些代號查這個產業的新聞
                r["codes"] = sorted(ind_codes.get(k, ()))[:300]
            groups.append(r)
    groups.sort(key=lambda x: (-x["n7"], -x["n24"]))

    kws = []
    for k, o in agg("keywords").items():
        if o["n7"] < 2:
            continue
        r = finish(k, o)
        r.update({"k": k})
        kws.append(r)
    kws.sort(key=lambda x: (-x["n7"], -x["n24"]))

    src = news["source"].value_counts()
    return {
        "asof": now.isoformat(timespec="seconds"), "days": days, "total": int(len(news)), "n24": int(news["recent"].sum()),
        "with_stock": int(news["codes"].map(lambda x: bool(x)).sum()),
        "sources": [{"name": k, "n": int(v)} for k, v in src.head(12).items()],
        "stocks": stock_rows[:200], "groups": groups[:80], "keywords": kws[:150],
    }


# ------------------------------------------------------------------ 主程式
def update(conn, now: datetime | None = None) -> str:
    now = now or datetime.now(timezone.utc)
    since = now - timedelta(days=KEEP_DAYS)
    stocks = db.query_df(conn, "select code, name, industry from public.stocks where kind = 'stock'")
    items, errors = fetch_all(since)
    if not items and errors:
        raise RuntimeError("新聞一則都沒抓到：" + "；".join(errors[:3]))
    tagger = Tagger(stocks)
    df = tag_items(items, tagger)
    n = 0
    if not df.empty:
        # 已經有的新聞不重抓（保留第一次的來源與時間）
        have = set(db.query_df(conn, "select id from public.news where id = any(%s)", (df["id"].tolist(),))["id"])
        new = df[~df["id"].isin(have)]
        if not new.empty:
            new = new.assign(**{c: new[c].map(pg_array) for c in ("codes", "themes", "keywords")})
            n = db.upsert(conn, "news", new, ["id"])
    db.execute(conn, "delete from public.news where ts < %s", (since,))

    news = db.query_df(conn, "select id, ts, source, codes, themes, keywords from public.news where ts >= %s", (since,))
    if not news.empty:
        news["ts"] = pd.to_datetime(news["ts"], utc=True)
    codes = sorted({c for cs in news.get("codes", []) for c in (cs or [])})
    prices = db.query_df(conn, """select code, date, close from public.daily_prices
                                  where code = any(%s) and date >= %s""", (codes, (now - timedelta(days=20)).date())) if codes else pd.DataFrame()
    mf = db.query_df(conn, "select code, date, net from public.main_force where code = any(%s) and date >= %s",
                     (codes, (now - timedelta(days=14)).date())) if codes else pd.DataFrame()
    stats = compute(news, stocks, prices, mf, now)
    stats["errors"] = errors[:10]
    db.execute(conn, """insert into public.app_settings (key, value) values ('news_stats', %s::jsonb)
                        on conflict (key) do update set value = excluded.value""",
               (json.dumps(stats, ensure_ascii=False, allow_nan=False, default=str),))
    top = "、".join(f"{s['name']}({s['n7']})" for s in stats["stocks"][:3])
    msg = f"新增 {n} 則、7 日共 {stats['total']} 則；最熱：{top or '無'}"
    if errors:
        msg += f"；{len(errors)} 個來源失敗（{errors[0]}）"
    return msg
