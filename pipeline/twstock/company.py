"""公司基本資料：產業別（族群）與已發行股數（算市值、排龍頭用）。每 7 天更新一次。

來源：
- 上市：證交所 OpenAPI t187ap03_L（產業別代碼、已發行普通股數）
- 上櫃：櫃買中心 OpenAPI mopsfin_t187ap03_O
- 產業別補漏：FinMind TaiwanStockInfo（industry_category）
"""
from __future__ import annotations

from datetime import date

from . import db
from .sources import finmind
from .sources.http import get_json, to_num

TWSE_URL = "https://openapi.twse.com.tw/v1/opendata/t187ap03_L"
TPEX_URL = "https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap03_O"
# 董事、監察人持股明細（每月）
TWSE_BOARD = "https://openapi.twse.com.tw/v1/opendata/t187ap11_L"
TPEX_BOARD = "https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap11_O"


def board_holdings(rows: list[dict]) -> dict[str, float]:
    """每家公司董事、監察人目前持股合計（股）。法人代表人那一列不重複算。"""
    out: dict[str, float] = {}
    for r in rows or []:
        code = str(_pick(r, "公司代號", "SecuritiesCompanyCode", "CompanyCode") or "").strip()
        title = str(_pick(r, "職稱", "Title", "JobTitle") or "")
        if not code or not ("董事" in title or "監察人" in title or "director" in title.lower() or "supervisor" in title.lower()):
            continue
        if "代表人" in title or "representative" in title.lower():
            continue
        n = to_num(_pick(r, "目前持股", "CurrentShareholding", "CurrentShares", "Shareholding")) or 0
        out[code] = out.get(code, 0) + n
    return out

# 證交所 / 櫃買中心共用的產業別代碼
INDUSTRY = {
    "01": "水泥工業", "02": "食品工業", "03": "塑膠工業", "04": "紡織纖維", "05": "電機機械", "06": "電器電纜",
    "08": "玻璃陶瓷", "09": "造紙工業", "10": "鋼鐵工業", "11": "橡膠工業", "12": "汽車工業", "14": "建材營造",
    "15": "航運業", "16": "觀光餐旅", "17": "金融保險", "18": "貿易百貨", "19": "綜合", "20": "其他",
    "21": "化學工業", "22": "生技醫療業", "23": "油電燃氣業", "24": "半導體業", "25": "電腦及週邊設備業",
    "26": "光電業", "27": "通信網路業", "28": "電子零組件業", "29": "電子通路業", "30": "資訊服務業",
    "31": "其他電子業", "32": "文化創意業", "33": "農業科技業", "34": "電子商務", "35": "綠能環保",
    "36": "數位雲端", "37": "運動休閒", "38": "居家生活", "80": "管理股票", "91": "存託憑證",
}


def _pick(rec: dict, *cands: str):
    """欄位名稱可能是中文或英文，找第一個「包含」關鍵字的欄位。"""
    for c in cands:
        for k, v in rec.items():
            if c.lower() in str(k).lower():
                return v
    return None


def parse_records(rows: list[dict]) -> list[dict]:
    out = []
    for r in rows or []:
        code = str(_pick(r, "公司代號", "SecuritiesCompanyCode", "CompanyCode") or "").strip()
        if not code:
            continue
        ind = str(_pick(r, "產業別", "IndustryCode", "Industry") or "").strip()
        ind = INDUSTRY.get(ind.zfill(2), ind) if ind.isdigit() else ind
        shares = to_num(_pick(r, "已發行普通股數", "IssueShares", "IssuedShares"))
        if not shares:
            cap = to_num(_pick(r, "實收資本額", "Paidin", "Capital"))
            par = to_num(_pick(r, "普通股每股面額", "ParValue")) or 10
            shares = cap / par if cap else None
        out.append({"code": code, "industry": ind or None, "shares": int(shares) if shares else None})
    return out


def update_company_info(conn, d: date, force: bool = False) -> str:
    last = db.get_setting(conn, "company_updated_v2", None)
    if not force and last and (d - date.fromisoformat(str(last).strip('"'))).days < 7:
        return "公司資料：本週已更新"
    recs: dict[str, dict] = {}
    errs = []
    for url in (TWSE_URL, TPEX_URL):
        try:
            for r in parse_records(get_json(url)):
                recs[r["code"]] = r
        except Exception as e:  # noqa: BLE001
            errs.append(f"{url.split('/')[2]} {e}")
    try:  # FinMind 補產業別（也涵蓋 ETF 以外查不到的）
        info = finmind.fetch("TaiwanStockInfo")
        if not info.empty:
            for r in info.drop_duplicates("stock_id").itertuples():
                cat = getattr(r, "industry_category", None)
                rec = recs.setdefault(r.stock_id, {"code": r.stock_id, "industry": None, "shares": None})
                if not rec["industry"] and cat:
                    rec["industry"] = cat
    except Exception as e:  # noqa: BLE001
        errs.append(f"FinMind {e}")
    rows = [(r["industry"], r["shares"], r["code"]) for r in recs.values()]
    with conn.cursor() as cur:
        cur.executemany("""update public.stocks set industry = coalesce(%s, industry), shares = coalesce(%s, shares)
                           where code = %s""", rows)
    conn.commit()
    # 董監持股比例 = 董事、監察人持股合計 ÷ 已發行股數
    held: dict[str, float] = {}
    for url in (TWSE_BOARD, TPEX_BOARD):
        try:
            held.update(board_holdings(get_json(url)))
        except Exception as e:  # noqa: BLE001
            errs.append(f"董監持股 {url.split('/')[2]} {e}")
    nb = 0
    if held:
        sh = db.query_df(conn, "select code, shares from public.stocks where shares > 0")
        upd = [(round(held[c] / float(s_) * 100, 2), c) for c, s_ in zip(sh["code"], sh["shares"]) if c in held]
        upd = [(min(v, 100.0), c) for v, c in upd]
        try:
            with conn.cursor() as cur:
                cur.executemany("update public.stocks set board_pct = %s where code = %s", upd)
            conn.commit()
            nb = len(upd)
        except Exception as e:  # noqa: BLE001  還沒跑 008 升級
            conn.rollback()
            errs.append(f"董監持股：{e}")
    if recs:
        db.execute(conn, """insert into public.app_settings (key, value) values ('company_updated_v2', to_jsonb(%s::text))
                            on conflict (key) do update set value = excluded.value""", (d.isoformat(),))
    return f"公司資料 {len(recs)} 檔、董監持股 {nb} 檔" + (f"（{'；'.join(errs)}）" if errs else "")
