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
