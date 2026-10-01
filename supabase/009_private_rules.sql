-- =============================================================
-- 升級 009：個人範本、建倉規則改存資料庫（程式碼公開也不會外流）；盤中選股
-- SQL Editor 貼上整份 → Run（可重複執行）
-- =============================================================

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
