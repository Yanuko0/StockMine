-- =============================================================
-- 掘股 StockMine — Supabase 資料庫結構
-- 使用方式：Supabase 後台 → SQL Editor → 貼上整份 → Run
-- 可重複執行（已存在的物件會略過）。新專案只要執行這一份；已執行過舊版的專案再執行 002_drawings_broker.sql
-- =============================================================

-- ---------- 基本資料 ----------
create table if not exists public.stocks (
  code        text primary key,
  name        text not null,
  market      text not null check (market in ('TWSE','TPEX')),
  kind        text not null default 'stock',        -- stock / etf
  updated_at  timestamptz not null default now()
);

-- 日K（未還原價；成交量單位：股）
create table if not exists public.daily_prices (
  code    text not null,
  date    date not null,
  open    numeric(12,2),
  high    numeric(12,2),
  low     numeric(12,2),
  close   numeric(12,2),
  volume  bigint,
  amount  bigint,
  trades  integer,
  primary key (code, date)
);

-- 三大法人（單位：股）
create table if not exists public.institutional (
  code         text not null,
  date         date not null,
  foreign_net  bigint,
  trust_net    bigint,
  dealer_net   bigint,
  total_net    bigint,
  primary key (code, date)
);

-- 融資融券（單位：張）
create table if not exists public.margin (
  code            text not null,
  date            date not null,
  margin_buy      integer,
  margin_sell     integer,
  margin_balance  integer,
  short_sell      integer,
  short_buy       integer,
  short_balance   integer,
  primary key (code, date)
);

-- 券商分點（只存關注清單，保留近 90 天，更早的封存到 Google 雲端硬碟）
create table if not exists public.broker_daily (
  code         text not null,
  date         date not null,
  broker_id    text not null,
  broker_name  text,
  buy          bigint,   -- 股
  sell         bigint,   -- 股
  net          bigint,   -- 股
  avg_price    numeric(12,2),
  primary key (code, date, broker_id)
);

-- 主力買賣超（買超前15 + 賣超前15 的淨額，單位：股）
create table if not exists public.main_force (
  code        text not null,
  date        date not null,
  top_buy     bigint,
  top_sell    bigint,
  net         bigint,
  broker_cnt  integer,
  primary key (code, date)
);

-- ---------- 使用者相關 ----------
create table if not exists public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  display_name  text,
  created_at    timestamptz not null default now()
);

