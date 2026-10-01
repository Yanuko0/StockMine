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


def download(path: str) -> bytes | None:
    r = _c().get(f"{_base()}/{BUCKET}/{path}")
    if r.status_code in (400, 404):
        return None
    r.raise_for_status()
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
