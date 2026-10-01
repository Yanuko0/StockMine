from __future__ import annotations

import time

import httpx

UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/126.0 Safari/537.36"
)

_client: httpx.Client | None = None


def client() -> httpx.Client:
    global _client
    if _client is None:
        _client = httpx.Client(
            headers={"User-Agent": UA, "Accept": "application/json, text/plain, */*"},
            timeout=httpx.Timeout(30.0),
            follow_redirects=True,
        )
    return _client


def get_json(url: str, params: dict | None = None, retries: int = 3, pause: float = 3.0):
    """證交所 / 櫃買中心請求：失敗會重試，每次請求間隔幾秒避免被封鎖。"""
    last = None
    for i in range(retries):
        try:
            r = client().get(url, params=params)
            r.raise_for_status()
            time.sleep(pause)
            return r.json()
        except Exception as e:  # noqa: BLE001
            last = e
            time.sleep(pause * (i + 2))
    raise RuntimeError(f"請求失敗 {url} {params}: {last}")


def to_num(s) -> float | None:
    """'1,234.5' → 1234.5；'--'、'' → None。"""
    if s is None:
        return None
    if isinstance(s, (int, float)):
        return float(s)
    s = str(s).strip().replace(",", "")
    if s in ("", "--", "---", "----", "X", "除權息", "除息", "除權"):
        return None
    try:
        return float(s)
    except ValueError:
        return None


def to_int(s) -> int | None:
    v = to_num(s)
    return None if v is None else int(round(v))
