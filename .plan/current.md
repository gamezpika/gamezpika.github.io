# Feature: 小智學園前端 — 金流 webhook 接入 + 單次時間鎖

> 接手自 Patrick 的純前端 Phaser 村莊 demo。本 plan 鎖定兩個募資文案明確承諾、但實作未做的功能。
> 受 stop_gate.sh 完成度契約管控；驗收命令 exit 0 = pass。

## Status

- 開始日期：2026-06-25
- 預計完工：未定（接手後第二輪迭代）
- 主導 session：本 session
- **研究來源**：暫缺正式 research_*.md；對標依據來自募資文案附錄 + 線上產品實測
- **本 plan 由**：2026-06-25 Frank 拍板「金流 + 時間鎖未來這邊接續處理」

## 背景與動機

募資文案 `xiaozhi_funding_v1.docx` 第 ④ 段「特色五：零內購 × 時間鎖 × 全訂閱制」是嘖嘖／flyingV 平台對家長最關鍵的信任承諾。實際 grep `core/parent_api.py:67` 看到 gateway 只有預留字串 `trial/ecpay/linepay/manual`，註解 `:292` 明寫「未串金流前：先建 pending，真正付款成功由 webhook 轉 active」；`game_math.py:398` 註解寫「玩時控管已改用 daily_play_logs（5/2 鵝董會議要求）」— 只有每日累計 log，沒做「單次連續上限 + 強制休息」。文案領先實作，是上線最大風險。

## 對標產品（必填）

| 對標 | 對照面向 | 量化 threshold | 來源 |
|------|----------|----------------|------|
| Prodigy Math（北美最大遊戲化數學 RPG） | 家長訂閱訂價模型 + 兒童遊戲時間提醒 | A ≥ 0.80（金流／訂閱閘流程一致度） | 線上實測 prodigygame.com/parents |
| 均一教育平台（台灣本地 SaaS） | ECPay / 信用卡訂閱 webhook 流程；家長後台 | B ≥ 0.70（金流端對端可下單成功） | junyiacademy.org 開戶實測 |
| 任天堂 Switch 家長監控 App | 單次時段上限 + 強制休息間隔 UX | C ≥ 0.60（時間鎖閘行為一致） | Nintendo Switch Parental Controls |

> threshold check 細節在實作期間補。先用三個對標確認方向，不會偏掉。

## Must-have

- [ ] M1：ECPay 訂閱 webhook 接入 — `parent_api.py` `gateway=ecpay` 真實扣款 / 退款 / 續約三個 event 都能正確轉 entitlement 狀態
  - 驗收：`pytest tests/test_ecpay_webhook.py -q`（mock ecpay 三種 event payload，DB entitlement 狀態符合預期）
  - 對標達標：A ≥ 0.80（Prodigy / 均一 webhook 流程一致）
  - 來源：募資文案 §④ 特色五；`core/parent_api.py:67/292/311`
  - data_source：`external_api: https://payment-stage.ecpay.com.tw/...` + `db: subscriptions / payments 表`
- [ ] M2：LINE Pay 訂閱 webhook 接入（同 M1 但走 LINE Pay）
  - 驗收：`pytest tests/test_linepay_webhook.py -q`
  - 對標達標：A ≥ 0.80
  - 來源：同 M1；台灣家長偏好 LINE Pay
  - data_source：`external_api: https://sandbox-api-pay.line.me/...` + `db: subscriptions / payments`
- [ ] M3：單次連續玩時上限 + 強制休息間隔（session 級時間鎖）
  - 規則：單次連續 ≤ 30 分鐘 → 強制 10 分鐘休息；每日累計 ≤ 90 分鐘（鵝董會議基準 + 衛福部建議）
  - 驗收：`pytest tests/test_time_lock.py -q`（模擬連續 31 分鐘 → API 回 423 Locked；休息 10 分後恢復）
  - 對標達標：C ≥ 0.60（Switch 家長監控行為一致）
  - 來源：募資文案 §④ 特色五「單次登入時間有上限、強制休息間隔」
  - data_source：`db: daily_play_logs（已存在）+ 新增 session_play_logs` + `compute: 連續時段判定`

## Should-have

- [ ] S1：家長端 App SPA — 每週 AI 報告呈現頁面（後端 `mgmt_report.py` 已有 API，缺前端）
  - 驗收：`curl https://eduarena-skill-demo-production.up.railway.app/parent/report?child_id=X` 200 + 渲染檢查
  - 對標達標：B ≥ 0.70（均一家長後台對齊）
  - 來源：募資文案 §④ 特色四「AI 成長報告」
  - data_source：`external_api: tutoring /api/parent/report` + `compute: 前端排版`
- [ ] S2：訂閱方案頁 / 金流前端表單（觸發 M1/M2 webhook）
  - 驗收：手動 E2E — 嘖嘖 7 檔方案下單到 ECPay 沙箱完成
  - 對標達標：B ≥ 0.70
  - 來源：募資文案 §⑤ SKU 表
  - data_source：`external_api: tutoring /api/parent/subscribe` + `user_input: 方案 key / 信用卡資訊`

## Nice-to-have

- [ ] N1：時間鎖到期前 5 分鐘倒數提示（村莊內彈窗 + 角色台詞）
  - 來源：UX 友善
  - data_source：`compute: 從 session_play_logs 算剩餘時間`

## 風險與已知問題

- 金流測試需要 ECPay / LINE Pay 沙箱帳號（請 Patrick 提供或 Frank 自開）
- 時間鎖跟答題 session in-memory 狀態互動可能有 edge case（HANDOVER §7 提到 in-memory session、redeploy 會清）
- 鵝董基準的「90 分鐘」需跟教育顧問再確認，是否符合最新衛福部數位指引

## 對話 / 決策紀錄

- 2026-06-25：Frank 拍板「金流 webhook + 時間鎖未來由我們這邊接續處理」（非 Patrick）— 本 plan 啟動