-- 共享水平線（支撐 / 壓力）
create table if not exists public.lines (
  id               uuid primary key default gen_random_uuid(),
  code             text not null,
  price            numeric(12,2) not null,
  color            text not null default '#ff4d4f',
  label            text,
  timeframes       text[],                 -- null = 所有週期都顯示
  created_by       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_by_name  text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists lines_code_idx on public.lines (code);

-- 關注清單（分點資料只抓這裡面的股票）
create table if not exists public.watchlist (
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  code        text not null,
  created_at  timestamptz not null default now(),
  primary key (user_id, code)
);

-- 選股策略
create table if not exists public.strategies (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  conditions  jsonb not null,
  notify      boolean not null default false,
  owner       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  owner_name  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- 每日篩選結果
create table if not exists public.screen_results (
  strategy_id  uuid not null references public.strategies(id) on delete cascade,
  date         date not null,
  items        jsonb not null,         -- [{code,name,close,chg_pct}]
  created_at   timestamptz not null default now(),
  primary key (strategy_id, date)
);

-- 推播訂閱
create table if not exists public.push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  endpoint    text not null unique,
  p256dh      text not null,
  auth        text not null,
  created_at  timestamptz not null default now()
);

-- 排程執行紀錄（網頁上可看到每天有沒有抓成功）
create table if not exists public.job_runs (
  id          bigserial primary key,
  job         text not null,
  run_date    date not null,
  status      text not null,           -- ok / error / skipped
  message     text,
  created_at  timestamptz not null default now()
);

-- 全域設定（例如：月扣三低使用幾月均線）
create table if not exists public.app_settings (
  key    text primary key,
  value  jsonb not null
);
insert into public.app_settings (key, value) values
  ('deduct3low', '{"ma": 5}'),
  ('deduct_offset', '0')
on conflict (key) do nothing;

-- ---------- 權限（RLS）：只有登入的人能讀；寫入限自己的資料 ----------
alter table public.stocks             enable row level security;
alter table public.daily_prices       enable row level security;
alter table public.institutional      enable row level security;
alter table public.margin             enable row level security;
alter table public.broker_daily       enable row level security;
alter table public.main_force         enable row level security;
alter table public.profiles           enable row level security;
alter table public.lines              enable row level security;
alter table public.watchlist          enable row level security;
alter table public.strategies         enable row level security;
alter table public.screen_results     enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.job_runs           enable row level security;
alter table public.app_settings       enable row level security;

do $$
declare t text;
begin
  -- 市場資料：登入者可讀，寫入只有排程程式（service role 會略過 RLS）
  foreach t in array array['stocks','daily_prices','institutional','margin','broker_daily',
                           'main_force','screen_results','job_runs','app_settings','profiles',
                           'lines','strategies'] loop
    if not exists (select 1 from pg_policies where tablename = t and policyname = 'read_auth') then
      execute format('create policy read_auth on public.%I for select to authenticated using (true)', t);
    end if;
  end loop;
end $$;

-- 設定：登入者可修改
drop policy if exists settings_write on public.app_settings;
create policy settings_write on public.app_settings for all to authenticated using (true) with check (true);

-- 個人資料：自己
drop policy if exists profiles_own on public.profiles;
create policy profiles_own on public.profiles for all to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- 水平線：大家看得到；只能新增 / 修改 / 刪除自己畫的
drop policy if exists lines_insert on public.lines;
drop policy if exists lines_update on public.lines;
drop policy if exists lines_delete on public.lines;
create policy lines_insert on public.lines for insert to authenticated with check (created_by = auth.uid());
create policy lines_update on public.lines for update to authenticated using (created_by = auth.uid());
create policy lines_delete on public.lines for delete to authenticated using (created_by = auth.uid());

-- 策略：大家看得到；只能改自己的
drop policy if exists strategies_insert on public.strategies;
drop policy if exists strategies_update on public.strategies;
drop policy if exists strategies_delete on public.strategies;
create policy strategies_insert on public.strategies for insert to authenticated with check (owner = auth.uid());
create policy strategies_update on public.strategies for update to authenticated using (owner = auth.uid());
create policy strategies_delete on public.strategies for delete to authenticated using (owner = auth.uid());

-- 關注清單、推播訂閱：只看得到自己的
drop policy if exists watchlist_own on public.watchlist;
create policy watchlist_own on public.watchlist for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists push_own on public.push_subscriptions;
create policy push_own on public.push_subscriptions for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------- 即時同步：畫線改動時，其他人畫面會自動更新 ----------
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'lines') then
    alter publication supabase_realtime add table public.lines;
  end if;
end $$;

-- ---------- 分鐘K 檔案儲存空間 ----------
insert into storage.buckets (id, name, public)
values ('minute', 'minute', false)
on conflict (id) do nothing;

drop policy if exists minute_read on storage.objects;
create policy minute_read on storage.objects for select to authenticated
  using (bucket_id = 'minute');

-- ---------- 新使用者自動建立 profile ----------
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();


-- =============================================================
-- 升級 002：多種畫線工具 + 分點期間彙總
-- 已經執行過 schema.sql 的專案：到 SQL Editor 貼上這份 → Run（可重複執行）
-- =============================================================

