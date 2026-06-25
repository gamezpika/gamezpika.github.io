// demo_state.js — demo 站前端狀態接後端
// Phase 1：職業 village_job / 精通 village_mastery（全域鍵：localStorage 名＝後端名）。
// Phase 2：裝備 village_equip / 造型 village_outfits_owned / 農場 campus_crops、campus_harvest、campus_livestock
//          （accNS「base::child_id」帳號前綴鍵：後端存 base 名，localStorage 用 accNS(base)）。
// 目的：綁帳號 + 跨裝置 + 後台改得到。機制：進村莊 hydrate（後端→localStorage），寫入時 write-through（debounce）。
// 訪客（沒 token）不同步，維持純本地。
(function () {
  var API = window.EDU_API || "https://eduarena-tutoring-production.up.railway.app";
  var GLOBAL_KEYS = ["village_job", "village_mastery"];
  var NS_KEYS = ["village_equip", "village_outfits_owned", "campus_crops", "campus_harvest", "campus_livestock"];
  var ALL_KEYS = GLOBAL_KEYS.concat(NS_KEYS);
  var OWNER_KEY = "demo_state_owner";          // 全域鍵歸屬哪個 child_id（防共用裝置串帳號）
  var NS_SYNCED_KEY = "demo_state_ns_synced";  // 前綴鍵已同步集合 {"base::cid":true}（分辨 rollout 遷移 vs admin 刪除清掉）

  function token() {
    try { return localStorage.getItem("eduarena_demo_token") || ""; } catch (e) { return ""; }
  }
  function childId() {
    try { return localStorage.getItem("eduarena_demo_child_id") || ""; } catch (e) { return ""; }
  }
  function isNS(base) { return NS_KEYS.indexOf(base) >= 0; }

  // 前綴鍵的實際 localStorage 名：在「載入當下」快取 accNS(base)——跟 farm.js/crop.js/shop.js 的 const 同一時點、
  // 同一 child_id。否則訪客 provision 後 child_id 由無變有，demo_state 動態算出的鍵會跟 readers 當初寫的鍵對不上。
  var NS_LS = {};
  try {
    for (var _i = 0; _i < NS_KEYS.length; _i++) {
      var _b = NS_KEYS[_i];
      NS_LS[_b] = (typeof window.accNS === "function") ? window.accNS(_b) : _b;
    }
  } catch (e) {}
  function lsKey(base) { return isNS(base) ? (NS_LS[base] || base) : base; }

  function loadNsSynced() {
    try { var o = JSON.parse(localStorage.getItem(NS_SYNCED_KEY) || "{}"); return (o && typeof o === "object") ? o : {}; }
    catch (e) { return {}; }
  }
  function markNsSynced(base, cid) {
    try { var o = loadNsSynced(); o[base + "::" + cid] = true; localStorage.setItem(NS_SYNCED_KEY, JSON.stringify(o)); } catch (e) {}
  }
  function isNsSynced(base, cid) { return loadNsSynced()[base + "::" + cid] === true; }

  // dirty[base]＝這鍵本頁被本地改過（玩家操作或舊資料待遷移）：要上傳，且 hydrate 回應不准覆蓋。
  var timer = null, dirty = {};

  // 只把 dirty 的 base 鍵 POST 回後端（後端是部分鍵 merge）。keepalive=true 用於離開頁面時仍能送達。
  function postState(keepalive) {
    var t = token(); if (!t) return;
    var cid = childId();
    var sent = {};
    ALL_KEYS.forEach(function (base) {
      if (!dirty[base]) return;
      try { var v = localStorage.getItem(lsKey(base)); if (v != null) sent[base] = v; } catch (e) {}
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
        // 上傳成功＝後端已等於本地→清 dirty（但這鍵自送出後有新編輯則保留續傳）；前綴鍵另記「已同步」。
        sentKeys.forEach(function (base) {
          try {
            if (localStorage.getItem(lsKey(base)) === sent[base]) delete dirty[base];
            if (isNS(base)) markNsSynced(base, cid);
          } catch (e) {}
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
    postState(true);   // 不靠 timer：只要還有未確認的 dirty 就 keepalive 補送（postState 沒 dirty 會自行 return）
  }

  // hydrate：後端有的鍵覆蓋本地；後端缺鍵時——
  //   前綴鍵(已帳號隔離)：已同步過→被刪→清(尊重 admin/後端刪除)；沒同步過→rollout 舊資料→保留+上傳遷移。
  //   全域鍵：owner 戳記防串帳號——sameOwner→清(後端權威)；legacy(從沒同步過任何帳號)→遷移；別帳號→清。
  //   dirty 鍵一律跳過（玩家剛改的新值最大，稍後 scheduleUpload 上傳）。
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
        var prevLivestock = null;
        try { prevLivestock = localStorage.getItem(lsKey("campus_livestock")); } catch (e) {}
        ALL_KEYS.forEach(function (base) {
          try {
            if (dirty[base]) return;   // 本地剛改過→保留玩家新值
            var k = lsKey(base);
            var has = Object.prototype.hasOwnProperty.call(data, base) && typeof data[base] === "string";
            if (isNS(base)) {
              if (has) { localStorage.setItem(k, data[base]); markNsSynced(base, cid); }   // 後端有→權威+標記已同步
              else if (isNsSynced(base, cid)) { localStorage.removeItem(k); }                // 同步過卻沒了→被刪→清
              else if (localStorage.getItem(k) != null) { dirty[base] = true; }              // 沒同步過→rollout 舊資料→遷移
            } else {
              if (has) { localStorage.setItem(k, data[base]); }                              // 後端有→權威
              else if (sameOwner) { localStorage.removeItem(k); }                            // 已同步這帳號、後端被清→清
              else if (legacy) { if (localStorage.getItem(k) != null) dirty[base] = true; }  // 純前端舊資料→遷移
              else { localStorage.removeItem(k); }                                           // 別帳號殘留→清(防串帳號)
            }
          } catch (e) {}
        });
        try { localStorage.setItem(OWNER_KEY, cid); } catch (e) {}
        if (Object.keys(dirty).length) scheduleUpload();
        // 裝備/造型 hydrate 後可能變→若晚於 Phaser create，主動觸發走路 sprite live-swap（applyWalkOutfit 自帶比對/no-op）。
        try { if (typeof window.applyWalkOutfit === "function") window.applyWalkOutfit(); } catch (e) {}
        // 牧場動物只在 attach 時 spawn 一次→livestock 真的變了才重建（種田每幀自刷不用管）。
        try {
          if (localStorage.getItem(lsKey("campus_livestock")) !== prevLivestock && typeof window.refreshRanch === "function") window.refreshRanch();
        } catch (e) {}
        window.__demoStateHydrated = true;
        return true;
      })
      .catch(function () { return false; });
  }

  window.addEventListener("pagehide", flush);
  document.addEventListener("visibilitychange", function () { if (document.hidden) flush(); });

  window.DemoState = { hydrate: hydrate, save: save, flush: flush, KEYS: ALL_KEYS };
  // 載入即同步一次（Phaser 啟動期間就載回）
  hydrate();
})();
