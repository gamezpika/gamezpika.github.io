/* farm.js — campus 牧場「養動物」(畜牧) C-3a + C-3b 成長 + C-3c 收成
 * 零核心改動：包 window.openShop 攔 "ranch"、輪詢 window.game 抓 campus 場景、
 * runtime 載圖在欄裡生動物 sprite。寶寶靜態小圖→秒級長大→成年走路圖+變大；
 * 成年定時產出產品，點一下收成（計數存 localStorage）。
 */
(function () {
  "use strict";

  (function injectCSS() {
    if (document.getElementById("ranch-css")) return;
    const st = document.createElement("style");
    st.id = "ranch-css";
    st.textContent =
      // 村莊風（同商店/布告欄：奶油底+棕邊+棕標題列+紅關閉鈕+奶油卡）
      "#ranch-overlay{position:fixed;inset:0;z-index:21000;display:none;align-items:center;justify-content:center;background:rgba(20,14,8,.55);backdrop-filter:blur(2px);font-family:-apple-system,'PingFang TC','Microsoft JhengHei',sans-serif}" +
      ".ranch-panel{position:relative;width:min(94vw,430px);max-height:88vh;background:linear-gradient(180deg,#fff6e2,#ffeecb);border:5px solid #8a5a2b;border-radius:20px;box-shadow:0 14px 40px rgba(0,0,0,.5),inset 0 0 0 3px #ffd98a;overflow:hidden;display:flex;flex-direction:column;animation:ranch-pop .2s cubic-bezier(.2,1.3,.5,1)}" +
      "@keyframes ranch-pop{from{transform:scale(.88);opacity:0}to{transform:scale(1);opacity:1}}" +
      ".ranch-close{position:absolute;top:8px;right:10px;z-index:4;width:34px;height:34px;border-radius:50%;background:#e8533a;color:#fff;border:3px solid #fff2dd;font-size:19px;font-weight:900;cursor:pointer;line-height:1;box-shadow:0 3px 0 #a8331f;padding:0}" +
      ".ranch-close:active{transform:translateY(2px);box-shadow:0 1px 0 #a8331f}" +
      "#ranch-overlay #ranch-body{display:flex;flex-direction:column;flex:1;min-height:0}" +
      ".ranch-tbar{flex:0 0 auto;background:linear-gradient(180deg,#b5712f,#94591f);color:#fff7e6;font-size:20px;font-weight:800;letter-spacing:2px;text-align:center;padding:12px 46px;border-bottom:3px solid #ffd98a;text-shadow:0 2px 0 rgba(0,0,0,.25)}" +
      ".ranch-content{flex:1;min-height:0;padding:14px;overflow-y:auto;-webkit-overflow-scrolling:touch}" +
      ".ranch-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:9px}" +
      ".ranch-card{display:flex;flex-direction:column;align-items:center;gap:2px;padding:9px 4px 7px;border:3px solid #e3c089;border-radius:14px;background:#fffaf0;cursor:pointer;box-shadow:0 2px 0 #e3c089}" +
      ".ranch-card:active{transform:translateY(2px);box-shadow:0 0 0 #e3c089}" +
      ".ranch-card img{width:50px;height:50px;object-fit:contain}" +
      ".ranch-name{font-size:13px;font-weight:800;color:#5a3a18}" +
      ".ranch-prod{font-size:11px;color:#a07a4a}" +
      ".ranch-add{font-size:12px;color:#2bb05a;font-weight:800;margin-top:1px}" +
      ".ranch-sec{margin-top:13px;padding-top:10px;border-top:2px dashed #e3c089}" +
      ".ranch-sec-t{font-size:13px;color:#8a5a2b;font-weight:800;margin-bottom:6px}" +
      ".ranch-chip{display:inline-block;background:#ffe3b0;border:2px solid #d8a85a;border-radius:999px;padding:3px 10px;margin:0 6px 6px 0;font-size:12px;font-weight:700;color:#7a4f1e}" +
      ".ranch-chip.harvest{background:#e6f3cf;border-color:#bcd98a;color:#4a6a1e}" +
      ".ranch-empty{font-size:12px;color:#b89a6a}";
    document.head.appendChild(st);
  })();

  // 6 種家畜：走路圖(成年) + 寶寶/青年靜態圖 + 產品 + h(成年顯示高,依體型) + zone(pen陸欄/pond池塘)
  const SPECIES = {
    cow:     { name: "牛", emoji: "🐄", img: "cowwalk.webp",    fw: 384, fh: 337, frames: 9, fr: 8, facing: "left",  speed: 28, baby: "cow_baby.webp",     teen: "cow_teen.webp",     product: "🥛", h: 118, zone: "pen" },
    chicken: { name: "雞", emoji: "🐔", img: "chick_walk.webp", fw: 512, fh: 512, frames: 6, fr: 8, facing: "right", speed: 34, baby: "chicken_baby.webp", teen: "chicken_teen.webp", product: "🥚", h: 58,  zone: "pen" },
    pig:     { name: "豬", emoji: "🐷", img: "pig_walk.webp",   fw: 292, fh: 264, frames: 2, fr: 4, facing: "right", speed: 26, baby: "pig_baby.webp",     teen: "pig_teen.webp",     product: "🍖", h: 90,  zone: "pen" },
    sheep:   { name: "羊", emoji: "🐑", img: "sheep_walk.webp", fw: 277, fh: 264, frames: 2, fr: 4, facing: "right", speed: 28, baby: "sheep_baby.webp",   teen: "sheep_teen.webp",   product: "🧶", h: 92,  zone: "pen" },
    duck:    { name: "鴨", emoji: "🦆", img: "duck_walk.webp",  fw: 239, fh: 264, frames: 2, fr: 5, facing: "right", speed: 30, baby: "duck_baby.webp",    teen: "duck_teen.webp",    product: "🥚", h: 66,  zone: "pond" },
    goose:   { name: "鵝", emoji: "🪿", img: "goose_walk.webp", fw: 247, fh: 264, frames: 2, fr: 5, facing: "right", speed: 30, baby: "goose_baby.webp",   teen: "goose_teen.webp",   product: "🥚", h: 80,  zone: "pond" },
  };
  const ORDER = ["cow", "chicken", "pig", "sheep", "duck", "goose"];
  // 面板不顯示 emoji → 產物/收成 emoji 對應中文名(含作物,收成籃與種田共用)
  const NAME_MAP = { "🥛": "牛奶", "🥚": "蛋", "🍖": "肉", "🧶": "羊毛", "🥦": "花椰菜", "🥕": "胡蘿蔔", "🍅": "番茄", "🌽": "玉米", "🍎": "蘋果", "🍠": "地瓜" };

  // 成長時間（秒級 demo）
  const BABY_MS = 7000, TEEN_MS = 18000;   // 0~7s 寶寶 / 7~18s 青年 / 18s+ 成年
  const PRODUCT_MS = 10000;                 // 成年每 10s 產出一個產品
  const STAGE_MUL = { baby: 0.55, teen: 0.78, adult: 1.0 };  // 各階段相對成年 h 的倍率

  const LS_STOCK = accNS("campus_livestock");   // [{id,species,bornAt,lastCollect}]（依帳號分開）
  const LS_HARVEST = accNS("campus_harvest");   // {emoji: count}（與種田共用收成籃，依帳號分開）

  let _seq = 0, _now = 0;
  function now() { return _now || Date.now(); }   // _now 用 scene time 推進，避免 Date 不可用環境
  function loadStock() {
    try { const a = JSON.parse(localStorage.getItem(LS_STOCK)); if (Array.isArray(a)) return a; } catch (e) {}
    const t = Date.now();
    const seed = [
      { id: "s1", species: "cow",     bornAt: t - 19000 },   // 起手給 3 隻已成年的
      { id: "s2", species: "chicken", bornAt: t - 19000 },
      { id: "s3", species: "sheep",   bornAt: t - 19000 },
    ];
    localStorage.setItem(LS_STOCK, JSON.stringify(seed));
    return seed;
  }
  function saveStock(a) { localStorage.setItem(LS_STOCK, JSON.stringify(a)); if (window.DemoState) window.DemoState.save("campus_livestock"); }
  function loadHarvest() { try { return JSON.parse(localStorage.getItem(LS_HARVEST)) || {}; } catch (e) { return {}; } }
  function saveHarvest(h) { localStorage.setItem(LS_HARVEST, JSON.stringify(h)); if (window.DemoState) window.DemoState.save("campus_harvest"); }
  function newId() { _seq += 1; return "a" + Date.now() + "_" + _seq; }

  function stageOf(rec) {
    const e = Date.now() - rec.bornAt;
    if (e < BABY_MS) return "baby";
    if (e < TEEN_MS) return "teen";
    return "adult";
  }

  // ---------- 世界裡的動物管理 ----------
  const Ranch = {
    scene: null, animals: {}, _pending: {}, onUpdate: null,
    // 水禽在池塘上游（池塘是 obstacle，動物不吃碰撞所以可在水面）
    POND:         { x0: 0.06, y0: 0.76, x1: 0.21, y1: 0.90 },
    LAND_DEFAULT: { x0: 0.82, y0: 0.12, x1: 0.93, y1: 0.22 },  // 找不到柵欄時的後備：右上空草地(刻意避開翻土田)
    _landPen: null,

    // 從 config 放置的「牧場柵欄」建築 sprite 讀位置 → 算欄內活動範圍（派派在地圖編輯器移柵欄,動物自動跟著）
    computePen() {
      const sc = this.scene;
      // 用 /fence/ 模糊比對：抓 fence_back(或任何柵欄圖)，日後再改名也不會失聯掉進後備欄；排除前排 overlay 自己
      const f = sc.children.list.find((o) => o.texture && /fence/.test(o.texture.key) && o.texture.key !== "fence_front.webp");
      if (!f) { this._landPen = this.LAND_DEFAULT; return; }
      const dw = f.displayWidth, dh = f.displayHeight;
      const left = f.x - dw * (f.originX != null ? f.originX : 0.5);
      const top = f.y - dh * (f.originY != null ? f.originY : 1.0);
      const oy = sc.WORLD_OFFSET_Y || 0;
      // 內縮到菱形欄內側（iso 六角欄：中央透明區約佔中段）
      this._landPen = {
        x0: (left + dw * 0.24) / sc.IMG_W, x1: (left + dw * 0.76) / sc.IMG_W,
        y0: (top + dh * 0.40 - oy) / sc.IMG_H, y1: (top + dh * 0.78 - oy) / sc.IMG_H,
      };
    },

    // 執行期強制圖層深度（寫在 farm.js 不靠 campus_config → 地圖編輯器一鍵推也洗不掉）：
    // ①柵欄整片壓到玩家後 ②疊一張前排底排橫桿用接地線排序,遮住走進欄裡的玩家 ③翻土田壓成地面層永遠在玩家下
    applyMapDepth() {
      const sc = this.scene;
      if (this._fenceFront) { this._fenceFront.destroy(); this._fenceFront = null; }
      const fence = sc.children.list.find((o) => o.texture && /fence/.test(o.texture.key) && o.texture.key !== "fence_front.webp");
      if (fence) {
        fence.setDepth(2);   // 後排:永遠在玩家後(地面層之上)
        if (sc.textures.exists("fence_front.webp")) {
          this._fenceFront = sc.add.image(fence.x, fence.y, "fence_front.webp")
            .setOrigin(fence.originX, fence.originY).setScale(fence.scaleX, fence.scaleY)
            .setRotation(fence.rotation).setDepth(fence.y);   // 前排:接地線正常排序
        }
      }
      const field = sc.children.list.find((o) => o.texture && o.texture.key === "field_iso.webp");
      if (field) field.setDepth(1);   // 翻土田:地面層,永遠在玩家下
    },

    zoneArea(zone) { return zone === "pond" ? this.POND : (this._landPen || this.LAND_DEFAULT); },
    penPoint(zone) { const A = this.zoneArea(zone); return { x: A.x0 + (A.x1 - A.x0) * Math.random(), y: A.y0 + (A.y1 - A.y0) * Math.random() }; },
    nx(x) { return x * this.scene.IMG_W; },
    ny(y) { return y * this.scene.IMG_H + (this.scene.WORLD_OFFSET_Y || 0); },

    // 載圖（image 或 spritesheet），同 key 去重 + scene 失效保護
    ensureTex(key, url, sheet, cb) {
      const sc = this.scene;
      if (!sc) return;
      if (sc.textures.exists(key)) { cb(); return; }
      (this._pending[key] = this._pending[key] || []).push(cb);
      if (this._pending[key].length > 1) return;
      if (sheet) sc.load.spritesheet(key, url, { frameWidth: sheet.fw, frameHeight: sheet.fh });
      else sc.load.image(key, url);
      sc.load.once("complete", () => {
        const cbs = this._pending[key] || []; delete this._pending[key];
        if (!this.scene || !this.scene.textures.exists(key)) return;
        cbs.forEach((c) => c());
      });
      sc.load.start();
    },
    ensureWalkAnim(sp) {
      const sc = this.scene, key = "ranch_walk_" + sp.img;
      if (!sc.anims.exists(key)) sc.anims.create({ key, frames: sc.anims.generateFrameNumbers("ranch_" + sp.img, { start: 0, end: sp.frames - 1 }), frameRate: sp.fr, repeat: -1 });
    },

    spawn(rec) {
      const sp = SPECIES[rec.species];
      if (!sp || !this.scene || this.animals[rec.id]) return;
      const p = this.penPoint(sp.zone);
      const a = { rec, sp, spr: null, shadow: null, stage: null, homeX: this.nx(p.x), homeY: this.ny(p.y), target: this.penPoint(sp.zone), pause: 0, prodSpr: null };
      this.animals[rec.id] = a;
      this.applyStage(a, stageOf(rec));
    },

    // 套用某成長階段：載對的圖、換貼圖、定大小、走/靜、可點收成
    applyStage(a, stage) {
      const sp = a.sp;
      const isAdult = stage === "adult";
      const texKey = isAdult ? "ranch_" + sp.img : "ranch_" + sp[stage];
      const url = (isAdult ? sp.img : sp[stage]) + "?v=3";
      const sheet = isAdult ? { fw: sp.fw, fh: sp.fh } : null;
      this.ensureTex(texKey, url, sheet, () => {
        if (!this.scene || !this.animals[a.rec.id]) return;
        if (isAdult) this.ensureWalkAnim(sp);
        const frameH = isAdult ? sp.fh : this.scene.textures.get(texKey).getSourceImage().height;
        const targetH = sp.h * STAGE_MUL[stage];   // 依體型 + 階段
        const scale = targetH / frameH;
        if (!a.spr) {
          a.spr = this.scene.add.sprite(a.homeX, a.homeY, texKey, 0).setOrigin(0.5, 1);
          a.shadow = this.scene.add.ellipse(a.homeX, a.homeY, 40, 13, 0x000000, 0.26);
        } else {
          a.spr.setTexture(texKey, 0);
        }
        a.spr.setScale(scale);
        a.shadow.setScale((sp.h / 100) * STAGE_MUL[stage]);
        if (isAdult) { a.spr.play("ranch_walk_" + sp.img); a.spr.setInteractive(); a.spr.on("pointerdown", () => this.tryCollect(a)); }
        else { a.spr.anims && a.spr.anims.stop(); a.spr.disableInteractive && a.spr.disableInteractive(); }
        a.stage = stage;
      });
    },

    productReady(a) {
      if (a.stage !== "adult") return false;
      const base = Math.max(a.rec.bornAt + TEEN_MS, a.rec.lastCollect || 0);
      return Date.now() - base >= PRODUCT_MS;
    },
    showProduct(a) {
      if (a.prodSpr) return;
      a.prodSpr = this.scene.add.text(a.spr.x, a.spr.y - a.sp.h - 6, a.sp.product, { fontSize: "26px" }).setOrigin(0.5, 1).setDepth(99998);
    },
    hideProduct(a) { if (a.prodSpr) { a.prodSpr.destroy(); a.prodSpr = null; } },
    tryCollect(a) {
      if (!this.productReady(a) || a._collected) return;
      a._collected = true;
      const h = loadHarvest(); h[a.sp.product] = (h[a.sp.product] || 0) + 1; saveHarvest(h);
      saveStock(loadStock().filter((x) => x.id !== a.rec.id));   // 從牧場移除
      this.hideProduct(a);
      if (a.spr.disableInteractive) a.spr.disableInteractive();
      // 飄字 +產品
      const t = this.scene.add.text(a.spr.x, a.spr.y - 60, "+" + a.sp.product, { fontSize: "22px", color: "#3a8a3a", fontStyle: "bold" }).setOrigin(0.5).setDepth(99999);
      this.scene.tweens.add({ targets: t, y: t.y - 36, alpha: 0, duration: 800, onComplete: () => t.destroy() });
      // 動物收成後離開：縮小淡出消失
      a.leaving = true;   // update() 不再移動牠
      this.scene.tweens.add({ targets: a.shadow, alpha: 0, duration: 420 });
      this.scene.tweens.add({
        targets: a.spr, scaleX: a.spr.scaleX * 0.4, scaleY: a.spr.scaleY * 0.4, alpha: 0, duration: 420,
        onComplete: () => {
          if (a.spr) a.spr.destroy(); if (a.shadow) a.shadow.destroy();
          delete this.animals[a.rec.id];
        },
      });
    },

    // 一次批次預載 6 種全部圖（成年 sheet + 寶寶 + 青年），避免逐隻 load.start 序列化失效
    preloadAll(cb) {
      const sc = this.scene; let need = false;
      ORDER.forEach((k) => {
        const sp = SPECIES[k];
        const a = "ranch_" + sp.img;
        if (!sc.textures.exists(a)) { sc.load.spritesheet(a, sp.img + "?v=3", { frameWidth: sp.fw, frameHeight: sp.fh }); need = true; }
        [sp.baby, sp.teen].forEach((img) => { const k2 = "ranch_" + img; if (!sc.textures.exists(k2)) { sc.load.image(k2, img + "?v=3"); need = true; } });
      });
      if (!sc.textures.exists("fence_front.webp")) { sc.load.image("fence_front.webp", "fence_front.webp?v=1"); need = true; }
      if (!need) { cb(); return; }
      sc.load.once("complete", () => { if (this.scene) cb(); });
      sc.load.start();
    },
    attach(scene) {
      this.detach();
      this.scene = scene; this.animals = {}; this._pending = {};
      this.preloadAll(() => {
        if (!this.scene) return;
        this.computePen();
        this.applyMapDepth();
        ORDER.forEach((k) => this.ensureWalkAnim(SPECIES[k]));
        loadStock().forEach((rec) => this.spawn(rec));
      });
      this.onUpdate = (time, delta) => this.update(delta);
      scene.events.on("update", this.onUpdate);
      scene.events.once("shutdown", () => this.detach());
      scene.__ranchAttached = true;
    },
    detach() {
      if (this.scene && this.onUpdate) this.scene.events.off("update", this.onUpdate);
      Object.values(this.animals).forEach((a) => { if (a.spr) a.spr.destroy(); if (a.shadow) a.shadow.destroy(); if (a.prodSpr) a.prodSpr.destroy(); });
      if (this._fenceFront) { this._fenceFront.destroy(); this._fenceFront = null; }
      this.animals = {}; this._pending = {}; this._landPen = null; this.onUpdate = null;
      if (this.scene) this.scene.__ranchAttached = false;
      this.scene = null;
    },

    update(delta) {
      const sc = this.scene;
      if (!sc || !sc.player) return;
      const dt = delta / 1000;
      Object.values(this.animals).forEach((a) => {
        if (!a.spr || a.leaving) return;
        // 成長換階段
        const stage = stageOf(a.rec);
        if (stage !== a.stage) this.applyStage(a, stage);
        if (a.stage !== "adult") {
          // 寶寶/青年：原地待著（輕微呼吸）
          a.shadow.x = a.spr.x; a.shadow.y = a.spr.y;
          a.spr.setDepth(a.spr.y); a.shadow.setDepth(a.spr.y - 1);
          return;
        }
        // 成年：走路巡邏
        if (a.pause > 0) { a.pause -= delta; a.spr.anims && a.spr.anims.pause(); }
        else {
          a.spr.anims && a.spr.anims.resume();
          const tx = this.nx(a.target.x), ty = this.ny(a.target.y);
          const dx = tx - a.spr.x, dy = ty - a.spr.y, dist = Math.hypot(dx, dy);
          if (dist < 6) { a.target = this.penPoint(a.sp.zone); a.pause = 600 + Math.random() * 1400; }
          else {
            a.spr.x += (dx / dist) * a.sp.speed * dt;
            a.spr.y += (dy / dist) * a.sp.speed * dt;
            const fwR = a.sp.facing === "right";
            a.spr.setFlipX(fwR ? dx < 0 : dx > 0);
          }
        }
        a.shadow.x = a.spr.x; a.shadow.y = a.spr.y;
        a.spr.setDepth(a.spr.y); a.shadow.setDepth(a.spr.y - 1);
        // 產品收成提示
        if (this.productReady(a)) { this.showProduct(a); if (a.prodSpr) { a.prodSpr.x = a.spr.x; a.prodSpr.y = a.spr.y - a.sp.h - 6; a.prodSpr.setDepth(99998); } }
      });
    },
  };

  setInterval(() => {
    const g = window.game; if (!g || !g.scene) return;
    const sc = g.scene.scenes.find((s) => s.scene.key === "explore" && s.mapId === "campus" && s.player);
    if (sc && !sc.__ranchAttached) Ranch.attach(sc);
  }, 400);

  // ---------- 畜牧面板 ----------
  let ov = null, onCloseCb = null;
  function buildOverlay() {
    if (ov) return ov;
    ov = document.createElement("div");
    ov.id = "ranch-overlay";
    ov.innerHTML =
      '<div class="ranch-panel">' +
      '  <button class="ranch-close" id="ranch-close">✕</button>' +
      '  <div id="ranch-body"></div>' +
      "</div>";
    document.body.appendChild(ov);
    ov.querySelector("#ranch-close").onclick = closeRanch;
    ov.onclick = (e) => { if (e.target === ov) closeRanch(); };
    return ov;
  }
  function render() {
    const stock = loadStock(), counts = {};
    stock.forEach((r) => { counts[r.species] = (counts[r.species] || 0) + 1; });
    const h = loadHarvest(), keys = Object.keys(h).filter((k) => h[k] > 0);
    const cards = ORDER.map((k) =>
      '<button class="ranch-card" data-k="' + k + '"><img src="' + SPECIES[k].teen + '?v=3" alt="">' +
      '<div class="ranch-name">' + SPECIES[k].name + '</div><div class="ranch-prod">產 ' + (NAME_MAP[SPECIES[k].product] || SPECIES[k].product) + '</div>' +
      '<div class="ranch-add">＋ 養</div></button>').join("");
    ov.querySelector("#ranch-body").innerHTML =
      '<div class="ranch-tbar">學園牧場</div><div class="ranch-content">' +
      '<div class="ranch-grid">' + cards + "</div>" +
      '<div class="ranch-sec"><div class="ranch-sec-t">目前牧場</div>' +
      (stock.length ? ORDER.filter((k) => counts[k]).map((k) => '<span class="ranch-chip">' + SPECIES[k].name + " ×" + counts[k] + "</span>").join("") : '<span class="ranch-empty">還沒有動物</span>') + "</div>" +
      '<div class="ranch-sec"><div class="ranch-sec-t">已收成</div>' +
      (keys.length ? keys.map((k) => '<span class="ranch-chip harvest">' + (NAME_MAP[k] || k) + " ×" + h[k] + "</span>").join("") : '<span class="ranch-empty">還沒收成</span>') + "</div>" +
      "</div>";
    ov.querySelectorAll(".ranch-card").forEach((b) => { b.onclick = () => addAnimal(b.dataset.k); });
  }
  function addAnimal(species) {
    const stock = loadStock();
    const rec = { id: newId(), species, bornAt: Date.now() };
    stock.push(rec); saveStock(stock);
    Ranch.spawn(rec);
    render();
  }
  function openRanch(cb) { onCloseCb = cb || null; buildOverlay(); render(); ov.style.display = "flex"; }
  function closeRanch() { if (ov) ov.style.display = "none"; const cb = onCloseCb; onCloseCb = null; if (cb) cb(); }

  const _origOpenShop = window.openShop;
  window.openShop = function (id, cb) {
    if (id === "ranch") { openRanch(cb); return; }
    if (typeof _origOpenShop === "function") return _origOpenShop(id, cb);
  };
  window.openRanch = openRanch;
  // hydrate 後 campus_livestock 變了→若牧場已掛上(玩家正在 campus)，用新 localStorage 重建動物。
  // 牧場 attach 時 spawn 一次、之後只跑動畫不重讀，故需這個鉤子（種田 crop.js 每幀 reconcile 不用）。
  window.refreshRanch = function () { if (Ranch.scene) Ranch.attach(Ranch.scene); };
})();
