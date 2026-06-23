// demo_state.js — demo 站前端狀態接後端（職業 village_job / 精通 village_mastery）
// 目的：綁帳號 + 跨裝置 + 後台 test-tools 改得到。原本這些是純前端 localStorage。
// 機制：進村莊先 hydrate（後端→localStorage，後端為真相），寫入時 write-through（localStorage→後端，debounce）。
// 訪客（沒登入、沒 token）不同步，維持純本地。Phase 1 只管職業+精通；Phase 2 再把 equip/farm 鍵加進 KEYS。
(function () {
  var API = "https://eduarena-tutoring-production.up.railway.app";
  var KEYS = ["village_job", "village_mastery"];

  function token() {
    try { return localStorage.getItem("eduarena_demo_token") || ""; } catch (e) { return ""; }
  }

  // 後端為真相：後端有的鍵覆蓋 localStorage、後端沒有的鍵清掉
  // （這兩個是全域鍵、非帳號前綴，清掉才不會讓共用裝置沿用上一個帳號的舊值）
  function hydrate() {
    var t = token();
    if (!t) return Promise.resolve(false);
    return fetch(API + "/api/demo/state", { headers: { Authorization: "Bearer " + t } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        if (!j || typeof j.data !== "object" || j.data === null) return false;
        var data = j.data;
        KEYS.forEach(function (k) {
          try {
            if (Object.prototype.hasOwnProperty.call(data, k) && typeof data[k] === "string") {
              localStorage.setItem(k, data[k]);
            } else {
              localStorage.removeItem(k);
            }
          } catch (e) {}
        });
        window.__demoStateHydrated = true;
        return true;
      })
      .catch(function () { return false; });
  }

  // write-through：把目前 localStorage 的受管鍵整包 POST 回後端（debounce 合併連續寫入）
  var timer = null;
  function save() {
    var t = token();
    if (!t) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(function () {
      timer = null;
      var data = {};
      KEYS.forEach(function (k) {
        try { var v = localStorage.getItem(k); if (v != null) data[k] = v; } catch (e) {}
      });
      fetch(API + "/api/demo/state", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + t },
        body: JSON.stringify({ data: data })
      }).catch(function () {});
    }, 600);
  }

  window.DemoState = { hydrate: hydrate, save: save, KEYS: KEYS };
  // 載入即同步一次（Phaser 啟動期間就載回，玩家點開職業/精通面板前完成；兩鍵開機都不讀，故 fire-and-forget 安全）
  hydrate();
})();
