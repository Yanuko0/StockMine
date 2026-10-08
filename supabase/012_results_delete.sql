-- =============================================================
-- 升級 012：選股結果可以自己刪掉某幾天（只能刪自己策略的結果）
-- SQL Editor 貼上整份 → Run（可重複執行）
-- =============================================================
drop policy if exists screen_results_delete_own on public.screen_results;
create policy screen_results_delete_own on public.screen_results for delete to authenticated
  using (exists (select 1 from public.strategies s where s.id = strategy_id and s.owner = auth.uid()));
