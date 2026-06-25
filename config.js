/* ────────────────────────────────────────────────────────────────────────
 * config.js — 全站「後端 API 位址」單一設定點（交接用）
 *
 * 要換後端（交接給別人 / 換 Railway service / 上自訂網址）只要改下面這一行。
 * 各前端 JS 仍各自保留同樣字串當 fallback：萬一某頁忘了載 config.js 也不會壞，
 * 會自動退回這個預設值（＝目前正式後端）。所以這支是「覆蓋點」，不是唯一定義點。
 *
 * 也支援用網址參數 ?api=http://localhost:8000 臨時覆蓋（本機測試指到本機後端）。
 *
 * 注意：還有兩處後端網址不在這裡，換後端時要一起改（見 HANDOVER.md）：
 *   1) Caddyfile 的題目圖反向代理（/static/images/q/* → 後端圖床 + 48b09 failover）
 *   2) 各頁面零星寫死的 demo 自身網址（活躍 ping 等，grep up.railway.app 找）
 * ──────────────────────────────────────────────────────────────────────── */
(function () {
  var override = null;
  try { override = new URLSearchParams(location.search).get("api"); } catch (e) {}
  window.EDU_API = override || "https://eduarena-tutoring-production.up.railway.app";
})();
