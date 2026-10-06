-- =============================================================
-- 升級 011：台股新聞熱度（只保留最近 7 天，排程每 2 小時更新）
-- SQL Editor 貼上整份 → Run（可重複執行）
-- =============================================================
create table if not exists public.news (
  id        text primary key,               -- 標題正規化後的雜湊（不同來源轉載同一則只算一次）
  ts        timestamptz not null,           -- 發布時間
  source    text,                           -- 來源（鉅亨網、經濟日報…）
  title     text not null,
  summary   text,                           -- 摘要前 200 字（不存全文）
  url       text,
  codes     text[] not null default '{}',   -- 提到的個股
  themes    text[] not null default '{}',   -- 題材（記憶體、CPO…）
  keywords  text[] not null default '{}',   -- 關鍵字
  created_at timestamptz not null default now()
);
create index if not exists news_ts on public.news (ts desc);
create index if not exists news_codes on public.news using gin (codes);
create index if not exists news_themes on public.news using gin (themes);
create index if not exists news_keywords on public.news using gin (keywords);

alter table public.news enable row level security;
drop policy if exists read_auth on public.news;
create policy read_auth on public.news for select to authenticated using (true);
