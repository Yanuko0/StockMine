"""排程工作入口。

用法：python -m twstock.cli <工作> [--date YYYY-MM-DD]
  eod              日K、三大法人（全市場）
  minutes          全市場 1分K（Shioaji），更新近 30 天檔案，並封存到 Google 雲端硬碟
  broker           關注清單的分點資料與主力買賣超
  screen           依策略篩選全市場，存結果並推播
  margin           融資融券（官方約 21:30 公布）
  backup           資料庫備份到 Google 雲端硬碟
  backfill-daily   用 FinMind 補歷史日K（可加 --inst --margin）
  backfill-minutes 用 Shioaji 補近 N 天 1分K
"""
from __future__ import annotations

import argparse
import io
import os
from pathlib import Path
import sys
import time
import traceback
from datetime import date, datetime, timedelta

import pandas as pd

from . import bars, broker_files, company, config, db, fundamentals, summary, gdrive, push, screener, storage, tranche
from .sources import broker as broker_src
from .sources import finmind, official


class Skip(Exception):
    """還沒設定、不需要執行：記錄為「略過」，不算錯誤。"""


def _set_output(key: str, value: str) -> None:
    """讓 GitHub Actions 後續步驟知道今天是不是交易日。"""
    path = os.environ.get("GITHUB_OUTPUT")
    if path:
        with open(path, "a", encoding="utf-8") as f:
            f.write(f"{key}={value}\n")


def is_trading_day(conn, d: date) -> bool:
    df = db.query_df(conn, "select 1 from public.daily_prices where date = %s limit 1", (d,))
    return not df.empty


# ------------------------------------------------------------------ eod
def job_eod(d: date) -> str:
    tw = official.twse_quotes(d)
    tp = official.tpex_quotes(d)
    if tw.empty and tp.empty:
        _set_output("trading", "false")
        return "休市（沒有行情資料）"
    q = pd.concat([tw, tp], ignore_index=True)
    stocks = q[["code", "name", "market"]].drop_duplicates("code").copy()
    stocks["kind"] = stocks["code"].map(official.kind_of)
    stocks["updated_at"] = pd.Timestamp.now(tz="UTC")
    prices = q.drop(columns=["name", "market"])
    prices = prices[prices["close"].notna()]  # 沒成交的不存

    # 三大法人：官方通常 15:00~16:30 公布，最多等 40 分鐘
    inst = pd.DataFrame()
    for i in range(5):
        a = official.twse_institutional(d)
        b = official.tpex_institutional(d)
        if not a.empty and not b.empty:
            inst = pd.concat([a, b], ignore_index=True)
            break
        print(f"[eod] 三大法人尚未公布，10 分鐘後重試（{i + 1}/5）")
        time.sleep(600)

    with db.connect() as conn:
        db.upsert(conn, "stocks", stocks, ["code"])
        n1 = db.upsert(conn, "daily_prices", prices, ["code", "date"])
        n2 = db.upsert(conn, "institutional", inst, ["code", "date"]) if not inst.empty else 0
        prune_old(conn, d)
    _set_output("trading", "true")
    extra = []
    for fn in (company.update_company_info, fundamentals.update_taiex, summary.update, fundamentals.update_dividends,
               fundamentals.update_financials):
        try:
            with db.connect() as conn:
                extra.append(fn(conn, d))
        except Exception as e:  # noqa: BLE001  選股用的額外資料失敗，不影響日K
            traceback.print_exc()
            extra.append(f"{fn.__name__} 失敗：{e}")
    return f"日K {n1} 筆（上市 {len(tw)}、上櫃 {len(tp)}），三大法人 {n2} 筆；" + "；".join(extra)


def prune_old(conn, d: date) -> None:
    """刪掉超過保留期限的資料，讓免費資料庫維持在 500 MB 以內。"""
    db.execute(conn, "delete from public.daily_prices where date < %s",
               (d - timedelta(days=int(365.25 * config.DAILY_KEEP_YEARS)),))
    cut = d - timedelta(days=config.CHIPS_KEEP_DAYS)
    db.execute(conn, "delete from public.institutional where date < %s", (cut,))
    db.execute(conn, "delete from public.margin where date < %s", (cut,))
    db.execute(conn, "delete from public.job_runs where run_date < %s", (d - timedelta(days=90),))


# ------------------------------------------------------------------ minutes
def _merge_minutes(old: bytes | None, new: pd.DataFrame, keep: int) -> pd.DataFrame:
    frames = [new]
    if old:
        try:
            frames.insert(0, bars.from_minute_file(old))
        except Exception as e:  # noqa: BLE001
            print(f"[minutes] 舊檔損壞，重建：{e}")
    df = pd.concat(frames, ignore_index=True).drop_duplicates("ts", keep="last").sort_values("ts")
    return bars.keep_last_days(df, keep)


# 分鐘K 本機快取：GitHub Actions 用 actions/cache 保存，每天只「上傳」到 Supabase，
# 不必每天把全市場檔案下載回來（Supabase 免費方案每月下載流量只有 5 GB）
CACHE_DIR = Path(os.environ.get("MINUTE_CACHE_DIR", Path(__file__).resolve().parent.parent / ".cache" / "m1"))


