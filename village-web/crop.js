/* crop.js — campus 學園農場「種田」(Phase C-2)
 * 鏡像 farm.js 模式、零核心改動：包 window.openShop 攔 "cropboard"(布告欄)、
 * 輪詢 window.game 抓 campus 場景、runtime 在田地 6 格生作物 sprite。
 * 流程：對話布告欄→選空格選作物→撒種子▶施肥▶澆水→20 分 4 階成長→點熟成收成。
 * 全 localStorage、不計幣。成長時間後台/網址可調(?cropgrow=秒數 或 window.CROP_GROW_MS)。
 */
(function () {
  "use strict";

  (function injectCSS() {
    if (document.getElementById("crop-css")) return;
    const st = document.createElement("style");
    st.id = "crop-css";
    st.textContent =
      "#crop-overlay{position:fixed;inset:0;z-index:21000;display:none;align-items:center;justify-content:center;background:rgba(0,0,0,.5)}" +
      "#crop-overlay .crop-panel{position:relative;box-sizing:border-box;display:block;width:min(92vw,460px);max-height:88vh;overflow-y:auto;padding:20px 16px 16px;background:#fffdf7;border:3px solid #bfe08c;border-radius:20px;box-shadow:0 12px 40px rgba(0,0,0,.35)}" +
      ".crop-close{position:absolute;top:10px;right:12px;width:32px;height:32px;border:none;border-radius:50%;background:#74b13a;color:#fff;font-size:17px;font-weight:700;cursor:pointer;line-height:32px;text-align:center;padding:0}" +
      ".crop-title{font-size:20px;font-weight:800;color:#3c5a14;text-align:center}" +
      ".crop-sub{font-size:13px;color:#5f8a3a;text-align:center;margin:4px 0 12px}" +
      ".crop-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}" +
      ".crop-plot{position:relative;display:flex;flex-direction:column;align-items:center;gap:3px;padding:10px 4px;border:2px solid #cfe6a4;border-radius:14px;background:#f5fbe8;cursor:pointer;min-height:96px;justify-content:center}" +
      ".crop-plot:active{transform:scale(.96)}" +
      ".crop-plot .pic{width:52px;height:52px;object-fit:contain;image-rendering:auto}" +
      ".crop-plot .ph{font-size:30px;line-height:1;opacity:.5}" +
      ".crop-plot .nm{font-size:13px;font-weight:700;color:#3c5a14}" +
      ".crop-plot .st{font-size:11px;color:#7a9a4a}" +
      ".crop-plot .ripe{font-size:11px;color:#3a8a3a;font-weight:700}" +
      ".crop-plot .idx{position:absolute;top:4px;left:7px;font-size:10px;color:#a9c47a;font-weight:700}" +
      ".crop-sec{margin-top:14px;padding-top:10px;border-top:1px dashed #cfe0a4}" +
      ".crop-sec-t{font-size:13px;color:#5f8a3a;margin-bottom:6px;font-weight:700}" +
      ".crop-chip{display:inline-block;background:#eaf6d8;border-radius:10px;padding:3px 9px;margin:0 6px 6px 0;font-size:13px;color:#3c5a14}" +
      ".crop-empty{font-size:13px;color:#8aa45a}" +
      // 種作物選擇 + 種植步驟
      ".crop-pick{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-top:6px}" +
      ".crop-pickcard{display:flex;flex-direction:column;align-items:center;gap:3px;padding:10px 4px;border:2px solid #cfe6a4;border-radius:14px;background:#fff8ec;cursor:pointer}" +
      ".crop-pickcard:active{transform:scale(.95)}" +
      ".crop-pickcard img{width:46px;height:46px;object-fit:contain}" +
      ".crop-pickcard .nm{font-size:13px;font-weight:700;color:#3c5a14}" +
      ".crop-back{display:inline-block;margin-bottom:8px;font-size:13px;color:#74b13a;font-weight:700;cursor:pointer;background:none;border:none;padding:0}" +
      ".crop-steps{text-align:center}" +
      ".crop-stage-view{position:relative;width:200px;height:200px;margin:8px auto;background:radial-gradient(ellipse at 50% 70%,#e7d3a8 0%,#cdb381 60%,#bda06e 100%);border-radius:16px;overflow:hidden;display:flex;align-items:center;justify-content:center}" +
      ".crop-stage-view img{width:150px;height:150px;object-fit:contain}" +
      ".crop-action-art{animation:cropBob 1.1s ease-in-out infinite;filter:drop-shadow(0 5px 6px rgba(0,0,0,.25))}" +
      "@keyframes cropBob{0%,100%{transform:translateY(0) rotate(-3deg)}50%{transform:translateY(-9px) rotate(3deg)}}" +
      ".crop-step-btns{display:flex;gap:8px;justify-content:center;margin-top:10px}" +
      ".crop-step-btn{flex:1;max-width:120px;padding:10px 4px;border:2px solid #cfe6a4;border-radius:12px;background:#f5fbe8;font-size:14px;font-weight:700;color:#3c5a14;cursor:pointer}" +
      ".crop-step-btn.done{background:#dff0c8;color:#7a9a4a;border-color:#dff0c8}" +
      ".crop-step-btn.active{background:#74b13a;color:#fff;border-color:#74b13a;animation:cropPulse 1s infinite}" +
      ".crop-step-btn:disabled{opacity:.55;cursor:default}" +
      "@keyframes cropPulse{0%,100%{transform:scale(1)}50%{transform:scale(1.05)}}" +
      // 動作粒子特效
      ".crop-fx{position:absolute;pointer-events:none;font-size:0}" +
      ".crop-seed-p{position:absolute;width:8px;height:11px;background:#8a5a2a;border-radius:40% 40% 50% 50%;top:-14px;animation:cropSeedFall .9s ease-in forwards}" +
      "@keyframes cropSeedFall{0%{transform:translateY(0) rotate(0);opacity:1}100%{transform:translateY(150px) rotate(120deg);opacity:0}}" +
      ".crop-drop{position:absolute;width:7px;height:12px;background:#5fb6e8;border-radius:50% 50% 50% 50%/60% 60% 40% 40%;top:-14px;animation:cropDrop .8s ease-in forwards}" +
      "@keyframes cropDrop{0%{transform:translateY(0);opacity:.95}100%{transform:translateY(160px);opacity:0}}" +
      ".crop-spark{position:absolute;width:9px;height:9px;background:radial-gradient(circle,#ffe27a 0%,#ffb43a 70%,transparent 71%);top:30px;animation:cropSpark 1s ease-out forwards}" +
      "@keyframes cropSpark{0%{transform:scale(.2);opacity:0}40%{transform:scale(1);opacity:1}100%{transform:scale(.4) translateY(-30px);opacity:0}}";
    document.head.appendChild(st);
  })();

  // 6 種作物（對齊圖鑑「種植植物」+ 商店蔬果）：4 階成長 spritesheet(1024x256, 4 幀 256)
  const CROPS = {
    broccoli:     { name: "花椰菜", emoji: "🥦", sheet: "crop_broccoli.webp" },
    carrot:       { name: "胡蘿蔔", emoji: "🥕", sheet: "crop_carrot.webp" },
    tomato:       { name: "番茄",   emoji: "🍅", sheet: "crop_tomato.webp" },
    corn:         { name: "玉米",   emoji: "🌽", sheet: "crop_corn.webp" },
    apple:        { name: "蘋果",   emoji: "🍎", sheet: "crop_apple.webp" },
    sweet_potato: { name: "地瓜",   emoji: "🍠", sheet: "crop_sweet_potato.webp" },
  };
  const ORDER = ["broccoli", "carrot", "tomato", "corn", "apple", "sweet_potato"];
  const FRAME = 256, FRAMES = 4;            // 1024x256, 4 幀：seed/sprout/growing/ripe
  const STAGE_NAME = ["種子", "幼苗", "生長", "熟成"];
  const PLOTS = 6;

  // 成長時間（預設 20 分；?cropgrow=秒數 或 window.CROP_GROW_MS=毫秒 可調，存 localStorage）
  function growMs() {
    const q = new URLSearchParams(location.search).get("cropgrow");
    if (q && +q > 0) { localStorage.setItem("crop_grow_ms", String(+q * 1000)); }
    if (typeof window.CROP_GROW_MS === "number" && window.CROP_GROW_MS > 0) return window.CROP_GROW_MS;
    const saved = +localStorage.getItem("crop_grow_ms");
    return saved > 0 ? saved : 20 * 60 * 1000;
  }
  // 4 階門檻（佔總時長比例）：種子→幼苗→生長→熟成
  const FRAC = [0, 0.12, 0.42, 0.80];
  function stageIndex(rec) {
    const f = (Date.now() - rec.plantedAt) / growMs();
    if (f >= FRAC[3]) return 3;
    if (f >= FRAC[2]) return 2;
    if (f >= FRAC[1]) return 1;
    return 0;
  }
  function remainText(rec) {
    const left = Math.max(0, rec.plantedAt + growMs() * FRAC[3] - Date.now());
    if (left <= 0) return "可收成";
    const m = Math.floor(left / 60000), s = Math.floor((left % 60000) / 1000);
    return m > 0 ? `還要 ${m} 分` : `還要 ${s} 秒`;
  }

  const LS_CROPS = "campus_crops";          // 長度 6 陣列，每格 {crop, plantedAt} 或 null
  const LS_HARVEST = "campus_harvest";      // {emoji:count}（與牧場共用收成籃）

  function normRec(r) {   // 防呆：只接受合法作物 + 正數時間戳，其餘視為空格
    if (!r || typeof r !== "object" || !CROPS[r.crop]) return null;
    if (typeof r.plantedAt !== "number" || !Number.isFinite(r.plantedAt) || r.plantedAt <= 0) return null;
    return { crop: r.crop, plantedAt: r.plantedAt };
  }
  function loadCrops() {
    let a = null;
    try { a = JSON.parse(localStorage.getItem(LS_CROPS)); } catch (e) {}
    const out = new Array(PLOTS).fill(null);
    if (Array.isArray(a)) for (let i = 0; i < PLOTS; i++) out[i] = normRec(a[i]);
    return out;
  }
  function saveCrops(a) { localStorage.setItem(LS_CROPS, JSON.stringify(a)); }
  function loadHarvest() {   // 防呆：只接受 plain object，count 取正整數
    let h = null;
    try { h = JSON.parse(localStorage.getItem(LS_HARVEST)); } catch (e) {}
    if (!h || typeof h !== "object" || Array.isArray(h)) return {};
    const out = {};
    for (const k in h) { const v = Math.floor(+h[k]); if (Number.isFinite(v) && v > 0) out[k] = v; }
    return out;
  }
  function saveHarvest(h) { localStorage.setItem(LS_HARVEST, JSON.stringify(h)); }

  // ---------- 世界裡的田地管理 ----------
  const Farm = {
    scene: null, slots: [], plotXY: [], plotSprites: [], onUpdate: null, _attached: false, _pending: {}, _plotScale: 1,

    // 沿大田菱形「等距(iso)」方向切 3 欄 x 2 列 = 六等份，每格正中央一個座標。
    // 跟著 field_iso 的位置/大小/旋轉走（地圖編輯器移田，作物與分隔線自動跟）。
    _geom: null,
    isoPoint(s, t) {   // s,t in [0,1] 在菱形兩條 iso 邊上的參數座標
      const g = this._geom, cos = Math.cos(g.rot), sin = Math.sin(g.rot);
      const ox = (s - t) * g.HW, oy = (s + t - 1) * g.HH;
      return { x: g.cx + ox * cos - oy * sin, y: g.cy + ox * sin + oy * cos };
    },
    computePlots() {
      const sc = this.scene;
      const f = sc.children.list.find((o) => o.texture && o.texture.key === "field_iso.webp");
      this.plotXY = [];
      if (f) {
        const dW = f.displayWidth, dH = f.displayHeight, rot = f.rotation || 0;
        // sprite 原點在底中(originY=1)、繞原點旋轉 → 算菱形視覺中心
        this._geom = { cx: f.x + dH * 0.5 * Math.sin(rot), cy: f.y - dH * 0.5 * Math.cos(rot), HW: dW * 0.40, HH: dH * 0.40, rot };
      } else {
        this._geom = { cx: 0.438 * sc.IMG_W, cy: 0.70 * sc.IMG_H + (sc.WORLD_OFFSET_Y || 0), HW: sc.IMG_W * 0.17, HH: sc.IMG_H * 0.12, rot: 0 };
      }
      const S = [1 / 6, 3 / 6, 5 / 6], T = [1 / 4, 3 / 4];   // 3 欄 x 2 列，各等份正中央
      for (const t of T) for (const s of S) this.plotXY.push(this.isoPoint(s, t));
    },

    // 開心農場土畦：載入深色空土畦圖(單張 image，繞 loader race)
    ensurePlotTex() {
      const sc = this.scene, key = "cropplot";
      if (!sc || sc.textures.exists(key) || this._pending[key]) return;
      const token = {}; this._pending[key] = token;
      const img = new Image();
      img.onload = () => { if (this._pending[key] === token) delete this._pending[key]; if (this.scene && !this.scene.textures.exists(key)) this.scene.textures.addImage(key, img); };
      img.onerror = () => { if (this._pending[key] === token) delete this._pending[key]; };
      img.src = "plot.webp?v=1";
    },
    // 6 格各鋪一塊空土畦(永遠在)，並隱藏舊大田犁溝底；土畦大小依格距
    makePlots() {
      const sc = this.scene;
      if (!sc || !sc.textures.exists("cropplot") || !this.plotXY.length || this.plotSprites.length) return;
      const f = sc.children.list.find((o) => o.texture && o.texture.key === "field_iso.webp");
      if (f) f.setVisible(false);   // 隱藏舊大田(留作定位錨)
      const a = this.plotXY[0], b = this.plotXY[1];
      const pitch = Math.hypot(b.x - a.x, b.y - a.y);
      const natW = sc.textures.get("cropplot").getSourceImage().width || 420;
      this._plotScale = (pitch * 1.34) / natW;   // 略大於格距→土畦緊貼幾乎無縫
      this.plotXY.forEach((p) => {
        const im = sc.add.image(p.x, p.y, "cropplot").setOrigin(0.5, 0.5).setScale(this._plotScale).setDepth(p.y);
        this.plotSprites.push(im);
      });
    },

    spriteScale() { const g = this._geom; return (g ? Math.hypot(g.HW, g.HH) / 3 * 1.55 : 130) / FRAME; },   // 作物高 ≈ 1.55 格距

    // 載入作物 sheet：完全繞開 scene 共用 LoaderPlugin（與 farm.js 共用會 race），
    // 改用瀏覽器原生 Image 各自平行載入 → 載好用 textures.addSpriteSheet 註冊。零 loader 競爭。
    ensureNeeded(cropKeys) {
      const sc = this.scene;
      if (!sc) return;
      cropKeys.forEach((ck) => {
        const key = "crop_" + ck;
        if (sc.textures.exists(key) || this._pending[key]) return;
        const token = {};   // 用 token 清 pending：擋換場後 stale callback 誤刪新一輪 pending
        this._pending[key] = token;
        const img = new Image();
        img.onload = () => {
          if (this._pending[key] === token) delete this._pending[key];
          if (this.scene && !this.scene.textures.exists(key)) {
            this.scene.textures.addSpriteSheet(key, img, { frameWidth: FRAME, frameHeight: FRAME });
          }
        };
        img.onerror = () => { if (this._pending[key] === token) delete this._pending[key]; };
        img.src = CROPS[ck].sheet + "?v=4";
      });
    },

    attach(scene) {
      this.detach();
      this.scene = scene; this.slots = new Array(PLOTS).fill(null); this.plotSprites = []; this._pending = {};
      this.computePlots();
      // 土畦/作物都由 update() 每幀自癒建立(繞 loader race)
      this.onUpdate = () => this.update();
      scene.events.on("update", this.onUpdate);
      scene.events.once("shutdown", () => this.detach());
      scene.__cropAttached = true; this._attached = true;
    },
    detach() {
      if (this.scene && this.onUpdate) this.scene.events.off("update", this.onUpdate);
      this.slots.forEach((s) => { if (s) { if (s.spr) s.spr.destroy(); if (s.shadow) s.shadow.destroy(); } });
      this.plotSprites.forEach((im) => im && im.destroy());
      this.plotSprites = [];
      this.slots = []; this.onUpdate = null; this._pending = {};
      if (this.scene) this.scene.__cropAttached = false;
      this.scene = null; this._attached = false;
    },

    syncPlot(i, rec) {
      const sc = this.scene, p = this.plotXY[i];
      let s = this.slots[i];
      if (!rec) {   // 空格：清掉 sprite
        if (s) { if (s.spr) s.spr.destroy(); if (s.shadow) s.shadow.destroy(); this.slots[i] = null; }
        return;
      }
      const key = "crop_" + rec.crop, idx = stageIndex(rec);
      if (!sc.textures.exists(key)) return;   // 貼圖還沒好→下一幀自癒重試（update 會批次排載），絕不建 __MISSING
      if (!s) {
        // 作物底部那撮土坐在土畦『中心』→ origin 偏下、位置在 plotXY(畦中心)
        const spr = sc.add.sprite(p.x, p.y, key, idx).setOrigin(0.5, 0.86);
        spr.setScale(this.spriteScale());
        s = this.slots[i] = { spr, crop: rec.crop, idx: -1 };
      }
      if (s.crop !== rec.crop) { s.spr.setTexture(key, idx); s.crop = rec.crop; s.idx = idx; }
      if (s.idx !== idx) { s.spr.setFrame(idx); s.idx = idx; }
      // 熟成可點收成
      if (idx === 3) {
        if (!s._inter) { s.spr.setInteractive(); s.spr.on("pointerdown", () => this.harvest(i)); s._inter = true; }
      } else if (s._inter) { s.spr.disableInteractive(); s._inter = false; }
      s.spr.setDepth(p.y + 1);   // 疊在自己那塊土畦(depth=p.y)之上
    },

    harvest(i) {
      const data = loadCrops(), rec = data[i];
      if (!rec || stageIndex(rec) !== 3) return;
      const sp = CROPS[rec.crop];
      const h = loadHarvest(); h[sp.emoji] = (h[sp.emoji] || 0) + 1; saveHarvest(h);
      data[i] = null; saveCrops(data);
      const old = this.slots[i];
      this.slots[i] = null;   // 立刻抽離狀態表→同格可馬上重種，收成動畫只動 old 引用（不會被重種沖掉）
      if (old && old.spr) {
        const t = this.scene.add.text(old.spr.x, old.spr.y - 60, "+" + sp.emoji, { fontSize: "22px", color: "#3a8a3a", fontStyle: "bold" }).setOrigin(0.5).setDepth(99999);
        this.scene.tweens.add({ targets: t, y: t.y - 36, alpha: 0, duration: 800, onComplete: () => t.destroy() });
        if (old.shadow) this.scene.tweens.add({ targets: old.shadow, alpha: 0, duration: 380 });
        this.scene.tweens.add({
          targets: old.spr, scaleX: old.spr.scaleX * 0.4, scaleY: old.spr.scaleY * 0.4, alpha: 0, duration: 380,
          onComplete: () => { if (old.spr) old.spr.destroy(); if (old.shadow) old.shadow.destroy(); },
        });
      }
      if (ov && ov.style.display === "flex") render();
    },

    update() {
      if (!this.scene) return;
      this.ensurePlotTex();   // 土畦圖
      this.makePlots();       // 6 塊空土畦(載好+座標好就建、隱藏舊大田)
      const data = loadCrops();
      // 先批次確保需要的作物貼圖載入（idle 時一次排完）
      const needed = [];
      for (let i = 0; i < PLOTS; i++) {
        const r = data[i];
        if (r && !this.scene.textures.exists("crop_" + r.crop) && needed.indexOf(r.crop) < 0) needed.push(r.crop);
      }
      if (needed.length) this.ensureNeeded(needed);
      for (let i = 0; i < PLOTS; i++) {
        const s = this.slots[i], rec = data[i];
        if (rec && (!s || s.crop !== rec.crop)) { this.syncPlot(i, rec); continue; }
        if (rec && s) { const idx = stageIndex(rec); if (idx !== s.idx) this.syncPlot(i, rec); }
        if (!rec && s) this.syncPlot(i, null);
      }
    },
  };

  setInterval(() => {
    const g = window.game; if (!g || !g.scene) return;
    const sc = g.scene.scenes.find((s) => s.scene.key === "explore" && s.mapId === "campus" && s.player);
    if (sc && !sc.__cropAttached) Farm.attach(sc);
  }, 400);

  // ---------- 布告欄面板 ----------
  let ov = null, onCloseCb = null, viewMode = "grid", pickPlot = -1;

  function buildOverlay() {
    if (ov) return ov;
    ov = document.createElement("div");
    ov.id = "crop-overlay";
    ov.innerHTML =
      '<div class="crop-panel">' +
      '  <button class="crop-close" id="crop-close">✕</button>' +
      '  <div id="crop-body"></div>' +
      "</div>";
    document.body.appendChild(ov);
    ov.querySelector("#crop-close").onclick = closeBoard;
    ov.onclick = (e) => { if (e.target === ov) closeBoard(); };
    return ov;
  }

  function render() {
    const body = ov.querySelector("#crop-body");
    if (viewMode === "grid") return renderGrid(body);
    if (viewMode === "pick") return renderPick(body);
    if (viewMode === "plant") return renderPlant(body);
  }

  function stageImg(crop, idx) {
    // 從 spritesheet 切一格當預覽（用 background-position）
    return '<span class="pic" style="display:inline-block;background:url(' + CROPS[crop].sheet + '?v=4) -' + (idx * 52) + 'px 0/' + (52 * FRAMES) + 'px 52px no-repeat"></span>';
  }

  function renderGrid(body) {
    const data = loadCrops();
    let cards = "";
    for (let i = 0; i < PLOTS; i++) {
      const rec = data[i];
      let inner;
      if (!rec) {
        inner = '<div class="ph">🟫</div><div class="nm">空地</div><div class="st">＋ 種植</div>';
      } else {
        const idx = stageIndex(rec), sp = CROPS[rec.crop];
        inner = stageImg(rec.crop, idx) + '<div class="nm">' + sp.name + "</div>" +
          (idx === 3 ? '<div class="ripe">🧺 點我收成</div>' : '<div class="st">' + STAGE_NAME[idx] + "・" + remainText(rec) + "</div>");
      }
      cards += '<div class="crop-plot" data-i="' + i + '"><span class="idx">' + (i + 1) + "</span>" + inner + "</div>";
    }
    const h = loadHarvest(), keys = Object.keys(h).filter((k) => h[k] > 0);
    body.innerHTML =
      '<div class="crop-title">🌾 學園農場・布告欄</div>' +
      '<div class="crop-sub">選一塊地種菜：撒種子→施肥→澆水，等它長大就能收成</div>' +
      '<div class="crop-grid" id="crop-grid">' + cards + "</div>" +
      '<div class="crop-sec"><div class="crop-sec-t">已收成：</div>' +
      (keys.length ? keys.map((k) => '<span class="crop-chip">' + k + " ×" + h[k] + "</span>").join("") : '<span class="crop-empty">還沒收成，種點菜吧</span>') +
      "</div>";
    body.querySelectorAll(".crop-plot").forEach((el) => {
      el.onclick = () => {
        const i = +el.dataset.i, data2 = loadCrops(), rec = data2[i];
        if (!rec) { pickPlot = i; viewMode = "pick"; render(); }
        else if (stageIndex(rec) === 3) { Farm.harvest(i); }
      };
    });
  }

  function renderPick(body) {
    body.innerHTML =
      '<button class="crop-back" id="crop-back">‹ 返回</button>' +
      '<div class="crop-title">選擇要種的作物</div>' +
      '<div class="crop-sub">第 ' + (pickPlot + 1) + " 塊地</div>" +
      '<div class="crop-pick">' +
      ORDER.map((k) => '<div class="crop-pickcard" data-k="' + k + '">' + stageImg(k, 3) +
        '<div class="nm">' + CROPS[k].name + "</div></div>").join("") +
      "</div>";
    body.querySelector("#crop-back").onclick = () => { viewMode = "grid"; render(); };
    body.querySelectorAll(".crop-pickcard").forEach((el) => {
      el.onclick = () => { startPlant(pickPlot, el.dataset.k); };
    });
  }

  // 種植步驟：撒種子▶施肥▶澆水
  let plantState = null;   // {plot, crop, step:0..3}
  function startPlant(plot, crop) { plantState = { plot, crop, step: 0 }; viewMode = "plant"; render(); }
  const STEPS = [
    { key: "seed",  label: "撒種子", img: "fx_seed.webp",  fx: spawnSeedFx },
    { key: "fert",  label: "施肥",   img: "fx_fert.webp",  fx: spawnSparkFx },
    { key: "water", label: "澆水",   img: "fx_water.webp", fx: spawnDropFx },
  ];

  function renderPlant(body) {
    const ps = plantState, sp = CROPS[ps.crop];
    body.innerHTML =
      '<button class="crop-back" id="crop-back">‹ 返回</button>' +
      '<div class="crop-title">種 ' + sp.name + "</div>" +
      '<div class="crop-sub">依序完成 3 個步驟</div>' +
      '<div class="crop-steps">' +
      '  <div class="crop-stage-view" id="crop-stage-view">' + stagePreviewImg(ps.crop, ps.step) + "</div>" +
      '  <div class="crop-step-btns">' +
      STEPS.map((s, i) => {
        const cls = ps.step > i ? "done" : (ps.step === i ? "active" : "");
        return '<button class="crop-step-btn ' + cls + '" data-s="' + i + '"' + (ps.step === i ? "" : " disabled") + ">" +
          (ps.step > i ? "✔ " : "") + s.label + "</button>";
      }).join("") +
      "  </div>" +
      "</div>";
    body.querySelector("#crop-back").onclick = () => { plantState = null; viewMode = "grid"; render(); };
    body.querySelectorAll(".crop-step-btn").forEach((b) => {
      b.onclick = () => doStep(+b.dataset.s);
    });
  }
  function stagePreviewImg(crop, step) {
    // 進行中→顯示當前動作美術(擺動)；3 步完成→顯示幼苗預告
    if (step >= 3) {
      return '<img src="' + CROPS[crop].sheet + '?v=4" style="object-position:-150px 0;width:' + (150 * FRAMES) + 'px;max-width:none;left:0">';
    }
    return '<img class="crop-action-art" src="' + STEPS[step].img + '?v=1" alt="' + STEPS[step].label + '">';
  }
  function doStep(i) {
    const ps = plantState;
    if (!ps || ps.step !== i) return;
    const view = ov.querySelector("#crop-stage-view");
    STEPS[i].fx(view);
    ps.step += 1;
    if (ps.step >= 3) {
      // 三步完成→種下，計時開始
      setTimeout(() => {
        const data = loadCrops();
        data[ps.plot] = { crop: ps.crop, plantedAt: Date.now() };
        saveCrops(data);
        Farm.syncPlot(ps.plot, data[ps.plot]);
        plantState = null; viewMode = "grid"; render();
      }, 900);
    } else {
      render();
    }
  }
  // 粒子特效（純 CSS，附在預覽框內）
  function spawnSeedFx(view) { burst(view, "crop-seed-p", 7); }
  function spawnDropFx(view) { burst(view, "crop-drop", 9); }
  function spawnSparkFx(view) { burst(view, "crop-spark", 8); }
  function burst(view, cls, n) {
    if (!view) return;
    for (let k = 0; k < n; k++) {
      const d = document.createElement("div");
      d.className = cls;
      d.style.left = (24 + Math.random() * 152) + "px";
      if (cls === "crop-spark") d.style.top = (60 + Math.random() * 80) + "px";
      d.style.animationDelay = (Math.random() * 0.3) + "s";
      view.appendChild(d);
      setTimeout(() => d.remove(), 1300);
    }
  }

  function openBoard(cb) { onCloseCb = cb || null; buildOverlay(); viewMode = "grid"; plantState = null; render(); ov.style.display = "flex"; }
  function closeBoard() { if (ov) ov.style.display = "none"; const cb = onCloseCb; onCloseCb = null; if (cb) cb(); }

  const _origOpenShop = window.openShop;
  window.openShop = function (id, cb) {
    if (id === "cropboard") { openBoard(cb); return; }
    if (typeof _origOpenShop === "function") return _origOpenShop(id, cb);
  };
  window.openCropBoard = openBoard;
})();
