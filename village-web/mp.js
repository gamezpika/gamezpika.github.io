// 多人整合層（整合波，feature flag）：?mp=1 才連線。
// 把雲端 colyseus world room 的其他玩家畫進真實 Phaser 村莊（重用 hero 走路動畫）。
// 完全獨立模組，explore.js 只在 create/update 末尾各呼叫一個 window.__mp.*（沒載入＝無作用）。
(function () {
  "use strict";
  if (new URLSearchParams(location.search).get("mp") !== "1") return; // feature flag：預設關＝單機 demo 不變

  var EP = "wss://colyseus-production-34e9.up.railway.app";
  var myUid = "mp" + Math.floor((Date.now() + performance.now()) % 1e9);
  var myName = (localStorage.getItem("village_player_name") || "玩家") + myUid.slice(-3);

  var room = null, connecting = false, remotes = {}, lastSend = 0, curScene = null;

  function connect() {
    if (room || connecting || typeof Colyseus === "undefined") return;
    connecting = true;
    var client = new Colyseus.Client(EP);
    client.joinOrCreate("world", { uid: myUid, name: myName, outfit: "default" })
      .then(function (r) {
        room = r; connecting = false;
        buildChat();
        r.onMessage("chat", function (m) { addChat(m.uid === myUid ? "me" : "", (m.channel === "near" ? "[附近]" : "") + m.name + "：" + m.text + (m.masked ? "（已過濾）" : "")); });
        r.onMessage("system", function (m) { addChat("sys", m.text); });
        r.onMessage("chat_blocked", function (m) { addChat("blk", blockMsg(m.reason)); });
      })
      .catch(function () { connecting = false; });
  }

  // ── 村莊內聊天 UI（接 server 第2波安全聊天：髒話/個資過濾、頻道）──
  function buildChat() {
    if (document.getElementById("mp-chat")) return;
    var box = document.createElement("div");
    box.id = "mp-chat";
    box.innerHTML =
      '<div id="mp-log" style="max-height:22vh;overflow-y:auto;font-size:13px;line-height:1.5;color:#fff;text-shadow:0 1px 2px #000;margin-bottom:4px"></div>' +
      '<div style="display:flex;gap:5px"><input id="mp-in" maxlength="120" placeholder="跟村莊裡的人說話…" style="flex:1;min-width:0;padding:7px 9px;border:none;border-radius:9px;font-size:14px"><button id="mp-send" style="border:none;border-radius:9px;padding:7px 12px;background:#4a9fff;color:#fff;font-weight:700">送</button></div>';
    box.style.cssText = "position:fixed;left:8px;bottom:8px;width:min(340px,72vw);z-index:9000;font-family:sans-serif;background:rgba(8,12,30,.35);border-radius:10px;padding:6px";
    document.body.appendChild(box);
    var input = document.getElementById("mp-in");
    function send() { var t = (input.value || "").trim(); if (!t || !room) return; try { room.send("chat", { text: t, channel: "world" }); } catch (e) {} input.value = ""; }
    document.getElementById("mp-send").addEventListener("click", send);
    input.addEventListener("keydown", function (e) { e.stopPropagation(); if (e.key === "Enter") send(); }); // 擋住 Phaser 鍵盤
    // 打字時關閉遊戲鍵盤（免得打 wasd 走人）；離開恢復
    input.addEventListener("focus", function () { if (curScene && curScene.input && curScene.input.keyboard) curScene.input.keyboard.enabled = false; });
    input.addEventListener("blur", function () { if (curScene && curScene.input && curScene.input.keyboard) curScene.input.keyboard.enabled = true; });
  }
  function addChat(cls, text) {
    var log = document.getElementById("mp-log"); if (!log) return;
    var e = document.createElement("div");
    if (cls === "sys") e.style.color = "#9fd3ff"; else if (cls === "blk") e.style.color = "#ff8a8a"; else if (cls === "me") e.style.color = "#ffd24a";
    e.textContent = text; log.appendChild(e); log.scrollTop = log.scrollHeight;
    while (log.childNodes.length > 50) log.removeChild(log.firstChild);
  }
  function blockMsg(r) {
    if (r && r.indexOf("pii") === 0) return "⛔ 含個資（電話/Email/連結），已擋下保護你";
    if (r === "abuse") return "⛔ 含不當用語，已擋下";
    if (r === "rate") return "⏳ 說太快了，慢一點";
    return "⛔ 訊息已擋下";
  }

  // 建一個遠端玩家的 sprite（重用主角 hero 走路動畫）+ 名牌
  function createRemote(scene, p) {
    var spr = scene.add.sprite(p.x, p.y, "hero", 0).setOrigin(0.5, 1).setScale(0.6);
    if (scene.anims.exists("hero_idle")) spr.play("hero_idle");
    var label = scene.add.text(p.x, p.y - 60, p.name || "玩家", {
      fontFamily: "sans-serif", fontSize: "15px", color: "#ffffff",
      stroke: "#1a2240", strokeThickness: 4,
    }).setOrigin(0.5, 1);
    return { spr: spr, label: label, x: p.x, y: p.y, tx: p.x, ty: p.y, dir: p.dir, moving: false, name: p.name };
  }
  function destroyRemote(r) { if (r.spr) r.spr.destroy(); if (r.label) r.label.destroy(); }

  // 每幀朝目標座標插值 + 切走路/idle 動畫
  function stepRemote(r) {
    r.x += (r.tx - r.x) * 0.25;
    r.y += (r.ty - r.y) * 0.25;
    r.spr.x = r.x; r.spr.y = r.y;
    r.spr.setDepth(r.y);
    r.label.x = r.x; r.label.y = r.y - 56;
    r.label.setDepth(r.y + 1);
    var key = "hero_idle";
    if (r.moving) key = r.dir === "up" ? "hero_walk_up" : (r.dir === "down" ? "hero_walk_down" : "hero_walk");
    var cur = r.spr.anims.currentAnim;
    if (r.spr.scene && r.spr.scene.anims.exists(key) && (!cur || cur.key !== key)) r.spr.play(key);
    if (key === "hero_walk") r.spr.setFlipX((r.tx - r.spr.x) < -0.5); // 朝移動方向
  }

  window.__mp = {
    count: function () { return Object.keys(remotes).length; },     // 驗證用：看到幾個遠端玩家
    connected: function () { return !!room; },
    // explore.js create() 末尾呼叫：換地圖(scene.restart)會重跑 → 重置遠端 sprite
    onSceneCreate: function (scene) {
      curScene = scene;
      remotes = {}; // 舊場景的 sprite 已被 Phaser 銷毀，清掉參照
      connect();
    },
    // explore.js update() 末尾呼叫：送自己位置 + 渲染其他人
    onUpdate: function (scene, x, y, dx, dy, moving) {
      curScene = scene;
      if (!room || !room.state) return;
      var now = performance.now();
      var dir = Math.abs(dx) > Math.abs(dy) ? "side" : (dy > 0 ? "down" : "up");
      if (now - lastSend > 80) { try { room.send("move", { x: x, y: y, dir: dir, moving: !!moving }); } catch (e) {} lastSend = now; }

      var seen = {};
      room.state.players.forEach(function (p, key) {
        if (key === room.sessionId) return; // 跳過自己
        seen[key] = 1;
        var r = remotes[key];
        if (!r) { r = createRemote(scene, p); remotes[key] = r; }
        r.tx = p.x; r.ty = p.y; r.dir = p.dir; r.moving = !!p.moving; r.name = p.name;
        if (r.label.text !== p.name) r.label.setText(p.name);
      });
      Object.keys(remotes).forEach(function (key) {
        if (!seen[key]) { destroyRemote(remotes[key]); delete remotes[key]; }
        else stepRemote(remotes[key]);
      });
    },
  };
})();
