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
