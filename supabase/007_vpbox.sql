-- =============================================================
-- 升級 007：分批建倉的「自動箱型（密集成交區）」設定
-- SQL Editor 貼上整份 → Run（可重複執行）
-- =============================================================
alter table public.tranche_plans add column if not exists box_auto       boolean      not null default true;  -- 沒畫箱型時用自動箱型
alter table public.tranche_plans add column if not exists box_days       integer      not null default 60;    -- 看前幾天
alter table public.tranche_plans add column if not exists box_va         numeric(5,1) not null default 70;    -- 包住幾 % 成交量
alter table public.tranche_plans add column if not exists box_max_height numeric(5,1) not null default 20;    -- 箱高上限 %