# 分點檔案的本機快取放在分鐘K 快取資料夾底下，跟著同一個 GitHub 快取保存
BROKER_CACHE_DIR = CACHE_DIR / "bk"


def load_minute_files(codes: list[str]) -> dict[str, bytes | None]:
    """先讀本機快取，沒有的才從 Supabase 下載。回傳 {code: 檔案內容}。"""
    out: dict[str, bytes | None] = {}
    missing = []
    for c in codes:
        f = CACHE_DIR / f"{c}.json.gz"
        if f.exists():
            out[c] = f.read_bytes()
        else:
            missing.append(c)
    if missing:
        got = storage.download_many([f"m1/{c}.json.gz" for c in missing])
        for c in missing:
            out[c] = got.get(f"m1/{c}.json.gz")
            if out[c]:
                save_minute_cache(c, out[c])
    return out


def save_minute_cache(code: str, data: bytes) -> None:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    (CACHE_DIR / f"{code}.json.gz").write_bytes(data)


def job_minutes(d: date, start: date | None = None, codes: list[str] | None = None,
                skip_existing_days: int = 0) -> str:
    if not (config.SHIOAJI_API_KEY and config.SHIOAJI_SECRET_KEY):
        raise Skip("尚未設定永豐金鑰（SHIOAJI_API_KEY），略過分鐘K")
    from .sources.shioaji_src import ShioajiClient

    with db.connect() as conn:
        if codes is None:
            if not is_trading_day(conn, d):
                return "休市，略過"
            # 只抓今天有成交的股票（下市、停牌的不抓）
            codes = db.query_df(conn, "select code from public.daily_prices where date = %s order by code",
                                (d,))["code"].tolist()
    sj = ShioajiClient()
    start = start or d
    fetched, failed, all_rows = 0, [], []
    try:
        batch = 100
        for i in range(0, len(codes), batch):
            chunk = codes[i:i + batch]
            olds = load_minute_files(chunk)
            uploads = {}
            for c in chunk:
                old = olds.get(c)
                if skip_existing_days and old:
                    have = bars.from_minute_file(old)["ts"].dt.normalize().nunique()
                    if have >= skip_existing_days:
                        continue
                rem = sj.remaining_mb()
                if rem is not None and rem < 20:
                    print("[minutes] Shioaji 今日流量快用完，停止。明天會繼續。")
                    raise StopIteration
                try:
                    df = sj.kbars_1m(c, start, d)
                except Exception as e:  # noqa: BLE001
                    failed.append(c)
                    print(f"[minutes] {c} 失敗：{e}")
                    continue
                if df.empty:
                    continue
                merged = _merge_minutes(old, df, config.MINUTE_KEEP_DAYS)
                uploads[f"m1/{c}.json.gz"] = bars.to_minute_file(c, merged)
                save_minute_cache(c, uploads[f"m1/{c}.json.gz"])
                day = df[df["ts"].dt.date == d].copy()
                if not day.empty:
                    day.insert(0, "code", c)
                    all_rows.append(day)
                fetched += 1
            storage.upload_many(uploads)
            print(f"[minutes] {min(i + batch, len(codes))}/{len(codes)}，{sj.usage()}")
    except StopIteration:
        pass
    finally:
        usage = sj.usage()
        sj.close()

    # 封存當天全市場 1分K 到 Google 雲端硬碟
    archived = ""
    if all_rows and gdrive.enabled():
        day_df = pd.concat(all_rows, ignore_index=True)
        buf = io.BytesIO()
        day_df.to_parquet(buf, index=False, compression="zstd")
        gdrive.upload_bytes(f"分鐘K/{d:%Y}/{d:%m}", f"{d:%Y%m%d}.parquet", buf.getvalue())
        archived = "，已封存到 Google 雲端硬碟"
    return f"1分K {fetched} 檔，失敗 {len(failed)} 檔（{usage}）{archived}"


# ------------------------------------------------------------------ broker
def _broker_pool(conn, d: date) -> pd.DataFrame:
    """全市場分點範圍：上市個股與 ETF（預設全部），依成交值由大到小。"""
    since = d - timedelta(days=40)
    return db.query_df(conn, """
        select p.code, s.market, avg(p.volume) / 1000 as lots, avg(p.amount) as amt
        from public.daily_prices p join public.stocks s on s.code = p.code
        where p.date > %s and p.date <= %s and s.market = 'TWSE' and s.kind in ('stock', 'etf')
        group by p.code, s.market
        having avg(p.volume) / 1000 >= %s
        order by avg(p.amount) desc
        limit %s""", (since, d, config.BROKER_POOL_MIN_LOTS, config.BROKER_POOL_MAX))


