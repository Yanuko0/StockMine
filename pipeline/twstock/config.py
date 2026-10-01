"""讀取環境變數（在 GitHub Actions 由 Secrets 提供，本機可用 .env）。"""
from __future__ import annotations

import os
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

TW_TZ = timezone(timedelta(hours=8))


def _load_dotenv() -> None:
    p = Path(__file__).resolve().parent.parent / ".env"
    if not p.exists():
        return
    for line in p.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


_load_dotenv()


def env(name: str, default: str | None = None, required: bool = False) -> str | None:
    v = os.environ.get(name, default)
    if required and not v:
        raise RuntimeError(f"缺少環境變數 {name}，請到 GitHub Secrets 設定")
    return v


SUPABASE_URL = env("SUPABASE_URL")
SUPABASE_SERVICE_KEY = env("SUPABASE_SERVICE_KEY")
SUPABASE_DB_URL = env("SUPABASE_DB_URL")

SHIOAJI_API_KEY = env("SHIOAJI_API_KEY")
SHIOAJI_SECRET_KEY = env("SHIOAJI_SECRET_KEY")

FINMIND_TOKEN = env("FINMIND_TOKEN")
FINMIND_SPONSOR = (env("FINMIND_SPONSOR", "false") or "").lower() == "true"

GDRIVE_CLIENT_ID = env("GDRIVE_CLIENT_ID")
GDRIVE_CLIENT_SECRET = env("GDRIVE_CLIENT_SECRET")
GDRIVE_REFRESH_TOKEN = env("GDRIVE_REFRESH_TOKEN")
GDRIVE_ROOT_FOLDER = env("GDRIVE_ROOT_FOLDER", "掘股 StockMine")

VAPID_PRIVATE_KEY = env("VAPID_PRIVATE_KEY")
VAPID_SUBJECT = env("VAPID_SUBJECT", "mailto:admin@example.com")
APP_URL = env("APP_URL", "")

# 全市場 1分K 在 Supabase 保留幾個交易日
MINUTE_KEEP_DAYS = int(env("MINUTE_KEEP_DAYS", "30") or 30)
# 分點資料在資料庫保留幾天
BROKER_KEEP_DAYS = int(env("BROKER_KEEP_DAYS", "90") or 90)
# 免費資料庫只有 500 MB：日K 保留 5 年；三大法人、融資融券保留約 400 天
DAILY_KEEP_YEARS = int(env("DAILY_KEEP_YEARS", "5") or 5)
CHIPS_KEEP_DAYS = int(env("CHIPS_KEEP_DAYS", "400") or 400)


def today_tw() -> date:
    return datetime.now(TW_TZ).date()


def parse_date(s: str | None) -> date:
    if not s:
        return today_tw()
    return datetime.strptime(s.replace("/", "-"), "%Y-%m-%d").date()

# 全市場分點（上市）：近 20 日平均成交量 ≥ 這個張數的股票才抓（0 = 全部）；最多幾檔；最多花幾分鐘；同時幾條連線
BROKER_POOL_MIN_LOTS = int(env("BROKER_POOL_MIN_LOTS", "0") or 0)
BROKER_POOL_MAX = int(env("BROKER_POOL_MAX", "1500") or 1500)
BROKER_BUDGET_MIN = int(env("BROKER_BUDGET_MIN", "60") or 60)
BROKER_WORKERS = int(env("BROKER_WORKERS", "4") or 4)
