-- =============================================================
-- 升級 005：選股用的基本面資料（現金股利、財報年度數字）
-- SQL Editor 貼上整份 → Run（可重複執行）
-- =============================================================

-- 除權息紀錄（證交所 / 櫃買中心「除權除息計算結果表」，每週自動更新）
create table if not exists public.dividends (
  code       text not null,
  ex_date    date not null,
  cash       numeric(12,6),   -- 每股現金股利（元）
  pre_close  numeric(12,2),   -- 除權息前收盤價
  primary key (code, ex_date)
);

-- 年度財報（FinMind 免費版，每天輪流更新約 100 檔）
create table if not exists public.fin_yearly (
  code        text not null,
  year        integer not null,
  revenue     numeric(20,0),
  net_income  numeric(20,0),   -- 稅後淨利
  quarters    integer,         -- 這一年有幾季資料（4 = 完整）
  primary key (code, year)
);
create table if not exists public.fin_status (
  code        text primary key,
  updated_at  timestamptz not null default now()
);

alter table public.dividends  enable row level security;
alter table public.fin_yearly enable row level security;
alter table public.fin_status enable row level security;
drop policy if exists read_auth on public.dividends;
drop policy if exists read_auth on public.fin_yearly;
create policy read_auth on public.dividends  for select to authenticated using (true);
create policy read_auth on public.fin_yearly for select to authenticated using (true);

-- 加權指數放在 stocks / daily_prices（代號 TAIEX），選股的「大盤條件」會用到
insert into public.stocks (code, name, market, kind) values ('TAIEX', '加權指數', 'TWSE', 'index')
on conflict (code) do nothing;
