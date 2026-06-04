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
      "#ranch-overlay{position:fixed;inset:0;z-index:21000;display:none;align-items:center;justify-content:center;background:rgba(0,0,0,.5)}" +
      "#ranch-overlay .ranch-panel{position:relative;box-sizing:border-box;display:block;width:min(92vw,440px);max-height:86vh;overflow-y:auto;padding:20px 16px 16px;background:#fffdf7;border:3px solid #e6c98c;border-radius:20px;box-shadow:0 12px 40px rgba(0,0,0,.35)}" +
      ".ranch-close{position:absolute;top:10px;right:12px;width:32px;height:32px;border:none;border-radius:50%;background:#e8a24a;color:#fff;font-size:17px;font-weight:700;cursor:pointer;line-height:32px;text-align:center;padding:0}" +
      ".ranch-title{font-size:20px;font-weight:800;color:#5a3a14;text-align:center}" +
      ".ranch-sub{font-size:13px;color:#8a6a3a;text-align:center;margin:4px 0 12px}" +
      ".ranch-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}" +
      ".ranch-card{display:flex;flex-direction:column;align-items:center;gap:2px;padding:10px 4px;border:2px solid #e6c98c;border-radius:14px;background:#fff8ec;cursor:pointer}" +
      ".ranch-card:active{transform:scale(.95)}" +
      ".ranch-emoji{font-size:34px;line-height:1}" +
      ".ranch-name{font-size:14px;font-weight:700;color:#5a3a14}" +
      ".ranch-prod{font-size:11px;color:#9a7a4a}" +
      ".ranch-add{font-size:12px;color:#3a8a3a;font-weight:700}" +
      ".ranch-sec{margin-top:14px;padding-top:10px;border-top:1px dashed #e0c894}" +
      ".ranch-sec-t{font-size:13px;color:#8a6a3a;margin-bottom:6px;font-weight:700}" +
      ".ranch-chip{display:inline-block;background:#fdeccb;border-radius:10px;padding:3px 9px;margin:0 6px 6px 0;font-size:13px;color:#5a3a14}" +
      ".ranch-chip.harvest{background:#eaf6d8}" +
      ".ranch-empty{font-size:13px;color:#aa8a5a}";
    document.head.appendChild(st);
  })();

  // 6 種家畜：走路圖(成年) + 寶寶/青年靜態圖 + 產品
  const SPECIES = {
    cow:     { name: "牛", emoji: "🐄", img: "cowwalk.webp",    fw: 384, fh: 337, frames: 9, fr: 8, facing: "left",  speed: 28, baby: "cow_baby.webp",     teen: "cow_teen.webp",     product: "🥛" },
    chicken: { name: "雞", emoji: "🐔", img: "chick_walk.webp", fw: 512, fh: 512, frames: 6, fr: 8, facing: "right", speed: 34, baby: "chicken_baby.webp", teen: "chicken_teen.webp", product: "🥚" },
    pig:     { name: "豬", emoji: "🐷", img: "pig_walk.webp",   fw: 292, fh: 264, frames: 2, fr: 4, facing: "right", speed: 26, baby: "pig_baby.webp",     teen: "pig_teen.webp",     product: "🍖" },
    sheep:   { name: "羊", emoji: "🐑", img: "sheep_walk.webp", fw: 277, fh: 264, frames: 2, fr: 4, facing: "right", speed: 28, baby: "sheep_baby.webp",   teen: "sheep_teen.webp",   product: "🧶" },
    duck:    { name: "鴨", emoji: "🦆", img: "duck_walk.webp",  fw: 239, fh: 264, frames: 2, fr: 5, facing: "right", speed: 30, baby: "duck_baby.webp",    teen: "duck_teen.webp",    product: "🥚" },
    goose:   { name: "鵝", emoji: "🪿", img: "goose_walk.webp", fw: 247, fh: 264, frames: 2, fr: 5, facing: "right", speed: 30, baby: "goose_baby.webp",   teen: "goose_teen.webp",   product: "🥚" },
  };
  const ORDER = ["cow", "chicken", "pig", "sheep", "duck", "goose"];

  // 成長時間（秒級 demo）
  const BABY_MS = 7000, TEEN_MS = 18000;   // 0~7s 寶寶 / 7~18s 青年 / 18s+ 成年
  const PRODUCT_MS = 10000;                 // 成年每 10s 產出一個產品
  const STAGE_H = { baby: 56, teen: 78, adult: 100 };  // 各階段目標螢幕高(px)

  const LS_STOCK = "campus_livestock";   // [{id,species,bornAt,lastCollect}]
  const LS_HARVEST = "campus_harvest";   // {emoji: count}

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
  function saveStock(a) { localStorage.setItem(LS_STOCK, JSON.stringify(a)); }
  function loadHarvest() { try { return JSON.parse(localStorage.getItem(LS_HARVEST)) || {}; } catch (e) { return {}; } }
  function saveHarvest(h) { localStorage.setItem(LS_HARVEST, JSON.stringify(h)); }
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
    PEN: { x0: 0.46, y0: 0.46, x1: 0.80, y1: 0.70 },

    penPoint() { const P = this.PEN; return { x: P.x0 + (P.x1 - P.x0) * Math.random(), y: P.y0 + (P.y1 - P.y0) * Math.random() }; },
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
      const p = this.penPoint();
      const a = { rec, sp, spr: null, shadow: null, stage: null, homeX: this.nx(p.x), homeY: this.ny(p.y), target: this.penPoint(), pause: 0, prodSpr: null };
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
        const scale = STAGE_H[stage] / frameH;
        if (!a.spr) {
          a.spr = this.scene.add.sprite(a.homeX, a.homeY, texKey, 0).setOrigin(0.5, 1);
          a.shadow = this.scene.add.ellipse(a.homeX, a.homeY, 40, 13, 0x000000, 0.26);
        } else {
          a.spr.setTexture(texKey, 0);
        }
        a.spr.setScale(scale);
        a.shadow.setScale(STAGE_H[stage] / STAGE_H.adult);
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
      a.prodSpr = this.scene.add.text(a.spr.x, a.spr.y - STAGE_H.adult - 6, a.sp.product, { fontSize: "26px" }).setOrigin(0.5, 1).setDepth(99998);
    },
    hideProduct(a) { if (a.prodSpr) { a.prodSpr.destroy(); a.prodSpr = null; } },
    tryCollect(a) {
      if (!this.productReady(a)) return;
      const h = loadHarvest(); h[a.sp.product] = (h[a.sp.product] || 0) + 1; saveHarvest(h);
      a.rec.lastCollect = Date.now();
      const stock = loadStock(); const r = stock.find((x) => x.id === a.rec.id); if (r) { r.lastCollect = a.rec.lastCollect; saveStock(stock); }
      this.hideProduct(a);
      // 飄字 +產品
      const t = this.scene.add.text(a.spr.x, a.spr.y - 60, "+" + a.sp.product, { fontSize: "22px", color: "#3a8a3a", fontStyle: "bold" }).setOrigin(0.5).setDepth(99999);
      this.scene.tweens.add({ targets: t, y: t.y - 36, alpha: 0, duration: 800, onComplete: () => t.destroy() });
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
      if (!need) { cb(); return; }
      sc.load.once("complete", () => { if (this.scene) cb(); });
      sc.load.start();
    },
    attach(scene) {
      this.detach();
      this.scene = scene; this.animals = {}; this._pending = {};
      this.preloadAll(() => {
        if (!this.scene) return;
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
      this.animals = {}; this._pending = {}; this.onUpdate = null;
      if (this.scene) this.scene.__ranchAttached = false;
      this.scene = null;
    },

    update(delta) {
      const sc = this.scene;
      if (!sc || !sc.player) return;
      const dt = delta / 1000;
      Object.values(this.animals).forEach((a) => {
        if (!a.spr) return;
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
          if (dist < 6) { a.target = this.penPoint(); a.pause = 600 + Math.random() * 1400; }
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
        if (this.productReady(a)) { this.showProduct(a); if (a.prodSpr) { a.prodSpr.x = a.spr.x; a.prodSpr.y = a.spr.y - STAGE_H.adult - 6; a.prodSpr.setDepth(99998); } }
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
      '  <div class="ranch-title">🐮 學園牧場・養動物</div>' +
      '  <div class="ranch-sub">養動物→寶寶長大成年→點成年的動物收成</div>' +
      '  <div class="ranch-grid" id="ranch-grid"></div>' +
      '  <div class="ranch-sec" id="ranch-owned"></div>' +
      '  <div class="ranch-sec" id="ranch-harvest"></div>' +
      "</div>";
    document.body.appendChild(ov);
    ov.querySelector("#ranch-close").onclick = closeRanch;
    ov.onclick = (e) => { if (e.target === ov) closeRanch(); };
    return ov;
  }
  function render() {
    ov.querySelector("#ranch-grid").innerHTML = ORDER.map((k) =>
      '<button class="ranch-card" data-k="' + k + '"><div class="ranch-emoji">' + SPECIES[k].emoji + '</div>' +
      '<div class="ranch-name">' + SPECIES[k].name + '</div><div class="ranch-prod">產 ' + SPECIES[k].product + '</div>' +
      '<div class="ranch-add">＋ 養</div></button>').join("");
    ov.querySelectorAll(".ranch-card").forEach((b) => { b.onclick = () => addAnimal(b.dataset.k); });
    const stock = loadStock(), counts = {};
    stock.forEach((r) => { counts[r.species] = (counts[r.species] || 0) + 1; });
    ov.querySelector("#ranch-owned").innerHTML = '<div class="ranch-sec-t">目前牧場：</div>' +
      (stock.length ? ORDER.filter((k) => counts[k]).map((k) => '<span class="ranch-chip">' + SPECIES[k].emoji + " " + SPECIES[k].name + " ×" + counts[k] + "</span>").join("") : '<span class="ranch-empty">還沒有動物，養一隻吧</span>');
    const h = loadHarvest(), keys = Object.keys(h).filter((k) => h[k] > 0);
    ov.querySelector("#ranch-harvest").innerHTML = '<div class="ranch-sec-t">已收成：</div>' +
      (keys.length ? keys.map((k) => '<span class="ranch-chip harvest">' + k + " ×" + h[k] + "</span>").join("") : '<span class="ranch-empty">還沒收成，養大動物點牠收成</span>');
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
})();
