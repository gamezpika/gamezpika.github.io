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

  var API = window.EDU_API || "https://eduarena-tutoring-production.up.railway.app";
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
      // 村莊風（同商店/布告欄：奶油底+棕木邊+金內框+棕字）
      "#pl-overlay{position:fixed;inset:0;z-index:30000;display:none;align-items:center;justify-content:center;" +
      "background:rgba(40,25,10,.6);backdrop-filter:blur(3px);font-family:-apple-system,'PingFang TC','Microsoft JhengHei',sans-serif;padding:24px}" +
      "#pl-overlay .box{position:relative;max-width:340px;width:88%;background:linear-gradient(180deg,#fff6e2,#ffeecb);" +
      "border:5px solid #8a5a2b;border-radius:22px;box-shadow:0 16px 44px rgba(0,0,0,.5),inset 0 0 0 3px #ffd98a;padding:26px 24px 24px;text-align:center}" +
      "#pl-overlay .pl-hero{width:104px;height:104px;object-fit:contain;margin:0 auto 6px;display:block;filter:drop-shadow(0 5px 6px rgba(0,0,0,.2))}" +
      "#pl-overlay h2{font-size:23px;font-weight:900;color:#7a4f1e;margin:0 0 12px;text-shadow:0 2px 0 #ffe9bf}" +
      "#pl-overlay p{font-size:15px;line-height:1.8;color:#9a6f3a;margin:0 0 16px;white-space:pre-line;font-weight:700}" +
      "#pl-overlay .cd{display:none;font-size:34px;font-weight:900;color:#8a5a2b;letter-spacing:2px;margin:4px 0 16px;text-shadow:0 2px 0 #ffe9bf}" +
      "#pl-overlay button{border:2px solid #ffd98a;border-radius:999px;padding:12px 26px;font-size:15px;font-weight:900;cursor:pointer;" +
      "color:#fff7e6;background:linear-gradient(180deg,#b5712f,#94591f);box-shadow:0 4px 0 #6e4012}" +
      "#pl-overlay button:active{transform:translateY(2px);box-shadow:0 2px 0 #6e4012}";
    document.head.appendChild(st);
  }
  function overlay() {
    var o = document.getElementById("pl-overlay");
    if (!o) {
      injectCSS();
      o = document.createElement("div"); o.id = "pl-overlay";
      o.innerHTML = '<div class="box">' +
        '<img id="pl-hero" class="pl-hero" alt="">' +
        '<h2 id="pl-title"></h2><p id="pl-msg"></p><div class="cd" id="pl-cd" style="display:none"></div>' +
        '<button id="pl-btn">重新整理</button></div>';
      document.body.appendChild(o);
      document.getElementById("pl-btn").onclick = function () { tick(); };
    }
    return o;
  }
  function showLock() {
    var o = overlay(); o.style.display = "flex";
    document.getElementById("pl-hero").src = "pl_sleep.webp?v=1";
    document.getElementById("pl-title").textContent = "今天玩夠了～";
    document.getElementById("pl-msg").textContent = "記得吃飯、運動、睡覺，\n明天再來繼續冒險！";
    document.getElementById("pl-cd").style.display = "none";
    document.getElementById("pl-btn").style.display = "";
  }
  var restTimer = null;
  function showRest(sec) {
    var o = overlay(); o.style.display = "flex";
    document.getElementById("pl-hero").src = "pl_alarm.webp?v=1";
    document.getElementById("pl-title").textContent = "休息一下～";
    document.getElementById("pl-msg").textContent = "玩太久了，先休息一下，\n時間到自動繼續。";
    var cd = document.getElementById("pl-cd"); cd.style.display = "block";
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

  // ── 右上「今日剩 X 分」常駐牌子（跟裝備/速度同款 .hud-icon 木框，top:180 接在下面）──
  function ensureBadge() {
    var el = document.getElementById("pl-remain");
    if (!el) {
      el = document.createElement("div");
      el.id = "pl-remain"; el.className = "hud-icon"; el.style.top = "180px"; el.style.display = "none";
      el.innerHTML = '<span class="hud-slot"><img src="pl_alarm.webp?v=1" alt=""></span>' +
        '<span class="hud-label" id="pl-remain-label">剩 -- 分</span>';
      document.body.appendChild(el);
    }
    return el;
  }
  function updateBadge(s) {
    var el = ensureBadge();
    if ((s.limit_seconds || 0) <= 0 || s.locked || s.resting) { el.style.display = "none"; return; }   // 無限制/鎖屏/休息→不顯示
    el.style.display = "flex";
    var minLeft = Math.max(0, Math.ceil((s.remaining_seconds || 0) / 60));
    var lbl = document.getElementById("pl-remain-label");
    lbl.textContent = "剩 " + minLeft + " 分";
    var warn = minLeft <= 5;
    lbl.style.background = warn ? "rgba(176,42,42,.92)" : "";        // 快沒了變紅
    lbl.style.borderColor = warn ? "#ff9b8a" : "";
  }

  async function tick() {
    await heartbeat();
    var s = await status();
    if (!s) return;
    if (s.locked) showLock();
    else if (s.resting) showRest(s.rest_remaining_seconds || 0);
    else hide();
    updateBadge(s);
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
