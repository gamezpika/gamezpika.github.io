# 小智學園 EduArena — 交接文件 (HANDOVER)

接手前把這份從頭看完。涵蓋：架構、環境變數、部署、機密交接、換後端要改哪、踩過的地雷、待辦、repo 轉移。

---

## 1. 系統架構（兩個 repo、兩個 Railway service、一個 DB）

```
            ┌─────────────────────────────┐
玩家 LINE/   │  前端靜態站 (這個 repo)        │   Caddy 服務 (Railway)
Google ───▶ │  eduarena-skill-demo         │   COEP/COOP headers
            │  Phaser 村莊 + 各小遊戲頁      │   題目圖反向代理 → 後端
            └──────────────┬──────────────┘
                           │ fetch (config.js 設定的 API base)
                           ▼
            ┌─────────────────────────────┐
            │  後端 API (另一個 repo)        │   FastAPI / uvicorn (Railway)
            │  eduarena-tutoring          │   core.main:app
            └──────────────┬──────────────┘
                           ▼
            ┌─────────────────────────────┐
            │  PostgreSQL (Railway 同專案)   │
            └─────────────────────────────┘
```

| 元件 | repo | Railway |
|---|---|---|
| 前端 | `Zumii-ai/eduarena-skill-demo`（組織，OK） | project **eduarena-skill-demo** / service **eduarena-skill-demo**（Caddy 靜態） |
| 後端 | `Zumii-ai/eduarena-tutoring`（已轉入組織 2026-06；Railway source 已指向新 repo） | 同 project / service **eduarena-tutoring**（`uvicorn core.main:app`，Python 3.11.11；另有 `worker: python bot.py` TG bot，目前停用） |
| DB | （後端 repo 內 models） | 同 project 的 PostgreSQL；schema 不是 alembic，見 §7 |

- 後端正式網址：`https://eduarena-tutoring-production.up.railway.app`
- 前端正式網址：`https://eduarena-skill-demo-production.up.railway.app`
- 另有一個**舊正式站** `web-production-48b09`（48b09），只剩「舊題目圖圖床」還在用（Caddyfile 的 failover），其他都已搬到上面兩個。

---

## 2. 後端環境變數（在 Railway → eduarena-tutoring → Variables）

| 變數 | 用途 | 交接動作 |
|---|---|---|
| `DATABASE_URL` | Postgres 連線（含密碼） | Railway 內部自動帶；對外用 `DATABASE_PUBLIC_URL`（centerbeam.proxy.rlwy.net）。交接＝轉移 DB 擁有權 |
| `JWT_SECRET` | 玩家登入 token 簽章 | **建議輪替**（換了所有人要重登） |
| `LIFF_ID` / `LINE_CHANNEL_SECRET` / `LINE_CHANNEL_ID` | LINE 登入/LIFF | 看是否沿用同一個 LINE OA；要換人管就新建 LIFF |
| `GEMINI_API_KEY` | AI 出題（題庫生成） | 換成接手方自己的 key（現在掛誰的帳號付錢？） |
| `EDUARENA_BOT_TOKEN` / `EDUARENA_WEBAPP_URL` | Telegram bot（目前停用） | 視需要 |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | 後台登入 | ⚠️ **未設這兩個 env 時會落到程式內建的弱預設值**。上線前務必設定強帳密，見 §5 |
| `RAILWAY_API_TOKEN` | 非互動 Railway 操作（不過期） | **務必輪替/重發**，等於整個 Railway 的鑰匙 |

> 後端 `.env` 沒進 git（`.gitignore` 有擋，OK）。代表接手方拿不到，要另外安全交付一份。

---

## 3. 部署

- **`git push` 到 `main` → Railway 自動部署**（前後端各看自己的 repo，無 CI gate）。
- 前端部署 ≈ 1.5~2 分鐘；驗證：`curl` 線上 `village-web/index.html` 看 `?v=` 有沒有跳、或直接 grep 部署後的 JS 內容。
- 後端部署完，schema migration 在 app 啟動時自動跑（見 §7）。
- Railway CLI token 5 天過期；要操作 Railway 用 **GraphQL + Personal Access Token**（endpoint `https://backboard.railway.com/graphql/v2`）。

---

## 4. 本機開發

```bash
# 前端
cd eduarena-skill-demo && python3 -m http.server 8799
#   village-web/index.html?mp=0          單機
#   ...&api=http://localhost:8000        後端指本機
#   ...&dbg=1                            卡死診斷 HUD

# 後端
cd eduarena-tutoring && pip install -r requirements.txt
uvicorn core.main:app --reload   # 需要 .env（DATABASE_URL 等）
```

無自動化測試（見 §8）。改完手動走完登入→建角色→進村→答題→換地圖確認。

---

## 5. ⚠️ 機密與安全（交接最優先）

1. **後台帳密務必設定**：`core/admin_auth.py` 在沒設 env 時會落到內建弱預設值。後台能改題庫、看學生資料，
   所以**上線前一定**要在 Railway 設 `ADMIN_USERNAME` + `ADMIN_PASSWORD`（用強密碼）。當前線上是否已設、實際值，請走私下管道確認，不要寫進這份文件。
