-- =============================================================
-- 升級 006：產業別 / 市值（選股結果分族群、排龍頭）＋ 自訂族群
-- SQL Editor 貼上整份 → Run（可重複執行）
-- =============================================================

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
