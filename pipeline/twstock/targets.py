"""從新聞標題 / 摘要裡整理「券商、外資給的目標價」。

完全免費：只讀新聞文字（鉅亨網、Yahoo、Google 新聞），用規則找出
  券商（大摩、高盛、凱基…）、評等（買進 / 中立 / 減碼）、動作（調升 / 調降 / 維持 / 首評）、目標價（原本 → 新的）。
同一家券商對同一檔的同一個目標價，10 天內不同媒體轉載只算一次。

限制（網頁上也會講清楚）：
  - 只抓得到「有上新聞」的目標價；券商報告原文是付費的，沒上新聞的就沒有。
  - 一則新聞講很多檔股票時，只有股名就在「目標價」前面的才算，避免張冠李戴。
"""
from __future__ import annotations

import re
from datetime import timedelta

import pandas as pd

# 正式名稱 → 新聞裡常見的寫法（長的寫前面，先比對）
BROKERS: dict[str, list[str]] = {
    "摩根士丹利": ["摩根士丹利", "大摩", "Morgan Stanley"],
    "摩根大通": ["摩根大通", "小摩", "摩通", "JPMorgan", "JP Morgan"],
    "高盛": ["高盛", "Goldman"],
    "美銀": ["美銀證券", "美銀美林", "美林", "美銀", "BofA"],
    "花旗": ["花旗環球", "花旗", "Citi"],
    "瑞銀": ["瑞銀", "UBS"],
    "野村": ["野村"],
    "麥格理": ["麥格理", "Macquarie"],
    "匯豐": ["匯豐", "滙豐", "HSBC"],
    "德意志": ["德意志", "德銀"],
    "巴克萊": ["巴克萊", "Barclays"],
    "里昂": ["中信里昂", "里昂", "CLSA"],
    "傑富瑞": ["傑富瑞", "Jefferies"],
    "伯恩斯坦": ["伯恩斯坦", "Bernstein"],
    "大和": ["大和資本", "大和證券", "大和國泰", "大和"],
    "瑞穗": ["瑞穗", "Mizuho"],
    "凱基": ["凱基投顧", "凱基證券", "凱基"],
    "元大": ["元大投顧", "元大證券", "元大"],
    "富邦": ["富邦投顧"],
    "國泰": ["國泰證期", "國泰投顧"],
    "統一": ["統一投顧"],
    "群益": ["群益投顧"],
    "永豐": ["永豐投顧"],
    "兆豐": ["兆豐投顧"],
    "第一金": ["第一金投顧"],
    "台新": ["台新投顧"],
    "華南": ["華南投顧"],
    "玉山": ["玉山投顧"],
    "宏遠": ["宏遠投顧"],
    "康和": ["康和投顧"],
    "FactSet 共識": ["FactSet"],
    "外資（未具名）": ["外資券商", "外資法人", "外資圈", "外資"],
    "投顧（未具名）": ["投顧法人", "本土法人", "投顧"],
}
_ALIASES = sorted(((a, k) for k, v in BROKERS.items() for a in v), key=lambda x: -len(x[0]))
UNNAMED = {"外資（未具名）", "投顧（未具名）"}

RATINGS = [("強力買進", "多"), ("買進", "多"), ("加碼", "多"), ("增持", "多"), ("優於大盤", "多"), ("跑贏大盤", "多"),
           ("超越大盤", "多"), ("表現優於", "多"), ("區間操作", "中"), ("中立", "中"), ("持有", "中"), ("持平", "中"),
           ("減碼", "空"), ("減持", "空"), ("賣出", "空"), ("劣於大盤", "空"), ("落後大盤", "空"), ("表現落後", "空")]
ACT_UP = ("調升", "上修", "調高", "提高", "上調", "拉高", "喊高", "大升", "升至")
ACT_DOWN = ("調降", "下修", "調低", "下調", "砍", "降至", "下砍", "降低")
ACT_KEEP = ("維持", "重申")
ACT_INIT = ("首評", "首次", "新納入", "開始追蹤", "初次")

