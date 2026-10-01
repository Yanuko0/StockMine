-- =============================================================
-- 升級 008：三竹智選股常用條件需要的資料
--   董監持股比例、每季財報（營業利益占稅前利益）
-- SQL Editor 貼上整份 → Run（可重複執行）
-- =============================================================
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
