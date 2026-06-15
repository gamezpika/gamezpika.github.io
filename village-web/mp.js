// 多人整合層（整合波，feature flag）：?mp=1 才連線。
// 把雲端 colyseus world room 的其他玩家畫進真實 Phaser 村莊（重用 hero 走路動畫）。
// 完全獨立模組，explore.js 只在 create/update 末尾各呼叫一個 window.__mp.*（沒載入＝無作用）。
// ⚠️ 對戰(PK)/排行 已移除——EDU 專案本來就有完整真人 PK + 王榜，不重複造（見記憶分析）。
//    這層只做 EDU 缺的「共享即時世界」：同場可見 / 聊天 / 裝扮 / 好友。
(function () {
  "use strict";
  if (new URLSearchParams(location.search).get("mp") !== "1") return; // feature flag：預設關＝單機 demo 不變

  var EP = "wss://colyseus-production-34e9.up.railway.app";
  var myUid = "mp" + Math.floor((Date.now() + performance.now()) % 1e9);
  var myName = (localStorage.getItem("village_player_name") || "玩家") + myUid.slice(-3);

  var room = null, connecting = false, remotes = {}, lastSend = 0, curScene = null, mpClient = null, mySkin = "default", lastSkinCheck = 0;
  function el(id) { return document.getElementById(id); }

  // ── 裝扮造型：用 demo 自己的走路圖（與本地玩家同命名規則），各遠端玩家各自載自己真實的造型 ──
  var outfitReady = {}, outfitLoading = {}, outfitFailed = {};
  function frameDimsOf(scene, key) { var t = scene.textures.get(key); var f = t.get(0); return { w: f.width, h: f.height, n: t.frameTotal - 1 }; }
  // 白名單：只認 demo 真實 outfit id（含預設），未知一律回 default，避免去載不存在的圖造成 404/loader 壓力
  function validSkin(id) {
    if (!id || id === "default" || id === "default_f" || id === "default_m") return id || "default";
    try { if (typeof WALK_OUTFIT_IDS !== "undefined" && WALK_OUTFIT_IDS.indexOf(id) >= 0) return id; } catch (e) {}
    return "default";
  }
  // 本地玩家目前造型 id（對齊 explore.js 的 walkOutfitCurrent）
  function localSkin() { try { return validSkin((typeof walkOutfitCurrent === "function" && walkOutfitCurrent().id) || "default"); } catch (e) { return "default"; } }
  // 造型 id → 3 方向圖檔（對齊 explore.js：男生預設 player3/1/2、女生預設 walk_f_default、其餘 walk_<id>）
  function skinSheets(id) {
    if (!id || id === "default" || id === "default_m") return { side: "player3.webp", down: "player1.webp", up: "player2.webp" };
    if (id === "default_f") return { side: "walk_f_default_side.webp", down: "walk_f_default_down.webp", up: "walk_f_default_up.webp" };
    return { side: "walk_" + id + "_side.webp", down: "walk_" + id + "_down.webp", up: "walk_" + id + "_up.webp" };
  }

  // 動態載入某造型的 3 方向走路圖 + 建動畫（所有造型與 config player 同 frame 規格，借 hero dims）。回 anim 前綴(ready) 或 null。
  function ensureOutfitAnims(scene, skinId) {
    var id = validSkin(skinId);
    var prefix = "mp_o_" + id.replace(/[^a-zA-Z0-9_]/g, "");
    if (outfitReady[id]) return prefix;
    if (scene.anims.exists(prefix + "_walk")) { outfitReady[id] = true; return prefix; } // 換地圖後 anims 仍在
    if (outfitFailed[id] || outfitLoading[id]) return null; // 載失敗過就別每幀重打 loader
    if (!scene.textures.exists("hero") || !scene.textures.exists("hero_down") || !scene.textures.exists("hero_up")) return null;
    var base = scene.assetBase || "", f = skinSheets(id);
    var d = { side: frameDimsOf(scene, "hero"), down: frameDimsOf(scene, "hero_down"), up: frameDimsOf(scene, "hero_up") };
    outfitLoading[id] = true;
    if (!scene.textures.exists(prefix + "_side")) scene.load.spritesheet(prefix + "_side", base + f.side + "?v=4", { frameWidth: d.side.w, frameHeight: d.side.h });
    if (!scene.textures.exists(prefix + "_down")) scene.load.spritesheet(prefix + "_down", base + f.down + "?v=4", { frameWidth: d.down.w, frameHeight: d.down.h });
    if (!scene.textures.exists(prefix + "_up")) scene.load.spritesheet(prefix + "_up", base + f.up + "?v=4", { frameWidth: d.up.w, frameHeight: d.up.h });
    scene.load.once("complete", function () {
      // 三張圖任一 404 → 標記 failed 退回 default，別每幀重試
      if (!scene.textures.exists(prefix + "_side") || !scene.textures.exists(prefix + "_down") || !scene.textures.exists(prefix + "_up")) {
        outfitFailed[id] = true; outfitLoading[id] = false; return;
      }
      try {
        if (!scene.anims.exists(prefix + "_walk")) scene.anims.create({ key: prefix + "_walk", frames: scene.anims.generateFrameNumbers(prefix + "_side", { start: 0, end: d.side.n - 1 }), frameRate: 12, repeat: -1 });
        if (!scene.anims.exists(prefix + "_walk_down")) scene.anims.create({ key: prefix + "_walk_down", frames: scene.anims.generateFrameNumbers(prefix + "_down", { start: 0, end: d.down.n - 1 }), frameRate: 14, repeat: -1 });
        if (!scene.anims.exists(prefix + "_walk_up")) scene.anims.create({ key: prefix + "_walk_up", frames: scene.anims.generateFrameNumbers(prefix + "_up", { start: 0, end: d.up.n - 1 }), frameRate: 14, repeat: -1 });
        if (!scene.anims.exists(prefix + "_idle")) scene.anims.create({ key: prefix + "_idle", frames: [{ key: prefix + "_down", frame: 0 }], frameRate: 1 });
        outfitReady[id] = true;
      } catch (e) { outfitFailed[id] = true; }
      outfitLoading[id] = false;
    });
    scene.load.start();
    return null;
  }

  function connect() {
    if (room || connecting || typeof Colyseus === "undefined") return;
    connecting = true;
    mpClient = mpClient || new Colyseus.Client(EP);
    mySkin = localSkin();
    mpClient.joinOrCreate("world", { uid: myUid, name: myName, outfit: "default", skin: mySkin })
      .then(function (r) {
        room = r; connecting = false;
        buildChat();
        // 斷線重置：清回 null + 清遠端 sprite + 退避重連（否則 connect() 被永久擋住、畫面卡斷線前）
        r.onLeave(function () {
          room = null; connecting = false;
          Object.keys(remotes).forEach(function (k) { destroyRemote(remotes[k]); delete remotes[k]; });
          setTimeout(connect, 2000);
        });
        r.onMessage("chat", function (m) { addChat(m.uid === myUid ? "me" : "", (m.channel === "near" ? "[附近]" : "") + m.name + "：" + m.text + (m.masked ? "（已過濾）" : "")); });
        r.onMessage("system", function (m) { addChat("sys", m.text); });
        r.onMessage("chat_blocked", function (m) { addChat("blk", blockMsg(m.reason)); });
        r.onMessage("friends", function (m) { friendsData = m; renderFriends(); });
        r.onMessage("wallet", function (m) { myCoins = m.coins; var c = el("mp-coins"); if (c) c.textContent = "🪙 " + m.coins; });
        r.onMessage("me", function (m) { myCoins = m.coins; var c = el("mp-coins"); if (c) c.textContent = "🪙 " + m.coins; });
        r.onMessage("notice", function (n) { var t = noticeMsg(n); if (t) addChat("sys", t); });
        // 玩家造型以 server 實際 outfit 為準（default＝主角樣子）；不再強制亂配造型
        buildSocialUI();
      })
      .catch(function () { connecting = false; });
  }

  // ── 村莊內聊天 UI（接 server 安全聊天：髒話/個資過濾、頻道）──
  function buildChat() {
    if (el("mp-chat")) return;
    var box = document.createElement("div");
    box.id = "mp-chat";
    box.innerHTML =
      '<div id="mp-log" style="max-height:22vh;overflow-y:auto;font-size:13px;line-height:1.5;color:#fff;text-shadow:0 1px 2px #000;margin-bottom:4px"></div>' +
      '<div style="display:flex;gap:5px"><input id="mp-in" maxlength="120" placeholder="跟村莊裡的人說話…" style="flex:1;min-width:0;padding:7px 9px;border:none;border-radius:9px;font-size:14px"><button id="mp-send" style="border:none;border-radius:9px;padding:7px 12px;background:#4a9fff;color:#fff;font-weight:700">送</button></div>';
    // 上移到搖桿(左下 116px 高)上方，不擋住移動搖桿
    box.style.cssText = "position:fixed;left:8px;bottom:150px;width:min(320px,66vw);z-index:9000;font-family:sans-serif;background:rgba(8,12,30,.35);border-radius:10px;padding:6px";
    document.body.appendChild(box);
    var input = el("mp-in");
    function send() { var t = (input.value || "").trim(); if (!t || !room) return; try { room.send("chat", { text: t, channel: "world" }); } catch (e) {} input.value = ""; }
    el("mp-send").addEventListener("click", send);
    // 注音/拼音「確認候選字」的 Enter 不能當送出，否則送半成品 ㄅ 狂撞 rate limit。
    // isComposing/keyCode229 擋多數；再用 compositionend 時間戳擋「補送」那顆(部分瀏覽器 compositionend 後又來一個 keydown Enter，此時 isComposing 已 false)。
    var lastCompEnd = 0;
    input.addEventListener("compositionend", function () { lastCompEnd = performance.now(); });
    input.addEventListener("keydown", function (e) { e.stopPropagation(); if (e.key === "Enter" && !e.isComposing && e.keyCode !== 229 && (performance.now() - lastCompEnd) > 250) send(); }); // 擋住 Phaser 鍵盤
    input.addEventListener("focus", function () { if (curScene && curScene.input && curScene.input.keyboard) curScene.input.keyboard.enabled = false; pinChat(true); });
    input.addEventListener("blur", function () { if (curScene && curScene.input && curScene.input.keyboard) curScene.input.keyboard.enabled = true; pinChat(false); });
    bindKeyboardPin();
  }

  // ── 手機鍵盤彈出時把聊天框釘在鍵盤正上方（避免黑塊／輸入框被鍵盤蓋住）──
  // 用 top 對齊 visual viewport 底邊：iOS 的 position:fixed + bottom 在鍵盤升起時不可靠，會把框塞到鍵盤下面看不到。
  var pinBound = false;
  function kbHeight() {
    var vv = window.visualViewport; if (!vv) return 0;
    var layoutH = document.documentElement.clientHeight || window.innerHeight; // 版面高(iOS 不隨鍵盤縮)
    return Math.max(0, layoutH - (vv.offsetTop + vv.height)); // 鍵盤高 = 版面底 - 可視底
  }
  function placeChat(focused) {
    var box = el("mp-chat"); if (!box) return;
    var vv = window.visualViewport, kb = vv ? kbHeight() : 0, log = el("mp-log");
    if (focused && kb > 80) { // 真的有軟鍵盤才展開（桌機/硬體鍵盤 kb≈0 → 維持小框不蓋搖桿）
      // 鍵盤升起：把聊天框展開成「鍵盤上方的半透明聊天面板」，填滿可視區 →
      // 蓋掉 iOS 鍵盤頂上去後露出的底色一大塊黑，順便變成完整聊天記錄視圖
      box.style.bottom = "auto";
      box.style.top = (vv.offsetTop + 8) + "px";
      box.style.height = Math.max(120, vv.height - 16) + "px";
      box.style.right = "8px"; box.style.width = "auto";
      box.style.display = "flex"; box.style.flexDirection = "column";
      box.style.background = "rgba(8,12,30,.6)";
      if (log) { log.style.maxHeight = "none"; log.style.flex = "1"; }
      if (window.scrollY) window.scrollTo(0, 0); // 擋 iOS 自動把頁面捲上去
    } else {
      box.style.top = "auto"; box.style.height = "auto"; box.style.bottom = "150px";
      box.style.right = "auto"; box.style.width = "min(320px,66vw)";
      box.style.background = "rgba(8,12,30,.35)";
      if (log) { log.style.maxHeight = "22vh"; log.style.flex = ""; }
    }
  }
  function bindKeyboardPin() {
    if (pinBound || !window.visualViewport) return; pinBound = true;
    function reflow() { placeChat(document.activeElement === el("mp-in")); }
    window.visualViewport.addEventListener("resize", reflow);
    window.visualViewport.addEventListener("scroll", reflow);
  }
  function pinChat(on) {
    placeChat(on);
    // 鍵盤升降有動畫(~300ms)，補幾次重排確保最後落在鍵盤正上方
    if (on) { [120, 280, 450].forEach(function (t) { setTimeout(function () { placeChat(document.activeElement === el("mp-in")); }, t); }); }
  }
  function addChat(cls, text) {
    var log = el("mp-log"); if (!log) return;
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
    // 比例對齊本地玩家（每張地圖的 player.scale 不同，別寫死）；確認 sprite 還活著才採用
    var psc = (scene.playerSprite && scene.playerSprite.scene && scene.playerSprite.scaleX) || 0.66;
    var spr = scene.add.sprite(p.x, p.y, "hero", 0).setOrigin(0.5, 1).setScale(psc);
    if (scene.anims.exists("hero_idle")) spr.play("hero_idle");
    var label = scene.add.text(p.x, p.y - 60, p.name || "玩家", {
      fontFamily: "sans-serif", fontSize: "15px", color: "#ffffff",
      stroke: "#1a2240", strokeThickness: 4,
    }).setOrigin(0.5, 1);
    var r = { spr: spr, label: label, x: p.x, y: p.y, tx: p.x, ty: p.y, dir: p.dir, moving: false, name: p.name, skin: p.skin || "default", uid: p.uid };
    spr.setInteractive({ useHandCursor: true }); // 點玩家 → 加好友 / 送金幣
    spr.on("pointerdown", function () { openPMenu(r); });
    return r;
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
    var scene = r.spr.scene; if (!scene) return;
    var prefix = ensureOutfitAnims(scene, r.skin) || "hero"; // 造型 ready 用該玩家真實造型 anims，否則暫用 hero
    var suffix = r.moving ? (r.dir === "up" ? "_walk_up" : (r.dir === "down" ? "_walk_down" : "_walk")) : "_idle";
    var key = prefix + suffix;
    var cur = r.spr.anims.currentAnim;
    if (scene.anims.exists(key) && (!cur || cur.key !== key)) r.spr.play(key);
    if (suffix === "_walk") { // 朝移動方向翻轉（對齊本地玩家：讀 side.facing，村莊 side 圖朝左）
      var sideCfg = (scene.config && scene.config.player && scene.config.player.sprites && scene.config.player.sprites.side) || {};
      var forwardRight = (sideCfg.facing || "right") === "right";
      var delta = r.tx - r.spr.x;
      if (delta > 0.5) r.spr.setFlipX(!forwardRight);      // 往右
      else if (delta < -0.5) r.spr.setFlipX(forwardRight); // 往左
    }
  }

  // ── 社交：好友 / 互送金幣，接雲端 world room 社交 handler（PK/排行已移除，用 EDU 既有的）──
  var friendsData = { friends: [], incoming: [], outgoing: [] }, myCoins = 0, pmTarget = null;
  function noticeMsg(n) {
    if (n.kind === "friend_sent") return "👥 已送出好友邀請";
    if (n.kind === "friend_added") return "🎉 你們成為好友了！";
    if (n.kind === "gift_sent") return "🎁 已送出 " + n.amount + " 金幣";
    if (n.kind === "gift_got") return "🎁 " + n.from + " 送你 " + n.amount + " 金幣！";
    if (n.kind === "gift_failed") return n.reason === "not_friend" ? "要先成為好友才能送金幣" : (n.reason === "no_coins" ? "金幣不夠" : "送金幣失敗");
    return "";
  }
  function buildSocialUI() {
    if (el("mp-friendbtn")) return;
    var coins = document.createElement("div"); coins.id = "mp-coins"; coins.textContent = "🪙 …";
    // 下移到「🎒 裝備」按鈕(top:14 right:14)下方，避免重疊
    coins.style.cssText = "position:fixed;right:10px;top:60px;z-index:9000;color:#ffd24a;font-weight:800;font-family:sans-serif;background:rgba(8,12,30,.5);padding:5px 9px;border-radius:9px";
    document.body.appendChild(coins);
    var fb = document.createElement("button"); fb.id = "mp-friendbtn"; fb.textContent = "👥 好友";
    fb.style.cssText = "position:fixed;right:10px;top:98px;z-index:9000;border:none;border-radius:12px;padding:9px 13px;font-size:13px;font-weight:800;color:#fff;font-family:sans-serif;background:linear-gradient(135deg,#6a5cff,#4a3fd6)";
    fb.addEventListener("click", function () { if (room) room.send("friendList"); el("mp-fpanel").style.display = "flex"; });
    document.body.appendChild(fb);
    // 好友面板
    var fp = document.createElement("div"); fp.id = "mp-fpanel"; fp.style.cssText = panelCss();
    fp.innerHTML = '<h3 style="margin:6px 0">👥 好友</h3><div id="mp-fincoming" style="width:min(360px,90vw)"></div><div id="mp-flist" style="width:min(360px,90vw);display:flex;flex-direction:column;gap:6px"></div><button id="mp-fclose" style="' + closeCss() + '">關閉</button>';
    document.body.appendChild(fp); el("mp-fclose").addEventListener("click", function () { fp.style.display = "none"; });
    // 點玩家彈出選單
    var pm = document.createElement("div"); pm.id = "mp-pmenu";
    pm.style.cssText = "position:fixed;left:50%;top:42%;transform:translateX(-50%);z-index:9600;display:none;flex-direction:column;gap:8px;background:#1a2348;border:1px solid #3a4a7a;border-radius:12px;padding:14px;font-family:sans-serif;color:#fff;text-align:center";
    pm.innerHTML = '<div id="mp-pmn" style="font-weight:800"></div><button id="mp-pm-friend" style="' + actCss() + '">👥 加好友</button><button id="mp-pm-gift" style="' + actCss() + '">🎁 送金幣</button><button id="mp-pm-x" style="' + actCss() + 'background:#444">取消</button>';
    document.body.appendChild(pm);
    el("mp-pm-friend").addEventListener("click", function () { if (room && pmTarget) room.send("friendRequest", { to: pmTarget.uid }); closePMenu(); });
    el("mp-pm-gift").addEventListener("click", function () { if (room && pmTarget) { var a = prompt("送多少金幣給 " + pmTarget.name + "？（需先成為好友）", "10"); if (a) room.send("giftCoins", { to: pmTarget.uid, amount: parseInt(a, 10) || 0 }); } closePMenu(); });
    el("mp-pm-x").addEventListener("click", closePMenu);
  }
  function panelCss() { return "position:fixed;inset:0;background:rgba(8,12,30,.96);z-index:9550;display:none;flex-direction:column;align-items:center;justify-content:flex-start;gap:10px;padding:24px;color:#fff;font-family:sans-serif;overflow-y:auto"; }
  function closeCss() { return "border:none;border-radius:14px;padding:11px 28px;font-weight:800;background:#444;color:#fff;margin-top:8px"; }
  function actCss() { return "border:none;border-radius:9px;padding:9px 16px;font-weight:700;background:#4a9fff;color:#fff;font-size:14px;"; }
  function rowCss() { return "display:flex;gap:8px;align-items:center;justify-content:space-between;width:min(360px,90vw);background:rgba(255,255,255,.07);border-radius:9px;padding:7px 11px"; }
  function openPMenu(r) { var n = el("mp-pmn"), m = el("mp-pmenu"); if (!n || !m) return; pmTarget = r; n.textContent = r.name; m.style.display = "flex"; }
  function closePMenu() { var m = el("mp-pmenu"); if (m) m.style.display = "none"; pmTarget = null; }
  function esc(s) { var d = document.createElement("div"); d.textContent = s == null ? "" : String(s); return d.innerHTML; }
  function renderFriends() {
    var inc = el("mp-fincoming"); if (!inc) return; inc.innerHTML = "";
    (friendsData.incoming || []).forEach(function (f) {
      var row = document.createElement("div"); row.style.cssText = rowCss();
      row.innerHTML = "<div>👋 " + esc(f.name) + " 想加你</div>";
      var b = document.createElement("button"); b.textContent = "接受"; b.style.cssText = actCss() + "background:#27ae60";
      b.addEventListener("click", function () { if (room) room.send("friendAccept", { from: f.uid }); });
      row.appendChild(b); inc.appendChild(row);
    });
    var box = el("mp-flist"); box.innerHTML = "";
    if (!(friendsData.friends || []).length) box.innerHTML = "<div style='opacity:.6'>還沒有好友，點看到的人加好友</div>";
    (friendsData.friends || []).forEach(function (f) {
      var row = document.createElement("div"); row.style.cssText = rowCss();
      row.innerHTML = "<div>" + (f.online ? "🟢 " : "⚪ ") + esc(f.name) + "</div>";
      var g = document.createElement("button"); g.textContent = "🎁送金幣"; g.style.cssText = actCss();
      g.addEventListener("click", function () { var a = prompt("送多少金幣給 " + f.name + "？", "10"); if (a && room) room.send("giftCoins", { to: f.uid, amount: parseInt(a, 10) || 0 }); });
      row.appendChild(g); box.appendChild(row);
    });
  }

  window.__mp = {
    count: function () { return Object.keys(remotes).length; },
    friendsCount: function () { return (friendsData.friends || []).length; },
    uid: function () { return myUid; },
    coins: function () { return myCoins; },
    _send: function (t, d) { if (room) try { room.send(t, d); } catch (e) {} },
    connected: function () { return !!room; },
    remoteInfo: function () { return Object.keys(remotes).map(function (k) { var r = remotes[k]; return { skin: r.skin, anim: r.spr.anims.currentAnim && r.spr.anims.currentAnim.key }; }); },
    // explore.js create() 末尾呼叫：換地圖(scene.restart)會重跑 → 重置遠端 sprite
    onSceneCreate: function (scene) {
      curScene = scene;
      Object.keys(remotes).forEach(function (k) { destroyRemote(remotes[k]); }); // 換地圖先清舊遠端，免殘影
      remotes = {};
      outfitLoading = {}; outfitFailed = {}; // 換地圖清旗標：舊 scene loader 的 complete 不一定 fire，避免造型永久卡 loading
      connect();
    },
    // explore.js update() 末尾呼叫：送自己位置 + 渲染其他人
    onUpdate: function (scene, x, y, dx, dy, moving) {
      curScene = scene;
      if (!room || !room.state) return;
      var now = performance.now();
      var dir = Math.abs(dx) > Math.abs(dy) ? "side" : (dy > 0 ? "down" : "up");
      if (now - lastSend > 80) { try { room.send("move", { x: x, y: y, dir: dir, moving: !!moving }); } catch (e) {} lastSend = now; }
      // 本地玩家在 demo 內換了衣服 → 即時廣播；節流 500ms，不用每幀讀 localStorage/JSON.parse
      if (now - lastSkinCheck > 500) {
        lastSkinCheck = now;
        var nowSkin = localSkin();
        if (nowSkin !== mySkin) { mySkin = nowSkin; try { room.send("setSkin", { id: nowSkin }); } catch (e) {} }
      }
      var seen = {};
      room.state.players.forEach(function (p, key) {
        if (key === room.sessionId) return; // 跳過自己
        seen[key] = 1;
        var r = remotes[key];
        if (!r) { r = createRemote(scene, p); remotes[key] = r; }
        r.tx = p.x; r.ty = p.y; r.dir = p.dir; r.moving = !!p.moving; r.name = p.name; r.skin = p.skin || "default";
        if (r.label.text !== p.name) r.label.setText(p.name);
      });
      Object.keys(remotes).forEach(function (key) {
        if (!seen[key]) { destroyRemote(remotes[key]); delete remotes[key]; }
        else stepRemote(remotes[key]);
      });
    },
  };
})();
