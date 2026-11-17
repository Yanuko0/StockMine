# 更新紀錄（CHANGELOG）

每次修改都記在這裡：最新的在最上面。
每一筆分兩段：**改了什麼**（使用上看得到的變化）、**程式改了哪裡**（檔案與做法）。
有「你要做的」的，代表除了 Commit + Push 之外還要手動做的事。

---

## 2026-11-17　盤中立即選股太慢（跑 15～20 分鐘）

**改了什麼**
- 盤中按「立即選股」通常會快很多：策略有分K 條件時，原本要逐檔抓全市場約 1900 檔的今天分K，現在先用不需要分K 的條件（均線、量、籌碼等日K 條件）篩過，只抓剩下的股票。
- 選股結果不變：只有用「且（AND）」組合的策略能先篩；用「或（OR）」的策略照舊全部抓。

**程式改了哪裡**
- `pipeline/twstock/screener.py`：新增 `without_minute()`，拿掉用到分K 的條件，只留可以先篩的條件。
- `pipeline/twstock/cli.py`
  - `job_screen` 新增 `prefilter=True` 模式：只回傳通過不看分K 條件的股票代號，不存結果；`live["candidates"]` 有給時，只讀這些股票的歷史分K 檔。
  - `live_data` 新增 `pick`：抓完全市場快照後先篩，再只抓候選股的分K。
  - 查 Shioaji 流量從每檔查一次改成每 50 檔查一次（原本每抓一檔就多一次 API 呼叫）；每 200 檔印一次進度。
  - 分K 快取改成「原本的＋這次新抓的」合在一起存，下一次立即選股可以沿用更多。
  - `job_live` 加上粗篩；粗篩出錯就照舊全部抓。

---

## 2026-11-16　立即選股：收盤後按了沒反應、跑完看不出來

**改了什麼**
- 收盤後（13:50 以後）到晚上收盤排程跑完前按「立即選股」，改用今天的收盤快照選股，結果放在最前面一格「今日收盤 HH:MM」。以前會存到昨天那一格，看起來像沒反應。
- 跑完一定會出現綠色提示「HH:MM 選股完成：… 共 N 檔」；選出來跟上一次一樣也會說「跟上一次一樣（價格已更新）」。
- 等待時顯示 GitHub 跑到哪一步（排隊中 / 安裝套件 / 抓最新股價、篩選中 / 存結果）、進度條、依最近幾次推估「預計還要幾分鐘」。
- 每 6 秒檢查一次（原本 10 秒）；離開頁面或重新整理後回來，會繼續等上次的立即選股。

**程式改了哪裡**
- `pipeline/twstock/cli.py`
  - `job_screen_now`：資料庫還沒有今天日K 的平日收盤後，也走 `job_live`（快照）；休市抓不到快照時退回最新收盤資料。
  - `job_live` / `live_data` 新增 `reuse_age`：收盤後可沿用今天盤中抓過的分K（最多 600 分鐘），只用收盤快照補最後幾分鐘，不重抓全市場。
- `web/app/api/screen-now/route.ts`（GET）：多回傳目前執行到的 GitHub 步驟（`/actions/runs/{id}/jobs`）、最近成功幾次的中位數耗時 `typical`。
- `web/lib/data.ts`：`screenRunStatus` 回傳 `steps`、`typical`；新增型別 `RunStep`、`ScreenRun`。
- `web/app/screener/page.tsx`：步驟中文化 `stepLabel()`、進度條、預估時間、`localStorage` 記住進行中的立即選股、完成提示 `doneMsg`、收盤後標籤「今日收盤」。

---

## 2026-10-29　新聞熱度排程失敗（Out of range float values）

**改了什麼**
- 新聞熱度排程不會因為某檔股票某天沒成交而整個失敗。

**程式改了哪裡**
- `pipeline/twstock/news.py`：算收盤價、5 日漲跌時跳過空的收盤價；存進資料庫前用 `_finite()` 把 NaN / 無限大換成空值。
- `pipeline/tests/test_news.py`：新增「某天沒成交」測試。

---

## 2026-10-08　選股結果日期可以管理、立即選股不會連按