-- ---------- 畫線（水平線、趨勢線、射線、箱型、通道、黃金分割、文字） ----------
-- points：[{ "t": 時間(UTC 毫秒), "v": 價格 }, ...]
-- 用「時間 + 價格」記錄，所以在 1分K 畫的線，切到日K / 週K / 月K 也會出現在對應位置
create table if not exists public.drawings (
  id               uuid primary key default gen_random_uuid(),
  code             text not null,
  kind             text not null check (kind in ('hline','segment','ray','rect','channel','fib','text')),
  points           jsonb not null,
  color            text not null default '#ff4d4f',
  label            text,
  created_by       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_by_name  text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists drawings_code_idx on public.drawings (code);

alter table public.drawings enable row level security;
drop policy if exists drawings_read on public.drawings;
drop policy if exists drawings_insert on public.drawings;
drop policy if exists drawings_update on public.drawings;
drop policy if exists drawings_delete on public.drawings;
create policy drawings_read   on public.drawings for select to authenticated using (true);
create policy drawings_insert on public.drawings for insert to authenticated with check (created_by = auth.uid());
create policy drawings_update on public.drawings for update to authenticated using (created_by = auth.uid());
create policy drawings_delete on public.drawings for delete to authenticated using (created_by = auth.uid());

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'drawings') then
    alter publication supabase_realtime add table public.drawings;
  end if;
end $$;

-- 舊的水平線搬到新表（只搬一次）
insert into public.drawings (id, code, kind, points, color, label, created_by, created_by_name, created_at, updated_at)
select l.id, l.code, 'hline',
       jsonb_build_array(jsonb_build_object('t', (extract(epoch from l.created_at) * 1000)::bigint, 'v', l.price)),
       l.color, l.label, l.created_by, l.created_by_name, l.created_at, l.updated_at
from public.lines l
where not exists (select 1 from public.drawings d where d.id = l.id);

-- ---------- 分點：近 N 個交易日累計，回傳買超前 N 名與賣超前 N 名 ----------
create or replace function public.broker_summary(p_code text, p_days int default 1, p_top int default 15)
returns table (
  side text, rank int, broker_id text, broker_name text,
  buy bigint, sell bigint, net bigint, avg_price numeric, days int,
  start_date date, end_date date
)
language sql stable
set search_path = public
as $$
  with d as (
    select distinct date from broker_daily where code = p_code order by date desc limit greatest(p_days, 1)
  ),
  agg as (
    select b.broker_id, max(b.broker_name) as broker_name,
           sum(b.buy)::bigint as buy, sum(b.sell)::bigint as sell, sum(b.net)::bigint as net,
           case when sum(b.buy + b.sell) > 0
                then round(sum(coalesce(b.avg_price, 0) * (b.buy + b.sell)) / sum(b.buy + b.sell), 2) end as avg_price,
           count(*)::int as days
    from broker_daily b
    where b.code = p_code and b.date in (select date from d)
    group by b.broker_id
  ),
  ranked as (
    select 'buy'::text as side, (row_number() over (order by net desc))::int as rank, agg.* from agg where net > 0
    union all
    select 'sell'::text, (row_number() over (order by net asc))::int, agg.* from agg where net < 0
  )
  select r.side, r.rank, r.broker_id, r.broker_name, r.buy, r.sell, r.net, r.avg_price, r.days,
         (select min(date) from d), (select max(date) from d)
  from ranked r
  where r.rank <= p_top
  order by r.side, r.rank;
$$;

-- 單一分點在這檔股票的每日進出
create or replace function public.broker_history(p_code text, p_broker text, p_days int default 20)
returns table (date date, buy bigint, sell bigint, net bigint, avg_price numeric)
language sql stable
set search_path = public
as $$
  select date, buy, sell, net, avg_price
  from broker_daily
  where code = p_code and broker_id = p_broker
  order by date desc
  limit p_days;
$$;

grant execute on function public.broker_summary(text, int, int) to authenticated;
grant execute on function public.broker_history(text, text, int) to authenticated;


-- =============================================================
-- 升級 004：分批建倉 + 策略隱私
-- SQL Editor 貼上整份 → Run（可重複執行）
-- =============================================================

-- ---------- 隱私：選股策略與結果只有自己看得到 ----------
drop policy if exists read_auth on public.strategies;
drop policy if exists strategies_read_own on public.strategies;
create policy strategies_read_own on public.strategies for select to authenticated
  using (owner = auth.uid());