def job_broker(d: date, extra_codes: list[str] | None = None, pool: bool = True) -> str:
    """分點（全市場上市股票，不用加自選）：
    - 每檔的分點明細存成檔案 bk/{code}.json.gz（最近 60 個交易日，個股頁「分點進出」用）
    - 主力買賣超存資料庫 main_force（一檔一天一筆，選股「關鍵券商」用）
    - 自選股另外存一份到 broker_daily（舊版查詢、Google 雲端備份用）
    """
    t0 = time.time()
    with db.connect() as conn:
        if not is_trading_day(conn, d):
            return "休市，略過"
        wl = db.query_df(conn, """select distinct w.code, s.market from public.watchlist w
                                  join public.stocks s on s.code = w.code""")
        if extra_codes:
            ex = db.query_df(conn, "select code, market from public.stocks where code = any(%s)", (extra_codes,))
            wl = pd.concat([wl, ex]).drop_duplicates("code")
        pl = _broker_pool(conn, d) if pool else pd.DataFrame(columns=["code", "market"])
    detail = set(wl["code"])
    todo = pd.concat([wl[["code", "market"]], pl[["code", "market"]]]).drop_duplicates("code")
    if todo.empty:
        return "沒有要抓分點的股票"

    use_finmind = config.FINMIND_SPONSOR and config.FINMIND_TOKEN
    if not use_finmind and d != config.today_tw():
        return "證交所分點只能查當天，無法補抓過去日期"

    skipped = [c for c, m in zip(todo["code"], todo["market"]) if m != "TWSE" and not use_finmind]
    todo = todo[[m == "TWSE" or use_finmind for m in todo["market"]]]
    budget = config.BROKER_BUDGET_MIN * 60

    def one(code: str):
        if time.time() - t0 > budget:
            return code, "timeout"
        trades = finmind.broker_report(code, d) if use_finmind else broker_src.fetch_twse_broker(code)
        if not use_finmind:
            time.sleep(0.5)
        return code, trades

    per_all, mf_all, raw_all, failed, timeouts = [], [], [], [], []
    per_by_code: dict[str, pd.DataFrame] = {}
    # 自選股先抓，再依成交值大到小抓全市場；同時開幾條連線（不要太多，以免被證交所擋）
    from concurrent.futures import ThreadPoolExecutor
    workers = 1 if use_finmind else config.BROKER_WORKERS
    with ThreadPoolExecutor(max_workers=workers) as ex:
        for code, trades in ex.map(one, todo["code"].tolist()):
            if isinstance(trades, str):
                timeouts.append(code)
                continue
            if trades is None:
                failed.append(code)
                continue
            if trades.empty:
                continue
            per, mf = broker_src.aggregate(trades, code, d)
            mf_all.append(mf)
            per_by_code[code] = per
            if code in detail:
                per_all.append(per)
                t = trades.copy()
                t.insert(0, "code", code)
                raw_all.append(t)

    with db.connect() as conn:
        n = 0
        if per_all:
            n = db.upsert(conn, "broker_daily", pd.concat(per_all, ignore_index=True), ["code", "date", "broker_id"])
        if mf_all:
            db.upsert(conn, "main_force", pd.DataFrame(mf_all), ["code", "date"])
        db.execute(conn, "delete from public.broker_daily where date < %s",
                   (d - timedelta(days=config.BROKER_KEEP_DAYS),))
        db.execute(conn, "delete from public.main_force where date < %s",
                   (d - timedelta(days=config.BROKER_KEEP_DAYS),))
    nf = 0
    try:
        nf = broker_files.update(per_by_code, d, BROKER_CACHE_DIR)
    except Exception as e:  # noqa: BLE001
        traceback.print_exc()
        failed.append(f"分點檔案上傳失敗：{e}")
    if raw_all and gdrive.enabled():
        buf = io.BytesIO()
        pd.concat(raw_all, ignore_index=True).to_parquet(buf, index=False, compression="zstd")
        gdrive.upload_bytes(f"分點/{d:%Y}/{d:%m}", f"{d:%Y%m%d}.parquet", buf.getvalue())
    mins = (time.time() - t0) / 60
    msg = f"分點 {nf} 檔（全市場上市 {len(pl)} 檔）；主力買賣超 {len(mf_all)} 檔；{mins:.0f} 分鐘"
    if skipped:
        msg += f"；上櫃 {len(skipped)} 檔略過（櫃買中心 reCAPTCHA）"
    if timeouts:
        msg += f"；時間到，{len(timeouts)} 檔沒抓"
    if failed:
        msg += f"；失敗 {len(failed)} 檔：{','.join(failed[:20])}"
    return msg


# ------------------------------------------------------------------ screen
MINUTE_TFS = set(bars.MINUTE_TFS)


