// demo_state.js — demo 站前端狀態接後端（職業 village_job / 精通 village_mastery）
// 目的：綁帳號 + 跨裝置 + 後台 test-tools 改得到。原本這些是純前端 localStorage。
// 機制：進村莊先 hydrate（後端→localStorage），寫入時 write-through（localStorage→後端，debounce）。
// 訪客（沒登入、沒 token）不同步，維持純本地。Phase 1 只管職業+精通；Phase 2 再把 equip/farm 鍵加進 KEYS。
(function () {
  var API = "https://eduarena-tutoring-production.up.railway.app";
  var KEYS = ["village_job", "village_mastery"];
  var OWNER_KEY = "demo_state_owner";   // 這兩個 global 鍵目前屬於哪個 child_id（用來分辨「我的舊資料」vs「別帳號殘留」）

  function token() {
    try { return localStorage.getItem("eduarena_demo_token") || ""; } catch (e) { return ""; }
  }
  function childId() {
    try { return localStorage.getItem("eduarena_demo_child_id") || ""; } catch (e) { return ""; }
  }

  // dirty[k]＝這鍵本頁被本地改過（玩家選職業/長精通，或舊資料待遷移）：要上傳，且 hydrate 回應不准覆蓋。
  var timer = null, dirty = {};

  // 只把 dirty 鍵 POST 回後端（後端是部分鍵 merge）。keepalive=true 用於離開頁面時仍能送達。
  // 只送 dirty——避免在 hydrate 清掉別帳號殘留前，把那些非 dirty 的舊值夾帶上傳到新帳號。
  function postState(keepalive) {
    var t = token(); if (!t) return;
    var sent = {};
    KEYS.forEach(function (k) {
      if (!dirty[k]) return;
      try { var v = localStorage.getItem(k); if (v != null) sent[k] = v; } catch (e) {}
    });
    var sentKeys = Object.keys(sent);
    if (!sentKeys.length) return;
    var opts = {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + t },
      body: JSON.stringify({ data: sent })
    };
    if (keepalive) opts.keepalive = true;   // sendBeacon 無法帶 Bearer header，改用 fetch keepalive
    try {
      fetch(API + "/api/demo/state", opts).then(function (r) {
        if (!r || !r.ok) return;
        // 上傳成功＝後端已等於本地→清 dirty，讓之後的 hydrate 能套用後端權威值(如 admin reset)。
        // 但只在這鍵自送出後沒再被改過(值仍相同)才清；若已有新編輯則保留 dirty 續傳。
        sentKeys.forEach(function (k) {
          try { if (localStorage.getItem(k) === sent[k]) delete dirty[k]; } catch (e) {}
        });
      }).catch(function () {});
    } catch (e) {}
  }

  function scheduleUpload() {
    if (!token()) return;   // 還沒 token（訪客 provision 中）→先擱著，等 hydrate 重跑時再把 dirty 補上傳
    if (timer) clearTimeout(timer);
    timer = setTimeout(function () { timer = null; postState(false); }, 600);
  }
  function save(key) {
    if (key) dirty[key] = true;
    scheduleUpload();
  }
  function flush() {
    if (timer) { clearTimeout(timer); timer = null; }
    // 不靠 timer 判斷：只要還有未被後端確認的 dirty 鍵就 keepalive 補送
    // （debounce 已觸發但 fetch 還在途/失敗時，離開頁面也能補上；postState 沒 dirty 會自行 return）。
    postState(true);
  }

  // hydrate：後端有的鍵覆蓋本地；後端缺鍵時依「這台裝置是否已為這帳號同步過」決定：
  //   sameOwner（已同步過這帳號）→ 後端全權威，缺鍵＝被清(admin reset / null 刪)→本地跟著清。
  //   legacy（從沒同步過任何帳號）→ 現有本地值是純前端時代舊資料 → 認領給現帳號 + 標記上傳遷移（救老玩家）。
  //   其餘（owner 是別帳號：換帳號 / 訪客）→ 不沿用，清掉。
  // dirty 鍵一律跳過（玩家剛改的新值最大，稍後 scheduleUpload 上傳）。
  function hydrate() {
    var t = token();
    if (!t) return Promise.resolve(false);
    var cid = childId();
    return fetch(API + "/api/demo/state", { headers: { Authorization: "Bearer " + t } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        if (!j || typeof j.data !== "object" || j.data === null) return false;
        var data = j.data;
        var owner = "";
        try { owner = localStorage.getItem(OWNER_KEY) || ""; } catch (e) {}
        var sameOwner = (owner === cid);
        var legacy = (owner === "");
        KEYS.forEach(function (k) {
          try {
            if (dirty[k]) return;   // 本地剛改過→保留玩家新值，不被這次 hydrate 覆蓋
            if (Object.prototype.hasOwnProperty.call(data, k) && typeof data[k] === "string") {
              localStorage.setItem(k, data[k]);                       // 後端有值→後端為真相
            } else if (sameOwner) {
              localStorage.removeItem(k);                             // 已同步過這帳號、後端現在沒有→後端被清→跟著清
            } else if (legacy && localStorage.getItem(k) != null) {
              dirty[k] = true;                                        // 純前端舊資料→保留並標記上傳遷移
            } else {
              localStorage.removeItem(k);                             // 別帳號殘留→清掉不沿用
            }
          } catch (e) {}
        });
        try { localStorage.setItem(OWNER_KEY, cid); } catch (e) {}
        // 遷移的舊資料 + 在 token/基準就緒前玩家就改好的 dirty 鍵，現在才有 token，補上傳。
        if (Object.keys(dirty).length) scheduleUpload();
        window.__demoStateHydrated = true;
        return true;
      })
      .catch(function () { return false; });
  }

  window.addEventListener("pagehide", flush);
  document.addEventListener("visibilitychange", function () { if (document.hidden) flush(); });

  window.DemoState = { hydrate: hydrate, save: save, flush: flush, KEYS: KEYS };
  // 載入即同步一次（Phaser 啟動期間就載回，玩家點開職業/精通面板前完成；兩鍵開機都不讀，故 fire-and-forget 安全）
  hydrate();
})();
