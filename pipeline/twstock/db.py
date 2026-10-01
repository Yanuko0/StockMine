"""直接連 Supabase Postgres（比 REST API 快很多，適合大量寫入）。"""
from __future__ import annotations

import json
import math
from contextlib import contextmanager
from datetime import date
from typing import Iterable, Sequence

import pandas as pd
import psycopg

from . import config


@contextmanager
def connect():
    url = config.env("SUPABASE_DB_URL", required=True)
    # prepare_threshold=None：相容 Supabase 連線池（pgbouncer transaction 模式）
    with psycopg.connect(url, autocommit=False, prepare_threshold=None) as conn:
        yield conn


def _clean(v):
    if v is None:
        return None
    if isinstance(v, float) and (math.isnan(v) or math.isinf(v)):
        return None
    if isinstance(v, (dict, list)):
        return json.dumps(v, ensure_ascii=False)
    if hasattr(v, "item"):  # numpy scalar
        v = v.item()
        if isinstance(v, float) and math.isnan(v):
            return None
    return v


def upsert(conn, table: str, rows: pd.DataFrame | Sequence[dict], pk: Sequence[str]) -> int:
    """批次 upsert：先 COPY 進暫存表，再 INSERT ... ON CONFLICT DO UPDATE。"""
    df = rows if isinstance(rows, pd.DataFrame) else pd.DataFrame(list(rows))
    if df.empty:
        return 0
    df = df.drop_duplicates(subset=list(pk), keep="last")
    cols = list(df.columns)
    tmp = f"tmp_{table}"
    col_list = ", ".join(f'"{c}"' for c in cols)
    updates = ", ".join(f'"{c}" = excluded."{c}"' for c in cols if c not in pk) or None
    with conn.cursor() as cur:
        cur.execute(f'create temp table if not exists {tmp} (like public.{table} including defaults) on commit drop')
        cur.execute(f"truncate {tmp}")
        with cur.copy(f"copy {tmp} ({col_list}) from stdin") as cp:
            for rec in df.itertuples(index=False, name=None):
                cp.write_row([_clean(v) for v in rec])
        conflict = ", ".join(f'"{c}"' for c in pk)
        action = f"do update set {updates}" if updates else "do nothing"
        cur.execute(
            f"insert into public.{table} ({col_list}) select {col_list} from {tmp} "
            f"on conflict ({conflict}) {action}"
        )
    conn.commit()
    return len(df)


def query_df(conn, sql: str, params: Iterable | None = None) -> pd.DataFrame:
    with conn.cursor() as cur:
        cur.execute(sql, params)
        if cur.description is None:
            return pd.DataFrame()
        cols = [d.name for d in cur.description]
        return pd.DataFrame(cur.fetchall(), columns=cols)


def execute(conn, sql: str, params: Iterable | None = None) -> None:
    with conn.cursor() as cur:
        cur.execute(sql, params)
    conn.commit()


def log_job(job: str, run_date: date, status: str, message: str = "") -> None:
    try:
        with connect() as conn:
            execute(
                conn,
                "insert into public.job_runs (job, run_date, status, message) values (%s, %s, %s, %s)",
                (job, run_date, status, message[:4000]),
            )
    except Exception as e:  # 紀錄失敗不影響主流程
        print(f"[log_job] 無法寫入執行紀錄：{e}")


def get_setting(conn, key: str, default):
    df = query_df(conn, "select value from public.app_settings where key = %s", (key,))
    if df.empty:
        return default
    return df.iloc[0]["value"]