NUM = r"(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)"
# 目標價 從 1,200 元 調升至 1,500 元 / 目標價調升至 1500 元 / 目標價上看 1500 / 目標價 1500 元
_FROM_TO = re.compile(r"目標價(?:分別)?(?:從|由)?\s*" + NUM + r"\s*元?\s*(?:大幅|一舉)?(?:調升|上修|調高|提高|上調|拉高|調降|下修|調低|下調|降|砍)\s*(?:至|到|為)\s*" + NUM)
_TO = re.compile(r"目標價(?:分別)?(?:中位數|平均值|平均|均值|共識)?\s*(?:大幅|一舉)?(?:調升|上修|調高|提高|上調|拉高|喊高|調降|下修|調低|下調|降|砍|喊到|喊|上看|看|達|訂|定|設|為|至|到|來到|直指|挑戰)*\s*(?:至|到|為|在)?\s*" + NUM + r"\s*(元|年)?")
_SPLIT = re.compile(r"[。；;！!？?\n|｜]")


def to_num(s: str) -> float:
    return float(s.replace(",", ""))


def _clause_start(text: str, pos: int) -> int:
    """這個「目標價」所在的句子從哪裡開始（往前找句號、分號）。"""
    m = None
    for m in _SPLIT.finditer(text, 0, pos):
        pass
    return m.end() if m else 0


def _nearest(text: str, start: int, end: int, needles: list[tuple[str, str]]) -> str | None:
    """text[start:end] 裡離 end 最近的那個詞（回傳對應的正式名稱）。"""
    best, best_key = None, (-1, 0)
    seg = text[start:end]
    for alias, canon in needles:
        p = seg.rfind(alias)
        if p < 0:
            continue
        key = (p + len(alias), len(alias))  # 結尾最靠近的；一樣近就取長的（「凱基投顧」優先於「投顧」）
        if key > best_key:
            best, best_key = canon, key
    return best


def extract(title: str, summary: str, stock_names: dict[str, str], cand_codes: list[str],
            closes: dict[str, float]) -> list[dict]:
    """一則新聞 → [{code, broker, target, prev, rating, stance, action}]。
    stock_names：{code: 名稱}；cand_codes：這則新聞被標到的個股；closes：最新收盤（排除不合理的數字）。"""
    out = []
    for text in (title or "", summary or ""):
        if "目標價" not in text:
            continue
        names = [(stock_names[c], c) for c in cand_codes if stock_names.get(c)] + [(c, c) for c in cand_codes]
        names.sort(key=lambda x: -len(x[0]))
        spans = []
        for m in _FROM_TO.finditer(text):
            spans.append((m.start(), m.end(), to_num(m.group(2)), to_num(m.group(1))))
        for m in _TO.finditer(text):
            if m.group(2) == "年" or any(a <= m.start() < b for a, b, _, _ in spans):
                continue
            spans.append((m.start(), m.end(), to_num(m.group(1)), None))
        for a, b, target, prev in spans:
            cs = _clause_start(text, a)
            back = max(cs, a - 40)
            code = _nearest(text, back, a, names)
            if code is None:
                # 整則只講一檔、而且股名真的有出現在這句話裡
                if len(cand_codes) == 1 and any(n in text[cs:b] for n, c in names if c == cand_codes[0]):
                    code = cand_codes[0]
                elif len(cand_codes) == 1 and len(spans) == 1 and any(n in text for n, c in names):
                    code = cand_codes[0]
            if code is None:
                continue
            # 同一句話裡如果還有別的股名在這個股名和「目標價」之間，代表不是講它
            close = closes.get(code)
            if close and not (close * 0.3 <= target <= close * 4):
                continue
            if not close and not (1 <= target <= 50000):
                continue
            broker = _nearest(text, cs, a + 1, _ALIASES) or _nearest(title or "", 0, len(title or ""), _ALIASES)
            if broker is None:
                broker = "外資（未具名）" if "外資" in text else "法人（未具名）"
            win = text[cs:min(len(text), b + 20)]
            rating, stance = next(((r, s) for r, s in RATINGS if r in win), (None, None))
            act_win = text[max(cs, a - 12):b]
            if prev is not None:
                action = "up" if target > prev else "down" if target < prev else "keep"
            elif any(k in act_win for k in ACT_DOWN):
                action = "down"
            elif any(k in act_win for k in ACT_UP):
                action = "up"
            elif any(k in win for k in ACT_INIT):
                action = "init"
            elif any(k in win for k in ACT_KEEP):
                action = "keep"
            else:
                action = None
            out.append({"code": code, "broker": broker, "target": target, "prev": prev,
                        "rating": rating, "stance": stance, "action": action})
    # 同一則新聞重複（標題、摘要都寫）只留一筆
    seen, uniq = set(), []
    for x in out:
        k = (x["code"], x["broker"], x["target"])
        if k not in seen:
            seen.add(k)
            uniq.append(x)
    return uniq


