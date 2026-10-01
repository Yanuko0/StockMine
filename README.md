# 掘股 StockMine

盤後台股分析網頁 App「掘股」（可以加入手機主畫面使用）。全部使用免費服務，不需要綁信用卡，每天收盤後自動更新。

## 功能

- **手機、電腦都好用**：手機底部分頁列；電腦是三欄式看盤（左：自選股 / 最近 / 自訂族群，中：K 線，右：報價 + 籌碼 / 分點），↑↓ 鍵切換股票
- **鍵盤精靈**：任何頁面直接打股號或名稱（或 Ctrl+K）就能搜尋
- **深色 / 淺色 / 跟隨系統**（設定頁，或電腦版左下角切換）
- **首頁**：加權指數、漲跌家數、成交值、自選股報價表（可排序、走勢小圖）、今日選股與建倉提醒、外資 / 投信買賣超與漲跌幅排行、產業漲跌
- **均線可以自訂**：期數、顏色、開關（預設 5 黃、10 藍、20 紫、60 綠、120 白、240 紅）
- 輸入股號或名稱搜尋個股
- **個股頁（看盤軟體風格）**：上方報價區（成交、漲跌、開高低、昨收、振幅、總量、5日均量、量比），下方分成「技術分析／籌碼／分點進出」三個分頁
- **技術分析**：1分、3分、5分、15分、30分、60分、日、週、月K
  - 5 / 10 / 20 / 60 均線，標出每條均線的**扣抵K棒**，下方列出扣抵值和均線可能的方向
  - **月扣三低**：用月K 算出扣三低線（D1~D3 的最高價位），**每個週期都畫同一條線**，標示「今日突破 / 站上 / 未突破」；月K 上另外標出 D1 / D2 / D3
  - 主圖：布林通道（可開關）
  - 副圖：成交量、KD、RSI、MACD、乖離率（公式與選股器相同），以及**主力、外資、投信、自營商買賣超**（張；週K、月K 自動加總，分K 不顯示）。最多同時開 4 個副圖
  - **⚙ 參數**：KD（一鍵切換 9,3,3 / 60,3,3）、RSI、MACD、乖離、布林通道都可以改
- **畫線工具**（所有人共享、即時同步）：水平線、趨勢線、射線、箱型、平行通道、黃金分割、文字標註
  - 8 種顏色，可加標籤；點線可以改顏色、改標籤、刪除；自己的線可以拖曳
  - 會自動吸附到 K 棒的開高低收
  - **跨週期**：用「時間＋價格」記錄，在 1分K 畫的線切到日K / 週K / 月K 也看得到，反過來也一樣
- **籌碼**：三大法人 1 / 5 / 20 日累計與連買連賣天數、近 20 日買賣超圖；融資融券與券資比；主力進出與籌碼集中度
- **分點進出**：1 / 5 / 20 日累計的買超、賣超前 15 名分點（張數、均價），點分點看它每天在這檔的進出；主力買賣超與集中度
- **選股器**（策略只有自己看得到）：用選單組合條件，每天收盤後自動掃全市場，可以推播通知
  - 技術：比較、交叉（KD 可指定參數）、布林通道、均線扣抵、月扣三低（站上 / 突破）、量比、多空排列、均線糾結、均線翻揚、區間振幅、漲跌幅、創新高
  - 籌碼 / 基本面：法人連買、法人買超天數比例、主力、關鍵券商佔成交量、平均現金殖利率、稅後淨利率、上市櫃範圍、大盤條件
  - 型態：跳空突破區間頂部、箱型底部不破、回測支撐（自動偵測，再加上自己畫的箱型 / 水平線）；條件群組（可以做「① 或 ② 或 ③」，結果會標出符合哪一個）；在自訂族群裡
  - **範本**：內建幾個通用範本（月扣三低突破、箱型突破、箱底佈局）；自己的策略可以「存成範本」，存在資料庫、只有自己看得到
  - **結果分族群**：同產業排在一起，組內依市值由大到小（第一檔標「龍頭」）；可以建立「自訂族群」（例：AI 伺服器）
- **分批建倉**：資金分成幾份，每一筆的進場條件、停損條件都用選股條件自己設定（存在資料庫，只有自己看得到）；每天收盤後提醒；持倉與損益紀錄
- 排程紀錄：設定頁可以看到每天有沒有抓成功

## 從舊版升級

