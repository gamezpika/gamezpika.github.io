/* play_limit.js — demo 防沉迷（接真實後台同一套設定）
 * 用 demo 訪客 token（eduarena_demo_token，shop.js 載入時建）打真實後台 /api/play：
 *   - 每 30 秒 POST /api/play/heartbeat 累計玩時
 *   - 查 /api/play/status：locked→鎖屏、resting→強制休息倒數
 *   - 設定值（每日上限/連續/休息）讀後台同一套（admin /admin/settings 改即生效）
 * 展示豁免：網址加 ?nolimit=1 → 整個模組不作用（不追蹤、不鎖）。
 * 沒拿到訪客身分就靜默不追蹤（不弄壞遊戲）。
 */
(function () {
  "use strict";
  if (new URLSearchParams(location.search).get("nolimit") === "1") return;   // 展示豁免

  var API = "https://eduarena-tutoring-production.up.railway.app";
  var TICK_MS = 30000;          // 每 30 秒 heartbeat + 查 status
  var token = function () { try { return localStorage.getItem("eduarena_demo_token") || ""; } catch (e) { return ""; } };

  async function call(path, opts) {
    var t = token(); if (!t) return null;
    opts = opts || {};
    opts.headers = Object.assign({ "Authorization": "Bearer " + t }, opts.headers || {});
    try { var r = await fetch(API + path, opts); if (!r.ok) return null; return await r.json(); }
    catch (e) { return null; }
  }
  var heartbeat = function () { return call("/api/play/heartbeat", { method: "POST" }); };
  var status = function () { return call("/api/play/status"); };

  // ── 共用全螢幕遮罩 ──
  function injectCSS() {
    if (document.getElementById("pl-css")) return;
    var st = document.createElement("style"); st.id = "pl-css";
    st.textContent =
      "#pl-overlay{position:fixed;inset:0;z-index:30000;display:none;align-items:center;justify-content:center;" +
      "background:linear-gradient(135deg,#5b6fd6,#7a4fb0);font-family:-apple-system,'PingFang TC','Noto Sans TC',sans-serif;color:#fff;text-align:center;padding:24px}" +
      "#pl-overlay .box{max-width:360px;background:rgba(255,255,255,.14);backdrop-filter:blur(8px);border-radius:18px;padding:36px 26px;box-shadow:0 10px 36px rgba(0,0,0,.35)}" +
      "#pl-overlay .emoji{font-size:54px;margin-bottom:8px}" +
      "#pl-overlay h2{font-size:22px;margin:0 0 12px}" +
      "#pl-overlay p{font-size:15px;line-height:1.7;opacity:.95;margin:0 0 18px;white-space:pre-line}" +
      "#pl-overlay .cd{font-size:30px;font-weight:800;letter-spacing:1px;margin:6px 0 16px}" +
      "#pl-overlay button{border:none;border-radius:999px;padding:11px 22px;font-size:14px;font-weight:800;cursor:pointer;background:#ffd54f;color:#5a3a00}";
    document.head.appendChild(st);
  }
  function overlay() {
    var o = document.getElementById("pl-overlay");
    if (!o) {
      injectCSS();
      o = document.createElement("div"); o.id = "pl-overlay";
      o.innerHTML = '<div class="box"><div class="emoji" id="pl-emoji">😴</div>' +
        '<h2 id="pl-title"></h2><p id="pl-msg"></p><div class="cd" id="pl-cd" style="display:none"></div>' +
        '<button id="pl-btn">🔄 重新整理</button></div>';
      document.body.appendChild(o);
      document.getElementById("pl-btn").onclick = function () { tick(); };
    }
    return o;
  }
  function showLock() {
    var o = overlay(); o.style.display = "flex";
    document.getElementById("pl-emoji").textContent = "😴";
    document.getElementById("pl-title").textContent = "今天玩夠了～";
    document.getElementById("pl-msg").textContent = "記得吃飯、運動、睡覺，\n明天再來繼續冒險！";
    document.getElementById("pl-cd").style.display = "none";
    document.getElementById("pl-btn").style.display = "";
  }
  var restTimer = null;
  function showRest(sec) {
    var o = overlay(); o.style.display = "flex";
    document.getElementById("pl-emoji").textContent = "⏸";
    document.getElementById("pl-title").textContent = "休息一下～";
    document.getElementById("pl-msg").textContent = "玩太久了，先休息一下，\n時間到自動繼續。";
    var cd = document.getElementById("pl-cd"); cd.style.display = "";
    document.getElementById("pl-btn").style.display = "none";
    if (restTimer) clearInterval(restTimer);
    var left = Math.max(0, sec | 0);
    var render = function () {
      var m = Math.floor(left / 60), s = left % 60;
      cd.textContent = m + ":" + (s < 10 ? "0" : "") + s;
      if (left <= 0) { clearInterval(restTimer); restTimer = null; tick(); }   // 倒數完跟伺服器確認
      left -= 1;
    };
    render(); restTimer = setInterval(render, 1000);
  }
  function hide() {
    var o = document.getElementById("pl-overlay"); if (o) o.style.display = "none";
    if (restTimer) { clearInterval(restTimer); restTimer = null; }
  }

  async function tick() {
    await heartbeat();
    var s = await status();
    if (!s) return;
    if (s.locked) showLock();
    else if (s.resting) showRest(s.rest_remaining_seconds || 0);
    else hide();
  }

  // 等訪客 token（shop.js 載入時建）就緒才開始；最多等 30 秒，沒身分就不追蹤
  (async function start() {
    for (var i = 0; i < 30 && !token(); i++) { await new Promise(function (r) { setTimeout(r, 1000); }); }
    if (!token()) return;
    tick();
    setInterval(tick, TICK_MS);
  })();

  window.eduDemoPlayLimit = { tick: tick, status: status };   // debug
})();
