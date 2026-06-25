# 小智學園 EduArena — Demo（遊戲化國小家教）

國小生「遊戲化學習」demo：孩子用 LINE / Google 登入，進到一個 2.5D 村莊世界（Phaser），
在地圖上走動、進各學院答題、打王、競技、種田養成。答題接真後端、給金幣、記進度。

> ⚠️ **這份 README 是給工程師快速上手用的。要交接 / 換人接手請先看 [HANDOVER.md](HANDOVER.md)**
> （架構、環境變數、部署、機密、地雷、待辦、repo 轉移步驟全在那）。

---

## 這個 repo 是什麼

**前端靜態站**（純 HTML/JS/CSS，無 build step，Phaser 走 CDN）。由 Railway 上的 Caddy 服務。
後端是另一個 repo（FastAPI，見 HANDOVER.md），這個 repo 只負責畫面與呼叫後端 API。

## 玩家流程（進入點）

```
index.html (Google/LINE 登入)
   → select.html (選/建小朋友)
   → onboarding.html (新手開場，可建角色)
   → village-web/index.html (Phaser 村莊主場景) ← 遊戲本體
```

地圖切換、答題面板、商店、任務、種田等都在 `village-web/` 裡。
獨立小遊戲（打地鼠、拼字、boss 戰、PVP 等）是各自的 `*.html`，靠 `arcade/shim.js` 接後端。

## 本機跑

```bash
cd eduarena-skill-demo
python3 -m http.server 8799
# 瀏覽器開 http://localhost:8799/village-web/index.html?mp=0
#   ?mp=0  = 單機模式（不連多人 colyseus）
#   ?api=http://localhost:8000  = 後端指到本機（預設指線上，見 config.js）
#   ?dbg=1 = 顯示卡死診斷 HUD
```

靜態檔直接服務，存檔重整即見效。**但改了 JS/CSS 要手動 bump `?v=`**（見下）。

## 重要目錄

```
config.js               ← 後端 API 位址「單一覆蓋點」（換後端改這裡）
index.html              ← Google/LINE 登入落地頁
select.html             ← 選小朋友
onboarding.html         ← 新手開場 + 建角色
village-web/            ← 村莊遊戲本體（Phaser）
  index.html            ← 場景進入點 + 載入所有 village 腳本（cache 版本號在這）
  explore.js            ← Phaser 場景：地圖載入、走動、傳送門、互動
  shop.js               ← 所有面板：學院答題/商店/任務/公布欄/裝備/角色…
  demo_state.js         ← 生活區狀態（種田/裝備/造型）接後端、跨裝置同步
  farm.js / crop.js     ← 種田牧場
  play_limit.js         ← 防沉迷強制休息
  mp.js                 ← 多人（colyseus）
assets/                 ← 地圖 config（JSON，map-editor 產出）+ 圖
arcade/                 ← 獨立小遊戲共用墊片
Caddyfile               ← 靜態服務設定（COEP、題目圖反向代理）
```

## 改版號（cache-bust，務必記得）

改了任何 JS/CSS，要去**引用它的 HTML 把 `?v=N` 加一**，否則玩家還是吃舊檔。
village 腳本的版本號集中在 [`village-web/index.html`](village-web/index.html)。
詳見 [HANDOVER.md](HANDOVER.md) 的「地雷」一節。

## 部署

`git push` 到 `main` → Railway 自動部署。前端、後端各一個 Railway service，都吃自己的 repo。
驗證方式、service 名稱、env 變數 → [HANDOVER.md](HANDOVER.md)。
