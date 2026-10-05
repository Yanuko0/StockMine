"""永豐 Shioaji：抓 1分K。

安全建議：API Key 只開「行情 / 資料」權限，不要開交易、帳務；
不需要也不要上傳憑證（.pfx）。這樣就算金鑰外洩也無法下單。
"""
from __future__ import annotations

import time
from datetime import date

import pandas as pd

from .. import config


class ShioajiClient:
    def __init__(self):
        import shioaji as sj

        key = config.env("SHIOAJI_API_KEY", required=True)
        secret = config.env("SHIOAJI_SECRET_KEY", required=True)
        self.api = sj.Shioaji(simulation=False)
        # subscribe_trade=False：不接收委託回報（我們只用行情）
        self.api.login(api_key=key, secret_key=secret, subscribe_trade=False)
        try:
            self.api.fetch_contracts(contract_download=True, contracts_timeout=60000)
        except Exception as e:  # noqa: BLE001  部分版本登入時已自動下載
            print(f"[shioaji] fetch_contracts：{e}")
        self._last = 0.0

    def close(self):
        try:
            self.api.logout()
        except Exception:  # noqa: BLE001
            pass

    def usage(self) -> str:
        try:
            u = self.api.usage()
            return f"已用 {u.bytes / 1e6:.1f}MB / 上限 {u.limit_bytes / 1e6:.0f}MB，剩 {u.remaining_bytes / 1e6:.1f}MB"
        except Exception as e:  # noqa: BLE001
            return f"(無法取得用量：{e})"

    def remaining_mb(self) -> float | None:
        try:
            return self.api.usage().remaining_bytes / 1e6
        except Exception:  # noqa: BLE001
            return None

    def kbars_1m(self, code: str, start: date, end: date) -> pd.DataFrame:
        """回傳欄位 ts（台灣時間，naive）, open, high, low, close, volume（張）。"""
        try:
            contract = self.api.Contracts.Stocks[code]
        except (KeyError, IndexError):
            contract = None
        if contract is None:
            return pd.DataFrame()
        # 查詢頻率限制：保守一點，每秒最多約 8 次
        wait = 0.13 - (time.time() - self._last)
        if wait > 0:
            time.sleep(wait)
        self._last = time.time()
        kb = self.api.kbars(contract=contract, start=start.isoformat(), end=end.isoformat())
        df = pd.DataFrame({**kb})
        if df.empty:
            return df
        df["ts"] = pd.to_datetime(df["ts"])
        return df.rename(columns={"Open": "open", "High": "high", "Low": "low",
                                  "Close": "close", "Volume": "volume"})[
            ["ts", "open", "high", "low", "close", "volume"]]

    def snapshots(self, codes: list[str], batch: int = 300) -> pd.DataFrame:
        """盤中快照：今天到目前為止的開高低收、總量（張）。回傳 code, ts, open, high, low, close, volume（張）。"""
        cons = [k for k in (self._contract(c) for c in codes) if k is not None]
        if len(cons) < len(codes) * 0.5:  # 商品檔沒下載完整：再下載一次
            try:
                self.api.fetch_contracts(contract_download=True, contracts_timeout=120000)
            except Exception as e:  # noqa: BLE001
                print(f"[shioaji] 重新下載商品檔失敗：{e}")
            cons = [k for k in (self._contract(c) for c in codes) if k is not None]
        rows = []
        for i in range(0, len(cons), batch):
            try:
                snaps = self.api.snapshots(cons[i:i + batch])
            except Exception as e:  # noqa: BLE001
                print(f"[shioaji] 快照失敗（第 {i // batch + 1} 批）：{e}")
                continue
            for sn in snaps:
                rows.append({"code": sn.code, "ts": sn.ts, "open": float(sn.open), "high": float(sn.high),
                             "low": float(sn.low), "close": float(sn.close), "volume": float(sn.total_volume)})
            time.sleep(0.2)
        print(f"[shioaji] 快照：{len(codes)} 檔要查、找到商品 {len(cons)} 檔、拿到 {len(rows)} 筆")
        df = pd.DataFrame(rows, columns=["code", "ts", "open", "high", "low", "close", "volume"])
        # ts 是奈秒整數（台灣時間）；沒資料時也要是日期型別，後面才能用 .dt
        df["ts"] = pd.to_datetime(df["ts"], errors="coerce")
        return df

    def _contract(self, code: str):
        try:
            return self.api.Contracts.Stocks[code]
        except (KeyError, IndexError):
            return None