如果你在加入「畫線工具」之前就已經執行過 `schema.sql`：到 Supabase → **SQL Editor** → 貼上 `supabase/002_drawings_broker.sql` → **Run**。
這會建立新的畫線資料表、把舊的水平線搬過去，並加上分點期間累計的查詢功能。可以重複執行。
新建的專案只要執行 `schema.sql` 就好（已經包含這些內容）。

**依序執行**（每份都可以重複執行；新專案只要跑 `schema.sql`）：
- `004_tranche_private.sql`：分批建倉、策略隱私、私人畫線
- `005_fundamentals.sql`：殖利率、財報、加權指數
- `006_groups.sql`：產業別 / 市值（選股分族群）、自訂族群

**資料庫快滿時**（免費方案上限 500 MB）：照 `supabase/003_shrink.sql` 裡的步驟執行。
之後排程每天會自動刪掉超過保留期限的資料：日K 保留 5 年；三大法人、融資融券保留約 400 天。
要調整的話，改 `pipeline/twstock/config.py` 裡 `DAILY_KEEP_YEARS`、`CHIPS_KEEP_DAYS` 的預設值。

## 架構（全部免費）

| 部分 | 服務 | 用途 |
|---|---|---|
| 網頁 App | Next.js，部署在 **Vercel** | 手機用「加入主畫面」安裝 |
| 資料庫、登入、檔案 | **Supabase** 免費方案 | 日K、法人、分點、畫線、策略；全市場近 30 天的 1分K 檔案 |
| 每日排程 | **GitHub Actions** | 每個交易日 16:10 自動抓資料、跑選股 |
| 分鐘K | **永豐 Shioaji** | 只開「行情 / 資料」權限 |
| 日K、法人、融資融券、上市分點 | 證交所、櫃買中心公開資料 | |
| 歷史資料補齊 | **FinMind** 免費版 | 第一次上線時補 5 年日K |
| 封存和備份 | **Google 雲端硬碟** | 每天封存分鐘K和分點；每週備份資料庫 |

```
StockMine/
├── web/              Next.js 網頁 App（TypeScript）
├── pipeline/         每日抓資料和選股（Python）
│   ├── twstock/      主程式
│   ├── scripts/      一次性設定工具（Google 授權、推播金鑰）
│   └── tests/        測試
├── supabase/schema.sql   資料庫結構（貼到 Supabase SQL Editor 執行）
└── .github/workflows/    排程
```

## 每日排程（台灣時間，週一到週五）

| 時間 | 工作 |
|---|---|
| 16:10 | 日K、三大法人 → 全市場 1分K → 關注清單分點 → 選股、推播 |
| 22:15 | 融資融券 |
| 週日 02:00 | 資料庫備份到 Google 雲端硬碟（保留最近 8 份） |

休市日會自動略過。

---

# 設定步驟

設定大約需要 1 小時，只要做一次。

## 1. Supabase

