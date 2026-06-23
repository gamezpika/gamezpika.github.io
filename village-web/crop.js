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
      // 村莊風（同商店：奶油底+棕邊+棕標題列+紅關閉鈕+奶油卡）
      "#crop-overlay{position:fixed;inset:0;z-index:21000;display:none;align-items:center;justify-content:center;background:rgba(20,14,8,.55);backdrop-filter:blur(2px);font-family:-apple-system,'PingFang TC','Microsoft JhengHei',sans-serif}" +
      ".crop-panel{position:relative;width:min(94vw,430px);max-height:88vh;background:linear-gradient(180deg,#fff6e2,#ffeecb);border:5px solid #8a5a2b;border-radius:20px;box-shadow:0 14px 40px rgba(0,0,0,.5),inset 0 0 0 3px #ffd98a;overflow:hidden;display:flex;flex-direction:column;animation:crop-pop .2s cubic-bezier(.2,1.3,.5,1)}" +
      "@keyframes crop-pop{from{transform:scale(.88);opacity:0}to{transform:scale(1);opacity:1}}" +
      ".crop-close{position:absolute;top:8px;right:10px;z-index:4;width:34px;height:34px;border-radius:50%;background:#e8533a;color:#fff;border:3px solid #fff2dd;font-size:19px;font-weight:900;cursor:pointer;line-height:1;box-shadow:0 3px 0 #a8331f;padding:0}" +
      ".crop-close:active{transform:translateY(2px);box-shadow:0 1px 0 #a8331f}" +
      "#crop-overlay #crop-body{display:flex;flex-direction:column;flex:1;min-height:0}" +
      ".crop-tbar{flex:0 0 auto;background:linear-gradient(180deg,#b5712f,#94591f);color:#fff7e6;font-size:20px;font-weight:800;letter-spacing:2px;text-align:center;padding:12px 46px;border-bottom:3px solid #ffd98a;text-shadow:0 2px 0 rgba(0,0,0,.25)}" +
      ".crop-content{flex:1;min-height:0;padding:14px;overflow-y:auto;-webkit-overflow-scrolling:touch}" +
      ".crop-back{display:inline-block;margin-bottom:10px;font-size:14px;color:#8a5a2b;font-weight:800;cursor:pointer;background:none;border:none;padding:0}" +
      ".crop-cap{font-size:12px;color:#a07a4a;text-align:center;margin:-2px 0 12px}" +
      // 田格
      ".crop-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:9px}" +
      ".crop-plot{position:relative;display:flex;flex-direction:column;align-items:center;gap:2px;padding:9px 4px 7px;border:3px solid #e3c089;border-radius:14px;background:#fffaf0;cursor:pointer;min-height:92px;justify-content:center;box-shadow:0 2px 0 #e3c089}" +
      ".crop-plot:active{transform:translateY(2px);box-shadow:0 0 0 #e3c089}" +
      ".crop-plot .pic{width:52px;height:52px}" +
      ".crop-plot .soil{width:44px;height:30px;border-radius:8px;background:linear-gradient(180deg,#a07a4a,#6e4f2c);box-shadow:inset 0 2px 5px rgba(0,0,0,.35)}" +
      ".crop-plot .nm{font-size:13px;font-weight:800;color:#5a3a18}" +
      ".crop-plot .st{font-size:11px;color:#a07a4a}" +
      ".crop-plot .ripe{font-size:12px;color:#2bb05a;font-weight:800}" +
      ".crop-plot .idx{position:absolute;top:3px;left:6px;font-size:10px;color:#c8a86a;font-weight:800}" +
      // 已收成
      ".crop-sec{margin-top:13px;padding-top:10px;border-top:2px dashed #e3c089}" +
      ".crop-sec-t{font-size:13px;color:#8a5a2b;font-weight:800;margin-bottom:6px}" +
      ".crop-chip{display:inline-block;background:#ffe3b0;border:2px solid #d8a85a;border-radius:999px;padding:3px 10px;margin:0 6px 6px 0;font-size:12px;font-weight:700;color:#7a4f1e}" +
      ".crop-empty{font-size:12px;color:#b89a6a}" +
      // 選作物
      ".crop-pick{display:grid;grid-template-columns:repeat(2,1fr);gap:10px}" +
      ".crop-pickcard{display:flex;align-items:center;gap:8px;padding:9px 10px;border:3px solid #e3c089;border-radius:14px;background:#fffaf0;cursor:pointer;box-shadow:0 2px 0 #e3c089}" +
      ".crop-pickcard:active{transform:translateY(2px);box-shadow:0 0 0 #e3c089}" +
      ".crop-pickcard .pic{width:46px;height:46px;flex:0 0 auto}" +
      ".crop-pickcard .nm{font-size:15px;font-weight:800;color:#5a3a18}" +
      // 種植步驟
      ".crop-stage-view{position:relative;width:190px;height:168px;margin:4px auto 12px;background:radial-gradient(ellipse at 50% 75%,#e7d3a8,#bda06e);border-radius:14px;overflow:hidden;display:flex;align-items:center;justify-content:center;border:3px solid #e3c089}" +
      ".crop-stage-view img{width:138px;height:138px;object-fit:contain}" +
      ".crop-action-art{animation:cropBob 1.1s ease-in-out infinite;filter:drop-shadow(0 5px 6px rgba(0,0,0,.25))}" +
      "@keyframes cropBob{0%,100%{transform:translateY(0) rotate(-3deg)}50%{transform:translateY(-8px) rotate(3deg)}}" +
      ".crop-step-btns{display:flex;gap:8px;justify-content:center}" +
      ".crop-step-btn{flex:1;max-width:120px;padding:11px 4px;border:3px solid #e3c089;border-radius:12px;background:#fffaf0;font-size:14px;font-weight:800;color:#8a5a2b;cursor:pointer;box-shadow:0 2px 0 #e3c089}" +
      ".crop-step-btn.done{background:#ffe3b0;color:#b89a6a;border-color:#e3c089}" +
      ".crop-step-btn.active{background:linear-gradient(180deg,#b5712f,#94591f);color:#fff7e6;border-color:#94591f}" +
      ".crop-step-btn:disabled{opacity:.5;cursor:default}" +
      // 動作粒子特效
      ".crop-seed-p{position:absolute;width:8px;height:11px;background:#8a5a2a;border-radius:40% 40% 50% 50%;top:-14px;animation:cropSeedFall .9s ease-in forwards}" +
      "@keyframes cropSeedFall{0%{transform:translateY(0) rotate(0);opacity:1}100%{transform:translateY(150px) rotate(120deg);opacity:0}}" +
      ".crop-drop{position:absolute;width:7px;height:12px;background:#5fb6e8;border-radius:50% 50% 50% 50%/60% 60% 40% 40%;top:-14px;animation:cropDrop .8s ease-in forwards}" +
      "@keyframes cropDrop{0%{transform:translateY(0);opacity:.95}100%{transform:translateY(160px);opacity:0}}" +
      ".crop-spark{position:absolute;width:9px;height:9px;background:radial-gradient(circle,#ffe27a 0%,#ffb43a 70%,transparent 71%);top:30px;animation:cropSpark 1s ease-out forwards}" +
      "@keyframes cropSpark{0%{transform:scale(.2);opacity:0}40%{transform:scale(1);opacity:1}100%{transform:scale(.4) translateY(-30px);opacity:0}}";
    document.head.appendChild(st);
  })();

  // 6 種作物（對齊圖鑑「種植植物」+ 商店蔬果）：4 階成長 spritesheet(1024x256, 4 幀 256)
  // sz = 各作物相對大小倍率（蘋果是樹最大、花椰菜/胡蘿蔔是蔬菜較小）
  const CROPS = {
    broccoli:     { name: "花椰菜", emoji: "🥦", sheet: "crop_broccoli.webp", sz: 0.72 },
    carrot:       { name: "胡蘿蔔", emoji: "🥕", sheet: "crop_carrot.webp",   sz: 0.82 },
    tomato:       { name: "番茄",   emoji: "🍅", sheet: "crop_tomato.webp",   sz: 1.00 },
    corn:         { name: "玉米",   emoji: "🌽", sheet: "crop_corn.webp",     sz: 1.18 },
    apple:        { name: "蘋果",   emoji: "🍎", sheet: "crop_apple.webp",    sz: 1.55 },
    sweet_potato: { name: "地瓜",   emoji: "🍠", sheet: "crop_sweet_potato.webp", sz: 0.88 },
  };
  const ORDER = ["broccoli", "carrot", "tomato", "corn", "apple", "sweet_potato"];
  const FRAME = 256, FRAMES = 4;            // 1024x256, 4 幀：seed/sprout/growing/ripe
  const STAGE_NAME = ["種子", "幼苗", "生長", "熟成"];
  // 收成籃以 emoji 為鍵(與牧場共用)；面板不顯示 emoji → 對應名稱
  const NAME_MAP = { "🥦": "花椰菜", "🥕": "胡蘿蔔", "🍅": "番茄", "🌽": "玉米", "🍎": "蘋果", "🍠": "地瓜", "🥛": "牛奶", "🥚": "蛋", "🍖": "肉", "🧶": "羊毛" };
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

  const LS_CROPS = accNS("campus_crops");          // 長度 6 陣列，每格 {crop, plantedAt} 或 null（依帳號分開）
  const LS_HARVEST = accNS("campus_harvest");      // {emoji:count}（與牧場共用收成籃，依帳號分開）

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
    scene: null, slots: [], plotXY: [], onUpdate: null, _attached: false, _pending: {},

    // 從 config 的土畦 building(plot.webp) 讀 6 格位置（土畦由 explore.js 依 config 畫；
    // 地圖編輯器移/加土畦 → 作物自動跟）。按 (y,x) 排序給穩定的格索引。
    _pitch: 100,
    computePlots() {
      const sc = this.scene;
      const plots = sc.children.list.filter((o) => o.texture && o.texture.key === "plot.webp");
      this.plotXY = plots.map((s) => ({ x: s.x, y: s.y })).sort((a, b) => (a.y - b.y) || (a.x - b.x));
      // 最近鄰格距（算作物大小用）
      let m = Infinity;
      for (let i = 0; i < this.plotXY.length; i++)
        for (let j = i + 1; j < this.plotXY.length; j++) {
          const d = Math.hypot(this.plotXY[i].x - this.plotXY[j].x, this.plotXY[i].y - this.plotXY[j].y);
          if (d > 1 && d < m) m = d;
        }
      this._pitch = isFinite(m) ? m : 100;
    },

    spriteScale(cropKey) {   // 基準高 ≈ 1.35 格距，再乘各作物 sz 倍率
      return (this._pitch * 1.35) * ((CROPS[cropKey] && CROPS[cropKey].sz) || 1) / FRAME;
    },

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
      this.scene = scene; this.slots = new Array(PLOTS).fill(null); this._pending = {};
      this.computePlots();
      // 作物由 update() 每幀自癒建立(繞 loader race)；土畦由 explore.js 依 config 畫
      this.onUpdate = () => this.update();
      scene.events.on("update", this.onUpdate);
      scene.events.once("shutdown", () => this.detach());
      scene.__cropAttached = true; this._attached = true;
    },
    detach() {
      if (this.scene && this.onUpdate) this.scene.events.off("update", this.onUpdate);
      this.slots.forEach((s) => { if (s) { if (s.spr) s.spr.destroy(); if (s.shadow) s.shadow.destroy(); } });
      this.slots = []; this.onUpdate = null; this._pending = {};
      if (this.scene) this.scene.__cropAttached = false;
      this.scene = null; this._attached = false;
    },

    syncPlot(i, rec) {
      const sc = this.scene, p = this.plotXY[i];
      if (!p) return;   // 土畦還沒載到這格→等下一幀
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
        spr.setScale(this.spriteScale(rec.crop));
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
      if (this.plotXY.length < PLOTS) this.computePlots();   // 土畦 building 還沒全載到→每幀補算
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

  function stageImg(crop, idx, sz) {
    sz = sz || 52;   // 從 spritesheet 切一格當預覽（background-position）
    return '<span class="pic" style="display:inline-block;width:' + sz + 'px;height:' + sz + 'px;background:url(' + CROPS[crop].sheet + '?v=4) -' + (idx * sz) + 'px 0/' + (sz * FRAMES) + 'px ' + sz + 'px no-repeat"></span>';
  }

  function renderGrid(body) {
    const data = loadCrops();
    let cards = "";
    for (let i = 0; i < PLOTS; i++) {
      const rec = data[i];
      let inner;
      if (!rec) {
        inner = '<div class="soil"></div><div class="nm">空地</div><div class="st">＋ 種植</div>';
      } else {
        const idx = stageIndex(rec), sp = CROPS[rec.crop];
        inner = stageImg(rec.crop, idx) + '<div class="nm">' + sp.name + "</div>" +
          (idx === 3 ? '<div class="ripe">可收成</div>' : '<div class="st">' + STAGE_NAME[idx] + "・" + remainText(rec) + "</div>");
      }
      cards += '<div class="crop-plot" data-i="' + i + '"><span class="idx">' + (i + 1) + "</span>" + inner + "</div>";
    }
    const h = loadHarvest(), keys = Object.keys(h).filter((k) => h[k] > 0);
    body.innerHTML =
      '<div class="crop-tbar">學園農場</div><div class="crop-content">' +
      '<div class="crop-grid">' + cards + "</div>" +
      '<div class="crop-sec"><div class="crop-sec-t">已收成</div>' +
      (keys.length ? keys.map((k) => '<span class="crop-chip">' + (NAME_MAP[k] || k) + " ×" + h[k] + "</span>").join("") : '<span class="crop-empty">還沒收成</span>') +
      "</div></div>";
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
      '<div class="crop-tbar">選擇作物</div><div class="crop-content">' +
      '<button class="crop-back" id="crop-back">‹ 返回</button>' +
      '<div class="crop-cap">第 ' + (pickPlot + 1) + " 塊地</div>" +
      '<div class="crop-pick">' +
      ORDER.map((k) => '<div class="crop-pickcard" data-k="' + k + '">' + stageImg(k, 3, 46) +
        '<div class="nm">' + CROPS[k].name + "</div></div>").join("") +
      "</div></div>";
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
      '<div class="crop-tbar">種 ' + sp.name + "</div><div class=\"crop-content\">" +
      '<button class="crop-back" id="crop-back">‹ 返回</button>' +
      '<div class="crop-stage-view" id="crop-stage-view">' + stagePreviewImg(ps.crop, ps.step) + "</div>" +
      '<div class="crop-step-btns">' +
      STEPS.map((s, i) => {
        const cls = ps.step > i ? "done" : (ps.step === i ? "active" : "");
        return '<button class="crop-step-btn ' + cls + '" data-s="' + i + '"' + (ps.step === i ? "" : " disabled") + ">" +
          (ps.step > i ? "✓ " : "") + s.label + "</button>";
      }).join("") +
      "</div></div>";
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