drop policy if exists read_auth on public.screen_results;
drop policy if exists screen_results_read_own on public.screen_results;
create policy screen_results_read_own on public.screen_results for select to authenticated
  using (exists (select 1 from public.strategies s where s.id = strategy_id and s.owner = auth.uid()));

-- ---------- 畫線可以設成「只有我看得到」 ----------
alter table public.drawings add column if not exists is_private boolean not null default false;
drop policy if exists drawings_read on public.drawings;
create policy drawings_read on public.drawings for select to authenticated
  using (not is_private or created_by = auth.uid());

-- ---------- 建倉設定（每人一份） ----------
create table if not exists public.tranche_plans (
  owner        uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  capital      numeric(14,0) not null default 300000,   -- 總資金
  parts        integer not null default 3,               -- 分幾份
  support_tol  numeric(6,4) not null default 0.02,        -- 觸及支撐的容許範圍（2%）
  bottom_pct   numeric(6,4) not null default 0.20,        -- 箱型下方幾 % 算「區間底部」
  stop_mode    text not null default 'cross' check (stop_mode in ('cross','below')),
  notify       boolean not null default true,
  updated_at   timestamptz not null default now()
);

-- ---------- 持倉紀錄 ----------
create table if not exists public.positions (
  id            uuid primary key default gen_random_uuid(),
  owner         uuid not null default auth.uid() references auth.users(id) on delete cascade,
  code          text not null,
  tranche       integer not null check (tranche between 1 and 9),  -- 第幾筆
  buy_date      date not null,
  buy_price     numeric(12,2) not null,
  shares        integer not null,                                  -- 股數
  status        text not null default 'open' check (status in ('open','closed')),
  close_date    date,
  close_price   numeric(12,2),
  close_reason  text,
  note          text,
  created_at    timestamptz not null default now()
);
create index if not exists positions_owner_idx on public.positions (owner, status);

-- ---------- 每日建倉 / 停損提醒 ----------
create table if not exists public.trade_alerts (
  id          bigserial primary key,
  owner       uuid not null references auth.users(id) on delete cascade,
  date        date not null,
  code        text not null,
  kind        text not null,      -- entry1 / entry2 / entry3 / stop
  price       numeric(12,2),      -- 收盤價
  level       numeric(12,2),      -- 觸發的支撐 / 底部價位
  message     text,
  created_at  timestamptz not null default now(),
  unique (owner, date, code, kind)
);

alter table public.tranche_plans enable row level security;
alter table public.positions     enable row level security;
alter table public.trade_alerts  enable row level security;

drop policy if exists plans_own on public.tranche_plans;
create policy plans_own on public.tranche_plans for all to authenticated
  using (owner = auth.uid()) with check (owner = auth.uid());
drop policy if exists positions_own on public.positions;
create policy positions_own on public.positions for all to authenticated
  using (owner = auth.uid()) with check (owner = auth.uid());
drop policy if exists alerts_own on public.trade_alerts;
create policy alerts_own on public.trade_alerts for select to authenticated
  using (owner = auth.uid());
drop policy if exists alerts_delete_own on public.trade_alerts;
create policy alerts_delete_own on public.trade_alerts for delete to authenticated
  using (owner = auth.uid());

-- ===== 以下等同 005_fundamentals.sql =====
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

-- ===== 以下等同 006_groups.sql =====
alter table public.stocks add column if not exists industry text;    -- 產業別（例：半導體業）
alter table public.stocks add column if not exists shares   bigint;  -- 已發行普通股數（算市值）

-- 選股結果附帶資訊（例如分K 資料涵蓋幾檔）
alter table public.screen_results add column if not exists meta jsonb;

-- 自訂族群（只有自己看得到），例如「AI 伺服器」= 2382, 3231, 6669 …
create table if not exists public.user_groups (
  id          uuid primary key default gen_random_uuid(),
  owner       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name        text not null,
  codes       text[] not null default '{}',
  sort        integer not null default 0,
  updated_at  timestamptz not null default now()
);
create index if not exists user_groups_owner_idx on public.user_groups (owner);
alter table public.user_groups enable row level security;
drop policy if exists groups_own on public.user_groups;
create policy groups_own on public.user_groups for all to authenticated
  using (owner = auth.uid()) with check (owner = auth.uid());