1. 到 [supabase.com](https://supabase.com) 建立新專案，Region 選 **Northeast Asia (Tokyo)**。
2. 左側 **SQL Editor** → New query → 貼上 `supabase/schema.sql` 全部內容 → **Run**。
3. **Authentication → Sign In / Providers**：關閉「Allow new users to sign up」（只有受邀的人能用）。
4. **Authentication → URL Configuration**：
   - Site URL：`https://你的網址.vercel.app/auth`（第 4 步部署後再回來填）
   - Redirect URLs：加入 `https://你的網址.vercel.app/**`
5. 記下這幾個值（**Project Settings**）：
   - `SUPABASE_URL`：Data API → Project URL
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`：API Keys → `anon` / publishable key（可以公開）
   - `SUPABASE_SERVICE_KEY`：API Keys → `service_role` / secret key（**不可公開**）
   - `SUPABASE_DB_URL`：右上 **Connect** → **Session pooler** 的連線字串（GitHub Actions 只支援 IPv4，所以要用 pooler），把 `[YOUR-PASSWORD]` 換成資料庫密碼

## 2. 永豐 Shioaji API 金鑰

1. 登入永豐金證券 → API 管理 → 新增 API Key。
2. 權限**只勾「行情 / 資料」**，不要勾「交易」和「帳務」。
3. **不要**上傳或設定憑證（.pfx）。這樣就算金鑰外洩，也無法下單或看到帳戶。
4. Secret Key 只會顯示一次，先存進密碼管理器。
5. 如果第一次登入失敗，請依永豐文件完成「條款簽署與測試」。

## 3. GitHub

1. 建立一個 **Private** repository，例如 `StockMine`，把整個資料夾推上去（見本文最後）。
2. **Settings → Secrets and variables → Actions → Secrets**，新增：

   | 名稱 | 值 | 必填 |
   |---|---|---|
   | `SUPABASE_URL` | Supabase Project URL | ✅ |
   | `SUPABASE_SERVICE_KEY` | service_role key | ✅ |
   | `SUPABASE_DB_URL` | Session pooler 連線字串 | ✅ |
   | `SHIOAJI_API_KEY` | 永豐 API Key | 分鐘K 需要 |
   | `SHIOAJI_SECRET_KEY` | 永豐 Secret Key | 分鐘K 需要 |
   | `FINMIND_TOKEN` | [FinMind](https://finmindtrade.com/) 免費註冊後的 token | 補歷史需要 |
   | `GDRIVE_CLIENT_ID` / `GDRIVE_CLIENT_SECRET` / `GDRIVE_REFRESH_TOKEN` | 見第 5 步 | 選填 |
   | `VAPID_PRIVATE_KEY` | 見第 6 步 | 選填 |

3. 同一頁的 **Variables** 分頁（選填）：
   - `FINMIND_SPONSOR` = `false`（有付費 FinMind Sponsor 才改成 `true`，這樣上櫃股票的分點也能抓）
   - `VAPID_SUBJECT` = `mailto:你的email`

## 4. Vercel

1. [vercel.com](https://vercel.com) → Add New Project → 選剛剛的 GitHub repo。
2. **Root Directory** 設為 `web`。
3. Environment Variables：
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `NEXT_PUBLIC_VAPID_PUBLIC_KEY`（選填，第 6 步）
   - `GITHUB_PAT`、`GITHUB_REPO`（選填：加入關注時立刻抓分點。PAT 用 Fine-grained token，只選這個 repo，權限 **Actions: Read and write**）
4. Deploy。完成後把網址填回 Supabase 第 1 步的 URL Configuration。

## 5. Google 雲端硬碟（選填，建議）

1. [Google Cloud Console](https://console.cloud.google.com/) → 建立專案 → **APIs & Services → Library** → 啟用 **Google Drive API**。
2. **OAuth consent screen**：User type 選 External → 填基本資料。
3. **發布狀態要改成「In production」**：保持「Testing」的話，授權 7 天就會失效。這個程式只用 `drive.file` 權限，不需要 Google 審核。
4. **Credentials → Create credentials → OAuth client ID** → 類型選 **Desktop app** → 記下 Client ID 和 Client Secret。
5. 在你的電腦執行：
   ```bash
   cd pipeline
   pip install google-auth-oauthlib
   python scripts/google_auth.py <Client ID> <Client Secret>
   ```
   瀏覽器開啟後，**用你要存資料的那個 Google 帳號登入**。終端機會印出 refresh token。
6. 把三個值存到 GitHub Secrets（`GDRIVE_CLIENT_ID`、`GDRIVE_CLIENT_SECRET`、`GDRIVE_REFRESH_TOKEN`）。

資料會存在該帳號雲端硬碟的「掘股 StockMine」資料夾。程式只看得到自己建立的檔案。

## 6. 推播通知（選填）

```bash
cd pipeline
pip install cryptography
python scripts/gen_vapid.py
```
- `VAPID_PRIVATE_KEY` → GitHub Secrets
- `NEXT_PUBLIC_VAPID_PUBLIC_KEY` → Vercel 環境變數（改完要重新部署）

iPhone 需要 iOS 16.4 以上，而且要先「加入主畫面」，從桌面圖示打開後，到「設定」開啟推播。

## 7. 邀請使用者

Supabase → **Authentication → Users → Invite user** → 輸入 Email。對方收到信後點連結，設定名稱和密碼即可登入。你自己也用這個方式邀請自己。

## 8. 第一次上線：補資料

到 GitHub repo 的 **Actions** 分頁，依序手動執行（Run workflow）：

1. **每日盤後資料**：建立股票清單和今天的日K。
2. **補歷史資料（手動）** → `backfill-daily`，額外參數 `--inst --resume`：用 FinMind 補 5 年日K和法人。免費額度每小時 600 次，全市場大約要 6 小時；超過單次時間上限的話，再按一次就會接著補。
3. **補歷史資料（手動）** → `backfill-minutes`，天數 `30`：用 Shioaji 補近 30 天 1分K。永豐免費流量每天 500MB，大概要分 2 到 3 天，每天按一次，已補好的股票會自動跳過。

之後就全自動了。

## 9. 安裝到手機

- **iPhone**：Safari 開網址 → 分享 → **加入主畫面**
- **Android**：Chrome 開網址 → 選單 → **安裝應用程式**

---

# 規則說明

## 扣抵值
N 期均線目前是最後 N 根的平均，**下一期會扣掉位置 L−N 的那根**（L = K 棒數量）。扣抵值低於現價 → 均線容易往上。
如果跟三竹智選股差一根，到「設定 → 扣抵位置」切換成「往前一根」。

## 扣三低
以本期收盤 C0 為基準（本期不算），下 1、2、3 期的扣抵值 D1、D2、D3 都低於 C0 時成立。
- D1 = 位置 L−N、D2 = L−N+1、D3 = L−N+2
- 扣三低線 = max(D1, D2, D3)。股價守在這條線上，條件才會繼續成立
- N 必須 ≥ 4；預設月K 5MA，可以在設定頁修改
- 月K 在月底前算出來的結果是「暫定」

## 分鐘K
台股 09:00–13:30 共 270 分鐘。每根 1分K 依距離 09:00 的第幾分鐘，歸入第 ceil(m / N) 根。
60分K 一天 5 根，最後一根是 13:00–13:30；3分K 90 根，5分K 54 根，15分K 18 根，30分K 9 根。

## 指標公式
- KD(9,3,3)：RSV = (C − 9日最低) / (9日最高 − 9日最低) × 100；K = ⅔·前K + ⅓·RSV；D = ⅔·前D + ⅓·K；起始值 50
- RSI：Wilder 平滑
- MACD(12,26,9)：DIF = EMA12 − EMA26；MACD = DIF 的 EMA9；OSC = DIF − MACD
- 乖離率：(C − MA) / MA × 100
- 布林通道(20,2)：中線 = MA20，上下軌 = 中線 ± 2 × 20 日母體標準差
- 價格使用**未還原**價

網頁（`web/lib/indicators.ts`）和選股器（`pipeline/twstock/indicators.py`）用完全相同的公式。

## 主力買賣超
當日各分點淨買賣張數：**買超前 15 名合計 + 賣超前 15 名合計**。

---

# 已知限制

- **上櫃股票的分點**：櫃買中心使用 Google reCAPTCHA，免費方案無法自動抓取。付費訂閱 FinMind Sponsor 後，把 `FINMIND_SPONSOR` 設為 `true` 就能抓。
- **上市股票的分點**：證交所只提供當天資料，而且有驗證碼（用開源 ddddocr 自動辨識，失敗會重試）。每天收盤後抓**全市場上市股票與 ETF**（不用加自選），每檔存成一個檔案（最近 60 個交易日）；歷史無法回補，從開始抓的那天起累積。
- **官方網站改版**：證交所或櫃買中心改版時，程式可能需要調整。設定頁的排程紀錄會顯示錯誤。
- **Supabase 免費方案**：資料庫 500MB，大約可以放 5 年全市場日K。更舊的資料可以從 Google 雲端硬碟的備份取回。
- **60分K 等分K 條件**：需要分K 資料（永豐 Shioaji）。補歷史分K 完成前，只會判斷已經有分K 的股票，選股頁會顯示涵蓋幾檔。
- **現金殖利率**：上市股票的除權息總表只給「權值+息值」，同時除權又除息的股票會略為高估。財報（稅後淨利率）用 FinMind 免費額度每天輪流更新，第一次全部更新完約需 2~3 週。
- **董監持股比率**：沒有免費的整批資料，範本裡先列為「略過」。
- **族群**：官方只有產業別；概念股族群請用「自訂族群」。
- 盤後資料不是即時報價；本工具僅供個人研究參考，不構成投資建議。

---

# 本機開發

```bash
# 網頁
cd web
cp .env.example .env.local   # 填入 Supabase
npm install
npm run dev                  # http://localhost:3000

# 排程程式
cd pipeline
pip install -r requirements.txt
cp .env.example .env         # 填入各項金鑰
python -m pytest -q          # 單元測試
python -m twstock.cli eod    # 手動跑一次
```

# 推上 GitHub

> **先移動排程設定檔**：排程檔放在 `github-workflows` 資料夾，因為系統不允許直接寫入 `.github`。
> 推上 GitHub 前請先把它移到 `.github\workflows`，否則排程不會執行。
> 在 PowerShell 裡執行：
> ```powershell
> cd $HOME\Documents\StockMine
> mkdir .github
> move github-workflows .github\workflows
> ```

```bash
cd StockMine
git init
git add .
git commit -m "init"
git branch -M main
git remote add origin https://github.com/你的帳號/StockMine.git
git push -u origin main
```
