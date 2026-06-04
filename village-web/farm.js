/* farm.js — campus 牧場「養動物」(畜牧) C-3a
 * 零核心改動：包住 window.openShop 攔 "ranch"、輪詢 window.game 抓 campus 場景、
 * 自己 runtime 載走路圖 + 在欄裡生動物 sprite + 走路巡邏。localStorage 存養的動物。
 * 牛雞沿用村莊現成走路圖；豬鴨鵝羊用新走路圖。
 */
(function () {
  "use strict";

  // 注入牧場面板 CSS（不動 shop.css，多 session 安全；面板框沿用 .shop-panel）
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
      ".ranch-add{font-size:12px;color:#3a8a3a;font-weight:700}" +
      ".ranch-owned{margin-top:14px;padding-top:10px;border-top:1px dashed #e0c894}" +
      ".ranch-owned-t{font-size:13px;color:#8a6a3a;margin-bottom:6px}" +
      ".ranch-chip{display:inline-block;background:#fdeccb;border-radius:10px;padding:3px 9px;margin:0 6px 6px 0;font-size:13px;color:#5a3a14}" +
      ".ranch-empty{font-size:13px;color:#aa8a5a}";
    document.head.appendChild(st);
  })();

  // 6 種家畜走路規格（牛雞=村莊現成圖；豬鴨鵝羊=新圖）
  const SPECIES = {
    cow:     { name: "牛", emoji: "🐄", img: "cowwalk.webp",    fw: 384, fh: 337, frames: 9, fr: 8, facing: "left",  scale: 0.26, speed: 28 },
    chicken: { name: "雞", emoji: "🐔", img: "chick_walk.webp", fw: 512, fh: 512, frames: 6, fr: 8, facing: "right", scale: 0.16, speed: 34 },
    pig:     { name: "豬", emoji: "🐷", img: "pig_walk.webp",   fw: 292, fh: 264, frames: 2, fr: 4, facing: "right", scale: 0.40, speed: 26 },
    sheep:   { name: "羊", emoji: "🐑", img: "sheep_walk.webp", fw: 277, fh: 264, frames: 2, fr: 4, facing: "right", scale: 0.40, speed: 28 },
    duck:    { name: "鴨", emoji: "🦆", img: "duck_walk.webp",  fw: 239, fh: 264, frames: 2, fr: 5, facing: "right", scale: 0.34, speed: 30 },
    goose:   { name: "鵝", emoji: "🪿", img: "goose_walk.webp", fw: 247, fh: 264, frames: 2, fr: 5, facing: "right", scale: 0.36, speed: 30 },
  };
  const ORDER = ["cow", "chicken", "pig", "sheep", "duck", "goose"];
  const LS_KEY = "campus_livestock";
  // 欄活動範圍（normalized）：穀倉前的草地（避開穀倉本體右下角）
  const PEN = { x0: 0.46, y0: 0.46, x1: 0.80, y1: 0.70 };

  let _seq = 0;
  function loadStock() {
    try {
      const a = JSON.parse(localStorage.getItem(LS_KEY));
      if (Array.isArray(a)) return a;
    } catch (e) {}
    // 起手 seed：先給幾隻讓牧場一進去就有動物（之後可在面板再養）
    const seed = [
      { id: "s1", species: "cow",     bornAt: 0 },
      { id: "s2", species: "chicken", bornAt: 0 },
      { id: "s3", species: "sheep",   bornAt: 0 },
    ];
    localStorage.setItem(LS_KEY, JSON.stringify(seed));
    return seed;
  }
  function saveStock(a) { localStorage.setItem(LS_KEY, JSON.stringify(a)); }
  function newId() { _seq += 1; return "a" + Date.now() + "_" + _seq; }

  // ---------- 世界裡的動物管理 ----------
  const Ranch = {
    scene: null,
    sprites: {},      // id -> {sprite, sp, target}
    _pending: {},     // texKey -> [cb...]（載圖去重，避免同種重複 load）
    onUpdate: null,

    penPoint() {
      return {
        x: PEN.x0 + (PEN.x1 - PEN.x0) * Math.random(),
        y: PEN.y0 + (PEN.y1 - PEN.y0) * Math.random(),
      };
    },
    nx(x) { return x * this.scene.IMG_W; },
    ny(y) { return y * this.scene.IMG_H + (this.scene.WORLD_OFFSET_Y || 0); },

    ensureTexture(sp, cb) {
      const sc = this.scene, key = "ranch_" + sp.img;
      if (!sc) return;
      if (sc.textures.exists(key)) { this.ensureAnim(sp); cb(); return; }
      // 同種載圖去重：第一隻才真的 load，其餘排隊等同一個 complete
      (this._pending[key] = this._pending[key] || []).push(cb);
      if (this._pending[key].length > 1) return;
      sc.load.spritesheet(key, sp.img + "?v=3", { frameWidth: sp.fw, frameHeight: sp.fh });
      sc.load.once("complete", () => {
        const cbs = this._pending[key] || [];
        delete this._pending[key];
        if (!this.scene || !this.scene.textures.exists(key)) return;  // 已離開 campus 或載失敗 → 不動
        this.ensureAnim(sp);
        cbs.forEach((c) => c());
      });
      sc.load.start();
    },
    ensureAnim(sp) {
      const sc = this.scene, key = "ranch_walk_" + sp.img;
      if (!sc.anims.exists(key)) {
        sc.anims.create({
          key,
          frames: sc.anims.generateFrameNumbers("ranch_" + sp.img, { start: 0, end: sp.frames - 1 }),
          frameRate: sp.fr, repeat: -1,
        });
      }
    },

    spawn(rec) {
      const sp = SPECIES[rec.species];
      if (!sp || !this.scene) return;
      this.ensureTexture(sp, () => {
        if (!this.scene || this.sprites[rec.id]) return;
        const p = this.penPoint();
        const spr = this.scene.add.sprite(this.nx(p.x), this.ny(p.y), "ranch_" + sp.img, 0);
        spr.setOrigin(0.5, 1).setScale(sp.scale);
        spr.play("ranch_walk_" + sp.img);
        const shadow = this.scene.add.ellipse(spr.x, spr.y, 48 * sp.scale * 2, 14 * sp.scale * 2, 0x000000, 0.28);
        this.sprites[rec.id] = { spr, shadow, sp, target: this.penPoint(), pause: 0 };
      });
    },

    attach(scene) {
      this.detach();
      this.scene = scene;
      this.sprites = {};
      this._pending = {};
      loadStock().forEach((rec) => this.spawn(rec));
      this.onUpdate = (time, delta) => this.update(delta);
      scene.events.on("update", this.onUpdate);
      scene.events.once("shutdown", () => this.detach());
      scene.__ranchAttached = true;
    },
    detach() {
      if (this.scene && this.onUpdate) this.scene.events.off("update", this.onUpdate);
      Object.values(this.sprites).forEach((a) => { a.spr.destroy(); a.shadow.destroy(); });
      this.sprites = {};
      this._pending = {};
      this.onUpdate = null;
      if (this.scene) this.scene.__ranchAttached = false;
      this.scene = null;
    },

    update(delta) {
      const sc = this.scene;
      if (!sc || !sc.player) return;
      const dt = delta / 1000;
      Object.values(this.sprites).forEach((a) => {
        if (a.pause > 0) { a.pause -= delta; a.spr.anims.pause(); return; }
        a.spr.anims.resume();
        const tx = this.nx(a.target.x), ty = this.ny(a.target.y);
        const dx = tx - a.spr.x, dy = ty - a.spr.y;
        const dist = Math.hypot(dx, dy);
        if (dist < 6) {
          a.target = this.penPoint();
          a.pause = 600 + Math.random() * 1400;   // 走到定點停一下吃草
          return;
        }
        const v = a.sp.speed;
        a.spr.x += (dx / dist) * v * dt;
        a.spr.y += (dy / dist) * v * dt;
        a.shadow.x = a.spr.x; a.shadow.y = a.spr.y;
        a.spr.setDepth(a.spr.y); a.shadow.setDepth(a.spr.y - 1);
        // 朝向：facing 'right' 的圖往左走要翻
        const forwardRight = a.sp.facing === "right";
        a.spr.setFlipX(forwardRight ? dx < 0 : dx > 0);
      });
    },
  };

  // 輪詢抓 campus 場景（不改 explore.js）；換地圖 scene.restart 後自動重接
  setInterval(() => {
    const g = window.game;
    if (!g || !g.scene) return;
    const sc = g.scene.scenes.find((s) => s.scene.key === "explore" && s.mapId === "campus" && s.player);
    if (sc && !sc.__ranchAttached) Ranch.attach(sc);
  }, 400);

  // ---------- 畜牧面板（HTML overlay）----------
  let ov = null, onCloseCb = null;
  function buildOverlay() {
    if (ov) return ov;
    ov = document.createElement("div");
    ov.id = "ranch-overlay";
    ov.innerHTML =
      '<div class="ranch-panel">' +
      '  <button class="ranch-close" id="ranch-close">✕</button>' +
      '  <div class="ranch-title">🐮 學園牧場・養動物</div>' +
      '  <div class="ranch-sub">選一種動物加進牧場，牠會出現在欄裡走動</div>' +
      '  <div class="ranch-grid" id="ranch-grid"></div>' +
      '  <div class="ranch-owned" id="ranch-owned"></div>' +
      "</div>";
    document.body.appendChild(ov);
    ov.querySelector("#ranch-close").onclick = closeRanch;
    ov.onclick = (e) => { if (e.target === ov) closeRanch(); };
    return ov;
  }
  function render() {
    const grid = ov.querySelector("#ranch-grid");
    grid.innerHTML = ORDER.map((k) =>
      '<button class="ranch-card" data-k="' + k + '">' +
      '<div class="ranch-emoji">' + SPECIES[k].emoji + "</div>" +
      '<div class="ranch-name">' + SPECIES[k].name + "</div>" +
      '<div class="ranch-add">＋ 養</div></button>'
    ).join("");
    grid.querySelectorAll(".ranch-card").forEach((b) => {
      b.onclick = () => addAnimal(b.dataset.k);
    });
    const stock = loadStock();
    const counts = {};
    stock.forEach((r) => { counts[r.species] = (counts[r.species] || 0) + 1; });
    ov.querySelector("#ranch-owned").innerHTML =
      '<div class="ranch-owned-t">目前牧場：</div>' +
      (stock.length
        ? ORDER.filter((k) => counts[k]).map((k) =>
            '<span class="ranch-chip">' + SPECIES[k].emoji + " " + SPECIES[k].name + " ×" + counts[k] + "</span>").join("")
        : '<span class="ranch-empty">還沒有動物，養一隻吧</span>');
  }
  function addAnimal(species) {
    const stock = loadStock();
    const rec = { id: newId(), species, bornAt: Date.now() };
    stock.push(rec);
    saveStock(stock);
    Ranch.spawn(rec);   // 立刻出現在欄裡
    render();
  }

  function openRanch(cb) {
    onCloseCb = cb || null;
    buildOverlay();
    render();
    ov.style.display = "flex";
  }
  function closeRanch() {
    if (ov) ov.style.display = "none";
    const cb = onCloseCb; onCloseCb = null;
    if (cb) cb();
  }

  // 包住 window.openShop 攔 "ranch"（不改 shop.js）
  const _origOpenShop = window.openShop;
  window.openShop = function (id, cb) {
    if (id === "ranch") { openRanch(cb); return; }
    if (typeof _origOpenShop === "function") return _origOpenShop(id, cb);
  };
  window.openRanch = openRanch;
})();
