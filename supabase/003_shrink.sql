-- =============================================================
-- 升級 003：縮小資料庫（免費方案上限 500 MB）
--
-- 步驟一：貼上「這一段」→ Run
-- =============================================================

-- 1. 拿掉用不到的日期索引（各省下數十 MB）
drop index if exists public.daily_prices_date_idx;
drop index if exists public.institutional_date_idx;

-- 2. 三大法人、融資融券只保留最近約 400 天（網頁和選股只用到近 60 天）
delete from public.institutional where date < current_date - 400;
delete from public.margin        where date < current_date - 400;

-- 3. 日K 保留 5 年（月扣三低、月均線用得到）
delete from public.daily_prices  where date < current_date - interval '5 years';

-- =============================================================
-- 步驟二：上面執行完之後，開一個「新的」 query，只貼下面這兩行 → Run
-- （把刪掉的空間真正還回來；要單獨執行，不能跟上面一起跑）
--
--   vacuum full public.institutional;
--   vacuum full public.margin;
--
-- 步驟三：再查一次大小
--
--   select pg_size_pretty(pg_database_size(current_database()));
-- =============================================================