def job_screen(d: date, only: list[str] | None = None, live: dict | None = None) -> str:
    """選股。
    only：只跑這幾個策略（網頁按「立即選股」時）；live：盤中資料
      {"ts": 時間, "today": 今天到目前為止的日K（code, open, high, low, close, volume 股）, "m1": {code: 今天的 1分K}}
    盤中結果存 screen_live；盤後存 screen_results。只有每天的正式排程（only/live 都沒給）才跑建倉提醒、補財報。
    """
    full = only is None and live is None
    with db.connect() as conn:
        if live is None and not is_trading_day(conn, d):
            return "休市，略過"
        strategies = db.query_df(conn, "select id, name, conditions, notify, owner from public.strategies"
                                 + (" where id = any(%s::uuid[])" if only else ""), (only,) if only else None)
        if strategies.empty:
            return "沒有任何策略" + (_run_tranche(d) + _more_financials(d, 1800) if full else "")
        offset = int(db.get_setting(conn, "deduct_offset", 0) or 0)
        strat_list = strategies["conditions"].tolist()
        tfs_needed = screener.needed_timeframes(strat_list)

        # 日K：有月K條件時需要多年資料
        years = config.DAILY_KEEP_YEARS if "M" in tfs_needed else (2 if "W" in tfs_needed else 1.2)
        since = d - timedelta(days=int(365 * years))
        daily = db.query_df(conn, """select code, date, open, high, low, close, volume
                                     from public.daily_prices where date >= %s and date <= %s
                                     order by code, date""", (since, d))
        try:
            meta = db.query_df(conn, "select code, name, market, kind, industry, shares, board_pct from public.stocks").set_index("code")
        except Exception:  # noqa: BLE001  還沒跑 008 升級
            conn.rollback()
            meta = db.query_df(conn, "select code, name, market, kind, industry, shares, null::numeric as board_pct from public.stocks").set_index("code")
        names = meta["name"].to_dict()
        inst = db.query_df(conn, "select * from public.institutional where date > %s", (d - timedelta(days=45),))
        mf = db.query_df(conn, "select * from public.main_force where date > %s", (d - timedelta(days=45),))
        kinds_needed = {c.get("kind") for s in strat_list for c in screener.iter_conditions(s)}
        owners = [o for o in strategies["owner"].dropna().unique().tolist()]
        draws = db.query_df(conn, """select code, kind, points, created_by from public.drawings
                                     where kind in ('hline','rect') and created_by = any(%s::uuid[])""", (owners,))
        try:
            ugroups = db.query_df(conn, "select owner, name, codes from public.user_groups where owner = any(%s::uuid[])", (owners,))
        except Exception:  # noqa: BLE001  還沒跑 006 升級
            conn.rollback()
            ugroups = pd.DataFrame(columns=["owner", "name", "codes"])
        fyears = list(range(d.year - 5, d.year))  # 近 5 個完整年度
        yields, margins = {}, {}
        if "div_yield" in kinds_needed:
            yields = fundamentals.yearly_yields(
                db.query_df(conn, "select code, ex_date, cash, pre_close from public.dividends where ex_date >= %s",
                            (date(fyears[0], 1, 1),)), fyears)
        quarters = {}
        if "op_ratio" in kinds_needed:
            try:
                fq = db.query_df(conn, """select distinct on (code) code, op_income, pretax from public.fin_quarter
                                          order by code, date desc""")
                quarters = {r.code: {"op_income": r.op_income, "pretax": r.pretax} for r in fq.itertuples()}
            except Exception:  # noqa: BLE001
                conn.rollback()
        if "net_margin" in kinds_needed:
            margins = fundamentals.yearly_margins(
                db.query_df(conn, "select * from public.fin_yearly where year >= %s", (fyears[0],)), fyears)

    if live is not None and not live["today"].empty:  # 盤中：把今天到目前為止的 K 棒接上去
        t = live["today"].assign(date=d)
        daily = pd.concat([daily[daily["date"] != d], t[["code", "date", "open", "high", "low", "close", "volume"]]],
                          ignore_index=True).sort_values(["code", "date"])
    for c in ("open", "high", "low", "close"):
        daily[c] = daily[c].astype(float)
    daily["volume"] = daily["volume"].astype(float) / 1000  # 股 → 張（選股條件的量都用張）
    daily_g = dict(tuple(daily.groupby("code")))
    market = screener.Series(daily_g["TAIEX"]) if "TAIEX" in daily_g else None
    inst_g = dict(tuple(inst.groupby("code"))) if not inst.empty else {}
    # 法人買賣超排行（全市場）：{code: {"foreign:20:buy": 名次}}
    rank_keys = {f"{c.get('who', 'foreign')}:{int(c.get('days', 1))}:{c.get('dir', 'buy')}"
                 for st in strat_list for c in screener.iter_conditions(st) if c.get("kind") == "inst_rank"}
    inst_rank: dict[str, dict] = {}
    if rank_keys and not inst.empty:
        dates = sorted(inst["date"].unique())
        for key in rank_keys:
            who, n, dr = key.split(":")
            col = {"foreign": "foreign_net", "trust": "trust_net", "dealer": "dealer_net", "total": "total_net"}[who]
            recent = inst[inst["date"].isin(dates[-int(n):])]
            tot = recent.groupby("code")[col].sum()
            tot = tot[tot > 0] if dr == "buy" else -tot[tot < 0]
            for code, rk in tot.rank(ascending=False, method="min").items():
                inst_rank.setdefault(code, {})[key] = int(rk)
    mf_g = dict(tuple(mf.groupby("code"))) if not mf.empty else {}

    draw_g: dict = {}
    for r in draws.to_dict("records"):
        draw_g.setdefault((r["created_by"], r["code"]), []).append(r)
    code_groups: dict = {}
    group_sizes: dict = {}
    for r in ugroups.itertuples():
        group_sizes.setdefault(r.owner, {})[r.name] = len(r.codes or [])
        for cd in r.codes or []:
            code_groups.setdefault((r.owner, cd), set()).add(r.name)

    codes = [c for c, g in daily_g.items() if g["date"].iloc[-1] == d and meta["kind"].get(c) != "index"]
    minute_raw = {}
    if tfs_needed & MINUTE_TFS:
        minute_raw = load_minute_files(codes)

    hits: dict[int, list] = {i: [] for i in range(len(strategies))}
    # 條件漏斗：每條條件單獨通過幾檔、依序累積通過幾檔
    single = {i: [0] * len(s.get("conditions") or []) for i, s in enumerate(strat_list)}
    cumul = {i: [0] * len(s.get("conditions") or []) for i, s in enumerate(strat_list)}
    # 逐檔診斷：每檔每條條件成不成立（"1101…"）＋ 日K 根數、有沒有分K → 網頁可以查「這檔為什麼沒選到」
    diag: dict[int, dict] = {i: {} for i in range(len(strat_list))}
    for code in codes:
        g = daily_g[code]
        tfs: dict[str, screener.Series] = {"D": screener.Series(g)}
        if "W" in tfs_needed:
            tfs["W"] = screener.Series(bars.resample_daily(g, "W"))
        if "M" in tfs_needed:
            tfs["M"] = screener.Series(bars.resample_daily(g, "M"))
        raw = minute_raw.get(code)
        today_m1 = (live or {}).get("m1", {}).get(code)
        if raw or today_m1 is not None:
            m1 = bars.from_minute_file(raw) if raw else pd.DataFrame(columns=["ts", "open", "high", "low", "close", "volume"])
            if today_m1 is not None and not today_m1.empty:  # 盤中：接上今天的 1分K
                m1 = pd.concat([m1[m1["ts"].dt.date != d], today_m1], ignore_index=True).sort_values("ts")
            for tf in tfs_needed & MINUTE_TFS:
                n = bars.MINUTE_TFS[tf]
                df = m1 if n == 1 else bars.resample_minutes(m1, n)
                if n == 1:
                    df = df.assign(ts=df["ts"] - pd.Timedelta(minutes=1))
                tfs[tf] = screener.Series(df)
        m = meta.loc[code] if code in meta.index else None
        chips = {"inst": inst_g.get(code), "mf": mf_g.get(code), "offset": offset, "market": market,
                 "meta": {"kind": m["kind"], "market": m["market"],
                          "board_pct": None if m is None or pd.isna(m["board_pct"]) else float(m["board_pct"])} if m is not None else {},
                 "inst_rank": inst_rank.get(code, {}), "quarter": quarters.get(code),
                 "yields": yields.get(code, [0.0] * 5 if yields else None), "margins": margins.get(code)}
        for i, s in enumerate(strat_list):
            o = strategies["owner"].iloc[i]
            chips["draw"] = draw_g.get((o, code), [])
            chips["groups"] = code_groups.get((o, code), set())
            chips["group_sizes"] = group_sizes.get(o, {})
            parts = screener.eval_parts(s, tfs, chips)
            diag[i][code] = "".join("1" if x else "0" for x in parts) + f"|{len(g)}|{'m' if (raw or today_m1 is not None) else ''}"
            alive = True
            for j, ok in enumerate(parts):
                single[i][j] += ok
                alive = alive and ok
                cumul[i][j] += alive
            if screener.combine(s, parts):
                last = g.iloc[-1]
                prev = g.iloc[-2]["close"] if len(g) > 1 else None
                chg = round((last["close"] / prev - 1) * 100, 2) if prev else None
                sh = m["shares"] if m is not None else None
                mcap = round(float(sh) * float(last["close"]) / 1e8, 1) if sh is not None and pd.notna(sh) else None
                hits[i].append({"code": code, "name": names.get(code, ""), "close": float(last["close"]),
                                "chg_pct": chg, "volume": int(last["volume"] or 0),  # 張
                                "industry": (m["industry"] if m is not None and pd.notna(m["industry"]) else None),
                                "mcap": mcap,  # 市值（億）
                                "tags": screener.matched_labels(s, tfs, chips)})

    rows, notify = [], {}
    for i, s in enumerate(strategies.itertuples()):
        uses_min = bool(screener.needed_timeframes([s.conditions]) & MINUTE_TFS)
        info = {"run_at": datetime.now(config.TW_TZ).isoformat(timespec="seconds"),  # 網頁用來判斷「重跑完成了」
                "total": len(codes), "minute_codes": len(minute_raw) if uses_min else None,
                "funnel": {"single": single[i], "cumul": cumul[i]}, "diag": diag[i],
                "coverage": {"minute": len(minute_raw), "inst": len(inst_g), "mainforce": len(mf_g),
                             "yields": len(yields), "margins": sum(1 for v in margins.values() if v and all(x is not None for x in v))}}
        empty = [n for c in screener.iter_conditions(s.conditions) if c.get("kind") == "in_group"
                 for n in c.get("names") or [] if not group_sizes.get(s.owner, {}).get(n)]
        if empty:
            info["empty_groups"] = empty
        if live is not None:
            info["live"] = True
            rows.append({"strategy_id": s.id, "ts": live["ts"], "items": hits[i], "meta": info})
        else:
            rows.append({"strategy_id": s.id, "date": d, "items": hits[i], "meta": info})
        if s.notify and hits[i]:
            notify.setdefault(s.owner, []).append((s.id, s.name, [x["code"] for x in hits[i]]))
    with db.connect() as conn:
        if live is not None:
            # 盤中：只推播「這次新出現」的股票；只保留當天的盤中結果
            prev = db.query_df(conn, """select distinct on (strategy_id) strategy_id, items from public.screen_live
                                        where ts::date = %s order by strategy_id, ts desc""", (d,))
            before = {str(r.strategy_id): {x["code"] for x in (r.items or [])} for r in prev.itertuples()}
            db.upsert(conn, "screen_live", pd.DataFrame(rows), ["strategy_id", "ts"])
            db.execute(conn, "delete from public.screen_live where ts < %s", (live["ts"] - timedelta(days=2),))
            for owner, lst in notify.items():
                lines = []
                for sid, name, cs in lst:
                    new = [c for c in cs if c not in before.get(str(sid), set())]
                    if new:
                        shown = "、".join(f"{c} {names.get(c, '')}" for c in new[:5])
                        lines.append(f"{name}：新增 {len(new)} 檔（{shown}）")
                if lines:
                    push.send_to_user(conn, owner, f"盤中選股 {live['ts']:%H:%M}", "\n".join(lines), "/screener")
        else:
            db.upsert(conn, "screen_results", pd.DataFrame(rows), ["strategy_id", "date"])
            if full:
                for owner, lst in notify.items():  # 策略是私人的：只通知策略的主人
                    push.send_to_user(conn, owner, f"{d:%m/%d} 選股結果", "\n".join(f"{n}：{len(cs)} 檔" for _, n, cs in lst), "/screener")
    msg = "；".join(f"{len(hits[i])} 檔" for i, s in enumerate(strategies.itertuples()))
    return f"{len(strategies)} 個策略（{msg}）" + (_run_tranche(d) + _more_financials(d, 1800) if full else "")


