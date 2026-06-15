// 多人整合層（整合波，feature flag）：?mp=1 才連線。
// 把雲端 colyseus world room 的其他玩家畫進真實 Phaser 村莊（重用 hero 走路動畫）。
// 完全獨立模組，explore.js 只在 create/update 末尾各呼叫一個 window.__mp.*（沒載入＝無作用）。
(function () {
  "use strict";
  if (new URLSearchParams(location.search).get("mp") !== "1") return; // feature flag：預設關＝單機 demo 不變

  var EP = "wss://colyseus-production-34e9.up.railway.app";
  // 入口顯示開關（派派要先隱藏對戰+排行待核對；改 true 即可開回來）
  var SHOW_DUEL = false, SHOW_BOARD = false;
  var myUid = "mp" + Math.floor((Date.now() + performance.now()) % 1e9);
  var myName = (localStorage.getItem("village_player_name") || "玩家") + myUid.slice(-3);

  var room = null, connecting = false, remotes = {}, lastSend = 0, curScene = null;

  // ── 裝扮造型（#3）：server outfit id → demo 走路圖 sheet id；default 用 hero ──
  var OUTFIT_SHEET = { knight: "m_knight", wizard: "m_wizard_kid", elf: "f_elf", santa: "m_santa", superhero: "m_superhero" };
  var PICK = ["knight", "wizard", "elf"]; // 100 金幣買得起的，給每位玩家自動穿（展示用）
  var outfitReady = {}, outfitLoading = {};
  function hashStr(s) { var h = 0, i; for (i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h); }
  function frameDimsOf(scene, key) { var t = scene.textures.get(key); var f = t.get(0); return { w: f.width, h: f.height, n: t.frameTotal - 1 }; }

  // 動態載入某造型的 3 方向走路圖 + 建動畫（造型 sheet 與 hero 同 frame 規格）。回 anim 前綴(ready) 或 null。
  function ensureOutfitAnims(scene, outfitId) {
    var sheet = OUTFIT_SHEET[outfitId]; if (!sheet) return null; // default → hero
    var prefix = "mp_" + sheet;
    if (outfitReady[sheet]) return prefix;
    if (scene.anims.exists(prefix + "_walk")) { outfitReady[sheet] = true; return prefix; } // 換地圖後 anims 仍在
    if (outfitLoading[sheet]) return null;
    if (!scene.textures.exists("hero") || !scene.textures.exists("hero_down") || !scene.textures.exists("hero_up")) return null;
    var base = scene.assetBase || "";
    var d = { side: frameDimsOf(scene, "hero"), down: frameDimsOf(scene, "hero_down"), up: frameDimsOf(scene, "hero_up") };
    outfitLoading[sheet] = true;
    if (!scene.textures.exists(prefix + "_side")) scene.load.spritesheet(prefix + "_side", base + "walk_" + sheet + "_side.webp", { frameWidth: d.side.w, frameHeight: d.side.h });
    if (!scene.textures.exists(prefix + "_down")) scene.load.spritesheet(prefix + "_down", base + "walk_" + sheet + "_down.webp", { frameWidth: d.down.w, frameHeight: d.down.h });
    if (!scene.textures.exists(prefix + "_up")) scene.load.spritesheet(prefix + "_up", base + "walk_" + sheet + "_up.webp", { frameWidth: d.up.w, frameHeight: d.up.h });
    scene.load.once("complete", function () {
      try {
        if (!scene.anims.exists(prefix + "_walk")) scene.anims.create({ key: prefix + "_walk", frames: scene.anims.generateFrameNumbers(prefix + "_side", { start: 0, end: d.side.n - 1 }), frameRate: 12, repeat: -1 });
        if (!scene.anims.exists(prefix + "_walk_down")) scene.anims.create({ key: prefix + "_walk_down", frames: scene.anims.generateFrameNumbers(prefix + "_down", { start: 0, end: d.down.n - 1 }), frameRate: 14, repeat: -1 });
        if (!scene.anims.exists(prefix + "_walk_up")) scene.anims.create({ key: prefix + "_walk_up", frames: scene.anims.generateFrameNumbers(prefix + "_up", { start: 0, end: d.up.n - 1 }), frameRate: 14, repeat: -1 });
        if (!scene.anims.exists(prefix + "_idle")) scene.anims.create({ key: prefix + "_idle", frames: [{ key: prefix + "_down", frame: 0 }], frameRate: 1 });
        outfitReady[sheet] = true;
      } catch (e) {}
      outfitLoading[sheet] = false;
    });
    scene.load.start();
    return null;
  }

  var mpClient = null;
  function connect() {
    if (room || connecting || typeof Colyseus === "undefined") return;
    connecting = true;
    mpClient = mpClient || new Colyseus.Client(EP);
    mpClient.joinOrCreate("world", { uid: myUid, name: myName, outfit: "default" })
      .then(function (r) {
        room = r; connecting = false;
        buildChat();
        r.onMessage("chat", function (m) { addChat(m.uid === myUid ? "me" : "", (m.channel === "near" ? "[附近]" : "") + m.name + "：" + m.text + (m.masked ? "（已過濾）" : "")); });
        r.onMessage("system", function (m) { addChat("sys", m.text); });
        r.onMessage("chat_blocked", function (m) { addChat("blk", blockMsg(m.reason)); });
        r.onMessage("friends", function (m) { friendsData = m; renderFriends(); });
        r.onMessage("leaderboard", function (m) { boardData = m.top || []; renderBoard(); });
        r.onMessage("wallet", function (m) { myCoins = m.coins; var c = el("mp-coins"); if (c) c.textContent = "🪙 " + m.coins; });
        r.onMessage("me", function (m) { myCoins = m.coins; var c = el("mp-coins"); if (c) c.textContent = "🪙 " + m.coins; });
        r.onMessage("notice", function (n) { var t = noticeMsg(n); if (t) addChat("sys", t); });
        // 展示：每位玩家自動穿一件造型（買→穿，別人就看得到不同衣服）
        var myOutfit = PICK[hashStr(myUid) % PICK.length];
        try { r.send("buyOutfit", { id: myOutfit }); } catch (e) {}
        setTimeout(function () { try { r.send("setOutfit", { id: myOutfit }); } catch (e) {} }, 500);
        buildDuelUI();
        buildSocialUI();
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
    var r = { spr: spr, label: label, x: p.x, y: p.y, tx: p.x, ty: p.y, dir: p.dir, moving: false, name: p.name, outfit: p.outfit, uid: p.uid };
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
    var prefix = ensureOutfitAnims(scene, r.outfit) || "hero"; // 造型 ready 用造型 anims，否則 hero
    var suffix = r.moving ? (r.dir === "up" ? "_walk_up" : (r.dir === "down" ? "_walk_down" : "_walk")) : "_idle";
    var key = prefix + suffix;
    var cur = r.spr.anims.currentAnim;
    if (scene.anims.exists(key) && (!cur || cur.key !== key)) r.spr.play(key);
    if (suffix === "_walk") r.spr.setFlipX((r.tx - r.spr.x) < -0.5); // 朝移動方向
  }

  // ── 真人對戰（#4）：接雲端 DuelRoom，村莊裡按鈕配對 PK ──
  var duel = null, duelMyId = null, duelAnswered = false, duelLastRound = -1, duelLastPhase = "", duelRAF = false;
  function el(id) { return document.getElementById(id); }
  function buildDuelUI() {
    if (el("mpd")) return;
    if (SHOW_DUEL) { // 派派要先隱藏對戰入口待核對
      var btn = document.createElement("button");
      btn.id = "mpd-btn"; btn.textContent = "⚔️ 對戰";
      btn.style.cssText = "position:fixed;right:10px;top:10px;z-index:9000;border:none;border-radius:12px;padding:11px 16px;font-size:15px;font-weight:800;background:linear-gradient(135deg,#ff9a40,#ff5e3a);color:#fff;font-family:sans-serif";
      btn.addEventListener("click", startDuel);
      document.body.appendChild(btn);
    }

    var ov = document.createElement("div");
    ov.id = "mpd"; ov.style.cssText = "position:fixed;inset:0;background:rgba(8,12,30,.96);z-index:9500;display:none;flex-direction:column;align-items:center;justify-content:center;gap:16px;padding:24px;text-align:center;color:#fff;font-family:sans-serif";
    ov.innerHTML =
      '<div id="mpd-phase" style="font-size:14px;color:#9fd3ff">配對中…</div>' +
      '<div style="display:flex;gap:24px;font-size:18px;font-weight:800;align-items:flex-start">' +
        '<div><div id="mpd-me-n">你</div><div id="mpd-me-s">0</div><div id="mpd-me-h" style="font-size:14px">❤❤❤❤❤</div></div>' +
        '<div style="color:#ffd24a;align-self:center">VS</div>' +
        '<div><div id="mpd-op-n">對手</div><div id="mpd-op-s">0</div><div id="mpd-op-h" style="font-size:14px">❤❤❤❤❤</div></div>' +
      '</div>' +
      '<div id="mpd-q" style="font-size:22px;font-weight:900;min-height:28px;max-width:92vw"></div>' +
      '<div id="mpd-choices" style="display:grid;grid-template-columns:1fr 1fr;gap:10px;width:min(360px,92vw)"></div>' +
      '<div id="mpd-result" style="font-size:24px;font-weight:900"></div>' +
      '<button id="mpd-close" style="display:none;border:none;border-radius:14px;padding:12px 30px;font-weight:800;background:#444;color:#fff">關閉</button>';
    document.body.appendChild(ov);
    el("mpd-close").addEventListener("click", closeDuel);
  }
  function startDuel() {
    if (duel || !mpClient) return;
    el("mpd").style.display = "flex";
    el("mpd-result").textContent = ""; el("mpd-close").style.display = "none";
    el("mpd-q").textContent = ""; el("mpd-choices").innerHTML = "";
    duelLastRound = -1; duelLastPhase = "";
    if (curScene && curScene.input && curScene.input.keyboard) curScene.input.keyboard.enabled = false;
    mpClient.joinOrCreate("duel", { uid: myUid, name: myName }).then(function (r) {
      duel = r; duelMyId = r.sessionId;
      r.onMessage("reveal", function (m) { var bs = document.querySelectorAll("#mpd-choices button"); for (var i = 0; i < bs.length; i++) if (i === m.answer) bs[i].style.background = "#27ae60", bs[i].style.color = "#fff"; });
      if (!duelRAF) { duelRAF = true; requestAnimationFrame(duelLoop); }
    }).catch(function () { el("mpd-phase").textContent = "配對失敗"; el("mpd-close").style.display = "inline-block"; });
  }
  function closeDuel() {
    if (duel) { try { duel.leave(); } catch (e) {} duel = null; }
    el("mpd").style.display = "none";
    if (curScene && curScene.input && curScene.input.keyboard) curScene.input.keyboard.enabled = true;
  }
  function hearts(hp) { hp = Math.max(0, hp | 0); return "❤".repeat(hp) + "·".repeat(Math.max(0, 5 - hp)); }
  function duelLoop() {
    if (!duel) { duelRAF = false; return; }
    requestAnimationFrame(duelLoop);
    var s = duel.state; if (!s) return;
    var me = s.players.get(duelMyId), op = null;
    s.players.forEach(function (p, k) { if (k !== duelMyId) op = p; });
    el("mpd-me-n").textContent = me ? me.name : "你"; el("mpd-me-s").textContent = me ? me.score : 0; el("mpd-me-h").textContent = me ? hearts(me.hp) : "";
    el("mpd-op-n").textContent = op ? op.name : "等待對手…"; el("mpd-op-s").textContent = op ? op.score : 0; el("mpd-op-h").textContent = op ? hearts(op.hp) : "";
    var pm = { waiting: "配對中…", countdown: "準備開始！", question: "第 " + s.round + "/" + s.totalRounds + " 題", reveal: "公布答案", finished: "結束" };
    el("mpd-phase").textContent = pm[s.phase] || s.phase;
    if (s.phase === "question" && s.round !== duelLastRound) {
      duelLastRound = s.round; duelAnswered = false;
      el("mpd-q").textContent = s.questionText;
      var box = el("mpd-choices"); box.innerHTML = "";
      s.choices.forEach(function (c, i) {
        var btn = document.createElement("button");
        btn.textContent = c; btn.style.cssText = "padding:14px;border:none;border-radius:12px;background:#fff;color:#1a2240;font-size:16px;font-weight:700";
        btn.addEventListener("click", function () { if (duelAnswered) return; duelAnswered = true; try { duel.send("answer", { choice: i }); } catch (e) {} btn.style.outline = "3px solid #ffd24a"; });
        box.appendChild(btn);
      });
    }
    if (s.phase === "finished" && duelLastPhase !== "finished") {
      el("mpd-q").textContent = ""; el("mpd-choices").innerHTML = "";
      el("mpd-result").textContent = s.winnerUid === myUid ? "🏆 你贏了！" : (s.winnerUid ? "😢 對手獲勝" : "平手");
      el("mpd-close").style.display = "inline-block";
    }
    duelLastPhase = s.phase;
  }

  // ── 社交（#5）：好友 / 排行榜 / 互送，接雲端 world room 社交 handler ──
  var friendsData = { friends: [], incoming: [], outgoing: [] }, boardData = [], myCoins = 0, pmTarget = null;
  function noticeMsg(n) {
    if (n.kind === "friend_sent") return "👥 已送出好友邀請";
    if (n.kind === "friend_added") return "🎉 你們成為好友了！";
    if (n.kind === "gift_sent") return "🎁 已送出 " + n.amount + " 金幣";
    if (n.kind === "gift_got") return "🎁 " + n.from + " 送你 " + n.amount + " 金幣！";
    if (n.kind === "gift_failed") return n.reason === "not_friend" ? "要先成為好友才能送金幣" : (n.reason === "no_coins" ? "金幣不夠" : "送金幣失敗");
    if (n.kind === "bought" || n.kind === "mail_sent") return "";
    return "";
  }
  function btn(id, txt, top, bg) {
    var b = document.createElement("button"); b.id = id; b.textContent = txt;
    b.style.cssText = "position:fixed;right:10px;top:" + top + "px;z-index:9000;border:none;border-radius:12px;padding:9px 13px;font-size:13px;font-weight:800;color:#fff;font-family:sans-serif;background:" + bg;
    document.body.appendChild(b); return b;
  }
  function buildSocialUI() {
    if (el("mp-friendbtn")) return;
    var coins = document.createElement("div"); coins.id = "mp-coins"; coins.textContent = "🪙 …";
    coins.style.cssText = "position:fixed;right:10px;top:" + (SHOW_DUEL ? 58 : 10) + "px;z-index:9000;color:#ffd24a;font-weight:800;font-family:sans-serif;background:rgba(8,12,30,.5);padding:5px 9px;border-radius:9px";
    document.body.appendChild(coins);
    btn("mp-friendbtn", "👥 好友", SHOW_DUEL ? 96 : 52, "linear-gradient(135deg,#6a5cff,#4a3fd6)").addEventListener("click", function () { if (room) room.send("friendList"); el("mp-fpanel").style.display = "flex"; });
    if (SHOW_BOARD) btn("mp-boardbtn", "🏆 排行", 140, "linear-gradient(135deg,#3a4a8a,#2a3568)").addEventListener("click", function () { if (room) room.send("leaderboard"); el("mp-bpanel").style.display = "flex"; });
    // 好友面板
    var fp = document.createElement("div"); fp.id = "mp-fpanel"; fp.style.cssText = panelCss();
    fp.innerHTML = '<h3 style="margin:6px 0">👥 好友</h3><div id="mp-fincoming" style="width:min(360px,90vw)"></div><div id="mp-flist" style="width:min(360px,90vw);display:flex;flex-direction:column;gap:6px"></div><button id="mp-fclose" style="' + closeCss() + '">關閉</button>';
    document.body.appendChild(fp); el("mp-fclose").addEventListener("click", function () { fp.style.display = "none"; });
    // 排行榜面板
    var bp = document.createElement("div"); bp.id = "mp-bpanel"; bp.style.cssText = panelCss();
    bp.innerHTML = '<h3 style="margin:6px 0">🏆 金幣排行榜</h3><div id="mp-blist" style="width:min(360px,90vw);display:flex;flex-direction:column;gap:6px"></div><button id="mp-bclose" style="' + closeCss() + '">關閉</button>';
    document.body.appendChild(bp); el("mp-bclose").addEventListener("click", function () { bp.style.display = "none"; });
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
  function openPMenu(r) { pmTarget = r; el("mp-pmn").textContent = r.name; el("mp-pmenu").style.display = "flex"; }
  function closePMenu() { el("mp-pmenu").style.display = "none"; pmTarget = null; }
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
  function renderBoard() {
    var box = el("mp-blist"); if (!box) return; box.innerHTML = "";
    if (!boardData.length) { box.innerHTML = "<div style='opacity:.6'>（還沒有資料）</div>"; return; }
    boardData.forEach(function (p, i) {
      var row = document.createElement("div"); row.style.cssText = rowCss();
      var medal = i === 0 ? "🥇" : (i === 1 ? "🥈" : (i === 2 ? "🥉" : (i + 1) + "."));
      row.innerHTML = "<div>" + medal + " " + (p.online ? "🟢" : "") + esc(p.name) + "</div><div style='color:#ffd24a;font-weight:800'>🪙 " + p.coins + "</div>";
      box.appendChild(row);
    });
  }

  window.__mp = {
    count: function () { return Object.keys(remotes).length; },     // 驗證用：看到幾個遠端玩家
    duelPhase: function () { return duel && duel.state ? duel.state.phase : null }, // 驗證用
    friendsCount: function () { return (friendsData.friends || []).length; }, // 驗證用
    uid: function () { return myUid; },
    coins: function () { return myCoins; },
    _send: function (t, d) { if (room) try { room.send(t, d); } catch (e) {} },
    connected: function () { return !!room; },
    remoteInfo: function () { return Object.keys(remotes).map(function (k) { var r = remotes[k]; return { outfit: r.outfit, anim: r.spr.anims.currentAnim && r.spr.anims.currentAnim.key }; }); },
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
        r.tx = p.x; r.ty = p.y; r.dir = p.dir; r.moving = !!p.moving; r.name = p.name; r.outfit = p.outfit;
        if (r.label.text !== p.name) r.label.setText(p.name);
      });
      Object.keys(remotes).forEach(function (key) {
        if (!seen[key]) { destroyRemote(remotes[key]); delete remotes[key]; }
        else stepRemote(remotes[key]);
      });
    },
  };
})();
