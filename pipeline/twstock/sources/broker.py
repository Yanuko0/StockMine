"""券商分點進出。

- 上市：證交所「買賣日報表查詢系統」bsr.twse.com.tw（只能查當天，有圖形驗證碼，
  用開源的 ddddocr 自動辨識，失敗會重試）。
- 上櫃：櫃買中心使用 Google reCAPTCHA，無法免費自動化。
  若有 FinMind Sponsor（FINMIND_SPONSOR=true），上市上櫃都改用 FinMind。
"""
from __future__ import annotations

import csv
import io
import re
import time
from datetime import date

import httpx
import pandas as pd

from .http import UA

BSR = "https://bsr.twse.com.tw/bshtm/"

_ocr = None


def _get_ocr():
    global _ocr
    if _ocr is None:
        import ddddocr  # 延遲載入：模型檔較大
        _ocr = ddddocr.DdddOcr(show_ad=False)
    return _ocr


def _solve(img: bytes) -> str:
    txt = _get_ocr().classification(img)
    return re.sub(r"[^A-Za-z0-9]", "", txt).upper()


def decode_csv(data: bytes) -> str:
    """證交所分點 CSV 以前是 Big5（cp950），現在改成 UTF-8：先試 UTF-8，不行再用 cp950。"""
    try:
        return data.decode("utf-8-sig")
    except UnicodeDecodeError:
        return data.decode("cp950", errors="replace")


def good_name(name: str) -> bool:
    """名稱沒有亂碼（解不出來的字）才拿來更新分點名稱表。"""
    return bool(name) and "\ufffd" not in name


def parse_bsr_csv(text: str) -> pd.DataFrame:
    """把證交所分點 CSV 轉成每筆成交：broker_id, broker_name, price, buy, sell。"""
    rows = []
    for rec in csv.reader(io.StringIO(text)):
        # 一行有左右兩組：序號,券商,價格,買進股數,賣出股數,,序號,券商,價格,買進股數,賣出股數
        for off in (0, 6):
            part = rec[off:off + 5]
            if len(part) < 5 or not part[0].strip().isdigit():
                continue
            broker = part[1].strip()
            price = float(part[2].replace(",", "") or 0)
            buy = int(float(part[3].replace(",", "") or 0))
            sell = int(float(part[4].replace(",", "") or 0))
            rows.append({"broker_id": broker[:4].strip(), "broker_name": broker[4:].strip(),
                         "price": price, "buy": buy, "sell": sell})
    return pd.DataFrame(rows, columns=["broker_id", "broker_name", "price", "buy", "sell"])


def fetch_twse_broker(code: str, max_tries: int = 8) -> pd.DataFrame | None:
    """抓上市股票「當天」分點成交明細。查無資料回傳空表；多次失敗回傳 None。"""
    from bs4 import BeautifulSoup  # 延遲載入：只有抓分點時才需要（融資融券排程沒有安裝這個套件）
    with httpx.Client(headers={"User-Agent": UA}, timeout=30, follow_redirects=True) as c:
        for attempt in range(max_tries):
            try:
                r = c.get(BSR + "bsMenu.aspx")
                soup = BeautifulSoup(r.text, "html.parser")
                form = {i.get("name"): i.get("value", "") for i in soup.select("input[type=hidden]") if i.get("name")}
                img = soup.find("img", src=re.compile("CaptchaImage", re.I))
                if img is None:
                    raise RuntimeError("找不到驗證碼圖片（網站可能改版）")
                cap = c.get(BSR + img["src"]).content
                text = _solve(cap)
                if len(text) != 5:
                    continue
                form.update({
                    "__EVENTTARGET": "", "__EVENTARGUMENT": "", "__LASTFOCUS": "",
                    "RadioButton_Normal": "RadioButton_Normal",
                    "TextBox_Stkno": code, "CaptchaControl1": text, "btnOK": "查詢",
                })
                r2 = c.post(BSR + "bsMenu.aspx", data=form)
                if "HyperLink_DownloadCSV" in r2.text:
                    s2 = BeautifulSoup(r2.text, "html.parser")
                    a = s2.find(id="HyperLink_DownloadCSV")
                    href = a.get("href") if a and a.get("href") else "bsContent.aspx"
                    csv_bytes = c.get(BSR + href).content
                    return parse_bsr_csv(decode_csv(csv_bytes))
                if "查無資料" in r2.text:
                    return pd.DataFrame(columns=["broker_id", "broker_name", "price", "buy", "sell"])
                # 驗證碼錯誤 → 重試
            except Exception as e:  # noqa: BLE001
                print(f"[broker] {code} 第 {attempt + 1} 次失敗：{e}")
            time.sleep(1.5)
    return None


def aggregate(trades: pd.DataFrame, code: str, d: date) -> tuple[pd.DataFrame, dict]:
    """逐筆 → 每個分點的買賣合計，並計算主力買賣超。"""
    if trades.empty:
        return pd.DataFrame(), {}
    t = trades.copy()
    t["amt"] = t["price"] * (t["buy"] + t["sell"])
    t["qty"] = t["buy"] + t["sell"]
    g = t.groupby("broker_id").agg(broker_name=("broker_name", "first"), buy=("buy", "sum"),
                                   sell=("sell", "sum"), amt=("amt", "sum"), qty=("qty", "sum"))
    g["net"] = g["buy"] - g["sell"]
    g["avg_price"] = (g["amt"] / g["qty"].where(g["qty"] > 0)).round(2)
    g = g.reset_index()
    per = g[["broker_id", "broker_name", "buy", "sell", "net", "avg_price"]].copy()
    per.insert(0, "date", d)
    per.insert(0, "code", code)
    mf = main_force(per)
    mf.update({"code": code, "date": d})
    return per, mf


def main_force(per: pd.DataFrame, top: int = 15) -> dict:
    """主力買賣超 = 買超前 N 名合計 + 賣超前 N 名合計（賣超為負）。"""
    buyers = per[per["net"] > 0].nlargest(top, "net")["net"].sum()
    sellers = per[per["net"] < 0].nsmallest(top, "net")["net"].sum()
    return {"top_buy": int(buyers), "top_sell": int(sellers), "net": int(buyers + sellers),
            "broker_cnt": int(len(per))}