def market_open_now() -> bool:
    """台灣時間週一到週五 09:00~13:50 視為盤中（13:30 收盤後到盤後資料出來前，用盤中最後價格）（國定假日由快照日期再判斷）。"""
    now = datetime.now(config.TW_TZ)
    return now.weekday() < 5 and (9, 0) <= (now.hour, now.minute) < (13, 50)


def live_data(d: date, codes: list[str], need_minutes: bool) -> dict:
    """用永豐 Shioaji 抓盤中資料：全市場快照（今天的日K）＋（需要時）今天的 1分K。"""
    if not (config.SHIOAJI_API_KEY and config.SHIOAJI_SECRET_KEY):
        raise Skip("尚未設定永豐金鑰（SHIOAJI_API_KEY），無法盤中選股")
    from .sources.shioaji_src import ShioajiClient
    sj = ShioajiClient()
    try:
        snap = sj.snapshots(codes)
        snap = snap[(snap["close"] > 0) & (snap["volume"] > 0)]
        snap = snap[snap["ts"].dt.date == d]  # 休市日的快照是前一天的：不算
        today = snap.assign(volume=snap["volume"] * 1000)[["code", "open", "high", "low", "close", "volume"]]
        m1: dict = {}
        if need_minutes:
            for c in today["code"]:
                rem = sj.remaining_mb()
                if rem is not None and rem < 40:
                    print("[live] Shioaji 今日流量快用完，分K 只抓到這裡")
                    break
                try:
                    df = sj.kbars_1m(c, d, d)
                except Exception as e:  # noqa: BLE001
                    print(f"[live] {c} 分K 失敗：{e}")
                    continue
                if not df.empty:
                    m1[c] = df[df["ts"].dt.date == d]
        usage = sj.usage()
    finally:
        sj.close()
    ts = datetime.now(config.TW_TZ)
    return {"ts": ts, "today": today, "m1": m1, "usage": usage}


