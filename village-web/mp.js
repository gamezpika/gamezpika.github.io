// 多人整合層（整合波，feature flag）：?mp=1 才連線。
// 把雲端 colyseus world room 的其他玩家畫進真實 Phaser 村莊（重用 hero 走路動畫）。
// 完全獨立模組，explore.js 只在 create/update 末尾各呼叫一個 window.__mp.*（沒載入＝無作用）。
// ⚠️ 對戰(PK)/排行 已移除——EDU 專案本來就有完整真人 PK + 王榜，不重複造（見記憶分析）。
//    這層只做 EDU 缺的「共享即時世界」：同場可見 / 聊天 / 裝扮 / 好友。
(function () {
  "use strict";
  if (new URLSearchParams(location.search).get("mp") !== "1") return; // feature flag：預設關＝單機 demo 不變

  var EP = "wss://colyseus-production-34e9.up.railway.app";
  var API = EP.replace(/^wss:/, "https:"); // 家長控管/罐頭句等 HTTP 端點
  var myUid = "mp" + Math.floor((Date.now() + performance.now()) % 1e9);
  var myParental = { chatEnabled: true, mode: "free", allowWhisper: true }; // 本地角色的家長控管設定（連線後拉一次）
  var quickPhrases = null; // 罐頭安全句快取 [{id,text}]
  var PARENT_PIN = "1234";  // demo 家長 PIN（擋小孩亂改；正式版改真家長 token，見 onAuth 整合波）
  var myName = (localStorage.getItem("village_player_name") || "玩家") + myUid.slice(-3);

  var room = null, connecting = false, remotes = {}, lastSend = 0, curScene = null, mpClient = null, mySkin = "default", lastSkinCheck = 0;
  var desiredMap = "village", joinedMap = null, connSeq = 0; // 依地圖分房；connSeq=連線世代(換房/重連作廢舊房回呼)
  // 地圖 id canonical（與 server sanitizeMap 同規則）→ filterBy 分房 key 與房內一致
  function mapKey(id) { return (String(id || "").replace(/[^a-z0-9_]/gi, "").slice(0, 40)) || "village"; }
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
    var seq = ++connSeq;                 // 這次連線的世代（換房/重連用來作廢舊房回呼）
    var joiningMap = mapKey(desiredMap); // canonical：filterBy 分房 key 與房內一致
    mpClient = mpClient || new Colyseus.Client(EP);
    mySkin = localSkin();
    mpClient.joinOrCreate("world", { uid: myUid, name: myName, outfit: "default", skin: mySkin, map: joiningMap })
      .then(function (r) {
        if (seq !== connSeq) { try { r.removeAllListeners(); r.leave(); } catch (e) {} return; } // 已被更新的連線取代→丟棄
        room = r; joinedMap = joiningMap; connecting = false;
        buildChat();
        // 斷線重置：清回 null + 清遠端 sprite + 退避重連（世代守衛：舊房離開不重連）
        r.onLeave(function () {
          if (seq !== connSeq) return;   // 舊世代的房離開（換房造成）→ 忽略，不自動重連
          room = null; connecting = false; joinedMap = null;
          Object.keys(remotes).forEach(function (k) { destroyRemote(remotes[k]); delete remotes[k]; });
          setTimeout(connect, 2000);
        });
        r.onMessage("chat", function (m) { addChat(m.uid === myUid ? "me" : "", (m.channel === "near" ? "[附近]" : "") + m.name + "：" + m.text + (m.masked ? "（已過濾）" : "")); });
        r.onMessage("system", function (m) { addChat("sys", m.text); });
        r.onMessage("chat_blocked", function (m) { addChat("blk", blockMsg(m.reason)); });
        r.onMessage("friends", function (m) { friendsData = m; renderFriends(); });
        r.onMessage("me", function () {}); r.onMessage("wallet", function () {}); // 社交改純禮物、不涉金錢；保留 no-op 免 colyseus 警告
        r.onMessage("notice", function (n) { var t = noticeMsg(n); if (t) addChat("sys", t); if (n.kind === "gift_got") showGiftPop(n.gift, n.from); });
        r.onMessage("emote", function (m) { showEmote(m.uid, m.e); }); // 表情動作：頭頂冒表情
        // 玩家造型以 server 實際 outfit 為準（default＝主角樣子）；不再強制亂配造型
        buildSocialUI();
        // 連線途中 desiredMap 又變了（快速換圖期間 connect 被 connecting 擋掉，沒換房）→ 立刻切到正確地圖
        if (joinedMap !== mapKey(desiredMap)) gotoDesired();
      })
      .catch(function () { if (seq === connSeq) connecting = false; });
  }

  // 確保連到目前的 desiredMap：已連別張地圖就換房（換房+連線都走這裡，避免邏輯分叉）
  function gotoDesired() {
    if (room && joinedMap !== mapKey(desiredMap)) {
      var old = room; room = null; connecting = false; joinedMap = null;
      connSeq++;                                     // 世代+1：立即作廢舊房 onLeave（不自動重連）
      try { old.removeAllListeners(); } catch (e) {} // 清 listener（記憶體）；正確性靠世代守衛
      try { old.leave(); } catch (e) {}
    }
    connect();
  }

  // ── 村莊內聊天 UI（接 server 安全聊天：髒話/個資過濾、頻道）──
  function buildChat() {
    if (el("mp-chat")) return;
    var box = document.createElement("div");
    box.id = "mp-chat";
    box.innerHTML =
      '<div id="mp-log" style="max-height:22vh;overflow-y:auto;font-size:13px;line-height:1.5;color:#fff;text-shadow:0 1px 2px #000;margin-bottom:4px"></div>' +
      '<div id="mp-canned" style="display:none;flex-wrap:wrap;gap:5px;margin-bottom:5px"></div>' +
      '<div style="display:flex;gap:5px;align-items:center">' +
        '<button id="mp-parentbtn" title="家長控管" style="border:none;border-radius:9px;padding:7px 9px;background:#2e6d52;color:#fff;font-weight:700;font-size:13px;white-space:nowrap">家長</button>' +
        '<button id="mp-friendbtn" title="好友" style="border:none;border-radius:9px;padding:7px 9px;background:linear-gradient(135deg,#6a5cff,#4a3fd6);color:#fff;font-weight:700;font-size:13px;white-space:nowrap">好友</button>' +
        '<button id="mp-emotebtn" title="表情" style="border:none;border-radius:9px;padding:7px 9px;background:#3a4a7a;color:#fff;font-weight:700;font-size:13px;white-space:nowrap">表情</button>' +
        '<input id="mp-in" type="text" name="mpchat" autocomplete="off" autocorrect="off" autocapitalize="sentences" spellcheck="false" enterkeyhint="send" maxlength="120" placeholder="跟村莊裡的人說話…" style="flex:1;min-width:0;padding:7px 9px;border:none;border-radius:9px;font-size:14px">' +
        '<button id="mp-send" style="border:none;border-radius:9px;padding:7px 12px;background:#4a9fff;color:#fff;font-weight:700">送</button>' +
      '</div>';
    // 上移到搖桿(左下 116px 高)上方，不擋住移動搖桿
    // 收合狀態：下移到畫面最底，並偏右避開左下移動搖桿(left20~136)
    box.style.cssText = "position:fixed;left:146px;right:8px;bottom:14px;z-index:9000;font-family:sans-serif;background:rgba(8,12,30,.35);border-radius:10px;padding:6px";
    document.body.appendChild(box);
    var input = el("mp-in");
    function send() { var t = (input.value || "").trim(); if (!t || !room) return; try { room.send("chat", { text: t, channel: "world" }); } catch (e) {} input.value = ""; }
    // 行動裝置：用 pointerdown 在「按下當下」就送 + preventDefault 不讓輸入框失焦
    //（否則 blur→聊天列收回→按鈕瞬間移走→放開時點到空白，沒送出）。click 後備：input 已清空→重複呼叫無作用
    el("mp-send").addEventListener("pointerdown", function (e) { e.preventDefault(); send(); });
    el("mp-send").addEventListener("click", send);
    // 注音/拼音「確認候選字」的 Enter 不能當送出，否則送半成品 ㄅ 狂撞 rate limit。
    // isComposing/keyCode229 擋多數；再用 compositionend 時間戳擋「補送」那顆(部分瀏覽器 compositionend 後又來一個 keydown Enter，此時 isComposing 已 false)。
    var lastCompEnd = 0;
    input.addEventListener("compositionend", function () { lastCompEnd = performance.now(); });
    input.addEventListener("keydown", function (e) { e.stopPropagation(); if (e.key === "Enter" && !e.isComposing && e.keyCode !== 229 && (performance.now() - lastCompEnd) > 250) send(); }); // 擋住 Phaser 鍵盤
    input.addEventListener("focus", function () { if (curScene && curScene.input && curScene.input.keyboard) curScene.input.keyboard.enabled = false; pinChat(true); });
    input.addEventListener("blur", function () { if (curScene && curScene.input && curScene.input.keyboard) curScene.input.keyboard.enabled = true; pinChat(false); });
    bindKeyboardPin();
    el("mp-parentbtn").addEventListener("click", openParental);
    loadParental(); // 拉本地角色的家長設定 → 套用罐頭/聊天模式
  }

  // ── 手機打字時把聊天框展開成「可視區內的半透明聊天面板」，避免 iOS 鍵盤頂上去後露出底色黑塊 ──
  // 不靠「猜鍵盤高度」(iOS clientHeight 會跟鍵盤一起縮 → 算出 0 永遠不觸發)；
  // 改用「觸控裝置 + focus」當開關，面板尺寸直接綁 visualViewport(它就是鍵盤上方的可視區)。
  var pinBound = false;
  var isTouch = !!(window.matchMedia && window.matchMedia("(pointer: coarse)").matches);
  function placeChat(focused) {
    var box = el("mp-chat"); if (!box) return;
    var vv = window.visualViewport, log = el("mp-log");
    if (focused && vv && isTouch) {
      // 打字時：整列釘在鍵盤正上方(緊貼可視底)、實心底色像聊天列——不開大面板、不讓遊戲變暗(參考線上遊戲)
      box.style.left = "8px"; box.style.right = "8px"; box.style.width = "auto";
      box.style.bottom = "auto"; box.style.height = "auto";
      box.style.background = "rgba(20,26,46,.94)";
      if (log) { log.style.maxHeight = "26vh"; }
      var h = box.offsetHeight || 96;
      box.style.top = Math.max(6, vv.offsetTop + vv.height - h - 4) + "px"; // 底邊貼齊可視底＝鍵盤頂
      if (window.scrollY) window.scrollTo(0, 0); // 擋 iOS 自動把頁面捲上去
    } else {
      box.style.top = "auto"; box.style.height = "auto"; box.style.bottom = "14px";
      box.style.left = "146px"; box.style.right = "8px"; box.style.width = "auto"; // 底部偏右、避開搖桿
      box.style.background = "rgba(8,12,30,.35)";
      if (log) { log.style.maxHeight = "22vh"; }
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
    spr.setInteractive({ useHandCursor: true }); // 點玩家 → 加好友 / 送禮物
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

  // ── 社交：好友 / 互送純展示小禮物（無金錢）──
  var friendsData = { friends: [], incoming: [], outgoing: [] }, pmTarget = null, giftTarget = null, mpHidden = false;
  // 小禮物清單（UI emoji；之後想換精緻小圖再說）
  var GIFTS = [
    { id: "flower", e: "🌸", n: "花" }, { id: "cake", e: "🎂", n: "蛋糕" }, { id: "heart", e: "❤️", n: "愛心" },
    { id: "star", e: "⭐", n: "星星" }, { id: "candy", e: "🍬", n: "糖果" }, { id: "box", e: "🎁", n: "禮物" },
  ];
  function giftOf(id) { for (var i = 0; i < GIFTS.length; i++) if (GIFTS[i].id === id) return GIFTS[i]; return GIFTS[5]; }
  function noticeMsg(n) {
    if (n.kind === "friend_sent") return "👥 已送出好友邀請";
    if (n.kind === "friend_added") return "🎉 你們成為好友了！";
    if (n.kind === "gift_sent") return "🎁 已送出禮物 " + giftOf(n.gift).e;
    if (n.kind === "gift_got") { var g = giftOf(n.gift); return "🎁 " + n.from + " 送你" + g.n + " " + g.e + "！"; }
    if (n.kind === "gift_failed") return n.reason === "not_friend" ? "要先成為好友才能送禮物" : (n.reason === "rate" ? "送太快了，慢一點" : "送禮物失敗");
    return "";
  }
  // 收到禮物 → 畫面中央小彈跳動畫
  var giftPops = 0;
  function showGiftPop(giftId) {
    if (giftPops >= 3) return; // 同時最多 3 個，避免被狂送洗版堆積 DOM
    giftPops++;
    var g = giftOf(giftId);
    var pop = document.createElement("div");
    pop.textContent = g.e;
    pop.style.cssText = "position:fixed;left:50%;top:42%;transform:translate(-50%,-50%) scale(.3);z-index:9700;font-size:88px;pointer-events:none;transition:transform .4s cubic-bezier(.2,1.4,.4,1),opacity .5s;filter:drop-shadow(0 4px 10px rgba(0,0,0,.4))";
    document.body.appendChild(pop);
    requestAnimationFrame(function () { pop.style.transform = "translate(-50%,-50%) scale(1)"; });
    setTimeout(function () { pop.style.transform = "translate(-50%,-160%) scale(1)"; pop.style.opacity = "0"; }, 1100);
    setTimeout(function () { if (pop.parentNode) pop.parentNode.removeChild(pop); giftPops--; }, 1700);
  }
  // ── 表情動作 emote：點按鈕→送 id；收到→那個玩家頭頂冒表情、飄起來淡出 ──
  var EMOTES = [
    { id: "smile", e: "😄" }, { id: "like", e: "👍" }, { id: "heart", e: "❤️" }, { id: "wow", e: "😮" },
    { id: "cry", e: "😢" }, { id: "party", e: "🎉" }, { id: "wave", e: "👋" }, { id: "cool", e: "😎" },
  ];
  function emoteOf(id) { for (var i = 0; i < EMOTES.length; i++) if (EMOTES[i].id === id) return EMOTES[i].e; return ""; }
  var emoteCount = 0;
  function showEmote(uid, id) {
    var e = emoteOf(id); if (!e || emoteCount >= 30) return; // 上限 30 防被灌爆堆 text
    var scene = curScene;
    if (!scene || !scene.add || !scene.tweens || !scene.sys || !scene.sys.isActive()) return; // scene 生命週期防呆
    var spr = null;
    if (uid === myUid) spr = scene.playerSprite;
    else { for (var k in remotes) if (remotes[k].uid === uid) { spr = remotes[k].spr; break; } }
    if (!spr || !spr.scene || !spr.active) return;
    var headY = spr.y - (spr.displayHeight || 60) - 4; // 頭頂上方
    var t = null;
    try {
      t = scene.add.text(spr.x, headY, e, { fontSize: "30px" }).setOrigin(0.5, 1).setDepth(spr.y + 100);
      emoteCount++;
      scene.tweens.add({ targets: t, y: headY - 42, alpha: 0, duration: 1400, ease: "Cubic.easeOut", onComplete: function () { t.destroy(); emoteCount--; } });
    } catch (err) { if (t) { try { t.destroy(); } catch (e2) {} emoteCount--; } }
  }
  function buildSocialUI() {
    if (el("mp-fpanel")) return;
    // 好友 / 金幣已併入聊天室：👥 按鈕在聊天輸入列、金幣顯示在好友面板裡（不再浮在大地圖外面）
    var fb = el("mp-friendbtn");
    // pointerdown：在 blur 收回聊天列前就觸發，避免按鈕被移走點不到
    if (fb) fb.addEventListener("pointerdown", function () { if (room) room.send("friendList"); var fp = el("mp-fpanel"); if (fp) fp.style.display = "flex"; });
    var eb = el("mp-emotebtn");
    // 開表情前先 blur 關鍵盤(避免選擇器被鍵盤蓋)；pointerdown 在 blur 收列前就觸發
    if (eb) eb.addEventListener("pointerdown", function (ev) { ev.preventDefault(); var inp = el("mp-in"); if (inp) inp.blur(); var m = el("mp-emote"); if (m) m.style.display = "flex"; });
    // 好友面板
    var fp = document.createElement("div"); fp.id = "mp-fpanel"; fp.style.cssText = panelCss();
    fp.innerHTML = '<h3 style="margin:6px 0">👥 好友</h3><div id="mp-fincoming" style="width:min(360px,90vw)"></div><div id="mp-flist" style="width:min(360px,90vw);display:flex;flex-direction:column;gap:6px"></div><button id="mp-fclose" style="' + closeCss() + '">關閉</button>';
    document.body.appendChild(fp); el("mp-fclose").addEventListener("click", function () { fp.style.display = "none"; });
    // 點玩家彈出選單
    var pm = document.createElement("div"); pm.id = "mp-pmenu";
    pm.style.cssText = "position:fixed;left:50%;top:42%;transform:translateX(-50%);z-index:9600;display:none;flex-direction:column;gap:8px;background:#1a2348;border:1px solid #3a4a7a;border-radius:12px;padding:14px;font-family:sans-serif;color:#fff;text-align:center";
    pm.innerHTML = '<div id="mp-pmn" style="font-weight:800"></div><button id="mp-pm-friend" style="' + actCss() + '">👥 加好友</button><button id="mp-pm-gift" style="' + actCss() + '">🎁 送禮物</button><button id="mp-pm-x" style="' + actCss() + 'background:#444">取消</button>';
    document.body.appendChild(pm);
    el("mp-pm-friend").addEventListener("click", function () { if (room && pmTarget) room.send("friendRequest", { to: pmTarget.uid }); closePMenu(); });
    el("mp-pm-gift").addEventListener("click", function () { var t = pmTarget; closePMenu(); if (t) openGiftPicker(t); });
    el("mp-pm-x").addEventListener("click", closePMenu);
    // 送禮物選擇器
    var gp = document.createElement("div"); gp.id = "mp-gift";
    gp.style.cssText = "position:fixed;left:50%;top:42%;transform:translate(-50%,-50%);z-index:9650;display:none;flex-direction:column;gap:10px;background:#1a2348;border:1px solid #3a4a7a;border-radius:14px;padding:16px;font-family:sans-serif;color:#fff;text-align:center;width:min(300px,84vw)";
    var grid = '<div id="mp-gift-name" style="font-weight:800;margin-bottom:2px"></div><div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px">';
    GIFTS.forEach(function (g) { grid += '<button class="mp-gift-pick" data-id="' + g.id + '" style="border:none;border-radius:10px;padding:8px 0;background:rgba(255,255,255,.1);color:#fff;font-size:13px;cursor:pointer"><div style="font-size:30px;line-height:1.1">' + g.e + '</div>' + g.n + '</button>'; });
    grid += '</div><button id="mp-gift-x" style="' + actCss() + 'background:#444">取消</button>';
    gp.innerHTML = grid;
    document.body.appendChild(gp);
    el("mp-gift-x").addEventListener("click", closeGiftPicker);
    Array.prototype.forEach.call(gp.querySelectorAll(".mp-gift-pick"), function (btn) {
      btn.addEventListener("click", function () { if (room && giftTarget) room.send("sendGift", { to: giftTarget.uid, gift: btn.getAttribute("data-id") }); closeGiftPicker(); });
    });
    // 表情選擇器（送自己頭頂的 emote）
    var ep = document.createElement("div"); ep.id = "mp-emote";
    ep.style.cssText = "position:fixed;left:50%;bottom:78px;transform:translateX(-50%);z-index:9650;display:none;flex-direction:column;gap:8px;background:#1a2348;border:1px solid #3a4a7a;border-radius:14px;padding:12px;font-family:sans-serif;color:#fff;text-align:center;width:min(280px,84vw)";
    var egrid = '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px">';
    EMOTES.forEach(function (m) { egrid += '<button class="mp-emote-pick" data-id="' + m.id + '" style="border:none;border-radius:10px;padding:6px 0;background:rgba(255,255,255,.1);font-size:26px;cursor:pointer">' + m.e + '</button>'; });
    egrid += '</div><button id="mp-emote-x" style="' + actCss() + 'background:#444;padding:6px 16px">取消</button>';
    ep.innerHTML = egrid;
    document.body.appendChild(ep);
    el("mp-emote-x").addEventListener("click", function () { ep.style.display = "none"; });
    Array.prototype.forEach.call(ep.querySelectorAll(".mp-emote-pick"), function (btn) {
      btn.addEventListener("click", function () { if (room) try { room.send("emote", { e: btn.getAttribute("data-id") }); } catch (e) {} ep.style.display = "none"; });
    });
  }
  function openGiftPicker(t) { giftTarget = t; var n = el("mp-gift-name"), m = el("mp-gift"); if (!n || !m) return; n.textContent = "送禮物給 " + t.name; m.style.display = "flex"; }
  function closeGiftPicker() { var m = el("mp-gift"); if (m) m.style.display = "none"; giftTarget = null; }
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
      var g = document.createElement("button"); g.textContent = "🎁送禮物"; g.style.cssText = actCss();
      g.addEventListener("click", function () { openGiftPicker(f); });
      row.appendChild(g); box.appendChild(row);
    });
  }

  // ───────── 家長控管（demo：PIN 進入，自管本地角色的聊天安全設定）─────────
  var parentalUnlocked = false;   // 一個 session 解鎖一次
  var parentalHistory = [];
  function loadParental() {
    fetch(API + "/api/self/parental/" + encodeURIComponent(myUid))
      .then(function (r) { return r.json(); })
      .then(function (d) { if (d && d.settings) myParental = d.settings; if (d && Array.isArray(d.history)) parentalHistory = d.history; applyChatMode(); })
      .catch(function () { applyChatMode(); });
  }
  function fetchParentalFull() {
    fetch(API + "/api/self/parental/" + encodeURIComponent(myUid))
      .then(function (r) { return r.json(); })
      .then(function (d) { if (d && d.settings) myParental = d.settings; if (d && Array.isArray(d.history)) parentalHistory = d.history; applyChatMode(); renderParental(); })
      .catch(function () {});
  }
  function saveParental(patch) {
    Object.keys(patch).forEach(function (k) { myParental[k] = patch[k]; });
    applyChatMode(); renderParental();
    fetch(API + "/api/self/parental/" + encodeURIComponent(myUid), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) })
      .then(function (r) { return r.json(); })
      .then(function (d) { if (d && d.settings) { myParental = d.settings; applyChatMode(); renderParental(); } })
      .catch(function () { fetchParentalFull(); }); // 存檔失敗→拉回伺服器真實狀態，不留「假的已改」UI 誤導家長（Codex #2）
  }
  function renderCanned() {
    var box = el("mp-canned"); if (!box) return;
    if (!quickPhrases) {
      box.innerHTML = "<span style='color:#fff;opacity:.7;font-size:12px'>載入安全句…</span>";
      fetch(API + "/api/quick-phrases").then(function (r) { return r.json(); })
        .then(function (d) { quickPhrases = Array.isArray(d) ? d : []; var b = el("mp-canned"); if (b && b.style.display !== "none") renderCanned(); })
        .catch(function () { quickPhrases = []; });
      return;
    }
    box.innerHTML = "";
    quickPhrases.forEach(function (p) {
      var b = document.createElement("button");
      b.textContent = p.text;
      b.style.cssText = "border:none;border-radius:14px;padding:6px 11px;background:#4a9fff;color:#fff;font-size:13px;font-weight:700";
      b.addEventListener("pointerdown", function (e) { e.preventDefault(); if (room) try { room.send("quick", { id: p.id, channel: "world" }); } catch (er) {} });
      box.appendChild(b);
    });
  }
  // 依家長設定切換聊天輸入：關閉→鎖輸入框；只能安全句→換罐頭列；自由→正常輸入
  function applyChatMode() {
    var inp = el("mp-in"), snd = el("mp-send"), canned = el("mp-canned");
    if (!inp || !snd || !canned) return;
    if (!myParental.chatEnabled) {
      inp.value = ""; inp.disabled = true; inp.placeholder = "家長已關閉聊天"; inp.style.display = ""; snd.style.display = ""; snd.disabled = true; canned.style.display = "none";
    } else if (myParental.mode === "canned") {
      inp.style.display = "none"; snd.style.display = "none"; canned.style.display = "flex"; renderCanned();
    } else {
      inp.disabled = false; snd.disabled = false; inp.placeholder = "跟村莊裡的人說話…"; inp.style.display = ""; snd.style.display = ""; canned.style.display = "none";
    }
  }
  function closeParental() { var m = el("mp-parent"); if (m) m.remove(); }
  function openParental() {
    if (el("mp-parent")) return;
    var m = document.createElement("div"); m.id = "mp-parent";
    m.style.cssText = "position:fixed;inset:0;z-index:9500;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(0,0,0,.55);font-family:sans-serif";
    m.addEventListener("pointerdown", function (e) { if (e.target === m) closeParental(); });
    document.body.appendChild(m);
    renderParental();
    if (parentalUnlocked) fetchParentalFull(); // 解鎖才拉最新 settings + 監看歷史
  }
  function renderParental() {
    var m = el("mp-parent"); if (!m) return;
    if (!parentalUnlocked) {
      m.innerHTML = "<div style='background:#fff;border-radius:16px;max-width:320px;width:100%;padding:18px 16px 14px'>"
        + "<div style='font-weight:800;font-size:17px;color:#2e6d52;margin-bottom:6px'>家長控管</div>"
        + "<div style='font-size:13px;color:#555;margin-bottom:10px'>請輸入家長密碼（demo 密碼：1234）</div>"
        + "<input id='mp-pin' type='tel' inputmode='numeric' maxlength='8' placeholder='••••' style='width:100%;box-sizing:border-box;padding:10px;border:1px solid #ccc;border-radius:9px;font-size:18px;text-align:center;letter-spacing:6px'>"
        + "<div id='mp-pinerr' style='color:#e44;font-size:12px;height:16px;margin-top:4px'></div>"
        + "<div style='display:flex;gap:8px;margin-top:6px'><button id='mp-pinok' style='flex:1;border:none;border-radius:10px;padding:10px;background:#2e6d52;color:#fff;font-weight:800'>進入</button>"
        + "<button id='mp-pincancel' style='border:none;border-radius:10px;padding:10px 16px;background:#bbb;color:#fff;font-weight:800'>關閉</button></div></div>";
      var pin = el("mp-pin");
      function tryPin() { if ((pin.value || "").trim() === PARENT_PIN) { parentalUnlocked = true; renderParental(); fetchParentalFull(); } else { el("mp-pinerr").textContent = "密碼不對"; } }
      el("mp-pinok").addEventListener("click", tryPin);
      pin.addEventListener("keydown", function (e) { e.stopPropagation(); if (e.key === "Enter") tryPin(); });
      el("mp-pincancel").addEventListener("click", closeParental);
      try { pin.focus(); } catch (e) {}
      return;
    }
    function seg(label, hint, k, opts, cur) {
      var h = "<div style='margin-bottom:12px'><div style='font-weight:700;font-size:14px;color:#333'>" + label + "</div>";
      if (hint) h += "<div style='font-size:11.5px;color:#888;margin:1px 0 5px'>" + hint + "</div>";
      h += "<div style='display:flex;gap:7px'>";
      opts.forEach(function (o) {
        var on = o.v === cur;
        h += "<button class='mp-seg' data-k='" + k + "' data-v='" + o.v + "' style='flex:1;border:2px solid " + (on ? "#2e6d52" : "#ddd") + ";border-radius:10px;padding:8px 4px;background:" + (on ? "#e6f3ec" : "#fafafa") + ";color:" + (on ? "#2e6d52" : "#666") + ";font-weight:800;font-size:13px'>" + o.t + "</button>";
      });
      return h + "</div></div>";
    }
    var html = "<div style='background:#fff;border-radius:16px;max-width:340px;width:100%;max-height:82vh;overflow-y:auto;padding:16px 16px 14px'>";
    html += "<div style='display:flex;justify-content:space-between;align-items:center;margin-bottom:12px'><div style='font-weight:800;font-size:17px;color:#2e6d52'>家長控管</div><button id='mp-pclose' style='border:none;background:#eee;border-radius:8px;padding:5px 10px;font-weight:800;color:#666'>✕</button></div>";
    html += seg("聊天功能", "關閉後孩子不能發、也收不到訊息", "chatEnabled", [{ v: true, t: "開啟" }, { v: false, t: "關閉" }], myParental.chatEnabled);
    html += seg("聊天方式", "「只能安全句」＝孩子只能挑預設好的句子，不能自由打字", "mode", [{ v: "free", t: "自由打字" }, { v: "canned", t: "只能安全句" }], myParental.mode);
    html += seg("悄悄話", "是否允許孩子跟人私下悄悄話", "allowWhisper", [{ v: true, t: "允許" }, { v: false, t: "禁止" }], myParental.allowWhisper);
    html += "<div style='font-weight:700;font-size:14px;color:#333;margin:6px 0 4px'>最近聊天紀錄</div>";
    html += "<div id='mp-phist' style='background:#f5f5f5;border-radius:9px;padding:8px;max-height:140px;overflow-y:auto;font-size:12.5px;color:#444'></div>";
    html += "<div style='font-size:10.5px;color:#aaa;margin-top:8px;line-height:1.4'>※ demo 展示版：設定存伺服器記憶體、重啟會還原；正式版會綁定真實家長帳號與孩子。</div></div>";
    m.innerHTML = html;
    var hist = el("mp-phist");
    if (!parentalHistory.length) hist.textContent = "（還沒有聊天紀錄）";
    else parentalHistory.slice(-30).forEach(function (h) {
      var row = document.createElement("div"); row.style.cssText = "padding:3px 0;border-bottom:1px solid #e8e8e8";
      var t = ""; try { var dt = new Date(h.ts); t = ("0" + dt.getHours()).slice(-2) + ":" + ("0" + dt.getMinutes()).slice(-2); } catch (e) {}
      row.textContent = (t ? "[" + t + "] " : "") + (h.text || "");
      hist.appendChild(row);
    });
    el("mp-pclose").addEventListener("click", closeParental);
    Array.prototype.forEach.call(m.querySelectorAll(".mp-seg"), function (b) {
      b.addEventListener("click", function () {
        var k = b.getAttribute("data-k"), v = b.getAttribute("data-v");
        if (v === "true") v = true; else if (v === "false") v = false;
        var patch = {}; patch[k] = v; saveParental(patch);
      });
    });
  }

  window.__mp = {
    count: function () { return Object.keys(remotes).length; },
    friendsCount: function () { return (friendsData.friends || []).length; },
    uid: function () { return myUid; },
    _send: function (t, d) { if (room) try { room.send(t, d); } catch (e) {} },
    connected: function () { return !!room; },
    remoteInfo: function () { return Object.keys(remotes).map(function (k) { var r = remotes[k]; return { skin: r.skin, anim: r.spr.anims.currentAnim && r.spr.anims.currentAnim.key }; }); },
    // explore.js create() 末尾呼叫：換地圖(scene.restart)會重跑 → 重置遠端 sprite
    onSceneCreate: function (scene) {
      curScene = scene;
      desiredMap = mapKey(scene.mapId);
      Object.keys(remotes).forEach(function (k) { destroyRemote(remotes[k]); }); // 換地圖先清舊遠端，免殘影
      remotes = {};
      outfitLoading = {}; outfitFailed = {}; // 換地圖清旗標：舊 scene loader 的 complete 不一定 fire，避免造型永久卡 loading
      gotoDesired(); // 換地圖 → 連/換到新地圖房（不同地圖看不到彼此/不互相聊天）
    },
    // explore.js update() 末尾呼叫：送自己位置 + 渲染其他人
    onUpdate: function (scene, x, y, dx, dy, moving) {
      curScene = scene;
      // 聊天室(含好友)只在大地圖顯示：開任何 demo 選單/裝備/商店面板就隱藏（變化時才寫 DOM）
      var menuOpen = (typeof scene._anyPanelOpen === "function") && scene._anyPanelOpen();
      if (menuOpen !== mpHidden) {
        mpHidden = menuOpen;
        var box = el("mp-chat"); if (box) box.style.visibility = menuOpen ? "hidden" : "";
        if (menuOpen) { closePMenu(); closeGiftPicker(); closeParental(); var ep = el("mp-emote"); if (ep) ep.style.display = "none"; } // 開 demo 面板就關掉暫時彈窗，免疊上去
      }
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