2. **輪替機密**：`RAILWAY_API_TOKEN`（不過期、最危險）、`JWT_SECRET`、`LINE_CHANNEL_SECRET`、`GEMINI_API_KEY`、DB 密碼。
3. **外部服務擁有權交接**：Railway 專案、LINE Developers console、Google OAuth client、Gemini 帳單、GitHub。每個都要把接手方加進去或轉移。

---

## 6. 換後端要改哪些地方（耦合清單）

API base 已收斂到 **[`config.js`](config.js)（單一覆蓋點）**——改那一行即可；各前端 JS 仍保留同樣字串當 fallback（某頁沒載 config.js 也不壞）。但**還有兩處不在 config.js**，換後端時要一起改：

1. **`Caddyfile`** 的題目圖反向代理：`/static/images/q/*` → 後端圖床，miss 時 failover 到 48b09。換後端要改這裡的 host。
2. **零星寫死的「demo 自身網址」**（活躍 ping、og:meta 等）：`grep -rn "up.railway.app"` 全抓出來確認。

> config.js 目前載在 `select.html` / `onboarding.html` / `village-web/index.html`（主流程）。
> `arcade/` 各頁還沒載 config.js（用 fallback + 各頁可加 `?api=`）；要全站統一覆蓋就把 `<script src="../config.js">` 補進各 arcade 頁。

---

## 7. 地雷（踩過的坑，沒寫在 code 裡會中招）

- **Cache-bust 全靠手動 `?v=N`**：改 JS/CSS 後要去引用它的 HTML 把版本號 +1，否則玩家吃舊檔。village 腳本版本號集中在 `village-web/index.html`。地圖建築圖也有寫死的 `?v`，改圖要改檔名或 bump。
- **DB schema 不是 alembic**：靠 `Base.metadata.create_all` + `core/database.py` 裡手寫的 `ALTER ... IF NOT EXISTS`（在 `_migrate`，app 啟動時跑）。加欄位＝改 model + 在這裡補 `ALTER`（用 `IF NOT EXISTS`，否則 PG transaction 會 abort）。
- **題目圖跨來源被 COEP 擋**：demo 站開了 cross-origin isolation（給 Web 版用），跨來源圖片沒回 CORP 會被擋 → 靠 Caddy 反代成同源。改圖床網址記得連 Caddyfile 一起。
- **答題 session 是記憶體內狀態**：後端**不能水平擴充**（多 worker 會各有各的 session）、**redeploy 會清掉在線玩家的答題狀態**。有在線玩家時別亂重部署。
- **Web 後台 = 設定的唯一真相**：指令/題庫設定以後台為準，bot/前端讀後台，不要在 code 硬編碼覆蓋。
- **地圖切換＝Phaser `scene.restart`**（不是換頁）：載入卡住會黑屏，已加「進度感知看門狗」自救（`explore.js` `_armLoadWatchdog`）。地圖資料來自 `assets/*_config.json`，由 `map-editor.html` 編輯後 push 上線——別手改壞 registry/config 格式。
- **多人 colyseus**：裸網址預設開多人（`?mp=0` 才單機）。多人 server 另有部署。

---

## 8. 沒有的東西 / 已知缺口

- **無測試、無 CI**。歷來驗證都是臨時 playwright 腳本（不在 repo）。至少給接手方一份「上線前手動 smoke test 清單」；理想上補基本 CI。
- **前端無 build/lint/依賴管理**（純靜態 + CDN）。好處是簡單，壞處是沒型別/打包保護。
- **待辦（上線相關）**：隱私權/服務條款審查、防沉迷設定、自訂網址（Cloudflare zumii.ai 子網域）規劃。
- **deliver（送禮）型每日任務**在 demo 沒有「生活區交付」介面 → 目前在公布欄隱藏，要真正能解需另做 UI。

---

## 9. 後端 repo 轉組織（已完成 2026-06）

後端已從 `gamezpika/eduarena-tutoring` 轉入 `Zumii-ai/eduarena-tutoring`（前後端都在組織了）。已處理：

- ✅ Railway 後端 service 的 repo trigger 已指向 `Zumii-ai/eduarena-tutoring`（branch `main`）。
- ✅ 本機 remote 已更新（`git remote set-url origin git@github.com:Zumii-ai/eduarena-tutoring.git`）。
- ✅ 舊網址 `gamezpika/eduarena-tutoring` GitHub 仍會自動轉址（舊連結不會壞）。

**還要確認的（接手前驗一次）**：
- **下次推一個真 commit 時，去 Railway 確認有自動 build** ＝ 自動部署沒斷的最終證明。
  若沒自動觸發：Railway → service → Settings → Source，重連 `Zumii-ai/eduarena-tutoring`（組織要裝 Railway 的 GitHub App 並授權這個 repo）。
- 把接手工程師加進 `Zumii-ai` 組織 + 兩個 repo + Railway 專案。