def from_news(news: pd.DataFrame, stock_names: dict[str, str], closes: dict[str, float]) -> pd.DataFrame:
    """news：id, ts, source, title, summary, url, codes → 目標價表（同一家 10 天內重複轉載只留最早一筆）。"""
    rows = []
    for r in news.itertuples():
        codes = list(r.codes or [])
        if not codes or "目標價" not in f"{r.title}{r.summary or ''}":
            continue
        for x in extract(r.title, r.summary or "", stock_names, codes, closes):
            rows.append({**x, "date": pd.Timestamp(r.ts).tz_convert("Asia/Taipei").date() if pd.Timestamp(r.ts).tzinfo
                         else pd.Timestamp(r.ts).date(),
                         "title": r.title, "url": r.url, "source": r.source})
    df = pd.DataFrame(rows, columns=["code", "broker", "target", "prev", "rating", "stance", "action",
                                     "date", "title", "url", "source"])
    return dedupe(df)


def dedupe(df: pd.DataFrame, existing: pd.DataFrame | None = None, days: int = 10) -> pd.DataFrame:
    """同一檔、同一家、同一個目標價，10 天內只留最早的一筆（不同媒體轉載）。existing：資料庫裡已經有的。"""
    if df.empty:
        return df
    df = df.sort_values("date")
    keep, seen = [], {}
    if existing is not None and not existing.empty:
        for r in existing.itertuples():
            seen.setdefault((r.code, r.broker, float(r.target)), []).append(r.date)
    for i, r in df.iterrows():
        k = (r["code"], r["broker"], float(r["target"]))
        ds = seen.get(k, [])
        if any(abs((r["date"] - x).days) <= days for x in ds):
            continue
        seen.setdefault(k, []).append(r["date"])
        keep.append(i)
    return df.loc[keep].reset_index(drop=True)


def summarize(tp: pd.DataFrame, close: float | None, today) -> dict | None:
    """一檔的目標價整理：每家券商最新一筆（180 天內）的中位數、最高、最低、上檔空間、近 90 天調升 / 調降次數。"""
    if tp.empty:
        return None
    tp = tp.sort_values("date")
    recent = tp[tp["date"] >= today - timedelta(days=180)]
    latest = recent[~recent["broker"].isin(UNNAMED)].groupby("broker").tail(1)
    if latest.empty:
        latest = recent.groupby("broker").tail(1)
    if latest.empty:
        return {"n": 0}
    t = latest["target"].astype(float)
    r90 = tp[tp["date"] >= today - timedelta(days=90)]
    med = float(t.median())
    return {"n": int(len(latest)), "median": med, "high": float(t.max()), "low": float(t.min()),
            "upside": round((med / close - 1) * 100, 1) if close else None,
            "up90": int((r90["action"] == "up").sum()), "down90": int((r90["action"] == "down").sum()),
            "bull": int((latest["stance"] == "多").sum()), "bear": int((latest["stance"] == "空").sum()),
            "last": str(tp["date"].iloc[-1])}