def job_live(d: date, only: list[str] | None = None) -> str:
    """盤中選股（每 30 分鐘）：用盤中價格跑全部（或指定的）策略，結果存 screen_live。"""
    with db.connect() as conn:
        strategies = db.query_df(conn, "select conditions from public.strategies"
                                 + (" where id = any(%s::uuid[])" if only else ""), (only,) if only else None)
        last = db.query_df(conn, "select max(date) as d from public.daily_prices where code <> 'TAIEX' and date < %s", (d,))["d"][0]
        codes = db.query_df(conn, """select p.code from public.daily_prices p join public.stocks s on s.code = p.code
                                     where p.date = %s and s.kind <> 'index'""", (last,))["code"].tolist()
    if strategies.empty:
        return "沒有任何策略"
    need_min = bool(screener.needed_timeframes(strategies["conditions"].tolist()) & MINUTE_TFS)
    live = live_data(d, codes, need_min)
    if live["today"].empty:
        raise Skip("今天沒有盤中資料（休市、尚未開盤，或永豐快照抓不到）")
    msg = job_screen(d, only=only, live=live)
    return f"盤中 {live['ts']:%H:%M}：{msg}；快照 {len(live['today'])} 檔、分K {len(live['m1'])} 檔（{live['usage']}）"


def job_screen_now(d: date, strategy: str) -> str:
    """網頁按「立即選股」：盤中用盤中資料，盤後用最新收盤資料，只跑這一個策略。"""
    if market_open_now():
        try:
            return job_live(d, only=[strategy])
        except Exception as e:  # noqa: BLE001  盤中資料抓不到時，至少用最新收盤資料跑一次
            traceback.print_exc()
            note = f"盤中資料抓不到（{e}），改用最新收盤資料；"
    else:
        note = ""
    with db.connect() as conn:
        last = db.query_df(conn, "select max(date) as d from public.daily_prices where code <> 'TAIEX' and date <= %s", (d,))["d"][0]
    return f"{note}{last}：" + job_screen(last, only=[strategy])


