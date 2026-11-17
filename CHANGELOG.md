# 更新紀錄（CHANGELOG）

每次修改都記在這裡：最新的在最上面。
每一筆分兩段：**改了什麼**（使用上看得到的變化）、**程式改了哪裡**（檔案與做法）。
有「你要做的」的，代表除了 Commit + Push 之外還要手動做的事。

---

## 2026-11-17　個股「新聞・展望」：新聞、券商目標價、偏多 / 偏空、上漲機率、風險、AI 提示詞

**改了什麼**
- 個股頁新增一頁：電腦版在右側，「籌碼 / 分點進出」旁邊叫「新聞・展望」；手機版是第四個分頁「展望」。內容如下：
  - **多空展望**：
    - 之後 20 個交易日上漲 / 下跌的機率，用過去 3 年全市場「同樣狀態」的實際結果統計。狀態包括趨勢、近 20 日漲跌、RSI、量能、外資近 5 日。
    - 跟全市場平均比較，附可信度。差距在誤差範圍內就判「中性」，不硬說偏多或偏空。
    - 偏多理由、偏空理由，涵蓋技術、量價、法人、主力、融資、目標價、新聞熱度。
  - **新聞理由（選填）**：設定 Gemini 免費金鑰後，AI 會把新聞整理成看多 / 看空理由。每條都附新聞連結，對不到新聞的理由會自動丟掉。
  - **風險**：
    - 高 / 中 / 低，依據年化波動在全市場的排名，以及同狀態歷史上最差的情況。
    - 參考做法：停損、目標、風險報酬比、部位上限。
  - **「這個機率準不準？」**：用前 2 年的資料算機率，再用最近一年的實際結果對答案。上線後也會累積實際成績。
  - **自己問 AI**：一鍵複製整理好的提示詞，內容包括價格、均線、法人、主力、融資、目標價、新聞標題和統計。可以貼到 ChatGPT、Claude 或 Gemini。所有股票都能用，提示詞在瀏覽器裡組好，不經過我們的伺服器。
  - **券商 / 外資目標價**：
    - 依時間排序：券商、評等、調升或調降（原本 → 新的）、跟現價差多少，點券商名稱可以看原新聞。
    - 摘要卡：近半年各家最新目標價的中位數、最高、最低。
  - **個股新聞**：
    - 可選 7 / 30 / 90 天。
    - 來源：Google 新聞、Yahoo 股市，加上我們新聞表裡有提到這檔的新聞。
- 每天台灣時間約 21:30 幫「所有人的自選股＋最近 3 天新聞最多的股票」計算，最多 250 檔。其他股票打開時看得到新聞、目標價，也能複製 AI 提示詞，但沒有多空統計。
- 全部免費：新聞用公開 RSS，目標價從新聞文字整理，機率用自己的歷史資料算；AI 只用 Gemini 免費額度，也可以不用。

**程式改了哪裡**
- `pipeline/twstock/targets.py`（新）：從新聞標題 / 摘要抓目標價，包括券商別名、評等、動作、原本 → 新的目標價。
  - 防呆：股名要在「目標價」前面；數字不能離現價太遠（排除年份等）。
  - 同一家券商、同一個目標價，10 天內不同媒體轉載只算一次。
  - `summarize()`：每家券商最新一筆的中位數、上檔空間、近 90 天調升 / 調降次數。
- `pipeline/twstock/outlook.py`（新）：
  - `features` / `state_table` / `calibrate`：狀態分類、之後 20 日的報酬與期間最大回檔、歷史統計、回測校準（含 Brier 分數）。全市場 3 年的統計一週重算一次，省 Supabase 流量。
  - `verdict`：重疊樣本保守當 1/10 計算誤差，差距不夠大就判中性。
  - `rule_reasons`、`risk_plan`、`plan_text`：規則理由、風險、參考做法。
  - `fetch_stock_news`：個股新聞，Google 新聞 RSS＋Yahoo。
  - `ai_reasons` / `validate_ai`：呼叫 Gemini，並逐條核對新聞編號；目標價數字必須在該新聞裡出現。新聞沒變就不重問；遇到 429 就停；最多 40 次。
  - `live_track`：上線後的實際成績。
  - 2 小時內跑過就略過（GitHub 排程和 Vercel Cron 都會叫）。
- `pipeline/twstock/cli.py`：新工作 `outlook`。
- `pipeline/tests/test_outlook.py`（新）：目標價抓取、轉載去重、AI 結果核對、機率誤差判斷、之後 20 日結果計算、完整跑一次的資料庫測試。全部測試 74 個通過。
- `supabase/013_outlook.sql`（新，也加進 `schema.sql`）：`target_prices`、`stock_outlook`、`outlook_log` 三張表，登入者可讀。
- 排程：
  - `outlook.yml`（新）：GitHub 排程，台灣時間 22:50 當備用。
  - `web/vercel.json`：Vercel Cron 台灣時間 21:30 叫一次。
  - `web/app/api/cron/[job]/route.ts`：加 `outlook`。
- `web/app/api/stock-news/route.ts`（新）：個股新聞代抓，Google 新聞＋Yahoo RSS，快取 30 分鐘，只回傳標題、時間、來源、連結。
- `web/components/OutlookPanel.tsx`（新）、`web/lib/aiPrompt.ts`（新）、`web/lib/data.ts`（`getOutlook`、`getTargets`、`getStockNews`、`getOutlookModel` 與型別）。
- `web/app/stock/[code]/page.tsx`：加「新聞・展望」/「展望」分頁。

**你要做的**
1. Supabase SQL Editor 執行 `supabase/013_outlook.sql`。
2. 把 `_待移入_github_workflows/outlook.yml` 移到 `.github/workflows/`。
3. （選填）到 Google AI Studio 申請免費 API 金鑰，放到 GitHub → Settings → Secrets → Actions，名稱 `GEMINI_API_KEY`。不設也能用，只是沒有 AI 新聞理由。
4. Commit + Push 後，到 GitHub Actions 手動執行一次「個股展望」。

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

### 同一天補強：檢查正確性
**改了什麼**
- 修一個邊緣情況：粗篩原本可能少讀幾年日K（策略有月K 條件、又跟分K 條件放在同一個群組時），KD / RSI / MACD 數值會有些微差，邊緣的股票可能被誤刷掉。現在粗篩跟正式選股讀一樣長的資料。
- 條件漏斗、逐檔診斷：沒抓分K 的股票，分K 條件改標「－ 沒檢查」，不再顯示成 ✗；漏斗受影響的數字改顯示範圍（例如 33～60），並說明是盤中加速。原本會誤顯示「只有 N 檔有分K 資料」。
- 用隨機資料比對「全部抓」跟「先篩再抓」：選到的股票完全相同。

**程式改了哪裡**
- `pipeline/twstock/cli.py`：`job_screen` 讀幾年日K、要不要算週 / 月K，改用完整策略決定；診斷字串沒檢查的條件用 `?`；`meta.prefilter` 記錄候選檔數，以及漏斗每一條沒檢查的檔數。
- `web/components/Funnel.tsx`：顯示範圍、盤中加速說明；粗篩時不顯示分K 覆蓋率警告。
- `web/components/Diagnose.tsx`：`?` 顯示成「－（沒檢查）」；「只差一條」名單裡標 `?`。
- `web/lib/data.ts`：`meta` 型別加 `prefilter`。

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