-- ===== 以下等同 007_vpbox.sql =====
alter table public.tranche_plans add column if not exists box_auto       boolean      not null default true;  -- 沒畫箱型時用自動箱型
alter table public.tranche_plans add column if not exists box_days       integer      not null default 60;    -- 看前幾天
alter table public.tranche_plans add column if not exists box_va         numeric(5,1) not null default 70;    -- 包住幾 % 成交量
alter table public.tranche_plans add column if not exists box_max_height numeric(5,1) not null default 20;    -- 箱高上限 %

-- ===== 以下等同 008_mitake.sql =====
alter table public.stocks add column if not exists board_pct numeric(6,2);   -- 董監事持股比例 %（每週更新）

create table if not exists public.fin_quarter (
  code        text not null,
  date        date not null,          -- 季底日期
  revenue     numeric(20,0),
  op_income   numeric(20,0),          -- 營業利益
  pretax      numeric(20,0),          -- 稅前淨利
  net_income  numeric(20,0),          -- 稅後淨利
  primary key (code, date)
);
alter table public.fin_quarter enable row level security;
drop policy if exists read_auth on public.fin_quarter;
create policy read_auth on public.fin_quarter for select to authenticated using (true);

-- ===== 以下等同 009_private_rules.sql =====

-- 個人選股範本（只有自己看得到）
create table if not exists public.strategy_templates (
  id          uuid primary key default gen_random_uuid(),
  owner       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name        text not null,
  conditions  jsonb not null,           -- {logic, conditions, note}
  sort        integer not null default 0,
  created_at  timestamptz not null default now()
);
alter table public.strategy_templates enable row level security;
drop policy if exists templates_own on public.strategy_templates;
create policy templates_own on public.strategy_templates for all to authenticated
  using (owner = auth.uid()) with check (owner = auth.uid());

-- 分批建倉規則（每一筆的進場條件、停損條件，用選股條件的格式；只有自己看得到）
alter table public.tranche_plans add column if not exists rules jsonb;

-- 盤中選股結果（只留當天；每 30 分鐘一筆）
create table if not exists public.screen_live (
  strategy_id  uuid not null references public.strategies(id) on delete cascade,
  ts           timestamptz not null,
  items        jsonb not null,
  meta         jsonb,
  primary key (strategy_id, ts)
);
alter table public.screen_live enable row level security;
drop policy if exists screen_live_read_own on public.screen_live;
create policy screen_live_read_own on public.screen_live for select to authenticated
  using (exists (select 1 from public.strategies s where s.id = strategy_id and s.owner = auth.uid()));
-- =============================================================
-- 升級 010：共用設定只有管理員可以改
-- 以前任何登入的人都能改「扣抵設定」這類大家共用的設定；開放朋友使用後改成只有管理員能改。
-- 管理員名單放在獨立的表（使用者自己改不了）。預設把第一個註冊的帳號設成管理員。
-- SQL Editor 貼上整份 → Run（可重複執行）
-- =============================================================
create table if not exists public.app_admins (
  user_id uuid primary key references auth.users(id) on delete cascade
);
alter table public.app_admins enable row level security;
drop policy if exists admins_read_own on public.app_admins;
create policy admins_read_own on public.app_admins for select to authenticated using (user_id = auth.uid());
-- 沒有 insert / update / delete 政策：只有在 SQL Editor（或排程的 service role）才能加管理員

insert into public.app_admins (user_id)
select id from auth.users order by created_at limit 1
on conflict do nothing;

drop policy if exists settings_write on public.app_settings;
create policy settings_write on public.app_settings for all to authenticated
  using (exists (select 1 from public.app_admins a where a.user_id = auth.uid()))
  with check (exists (select 1 from public.app_admins a where a.user_id = auth.uid()));

-- 要多加一位管理員：把下面的 email 換掉再執行
-- insert into public.app_admins (user_id) select id from auth.users where email = 'friend@example.com' on conflict do nothing;