def _more_financials(d: date, budget: int) -> str:
    """有空檔就多更新一些財報（FinMind 免費版一小時 600 次，分散在每天幾個排程裡跑）。"""
    try:
        with db.connect() as conn:
            return "；" + fundamentals.update_financials(conn, d, budget_sec=budget)
    except Exception as e:  # noqa: BLE001
        traceback.print_exc()
        return f"；財報更新失敗：{e}"


def _run_tranche(d: date) -> str:
    try:
        return "；" + tranche.run(d, load_minute_files)
    except Exception as e:  # noqa: BLE001  建倉提醒失敗不影響選股結果
        traceback.print_exc()
        return f"；建倉提醒失敗：{e}"


# ------------------------------------------------------------------ margin
def job_margin(d: date, backfill_min: int = 14) -> str:
    """當天的融資融券；有空檔就回補過去缺的日子（證交所 / 櫃買中心可以查過去日期，一天一次查全市場）。"""
    t0 = time.time()
    a, b = official.twse_margin(d), official.tpex_margin(d)
    n = 0
    if not (a.empty and b.empty):
        with db.connect() as conn:
            n = db.upsert(conn, "margin", pd.concat([a, b], ignore_index=True), ["code", "date"])
    msg = f"融資融券 {n} 筆" if n else "當天沒有融資融券資料（休市或尚未公布）"

    # 回補：有三大法人資料的交易日（近 CHIPS_KEEP_DAYS 天），融資融券還沒有的日子，由新到舊
    with db.connect() as conn:
        days = db.query_df(conn, """select distinct i.date from public.institutional i
                                    where i.date >= %s and i.date < %s
                                      and not exists (select 1 from public.margin m where m.date = i.date)
                                    order by i.date desc""", (d - timedelta(days=config.CHIPS_KEEP_DAYS), d))["date"].tolist()
    filled = 0
    for day in days:
        if time.time() - t0 > backfill_min * 60:
            break
        try:
            x, y = official.twse_margin(day), official.tpex_margin(day)
        except Exception as e:  # noqa: BLE001
            print(f"[margin] {day} 失敗：{e}")
            continue
        if x.empty and y.empty:
            continue
        with db.connect() as conn:
            db.upsert(conn, "margin", pd.concat([x, y], ignore_index=True), ["code", "date"])
        filled += 1
        time.sleep(2)
    if days:
        left = len(days) - filled
        msg += f"；回補 {filled} 天" + (f"（還有 {left} 天，下次繼續）" if left > 0 else "（已補齊）")
    return msg + _more_financials(d, max(0, int(18 * 60 - (time.time() - t0))) if time.time() - t0 < 15 * 60 else 0)


# ------------------------------------------------------------------ backup
BACKUP_TABLES = ["stocks", "lines", "watchlist", "strategies", "screen_results", "profiles",
                 "app_settings", "main_force", "institutional", "margin", "broker_daily", "daily_prices"]


def _to_text(v):
    import json
    if v is None:
        return None
    if isinstance(v, (dict, list)):
        return json.dumps(v, ensure_ascii=False, default=str)
    return str(v)


