-- =============================================================
-- 升級 013：個股展望（新聞、券商目標價、偏多 / 偏空、上漲機率、風險）
-- SQL Editor 貼上整份 → Run（可重複執行）
-- =============================================================

-- 券商 / 外資目標價（從新聞整理，同一家同一個目標價 10 天內只留一筆）
create table if not exists public.target_prices (
  code        text not null,
  broker      text not null,              -- 摩根士丹利、高盛、凱基、FactSet 共識、外資（未具名）…
  target      numeric(12,2) not null,
  date        date not null,              -- 新聞日期
  prev        numeric(12,2),              -- 原本的目標價（新聞有寫才有）
  rating      text,                       -- 買進 / 加碼 / 中立 / 減碼…
  stance      text,                       -- 多 / 中 / 空
  action      text,                       -- up 調升 / down 調降 / keep 維持 / init 首評
  title       text,
  url         text,
  source      text,
  origin      text default 'rule',        -- rule：規則從標題抓到；ai：AI 從新聞整理（數字有核對）
  created_at  timestamptz not null default now(),
  primary key (code, broker, target, date)
);
create index if not exists target_prices_code on public.target_prices (code, date desc);

-- 每檔最新一次的展望（排程每天收盤後算：自選股＋最近有新聞的）
create table if not exists public.stock_outlook (
  code        text primary key,
  date        date not null,
  data        jsonb not null,
  updated_at  timestamptz not null default now()
);

-- 每天給的上漲機率（20 個交易日後拿來對答案，看這套方法實際準不準）
create table if not exists public.outlook_log (
  code   text not null,
  date   date not null,
  p_up   numeric(5,1),
  base   numeric(5,1),
  close  numeric(12,2),
  primary key (code, date)
);

alter table public.target_prices enable row level security;
alter table public.stock_outlook enable row level security;
alter table public.outlook_log   enable row level security;
drop policy if exists read_auth on public.target_prices;
create policy read_auth on public.target_prices for select to authenticated using (true);
drop policy if exists read_auth on public.stock_outlook;
create policy read_auth on public.stock_outlook for select to authenticated using (true);
drop policy if exists read_auth on public.outlook_log;
create policy read_auth on public.outlook_log for select to authenticated using (true);
