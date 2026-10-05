"""Supabase Storage（檔案儲存）：放全市場近 30 天的 1分K 壓縮檔。"""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor

import httpx

from . import config

BUCKET = "minute"


def _base() -> str:
    return config.env("SUPABASE_URL", required=True).rstrip("/") + "/storage/v1/object"


def _headers() -> dict:
    key = config.env("SUPABASE_SERVICE_KEY", required=True)
    if key.startswith("sb_secret_"):
        # 新版 secret key 不是 JWT：只放 apikey，Supabase 閘道會自動換成 service_role 權限
        return {"apikey": key}
    return {"Authorization": f"Bearer {key}", "apikey": key}  # 舊版 service_role（JWT）


_client: httpx.Client | None = None


def _c() -> httpx.Client:
    global _client
    if _client is None:
        _client = httpx.Client(timeout=60, headers=_headers(),
                               limits=httpx.Limits(max_connections=16, max_keepalive_connections=16))
    return _client


def _missing(r: httpx.Response) -> bool:
    """檔案不存在（正常，回傳 None）；其他 400 多半是金鑰 / 網址錯了，要報錯，不能當成沒有檔案。"""
    if r.status_code == 404:
        return True
    if r.status_code == 400:
        t = r.text.lower()
        return "not_found" in t or "not found" in t or '"404"' in t
    return False


def download(path: str) -> bytes | None:
    r = _c().get(f"{_base()}/{BUCKET}/{path}")
    if _missing(r):
        return None
    if r.status_code >= 300:
        raise RuntimeError(f"Supabase 檔案下載失敗（{r.status_code}）：{r.text[:160]}。"
                           "請檢查 GitHub Secrets 的 SUPABASE_URL、SUPABASE_SERVICE_KEY 是否正確")
    return r.content


def upload(path: str, data: bytes, content_type: str = "application/gzip") -> None:
    for attempt in range(3):
        r = _c().post(f"{_base()}/{BUCKET}/{path}", content=data,
                      headers={"Content-Type": content_type, "x-upsert": "true", "cache-control": "300"})
        if r.status_code < 300:
            return
    raise RuntimeError(f"上傳失敗 {path}: {r.status_code} {r.text[:200]}")


def download_many(paths: list[str], workers: int = 12) -> dict[str, bytes | None]:
    with ThreadPoolExecutor(workers) as ex:
        return dict(zip(paths, ex.map(download, paths)))


def upload_many(items: dict[str, bytes], workers: int = 12) -> None:
    with ThreadPoolExecutor(workers) as ex:
        list(ex.map(lambda kv: upload(*kv), items.items()))