def job_backup(d: date) -> str:
    if not gdrive.enabled():
        return "未設定 Google 雲端硬碟，略過"
    with db.connect() as conn:
        for t in BACKUP_TABLES:
            df = db.query_df(conn, f"select * from public.{t}")
            for col in df.columns:
                if df[col].dtype == object:  # uuid / 日期 / jsonb / Decimal → 文字
                    df[col] = df[col].map(_to_text)
            buf = io.BytesIO()
            df.to_parquet(buf, index=False, compression="zstd")
            gdrive.upload_bytes(f"資料庫備份/{d:%Y%m%d}", f"{t}.parquet", buf.getvalue())
    # 只保留最近 8 份
    folders = gdrive.list_files("資料庫備份")
    for f in folders[:-8]:
        gdrive.delete(f["id"])
    return f"已備份 {len(BACKUP_TABLES)} 個資料表"


# ------------------------------------------------------------------ backfill
def job_backfill_daily(start: date, end: date, with_inst: bool, with_margin: bool, resume: bool) -> str:
    with db.connect() as conn:
        stocks = db.query_df(conn, "select code from public.stocks")
        if stocks.empty:
            info = finmind.stock_info()
            info = info[info["code"].map(official.keep_code)]
            info["kind"] = info["code"].map(official.kind_of)
            db.upsert(conn, "stocks", info, ["code"])
            stocks = info
        done = set()
        if resume:
            done = set(db.query_df(conn, "select code from public.daily_prices group by code having min(date) <= %s",
                                   (start + timedelta(days=10),))["code"])
    codes = [c for c in stocks["code"].tolist() if c not in done]
    print(f"[backfill] 共 {len(codes)} 檔要補（每檔約 6 秒，FinMind 免費額度限制）")
    n = 0
    for i, c in enumerate(codes):
        try:
            frames = {"daily_prices": finmind.daily_prices(c, start, end)}
            chips_start = max(start, end - timedelta(days=config.CHIPS_KEEP_DAYS))  # 籌碼只補近 400 天
            if with_inst:
                frames["institutional"] = finmind.institutional(c, chips_start, end)
            if with_margin:
                frames["margin"] = finmind.margin(c, chips_start, end)
            with db.connect() as conn:
                for t, df in frames.items():
                    if not df.empty:
                        db.upsert(conn, t, df, ["code", "date"])
            n += 1
        except Exception as e:  # noqa: BLE001
            print(f"[backfill] {c} 失敗：{e}")
        if i % 50 == 0:
            print(f"[backfill] {i}/{len(codes)}")
    return f"補完 {n} 檔"


# ------------------------------------------------------------------ main
def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="twstock")
    p.add_argument("job")
    p.add_argument("--date")
    p.add_argument("--start")
    p.add_argument("--end")
    p.add_argument("--days", type=int, default=30)
    p.add_argument("--codes", help="逗號分隔的股票代號")
    p.add_argument("--inst", action="store_true")
    p.add_argument("--margin", action="store_true")
    p.add_argument("--resume", action="store_true")
    p.add_argument("--strategy", help="策略 ID（立即選股）")
    a = p.parse_args(argv)
    d = config.parse_date(a.date)
    codes = [c.strip() for c in a.codes.split(",") if c.strip()] if a.codes else None

    try:
        if a.job == "eod":
            msg = job_eod(d)
        elif a.job == "minutes":
            msg = job_minutes(d, codes=codes)
        elif a.job == "broker":
            msg = job_broker(d, codes, pool=not codes)  # 指定股票（立即抓分點）時只抓那幾檔
        elif a.job == "screen":
            msg = job_screen(d)
        elif a.job == "screen-now":
            msg = job_screen_now(d, a.strategy)
        elif a.job == "intraday":
            if not market_open_now():
                raise Skip("不在盤中時間")
            msg = job_live(d)
        elif a.job == "margin":
            msg = job_margin(d)
        elif a.job == "backup":
            msg = job_backup(d)
        elif a.job == "backfill-daily":
            start = config.parse_date(a.start) if a.start else d - timedelta(days=int(365.25 * config.DAILY_KEEP_YEARS))
            end = config.parse_date(a.end) if a.end else d
            msg = job_backfill_daily(start, end, a.inst, a.margin, a.resume)
        elif a.job == "backfill-minutes":
            # 往前推 days 個「日曆日 × 1.5」，確保涵蓋足夠交易日
            start = d - timedelta(days=int(a.days * 1.5) + 3)
            msg = job_minutes(d, start=start, codes=codes or _all_codes(), skip_existing_days=a.days)
        else:
            p.error(f"未知的工作：{a.job}")
            return 2
        print(f"[{a.job}] 完成：{msg}")
        db.log_job(a.job, d, "ok", msg)
        return 0
    except Skip as e:
        print(f"[{a.job}] 略過：{e}")
        db.log_job(a.job, d, "skipped", str(e))
        return 0
    except Exception as e:  # noqa: BLE001
        traceback.print_exc()
        db.log_job(a.job, d, "error", f"{e}")
        return 1


def _all_codes() -> list[str]:
    with db.connect() as conn:
        return db.query_df(conn, "select code from public.stocks order by code")["code"].tolist()


if __name__ == "__main__":
    sys.exit(main())