**改了什麼**
- 選股結果的日期列多了「管理」，可以刪掉某一天的結果；選股結果只保留最近 30 天。
- 立即選股按下去會顯示「送出中…」不能連按（連按會把 GitHub 上前一次取消）；失敗時用明顯的紅色提示並說明原因（例如 GitHub 金鑰失效）。
- 選股結果每一檔中間加上近 20 日走勢小線。

**程式改了哪裡**
- `supabase/012_results_delete.sql`（新）、`supabase/schema.sql`：允許刪除自己策略的選股結果。**你要做的：在 Supabase SQL Editor 執行一次。**
- `pipeline/twstock/cli.py`：`prune_old` 刪除 30 天前的 `screen_results`。
- `web/lib/data.ts`：新增 `deleteResult()`。
- `web/app/screener/page.tsx`：日期管理、送出中狀態、錯誤提示框、走勢小線（`getQuotes` 取近 20 日）。

---

## 2026-10-08　全球強勢族群：抓錯一天、排名改看昨晚美股

**改了什麼**
- 修正最新一天的漲跌常常拿到「前一天」的問題（例：美光顯示 -1.73%，實際 +4.06%）。
- 排名改成「昨晚美股平均漲幅」；日韓是前一天收盤，只當確認。資金同步改為美股強、且日或韓也強才算。沒有美股成分股的族群標「無美股」。
- 「3/3 漲」改寫成「3 檔中 3 檔漲」，避免看成日期。
- 只用台灣時間「昨天為止」的收盤：早上看到的是昨晚美股＋昨天日韓。

**程式改了哪裡**
- `pipeline/twstock/global_themes.py`
  - `parse_chart`：用 Yahoo `meta.regularMarketPrice/regularMarketTime` 補上或更正最新收盤；`cutoff` 只取到昨天；盤中那根不算。
  - `update`：同一市場日期比別人舊的股票不算進平均，列在「這次沒抓到」。
  - `build`：排名分數改用美股平均（`avg`），另存 `avg_all`、`basis`；最強細項與領漲股以美股為主。
- `web/app/global/page.tsx`：標題、「無美股」標記、「N 檔中 M 檔漲」。
- `web/lib/data.ts`：`GlobalTheme` 加 `avg_all`、`basis`。
- `pipeline/tests/test_global.py`：新增相關測試。

---

## 2026-10-08　準時的早上排程（Vercel Cron）

**改了什麼**
- 全球強勢族群每天台灣時間 05:00～05:59、07:00～07:59 各跑一次，新聞熱度 06:30～07:29 跑一次，8:30 前一定是最新的。不再只靠常延遲的 GitHub 排程。

**程式改了哪裡**
- `web/vercel.json`（新）：3 個每日排程。
- `web/app/api/cron/[job]/route.ts`（新）：Vercel 到點呼叫，驗證 `CRON_SECRET` 後請 GitHub 執行對應的 workflow。
- `.github/workflows/global.yml`：早上 4 個時段當備用。
- **你要做的：Vercel 環境變數新增 `CRON_SECRET`（自己打一串長亂碼）。**

---

## 2026-10-06 ～ 10-07　其他

- **新聞熱度頁（新）**：`pipeline/twstock/news.py`、`web/app/news/page.tsx`、`supabase/011_news.sql`、`.github/workflows/news.yml`。鉅亨網 / Yahoo / Google 新聞，統計標的、題材、關鍵字提及次數，標示「熱度高、主力賣超」。
- **全球強勢族群頁（新）**：`pipeline/twstock/global_map.py`（對照表）、`global_themes.py`、`web/app/global/page.tsx`。選股頁加「全球強勢 前3/5/10」篩選按鈕。
- **即時報價**：`web/app/api/live/route.ts`（證交所即時資料代轉）、`web/lib/useLive.ts`、`components/ui/Tick.tsx`；盤中每 5 秒更新、價格跳動閃色。
- **排程延遲／漏跑**：`cli.py` 的 `session_date`（凌晨跑也處理前一個交易日）、`_missing_days`（自動補漏掉的日K）、`_fill_institutional`（三大法人晚公布時晚上再補）；分點在隔天開盤前也能補抓並修正名稱亂碼。
- **介面**：下拉選單看不到字、文字對比、手機觸控大小、換頁淡入、iPhone 動態島遮擋、首頁大盤版面。
