"""全市場分點明細：每檔一個檔案 bk/{code}.json.gz（放在 Supabase Storage，保留最近 60 個交易日）。

為什麼不放資料庫：全市場每天約 15 萬筆分點，90 天就超過免費資料庫 500MB；
壓縮成檔案每檔約 50KB，全部約 50MB，放 Storage（免費 1GB）綽綽有餘。網頁看個股時只下載那一檔。

格式：{"v": 1, "code": "2330", "days": [{"d": "2026-10-01", "b": [[分點代號, 名稱, 買進股數, 賣出股數, 均價], ...]}]}
"""
from __future__ import annotations

import gzip
import json
from datetime import date

import pandas as pd

from . import storage

KEEP_DAYS = 60


def path(code: str) -> str:
    return f"bk/{code}.json.gz"


def encode(obj: dict) -> bytes:
    return gzip.compress(json.dumps(obj, ensure_ascii=False, separators=(",", ":")).encode(), 6)


def decode(data: bytes | None) -> dict | None:
    if not data:
        return None
    try:
        return json.loads(gzip.decompress(data) if data[:2] == b"\x1f\x8b" else data)
    except Exception:  # noqa: BLE001  壞檔就當沒有
        return None


def merge(old: dict | None, code: str, d: date, per: pd.DataFrame) -> dict:
    """把今天的分點加進去（同一天重跑會覆蓋），只留最近 KEEP_DAYS 天。"""
    rows = [[str(r.broker_id), str(r.broker_name), int(r.buy), int(r.sell),
             None if pd.isna(r.avg_price) else float(r.avg_price)]
            for r in per.itertuples() if (r.buy or r.sell)]
    days = [x for x in (old or {}).get("days", []) if x.get("d") != d.isoformat()]
    days.append({"d": d.isoformat(), "b": rows})
    days.sort(key=lambda x: x["d"])
    return {"v": 1, "code": code, "days": days[-KEEP_DAYS:]}


def update(per_by_code: dict[str, pd.DataFrame], d: date, cache_dir) -> int:
    """per_by_code：{code: aggregate() 算好的每分點合計}。先讀本機快取，沒有的才下載，合併後上傳。"""
    if not per_by_code:
        return 0
    cache_dir.mkdir(parents=True, exist_ok=True)
    old: dict[str, dict | None] = {}
    missing = []
    for c in per_by_code:
        f = cache_dir / f"{c}.json.gz"
        if f.exists():
            old[c] = decode(f.read_bytes())
        else:
            missing.append(c)
    if missing:
        got = storage.download_many([path(c) for c in missing])
        for c in missing:
            old[c] = decode(got.get(path(c)))
    out = {}
    for c, per in per_by_code.items():
        data = encode(merge(old.get(c), c, d, per))
        (cache_dir / f"{c}.json.gz").write_bytes(data)
        out[path(c)] = data
    storage.upload_many(out)
    return len(out)
