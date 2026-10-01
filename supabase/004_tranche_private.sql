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
