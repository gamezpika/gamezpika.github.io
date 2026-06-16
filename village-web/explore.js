// village-web Phaser 版 — 2.5D 大富翁風村莊
// 全部 driven by /assets/village_config.json
// 派派用 map-editor.html?map=village 編輯 → 推 GitHub → 自動上線

const REGISTRY_URL = "../assets/projects_registry.json";
const DPR = Math.max(1, window.devicePixelRatio || 1);
// 草/花卉等地上小植物：可踩過去、不建碰撞（現有已放置的也一起生效）
const WALKABLE_DECOR = new Set(["deco_grass.webp", "deco_flower.webp", "deco_flower_v2.webp"]);

function _qParam(name) {
  try { return new URLSearchParams(window.location.search).get(name); } catch (e) { return null; }
}

// 任務 NPC 驚嘆號/問號：狀態跟後端任務系統走（不再用 shop_id 前綴硬判）
const QUEST_DEMO_API = "https://eduarena-tutoring-production.up.railway.app";
// 學院室內地圖 → 科目；只有這些地圖的 NPC（且 id 在該科 academy.json）才掛符號
function _questSubjectOf(mapId) {
  const m = /^(chinese|math|science|social|english)_interior$/.exec(mapId || "");
  return m ? m[1] : null;
}

// 走路造型（服裝店真換裝）：買了這 28 套，走路圖整套換人；不在表內＝預設小男孩
// 圖檔尺寸/幀數跟 player1/2/3 完全相同 → 沿用 config 的 frame_width/height
// （美人魚/名牌包/珍珠項鍊/公事包 4 件跳過＝純展示，派派 6/13 定案）
const WALK_OUTFIT_IDS = [
  "f_academic", "f_angel", "f_beach", "f_blackcat", "f_bunny", "f_dress", "f_dress_pearl",
  "f_elf", "f_kawaii", "f_lady_full", "f_party_dress", "f_reindeer", "f_streetwear",
  "m_beach", "m_biker", "m_casual", "m_dino", "m_knight", "m_santa", "m_sports",
  "m_streetwear", "m_suit_full", "m_suit_jacket", "m_suit_pants", "m_suit_set",
  "m_superhero", "m_vampire", "m_wizard_kid",
];
const WALK_OUTFITS = {};
WALK_OUTFIT_IDS.forEach((id) => {
  WALK_OUTFITS[id] = { side: "walk_" + id + "_side.webp", down: "walk_" + id + "_down.webp", up: "walk_" + id + "_up.webp" };
});
// 女生初始造型（還沒買衣服的預設樣子）：棕髮女孩素色裙裝；男生預設沿用 config 原 player 男孩
const DEFAULT_F_SHEETS = { side: "walk_f_default_side.webp", down: "walk_f_default_down.webp", up: "walk_f_default_up.webp" };
function isFemalePlayer() {
  try { return localStorage.getItem("village_gender") === "female"; } catch (e) { return false; }
}
function walkOutfitCurrent() {
  try {
    const body = (JSON.parse(localStorage.getItem("village_equip") || "{}") || {}).body;
    if (WALK_OUTFITS[body]) {
      // 要真的買過才套造型（舊存檔預設 f_academic 轉真商品後沒買過 → 走預設，跟 shop.js getEquip 移轉一致）
      const own = JSON.parse(localStorage.getItem("village_outfits_owned") || "[]");
      if (Array.isArray(own) && own.indexOf(body) >= 0) return { id: body, sheets: WALK_OUTFITS[body] };
    }
    // 預設造型：女生玩家載女版初始圖，男生用 config 原 player（sheets:null）
    if (isFemalePlayer()) return { id: "default_f", sheets: DEFAULT_F_SHEETS };
  } catch (e) {}
  return { id: "default", sheets: null };
}

class ExploreScene extends Phaser.Scene {
  constructor() { super("explore"); }

  // 進入點：第一次啟動 data 為空 → 看 ?map= 或預設 village；
  // 走 portal 切地圖時 scene.restart({mapId, spawn}) 會把資料帶進來
  init(data) {
    this.mapId = (data && data.mapId) || _qParam("map") || "village";
    this.spawnOverride = (data && data.spawn) || null;
    // 從遊戲機返回帶 ?spawn=x,y（回到原本機台前面）：只在第一次進場吃，
    // 之後走傳送門換圖是 scene.restart 帶 spawn，不會再讀網址。
    if (!this.spawnOverride && !window.__urlSpawnUsed) {
      window.__urlSpawnUsed = true;
      const m = /^(0\.\d+),(0\.\d+)$/.exec(_qParam("spawn") || "");
      if (m) this.spawnOverride = { x: +m[1], y: +m[2] };
    }
    this.facingOverride = (data && data.facing) || null;
    this._transitioning = false;
    // 換裝狀態：restart 不會重建 scene instance，旗標要在這裡復位；
    // 世代+1 讓「換裝載到一半就走 portal」的舊 loader 回呼直接作廢
    this._outfitSwapping = false;
    this._outfitReapply = false;
    this._outfitGen = (this._outfitGen || 0) + 1;
    // 清掉上一張地圖的物件參考：restart 後它們已被 Phaser 銷毀，
    // 趁新地圖 asset 還在載時 update()/外部讀取要被 `if(!this.player) return` 擋住，
    // 不能讀到「殘留但已銷毀」的 player.body / obstacles
    this.player = null;
    this.obstacles = null;
    this.portals = [];
    this.npcs = [];
    this.interactables = [];
    this._proxAnims = null;   // 靠近才搖的樹清單，換地圖要清掉舊 sprite 參考
    this._nearPortal = null;
    this._nearShop = null;
    this._suppress = null;        // 逐棟抑制：剛開過的那棟（防關面板原地重開）
    this._interactInit = false;   // 落地第一幀若已站在觸發區內→記抑制不開（防機台返回秒重開）
    // 任務符號重算狀態復位：restart 不重建 scene instance，這些旗標若漏復位，
    // 「上一張圖還在 await 的 _refreshQuestMarks」會讓 _qBusy 卡 true → 新圖 create() 那次被擋掉 → 符號永遠不重建。
    // bump _qRunId 讓上一張圖在途的 refresh 變 stale，resume 後被 stale() 擋住、不污染新場景。
    this._qBusy = false;
    this._qPending = false;
    this._qRunId = (this._qRunId || 0) + 1;
    // 資訊彈窗(DOM)跨 restart 不會被 Phaser 銷毀，防殘留 .open 害看門狗誤判
    const _im = document.getElementById("info-modal");
    if (_im) _im.classList.remove("open");
    if (this._joyVec) { this._joyVec.x = 0; this._joyVec.y = 0; }   // 換場景清搖桿向量，防殘留持續移動
  }

  // backbuffer 是 css × dpr，UI/zoom 計算要用 CSS 尺寸（除以 dpr）
  get cssW() { return this.scale.width / DPR; }
  get cssH() { return this.scale.height / DPR; }

  // Stage 0：先載專案註冊表（map id → config 路徑，跟 map-editor 同一份真相）
  preload() {
    this.load.json("registry", REGISTRY_URL + "?v=" + Date.now());
  }

  // Stage 1：依 mapId 從 registry 找到 config 路徑，載入該地圖的 config
  create() {
    let configPath = "assets/" + this.mapId + "_config.json";  // fallback
    const reg = this.cache.json.get("registry");
    if (reg && Array.isArray(reg.projects)) {
      const entry = reg.projects.find(p => p.id === this.mapId);
      if (entry && entry.config_path) configPath = entry.config_path;
    }
    const cfgKey = "mapcfg_" + this.mapId;
    this.load.json(cfgKey, "../" + configPath + "?v=" + Date.now());
    // 跟 Stage 2 一樣防「空佇列 complete 不 fire」：有排到檔才等 complete，否則直接進下一步
    if (this.load.list.size > 0) {
      this.load.once("complete", () => this._loadAssets(cfgKey));
      this.load.start();
    } else {
      this._loadAssets(cfgKey);
    }
  }

  // Stage 2：讀 config → 載入該地圖所有 asset（已 cache 的跳過）→ 建場景
  _loadAssets(cfgKey) {
    const config = this.cache.json.get(cfgKey).map_config;
    this.config = config;
    const dim = config.dimensions;
    this.IMG_W = dim.image_width;
    this.IMG_H = dim.image_height;
    this.WORLD_W = dim.world_width;
    this.WORLD_H = dim.world_height;
    this.WORLD_OFFSET_Y = dim.world_offset_y || 0;  // 村莊 ground 放在 (0, -400)，海島為 0
    this.SKY_PAD = (config.camera && config.camera.sky_pad) || 0;
    this.VIEW_BASE_WIDTH = (config.camera && config.camera.view_base_width) || 1200;

    // asset_base 是相對 repo 根的路徑 (e.g. "village-web/")
    // 從 village-web/index.html 出發要 "../" 跳到 repo 根
    this.assetBase = "../" + (config.asset_base || "");

    // 背景（每張地圖一個 texture key，第一次切過去才下載 → 不拖累初始載入）
    this.bgKey = "bg_" + this.mapId;
    if (!this.textures.exists(this.bgKey)) {
      this.load.image(this.bgKey, "../" + config.background + "?v=4");
    }
    // 河流（config.river 驅動，海島沒有就不載）
    if (config.river && !this.textures.exists("river")) {
      this.load.spritesheet("river", this.assetBase + config.river.image + "?v=3",
        { frameWidth: config.river.frame_width, frameHeight: config.river.frame_height });
    }
    (config.buildings || []).forEach(b => {
      if (b.sprite && b.sprite.image) {
        if (!this.textures.exists(b.sprite.image)) {
          // 有 frame_width = spritesheet 動畫（噴泉），否則靜態圖
          if (b.sprite.frame_width && b.sprite.frame_height) {
            this.load.spritesheet(b.sprite.image, this.assetBase + b.sprite.image + "?v=12",
              { frameWidth: b.sprite.frame_width, frameHeight: b.sprite.frame_height });
          } else {
            this.load.image(b.sprite.image, this.assetBase + b.sprite.image + "?v=12");
          }
        }
      }
      // 清醒立繪（狀態切換）也先載好，避免淨化後重載閃一下
      if (b.purified && b.purified.sprite_image && !this.textures.exists(b.purified.sprite_image)) {
        this.load.image(b.purified.sprite_image, this.assetBase + b.purified.sprite_image + "?v=12");
      }
    });
    // Player sprites（3 方向，所有地圖共用同一個玩家 → 用固定 key、已載就跳過）
    // 有買走路造型就載造型 sheet（尺寸同原版，frame 設定照用）
    const ps = config.player.sprites;
    const oc = walkOutfitCurrent();
    const ow = oc.sheets;
    // 紀錄這批 texture 實際載的是哪套造型（換裝對帳用，texture 是 game 全域所以放 window）
    if (!this.textures.exists("hero")) window.__walkOutfitApplied = oc.id;
    if (!this.textures.exists("hero"))      this.load.spritesheet("hero",      this.assetBase + (ow ? ow.side : ps.side.image) + "?v=4", { frameWidth: ps.side.frame_width, frameHeight: ps.side.frame_height });
    if (!this.textures.exists("hero_down")) this.load.spritesheet("hero_down", this.assetBase + (ow ? ow.down : ps.down.image) + "?v=4", { frameWidth: ps.down.frame_width, frameHeight: ps.down.frame_height });
    if (!this.textures.exists("hero_up"))   this.load.spritesheet("hero_up",   this.assetBase + (ow ? ow.up   : ps.up.image)   + "?v=4", { frameWidth: ps.up.frame_width,   frameHeight: ps.up.frame_height });

    // 任務 NPC 頭頂符號（所有地圖共用，已載就跳過）：quest_mark=❗可領獎、quest_ask=❓可接任務、quest_progress=灰❗進行中
    if (!this.textures.exists("quest_mark")) this.load.image("quest_mark", "icons/ic_quest.webp?v=1");
    if (!this.textures.exists("quest_ask")) this.load.image("quest_ask", "icons/ic_quest_q.webp?v=1");
    if (!this.textures.exists("quest_progress")) this.load.image("quest_progress", "icons/ic_quest_progress.webp?v=1");
    if (!this.textures.exists("quest_glow")) this.load.image("quest_glow", "icons/ic_quest_glow.webp?v=1");   // 符號後方柔和光圈

    // NPC sprites（每隻 NPC 可帶自己的 side/down/up；沒給就 fallback 用 hero）
    if (Array.isArray(config.npcs)) {
      config.npcs.forEach(npcCfg => {
        const sCfg = npcCfg.sprite && npcCfg.sprite.sprites;
        if (!sCfg) return;
        ["side", "down", "up"].forEach(dir => {
          const def = sCfg[dir];
          if (!def || !def.image) return;
          const key = `npc_${npcCfg.id}_${dir}`;
          if (!this.textures.exists(key)) {
            this.load.spritesheet(key, this.assetBase + def.image + "?v=3",
              { frameWidth: def.frame_width, frameHeight: def.frame_height });
          }
        });
      });
    }

    // 有東西要載才顯示進度條；全部已 cache（例如走回村莊）就直接建場景
    // （loader 佇列空時 'complete' 不一定會 fire，故手動分流避免卡黑屏）
    if (this.load.list.size > 0) {
      const sw = this.scale.width, sh = this.scale.height;
      const loadText = this.add.text(sw / 2, sh / 2, "載入中 0%", {
        fontFamily: '-apple-system, "PingFang TC", sans-serif',
        fontSize: 24 * DPR, color: "#ffffff",
        backgroundColor: "#1a2412",
        padding: { x: 16 * DPR, y: 10 * DPR },
      }).setOrigin(0.5).setDepth(99999);
      const onProgress = (p) => loadText.setText(`載入中 ${Math.floor(p * 100)}%`);
      const onLoadErr = (file) => { loadText.setText(`載入失敗：${file.key || file.src}`).setColor("#ff7070"); };
      this.load.on("progress", onProgress);
      this.load.on("loaderror", onLoadErr);
      this.load.once("complete", () => {
        // 移除這兩個 listener，避免跨 restart 殘留呼叫到已銷毀的 loadText
        this.load.off("progress", onProgress);
        this.load.off("loaderror", onLoadErr);
        loadText.destroy();
        this._buildScene();
      });
      this.load.start();
    } else {
      this._buildScene();
    }
  }

  // 把 normalized image coord (0-1) 轉成 world coord
  _nx(nx) { return nx * this.IMG_W; }
  _ny(ny) { return ny * this.IMG_H + this.WORLD_OFFSET_Y; }
  _nbbox(bb) {
    const x = this._nx(bb.x_min);
    const y = this._ny(bb.y_min);
    const w = this._nx(bb.x_max - bb.x_min);
    const h = (bb.y_max - bb.y_min) * this.IMG_H;
    return { cx: x + w/2, cy: y + h/2, w, h };
  }

  _buildScene() {
    const config = this.config;

    // 1. 背景
    this.add.image(0, this.WORLD_OFFSET_Y, this.bgKey).setOrigin(0, 0).setDepth(0);
    // 河流流動（config.river 驅動，海島沒有 river 就略過）
    if (config.river && this.textures.exists("river")) {
      const rc = config.river;
      const river = this.add.sprite(rc.x || 0, this.WORLD_OFFSET_Y + (rc.y || 0), "river", 0).setOrigin(0, 0).setDepth(0.5);
      const rFrames = rc.frames || 16;
      if (!this.anims.exists("river_flow")) {
        this.anims.create({ key: "river_flow", frames: this.anims.generateFrameNumbers("river", { start: 0, end: rFrames - 1 }), frameRate: rc.frame_rate || 6, repeat: -1 });
      }
      river.play("river_flow");
    }

    // 1b. 水珠紋理（Phaser Graphics 即時畫，給粒子噴泉用）
    if (!this.textures.exists("water_drop")) {
      const g = this.add.graphics();
      g.fillStyle(0xa0d8ff, 1);
      g.fillCircle(7, 7, 7);
      g.fillStyle(0xe0f0ff, 0.6);
      g.fillCircle(5, 5, 3);
      g.generateTexture("water_drop", 14, 14);
      g.destroy();
    }

    // 2. Buildings：sprite + collision + interaction
    this.interactables = [];
    this._questDeans = [];   // 任務發放院長(建築型，如英文學院莎士比亞)，供任務符號系統掛 ❗❓
    this.obstacles = this.physics.add.staticGroup();
    (config.buildings || []).forEach(b => {
      // 狀態切換（英文學院入魔↔清醒）：state_key 存在且 localStorage 已標記 → 換清醒立繪/互動
      let sImg = b.sprite && b.sprite.image;
      let bShop = (b.interaction && b.interaction.shop_id) || "";
      let bLabel = (b.interaction && b.interaction.label) || b.name;
      if (b.state_key && b.purified) {
        let on = false; try { on = !!localStorage.getItem(b.state_key); } catch (e) {}
        if (on) {
          if (b.purified.sprite_image) sImg = b.purified.sprite_image;
          if (b.purified.shop_id) bShop = b.purified.shop_id;
          if (b.purified.label) bLabel = b.purified.label;
        }
      }
      // Sprite
      if (b.sprite && sImg && this.textures.exists(sImg)) {
        const anchor = { x: this._nx(b.anchor.x), y: this._ny(b.anchor.y) };
        let spr;
        if (b.sprite.frame_width && b.sprite.frame_height) {
          // spritesheet 動畫（噴泉等）
          spr = this.add.sprite(anchor.x, anchor.y, b.sprite.image, 0);
          const animKey = `building_${b.id}_anim`;
          if (!this.anims.exists(animKey)) {
            const cols = b.sprite.grid_cols || Math.round(this.textures.get(b.sprite.image).source[0].width / b.sprite.frame_width);
            const rows = b.sprite.grid_rows || Math.round(this.textures.get(b.sprite.image).source[0].height / b.sprite.frame_height);
            const frameCount = b.sprite.frames || (cols * rows);
            this.anims.create({
              key: animKey,
              frames: this.anims.generateFrameNumbers(b.sprite.image, { start: 0, end: frameCount - 1 }),
              frameRate: b.sprite.frame_rate || 8,
              repeat: -1,
            });
          }
          if (b.sprite.play_on_proximity) {
            // 樹等：平常停在第0幀，玩家靠近才搖（update 控制）
            spr.stop(); spr.setFrame(0);
            (this._proxAnims = this._proxAnims || []).push({ spr, animKey, x: anchor.x, y: anchor.y, on: false, r: b.sprite.prox_radius || 170 });
          } else {
            spr.play(animKey);
          }
        } else {
          spr = this.add.image(anchor.x, anchor.y, sImg);
        }
        spr.setOrigin(b.sprite.anchor_x || 0.5, b.sprite.anchor_y || 1.0);
        spr.setScale(b.sprite.scale || 1.0);
        if (b.sprite.rotation) spr.setRotation(b.sprite.rotation);
        // 加法混合（光暈類疊光素材；背景鎖死鐵律：光效疊圖層、不重繪底圖）＋柔和呼吸
        if (b.sprite.blend === "add") {
          spr.setBlendMode(Phaser.BlendModes.ADD);
          this.tweens.add({ targets: spr, alpha: { from: 0.5, to: 0.9 }, duration: 1600, yoyo: true, repeat: -1 });
        }
        spr.setDepth(anchor.y);
        // render_depth：覆寫排序深度。平鋪地面(翻土田)用低值永遠在玩家下；柵欄後排用低值永遠在玩家後
        if (typeof b.render_depth === "number") spr.setDepth(b.render_depth);
        // 任務發放院長(建築型，如英文學院莎士比亞)：記下立繪頂端座標，供任務符號掛 ❗❓
        if (b.quest_chain) {
          this._questDeans.push({ subj: b.quest_chain, x: anchor.x, y: anchor.y - spr.displayHeight - 6, questMark: null, questGlow: null, questState: null });
        }
        // 噴泉自動加連續粒子水流（fountain_splash 互動類型，加強動感）
        if (b.interaction && b.interaction.type === "fountain_splash") {
          this._addFountainParticles(anchor.x, anchor.y);
        }
        // 插牌動態名（街機/路標等任何帶空白木牌的建築）：sign_text 置中寫進牌面
        if (b.sign_text) {
          // 各牌型的牌面幾何（量自素材）：y=牌面中心離底部的高度比、w=可寫寬比、x=中心水平偏移比
          // 路標箭頭牌可寫區偏離中軸（箭頭尖端不寫字）；其他素材 fallback 街機插牌值
          const SIGN_GEO = {
            "deco_signpost_arrow_right.webp": { y: 0.66, w: 0.55, x: -0.08 },
            "deco_signpost_arrow_left.webp":  { y: 0.66, w: 0.55, x: 0.08 },
            "deco_banner_cloth.webp":         { y: 0.43, w: 0.65, x: 0 },
            "deco_arch_wood.webp":            { y: 0.845, w: 0.5, x: 0 },
          };
          const geo = SIGN_GEO[sImg] || { y: 0.91, w: 0.8, x: 0 };
          const sh = spr.displayHeight, sw2 = spr.displayWidth;
          const tx = this.add.text(
            anchor.x + sw2 * (typeof b.sign_text_x === "number" ? b.sign_text_x : geo.x),
            anchor.y - sh * (typeof b.sign_text_y === "number" ? b.sign_text_y : geo.y), b.sign_text, {
            fontFamily: '"Yuanti TC","YouYuan","PingFang TC","Microsoft JhengHei",sans-serif',
            fontSize: Math.max(15, Math.round(sh * 0.085)) + "px",
            fontStyle: "bold", color: "#6b4316", align: "center",
            stroke: "#fff3da", strokeThickness: Math.max(3, Math.round(sh * 0.014)),
          }).setOrigin(0.5, 0.5);
          // 字寬不准超出牌面：超過就整段等比縮小
          const maxW = sw2 * (typeof b.sign_text_w === "number" ? b.sign_text_w : geo.w);
          if (tx.width > maxW) tx.setScale(maxW / tx.width);
          tx.setDepth((typeof b.render_depth === "number" ? b.render_depth : anchor.y) + 0.1);
        }
      }
      // Collision bbox（草/花卉跳過，可踩過去）
      if (b.bounding_box && !(b.sprite && WALKABLE_DECOR.has(b.sprite.image))) {
        const bb = this._nbbox(b.bounding_box);
        const body = this.add.rectangle(bb.cx, bb.cy, bb.w, bb.h, 0xff0000, 0).setVisible(false);
        this.physics.add.existing(body, true);
        this.obstacles.add(body);
      }

      // Interaction
      if (b.interaction) {
        const a = b.anchor;
        this.interactables.push({
          cx: this._nx(a.x), cy: this._ny(a.y),
          radius: b.interaction.radius || 110,
          type: b.interaction.type,
          label: bLabel,
          body: b.interaction.body || "",
          shop_id: bShop,
          category: b.category || "",   // 人物(npc)判定用：人物互動要按鈕才開（派派 6/12）
        });
        // 建築門口圓墊（派派 6/12：建築物門口也要傳送點）：
        // 會開面板的建築（open_shop）在門口畫小一號的圈，視覺上跟換地圖大圈同語言。
        // b.door_ring=false 可單棟關閉；b.door_ring_w / b.door_ring_dx / b.door_ring_dy 可微調。
        const _ringable = b.interaction.type === "open_shop" ||
          (b.interaction.type === "open_modal" && (b.interaction.body || b.interaction.title));  // 走近會跳內容的也算（Codex P2）
        if (_ringable && b.door_ring !== false) {
          const dcx = this._nx(a.x) + (b.door_ring_dx || 0);
          const dcy = this._ny(a.y) + (b.door_ring_dy || 0);
          const dHex = b.door_ring_color || config.portal_color || "#ffc46e";
          const dm6 = /^#?([0-9a-fA-F]{6})$/.exec(String(dHex).trim());
          const dcol = dm6 ? parseInt(dm6[1], 16) : 0xffc46e;
          const drw = b.door_ring_w || 84, drh = drw * 0.42;
          const dring = this.add.graphics({ x: dcx, y: dcy });
          dring.fillStyle(dcol, 0.18); dring.fillEllipse(0, 0, drw, drh);
          dring.lineStyle(5, dcol, 0.9); dring.strokeEllipse(0, 0, drw, drh);
          dring.lineStyle(2, 0xffffff, 0.6); dring.strokeEllipse(0, 0, drw * 0.7, drh * 0.7);
          dring.setDepth(dcy - 6);
          this.tweens.add({
            targets: dring, scaleX: { from: 0.95, to: 1.05 }, scaleY: { from: 0.95, to: 1.05 },
            alpha: { from: 0.55, to: 0.9 }, duration: 1200, yoyo: true, repeat: -1,
          });
        }
      }
    });

    // 3. Obstacle areas (polygon) → 切多 rect 加進 collider
    if (Array.isArray(config.obstacle_areas)) {
      config.obstacle_areas.forEach(area => {
        if (!area.polygon || area.polygon.length < 3) return;
        // polygon → world coords
        const pts = area.polygon.map(p => ({ x: this._nx(p.x), y: this._ny(p.y) }));
        const rects = this._polygonToRects(pts, 30);
        rects.forEach(r => {
          const body = this.add.rectangle(r.cx, r.cy, r.w, r.h, 0x0000ff, 0).setVisible(false);
          this.physics.add.existing(body, true);
          this.obstacles.add(body);
        });
      });
    }

    // 4. Player（spawnOverride 來自 portal 指定的落點，沒有就用 config 預設出生點）
    const p = config.player;
    const spawnPt = this.spawnOverride || p.spawn;
    const PX = this._nx(spawnPt.x), PY = this._ny(spawnPt.y);
    this.PLAYER_SPEED = p.speed || 220;
    this.playerShadow = this.add.ellipse(PX, PY + 12, 56, 16, 0x000000, 0.4);
    this.player = this.add.rectangle(PX, PY, 22, 22, 0xffffff, 0).setVisible(false);
    this.physics.add.existing(this.player);
    this.player.body.setSize(22, 22);
    this.player.body.setCollideWorldBounds(true);
    this.playerSprite = this.add.sprite(PX, PY + 22, "hero", 0);
    this.playerSprite.setOrigin(0.5, 1);
    this.playerSprite.setScale(p.scale || 0.66);

    // 5. 動畫（anims 是 game 全域、scene.restart 後仍在 → 用 exists 擋重複建立）
    if (!this.anims.exists("hero_walk"))      this.anims.create({ key: "hero_walk",      frames: this.anims.generateFrameNumbers("hero",      { start: 0, end: (p.sprites.side.frames || 9) - 1  }), frameRate: p.sprites.side.frame_rate || 12, repeat: -1 });
    if (!this.anims.exists("hero_walk_down")) this.anims.create({ key: "hero_walk_down", frames: this.anims.generateFrameNumbers("hero_down", { start: 0, end: (p.sprites.down.frames || 25) - 1 }), frameRate: p.sprites.down.frame_rate || 14, repeat: -1 });
    if (!this.anims.exists("hero_walk_up"))   this.anims.create({ key: "hero_walk_up",   frames: this.anims.generateFrameNumbers("hero_up",   { start: 0, end: (p.sprites.up.frames   || 16) - 1 }), frameRate: p.sprites.up.frame_rate || 14, repeat: -1 });
    if (!this.anims.exists("hero_idle"))      this.anims.create({ key: "hero_idle",      frames: [{ key: "hero_down", frame: 0 }],                                                                  frameRate: 1                                });
    this.playerSprite.play("hero_idle");
    if (window.__mp) window.__mp.onSceneCreate(this); // 多人整合（feature flag ?mp=1）
    // 換裝一致性自癒：texture 是全域、restart 後 exists 會跳過重載 →
    // 若中途換過裝（或換裝被 portal 打斷），實際載的造型可能 ≠ 目前裝備，這裡對帳補套
    // （create 期間 scene 還不算 active，getScenes(true) 找不到 → 要把 this 傳進去）
    if (window.__walkOutfitApplied !== walkOutfitCurrent().id && window.applyWalkOutfit) window.applyWalkOutfit(this);

    this.physics.add.collider(this.player, this.obstacles);

    // 6. NPCs
    this.npcs = [];
    if (Array.isArray(config.npcs)) {
      config.npcs.forEach(npcCfg => {
        const sp = npcCfg.spawn;
        const id = npcCfg.id;
        const sCfg = npcCfg.sprite && npcCfg.sprite.sprites;

        // 解析每方向 texture + anim key（自帶 spritesheet 用自己的，否則 fallback hero）
        const resolveDir = (dir, fallbackTex, fallbackAnim) => {
          const def = sCfg && sCfg[dir];
          const texKey = `npc_${id}_${dir}`;
          if (def && def.image && this.textures.exists(texKey)) {
            const animKey = `npc_${id}_walk_${dir}`;
            if (!this.anims.exists(animKey)) {
              this.anims.create({
                key: animKey,
                frames: this.anims.generateFrameNumbers(texKey,
                  { start: 0, end: (def.frames || ((def.grid_cols || 1) * (def.grid_rows || 1))) - 1 }),
                frameRate: def.frame_rate || 8,
                repeat: -1,
              });
            }
            return { tex: texKey, anim: animKey };
          }
          return { tex: fallbackTex, anim: fallbackAnim };
        };
        const dSide = resolveDir("side", "hero", "hero_walk");
        // 若 NPC 自帶 sprites 但只給 side（單張 NPC），down/up 共用 side；
        // 完全沒 sprites（舊 villager_01）才走 hero 三方向 fallback。
        const dDown = resolveDir("down",
          sCfg ? dSide.tex : "hero_down",
          sCfg ? dSide.anim : "hero_walk_down");
        const dUp   = resolveDir("up",
          sCfg ? dSide.tex : "hero_up",
          sCfg ? dSide.anim : "hero_walk_up");

        const npc = {
          cfg: npcCfg,
          body: this.add.rectangle(this._nx(sp.x), this._ny(sp.y), 22, 22, 0xffffff, 0).setVisible(false),
          shadow: this.add.ellipse(this._nx(sp.x), this._ny(sp.y) + 12, 56, 16, 0x000000, 0.35),
          sprite: null,
          patrolIdx: 0,
          animKeys: { side: dSide.anim, down: dDown.anim, up: dUp.anim },
          bubble: null,
          questMark: null,
          questGlow: null,    // 符號後方的脈動光圈（依狀態上色）
          questState: null,   // 'claim'(❗可領)/'avail'(❓可接)/'progress'(灰❗進行中)/null；由 _refreshQuestMarks 依任務狀態設
        };
        // 任務 NPC 的 ❗/❓ 改由 _refreshQuestMarks（地圖建好後 async 算任務狀態）統一掛
        // NPC physics body + collider 跟玩家擋的同一組 obstacles（鳥群在天上豁免）
        this.physics.add.existing(npc.body);
        npc.body.body.setSize(22, 22);
        if (typeof npcCfg.depth_override !== 'number') {
          this.physics.add.collider(npc.body, this.obstacles);
        }
        npc.sprite = this.add.sprite(npc.body.x, npc.body.y + 22, dSide.tex, 0);
        npc.sprite.setOrigin(0.5, 1);
        npc.sprite.setScale((npcCfg.sprite && npcCfg.sprite.scale) || 0.66);
        if (npcCfg.sprite && npcCfg.sprite.tint) {
          const tintNum = parseInt(npcCfg.sprite.tint.replace("#", ""), 16);
          npc.sprite.setTint(tintNum);
        }
        npc.sprite.play(dSide.anim);

        // 氣泡：玩家走近冒「完整台詞」，對話框形狀（圓角+下方尖角指向 NPC）
        const greeting = npcCfg.greeting
          || (npcCfg.interaction && npcCfg.interaction.body)
          || npcCfg.name || "";
        if (greeting) {
          npc.bubble = this._makeBubble(npc.body.x, npc.body.y - 90, greeting);
          npc.bubble.setVisible(false);
        }

        // 靜止 NPC（沒 patrol）：站定不播走路動畫，依 cfg.face 設初始朝向。
        // （_updateNpc 對無 patrol 的 NPC 會 early-return，不會再翻面/同步深度，所以在這裡定好）
        if (!npcCfg.patrol || npcCfg.patrol.length === 0) {
          const face = npcCfg.face || "down";
          if (face === "down") npc.sprite.setTexture(dDown.tex, 0);
          else if (face === "up") npc.sprite.setTexture(dUp.tex, 0);
          else {
            npc.sprite.setTexture(dSide.tex, 0);
            const fwdRight = (((npcCfg.sprite && npcCfg.sprite.sprites && npcCfg.sprite.sprites.side) || {}).facing || "right") === "right";
            npc.sprite.setFlipX(face === "right" ? !fwdRight : fwdRight);
          }
          npc.sprite.stop();
          npc.sprite.setFrame(0);
          npc.sprite.setDepth(npc.sprite.y);
          npc.shadow.setDepth(npc.sprite.y - 1);
          if (npc.bubble) npc.bubble.setDepth(npc.sprite.y + 1);
        }

        this.npcs.push(npc);
      });
    }

    // 任務 NPC 頭頂 ❗/❓：地圖建好後算任務狀態掛符號，並監看任務面板關閉時即時重算
    this._refreshQuestMarks();
    this._setupQuestObserver();

    // 7. World bounds + camera
    this.physics.world.setBounds(0, 0, this.WORLD_W, this.WORLD_H);
    this.cameras.main.setBounds(0, -this.SKY_PAD, this.WORLD_W, this.WORLD_H + this.SKY_PAD);
    this.cameras.main.startFollow(this.player, true, 0.12, 0.12);
    this._adjustZoom();

    // 8. 鍵盤輸入
    this.cursors = this.input.keyboard.createCursorKeys();
    this.wasd = this.input.keyboard.addKeys("W,A,S,D");
    this.input.keyboard.on("keydown-SPACE", () => this._tryInteract());
    this.input.keyboard.on("keydown-ENTER", () => this._tryInteract());

    // 9. 縮放(pinch/滾輪)+觸控；移動改用左下虛擬搖桿
    this._setupTapToMove();
    this._setupJoystick();
    // ScaleManager 是全域、跨 scene.restart 不重置 → 只綁一次，避免換地圖累積重複 resize handler
    if (!this._resizeBound) { this.scale.on("resize", () => this._onResize()); this._resizeBound = true; }

    // 9b. 「進入」按鈕用 HTML 元素（Phaser 物件會被相機 zoom 推出畫面 → 手機看不到）
    this.enterEl = document.getElementById("enter-shop");
    if (this.enterEl) this.enterEl.onclick = () => this._enterNearShop();
    this._nearShop = null;
    this.portalEl = document.getElementById("enter-portal");
    if (this.portalEl) this.portalEl.onclick = () => { if (this._nearPortal) this._enterPortal(this._nearPortal); };
    this._hideEnter(); this._hidePortalBtn();

    // 9c. 傳送門（走到路口 → 跳新地圖）
    this.portals = [];
    if (Array.isArray(config.portals)) {
      config.portals.forEach(pt => {
        if (!pt.anchor) return;
        const cx = this._nx(pt.anchor.x), cy = this._ny(pt.anchor.y);
        // 圓圈傳送點：壓扁的圓環貼在路徑上（精準站在 anchor），顏色可隨地圖/單點配
        // pt.color（單點）> config.portal_color（整張圖）> 預設暖金
        const colHex = pt.color || config.portal_color || "#ffc46e";
        // 顏色防呆：只收 6 位 hex，亂值(red/#abc)一律回預設暖金
        const m6 = /^#?([0-9a-fA-F]{6})$/.exec(String(colHex).trim());
        const col = m6 ? parseInt(m6[1], 16) : 0xffc46e;
        // 圓墊大小跟觸發半徑脫鉤：固定小圓墊（剛好站一個人），pt.ring_w 可覆寫
        const rw = pt.ring_w || 110, rh = rw * 0.42;
        const ring = this.add.graphics({ x: cx, y: cy });
        ring.fillStyle(col, 0.22); ring.fillEllipse(0, 0, rw, rh);            // 內底淡色
        ring.lineStyle(8, col, 0.35); ring.strokeEllipse(0, 0, rw * 1.06, rh * 1.06); // 外暈(柔)
        ring.lineStyle(6, col, 1); ring.strokeEllipse(0, 0, rw, rh);          // 外環(實)
        ring.lineStyle(2, 0xffffff, 0.7); ring.strokeEllipse(0, 0, rw * 0.72, rh * 0.72); // 內圈細白環
        ring.setDepth(cy - 6);   // 貼地：在玩家腳下
        this.tweens.add({
          targets: ring, scaleX: { from: 0.94, to: 1.06 }, scaleY: { from: 0.94, to: 1.06 },
          alpha: { from: 0.65, to: 1 }, duration: 1000, yoyo: true, repeat: -1,
        });
        // 目的地文字：清楚大字浮在圓圈上方（深棕字+奶油描邊，任何地面都讀得清）
        if (!pt.hide_label) {
          // 貼近地圖頂邊的傳送點（島/碼頭 y≈0.03）：字放圈上會被裁掉 → 改放圈下方
          let ly = cy - rh / 2 - 26, oy = 1;
          if (ly - 34 < this.WORLD_OFFSET_Y) { ly = cy + rh / 2 + 10; oy = 0; }
          const lbl = this.add.text(cx, ly, pt.label || "前往", {
            fontFamily: '"Yuanti TC","YouYuan","PingFang TC","Microsoft JhengHei",sans-serif',
            fontSize: "22px", fontStyle: "bold", color: "#5a3c14", align: "center",
            stroke: "#fff3da", strokeThickness: 5,
          }).setOrigin(0.5, oy);
          lbl.setShadow(0, 2, "rgba(70,40,10,0.35)", 4, false, true);
          lbl.setDepth(cy + 2);
        }
        this.portals.push({
          id: pt.id, cx, cy, radius: pt.radius || 130,
          ax: rw / 2, by: rh / 2,   // 圓墊橢圓半軸（觸發判定用：腳真的踩進圈才算）
          target_map: pt.target_map, target_spawn: pt.target_spawn, facing: pt.facing,
          label: pt.label || "前往",
          locked: !!pt.locked,      // 鎖定傳送點（暫不開放）：踩進去只顯示提示，不傳送
          locked_msg: pt.locked_msg || "",
        });
      });
    }
    this._nearPortal = null;
    // 落地先解除武裝：玩家可能正好出生在「返回」傳送門圈內，要等他離開圈一次才重新啟用，
    // 否則一落地就被彈回去 → 無限迴圈
    this._portalArmed = false;

    // 10. State
    this.currentInteractable = null;
    this.modalOpen = false;

    // 11. 轉場淡入：用 DOM 黑幕（跨 scene.restart 穩定，蓋住換圖的載入閃爍）
    this._transitioning = false;
    const fade = document.getElementById("map-fade");
    if (fade) this.time.delayedCall(30, () => fade.classList.remove("show"));

    window.__scene = this;   // 測試/除錯用場景鉤子（叫車面板等）
    // 12. 給 DOM 面板用的場景切換鉤子（英文學院魔法陣：面板按鈕進場 / 淨化後重載本層）
    window.__exploreGoMap = (mapId, spawn) => {
      if (fade) fade.classList.add("show");
      this.modalOpen = false;
      this.time.delayedCall(180, () => this.scene.restart({ mapId: mapId, spawn: spawn }));
    };
    window.__exploreReload = () => {
      if (fade) fade.classList.add("show");
      this.modalOpen = false;
      const mid = this.mapId;
      this.time.delayedCall(180, () => this.scene.restart({ mapId: mid, spawn: { x: 0.5, y: 0.86 } }));
    };

    // 卡死診斷 HUD（網址加 ?dbg=1 才顯示）：即時印出移動相關狀態，抓「卡死不能動」真因
    this._pdCount = 0;
    if (location.search.indexOf("dbg") >= 0) {
      let d = document.getElementById("__dbg");
      if (!d) {
        d = document.createElement("div"); d.id = "__dbg";
        d.style.cssText = "position:fixed;top:4px;left:4px;z-index:99999;background:rgba(0,0,0,.82);color:#0f0;font:11px/1.4 monospace;padding:5px 7px;white-space:pre;pointer-events:none;border-radius:5px;";
        document.body.appendChild(d);
      }
      this._dbgEl = d;
    }
  }

  _showEnter(text) {
    if (this.enterEl) { this.enterEl.textContent = text; this.enterEl.classList.add("show"); }
  }
  _hideEnter() { if (this.enterEl) this.enterEl.classList.remove("show"); }

  _enterNearShop() {
    if (this.modalOpen || !this._nearShop) return;
    if (this._nearShop.type === "open_modal") { this._hideEnter(); this._showModal(this._nearShop); return; }
    if (this._nearShop.shop_id === "taxi") { this.modalOpen = true; this._hideEnter(); this._openTaxi(() => { this.modalOpen = false; }); return; }
    if (!window.openShop) return;
    const id = this._nearShop.shop_id;
    this.modalOpen = true;
    this._hideEnter();
    window.openShop(id, () => { this.modalOpen = false; });
  }

  // 🐴 馬車快遞：走近會跑的馬車 → 列 8 大據點 → 選了複用 portal 轉場傳送
  _openTaxi(onClose) {
    const DESTS = [
      { id: "village", name: "村莊" }, { id: "academy", name: "五大學院" },
      { id: "campus", name: "學園生活區" }, { id: "shopping", name: "商店街" },
      { id: "competitive", name: "競技場" }, { id: "playground", name: "遊樂場" },
      { id: "dock", name: "學園碼頭" }, { id: "island", name: "海島" },
    ];
    if (this._taxiOpen) return;   // 防重複開（Codex #2）
    this._taxiOpen = true;
    const cur = this.mapId;
    let m = document.getElementById("taxi-overlay"); if (m) m.remove();
    m = document.createElement("div"); m.id = "taxi-overlay"; m.className = "open";
    m.style.cssText = "position:fixed;inset:0;z-index:7000;display:flex;align-items:center;justify-content:center;padding:18px;background:rgba(0,0,0,.55);font-family:sans-serif";
    let html = "<div style='background:#fff6e2;border:5px solid #8a5a2b;border-radius:20px;max-width:360px;width:100%;padding:16px;box-shadow:0 14px 40px rgba(0,0,0,.5)'>";
    html += "<div style='font-weight:900;font-size:19px;color:#7a4715;text-align:center'>馬車快遞</div>";
    html += "<div style='font-size:13px;color:#9a7038;text-align:center;margin:2px 0 12px'>要去哪裡？跳上馬車馬上到！</div>";
    html += "<div style='display:grid;grid-template-columns:1fr 1fr;gap:8px'>";
    DESTS.forEach((d) => {
      const here = d.id === cur;
      html += "<button class='taxi-dest' data-map='" + d.id + "'" + (here ? " disabled" : "") +
        " style='border:none;border-radius:12px;padding:13px 8px;font-size:14px;font-weight:800;background:" +
        (here ? "#e8ddc4" : "#b5712f") + ";color:" + (here ? "#a89878" : "#fff7e6") + "'>" +
        d.name + (here ? "（在這）" : "") + "</button>";
    });
    html += "</div><button id='taxi-close' style='margin-top:12px;width:100%;border:none;border-radius:12px;padding:10px;background:#bbb;color:#fff;font-weight:800'>關閉</button></div>";
    m.innerHTML = html;
    document.body.appendChild(m);
    const close = () => { this._taxiOpen = false; if (m.parentNode) m.remove(); if (onClose) onClose(); };
    m.addEventListener("pointerdown", (e) => { if (e.target === m) close(); });
    m.querySelector("#taxi-close").addEventListener("click", close);
    m.querySelectorAll(".taxi-dest").forEach((b) => b.addEventListener("click", () => {
      const map = b.getAttribute("data-map");
      if (map === cur) return;
      this._taxiOpen = false;
      if (m.parentNode) m.remove(); if (onClose) onClose();
      this._enterPortal({ target_map: map });   // 複用 portal 轉場(淡出+scene.restart+逾時自救)
    }));
  }

  _showPortalBtn(label) {
    if (this.portalEl) { this.portalEl.textContent = (label || "前往") + " →"; this.portalEl.classList.add("show"); }
  }
  _hidePortalBtn() { if (this.portalEl) this.portalEl.classList.remove("show"); }

  // 走 portal 換地圖：黑幕淡入 → scene.restart（Phaser 自動拆掉舊場景所有 NPC/collider/粒子）→ 新場景淡出黑幕
  // 鎖定傳送點提示：玩家頭上冒一句話，2 秒淡出（不開面板、不擋操作）
  _showLockedToast(msg) {
    const t = this.add.text(this.player.x, this.player.y - 90, msg, {
      fontFamily: "-apple-system, 'PingFang TC', sans-serif",
      fontSize: "20px", fontStyle: "bold", color: "#fff",
      backgroundColor: "rgba(40,30,16,0.85)", padding: { x: 14, y: 8 },
    }).setOrigin(0.5).setDepth(99999);
    this.tweens.add({ targets: t, y: t.y - 26, alpha: 0, delay: 1400, duration: 700,
                      onComplete: () => t.destroy() });
  }

  _enterPortal(portal) {
    if (this._transitioning || this.modalOpen || !portal) return;
    this._transitioning = true;
    this._hideEnter(); this._hidePortalBtn();
    const fade = document.getElementById("map-fade");
    if (fade) fade.classList.add("show");
    this.time.delayedCall(300, () => {
      this.scene.restart({ mapId: portal.target_map, spawn: portal.target_spawn, facing: portal.facing });
    });
    // 轉場逾時自救：3 秒內 scene.restart 沒跑完(目標圖載入失敗等)→ 解凍+收黑幕，避免永久卡死。
    // (restart 成功的話本場景被關閉、此 timer 自動被 Phaser 取消，不會誤觸發)
    this.time.delayedCall(3000, () => {
      if (this._transitioning) { this._transitioning = false; const f = document.getElementById("map-fade"); if (f) f.classList.remove("show"); }
    });
  }

  _updatePortals() {
    if (!this.portals || this.portals.length === 0) return;
    const px = this.player.x, py = this.player.y;
    let nearest = null, best = Infinity, anyInside = false;
    for (const pt of this.portals) {
      // 橢圓距離：<=1 表示腳真的踩進畫出來的圓墊（視覺圈=觸發圈，沒碰到絕不切換）
      const ex = (px - pt.cx) / pt.ax, ey = (py - pt.cy) / pt.by;
      const e2 = ex * ex + ey * ey;
      if (e2 < 1.6 * 1.6) { anyInside = true; }   // 武裝判定範圍=圈的1.6倍（落地後要走離圈一段才武裝）
      if (e2 <= 1 && e2 < best) { best = e2; nearest = pt; }
    }
    if (!anyInside) {
      this._portalArmed = true;  // 離開所有傳送門圈後才武裝（防一落地就被彈回）
      for (const pt of this.portals) pt._toasted = false;   // 離圈後，鎖定提示可再跳
    }
    if (this._portalArmed && nearest && !this.modalOpen && !this._transitioning) {
      if (nearest.locked) {
        // 暫不開放：踩進圈只跳一次提示，離圈再進才會再跳
        if (!nearest._toasted) {
          nearest._toasted = true;
          this._showLockedToast(nearest.locked_msg || "這條航線尚未開放，敬請期待！");
        }
        this._nearPortal = null;
      } else {
        this._nearPortal = nearest;
        this._enterPortal(nearest);   // 走進圈直接切換地圖
      }
    } else {
      this._nearPortal = null;
    }
    this._hidePortalBtn();   // 底部傳送按鈕不再使用
  }

  _setupTapToMove() {
    // 移動已改用左下虛擬搖桿（_setupJoystick）；本函式只剩縮放(pinch/滾輪)+觸控計數+自癒看門狗。
    this.moveTarget = null;

    // userZoom：派派手動縮放倍率（最終 zoom = base × userZoom）
    // 一進地圖一律最遠景：起始倍率壓到 cover（剛好蓋滿地圖、不露綠），每張地圖一致
    const zp = this._zoomParts();
    this.userZoom = Math.min(1, zp.cover / zp.base);
    this.MIN_USER_ZOOM = Math.min(0.5, this.userZoom);
    this.MAX_USER_ZOOM = 3.0;
    this._adjustZoom();
    this._pinchStart = null;  // { dist, zoom } 雙指開始狀態
    this._nDown = 0; this._lastDownT = 0;  // 自管觸控數+最後觸控時間(修卡住第二指)

    this.input.on("pointerdown", (pointer) => {
      this._pdCount++;   // 診斷：點擊有傳到 Phaser 就會增加
      // 自管觸控計數（不靠會卡住的 pointer2.isDown）：距上次觸控 >400ms = 全新手勢
      // → 清掉卡住的計數。pinch 只在「兩指真的在 400ms 內同時落下」才成立。
      // 修「卡住的第二指害每次點擊被當縮放、永遠不能走」的根因。
      const _now = this.time.now;
      if (_now - (this._lastDownT || 0) > 400) this._nDown = 0;
      this._lastDownT = _now;
      this._nDown = (this._nDown || 0) + 1;
      // 失效保險：modalOpen 或 _transitioning 卡住，但畫面其實已穩定(沒任何 DOM 面板開著、
      // 沒黑幕轉場、也沒 Phaser modal)→ 兩個旗標都強制解鎖。防面板關閉/場景切換漏掉重置某旗標，
      // 害玩家卡死完全不能動（_transitioning 卡死之前的保險救不到，這裡補上）。
      const _fade = document.getElementById("map-fade");
      const _fadeShow = _fade && _fade.classList.contains("show");
      if ((this.modalOpen || this._transitioning) && !this.modalContainer && !_fadeShow && !this._anyPanelOpen()) {
        this.modalOpen = false;
        this._transitioning = false;
      }
      if (this.modalOpen || this._transitioning) return;
      // 雙指真的同時觸控才是 pinch（用自管計數，避免卡住的 pointer2.isDown 害每次點擊都被當縮放→不能走）
      if (this._nDown >= 2 && this.input.pointer2 && this.input.pointer2.isDown) {
        this._beginPinch();
      }
      // 點地圖移動已移除（改虛擬搖桿）；單指點擊不再設 moveTarget
    });

    // Pinch (手機雙指縮放)
    this.input.on("pointermove", () => {
      if (this._pinchStart && this.input.pointer1.isDown && this.input.pointer2 && this.input.pointer2.isDown) {
        const dx = this.input.pointer1.x - this.input.pointer2.x;
        const dy = this.input.pointer1.y - this.input.pointer2.y;
        const dist = Math.hypot(dx, dy);
        const ratio = dist / this._pinchStart.dist;
        this.userZoom = Math.max(this.MIN_USER_ZOOM,
                          Math.min(this.MAX_USER_ZOOM, this._pinchStart.zoom * ratio));
        this._adjustZoom();
        this.moveTarget = null;  // pinch 中不走
      }
    });
    this.input.on("pointerup", () => {
      this._nDown = Math.max(0, (this._nDown || 0) - 1);
      this._pinchStart = null;   // 任一指放開就結束 pinch
    });
    this.input.on("pointerupoutside", () => { this._nDown = Math.max(0, (this._nDown || 0) - 1); });
    this.input.on("gameout", () => { this._nDown = 0; this._pinchStart = null; });   // 手指移出畫布→清觸控計數,防卡住

    // 滾輪縮放（桌面）
    this.input.on("wheel", (pointer, _go, _dx, dy) => {
      const dir = dy > 0 ? -1 : 1;
      this.userZoom = Math.max(this.MIN_USER_ZOOM,
                        Math.min(this.MAX_USER_ZOOM, this.userZoom * (1 + dir * 0.12)));
      this._adjustZoom();
    });
  }

  _beginPinch() {
    const dx = this.input.pointer1.x - this.input.pointer2.x;
    const dy = this.input.pointer1.y - this.input.pointer2.y;
    this._pinchStart = { dist: Math.hypot(dx, dy), zoom: this.userZoom };
    this.moveTarget = null;
  }

  // 左下虛擬搖桿（DOM #joystick）：拖中央鈕 → 設 this._joyVec 單位方向，update() 當移動輸入。
  // 用 DOM 而非 Phaser，免疫相機 zoom（Phaser 搖桿會被 zoom 推位/變形，同 _showModal 問題）。
  // 跨 scene.restart 同一 scene instance → 只綁一次（_joyBound），handler 內 this 仍指當前 scene。
  _setupJoystick() {
    if (this._joyBound) return;
    const base = document.getElementById("joystick");
    const thumb = document.getElementById("joy-thumb");
    if (!base || !thumb) return;
    this._joyBound = true;
    this._joyVec = this._joyVec || { x: 0, y: 0 };
    const R = 44, DEAD = 7;   // thumb 最大位移半徑 / 死區（px）
    let pid = null;
    const reset = () => { pid = null; this._joyVec.x = 0; this._joyVec.y = 0; thumb.style.transform = "translate(0px,0px)"; };
    const apply = (cx, cy) => {
      const r = base.getBoundingClientRect();
      let dx = cx - (r.left + r.width / 2), dy = cy - (r.top + r.height / 2);
      const d = Math.hypot(dx, dy) || 0;
      if (d > R) { dx = dx / d * R; dy = dy / d * R; }
      thumb.style.transform = "translate(" + dx + "px," + dy + "px)";
      if (d < DEAD) { this._joyVec.x = 0; this._joyVec.y = 0; }
      else { const n = Math.hypot(dx, dy) || 1; this._joyVec.x = dx / n; this._joyVec.y = dy / n; }
    };
    base.addEventListener("pointerdown", (e) => {
      pid = e.pointerId; try { base.setPointerCapture(pid); } catch (x) {}
      apply(e.clientX, e.clientY); e.preventDefault();
    });
    base.addEventListener("pointermove", (e) => {
      if (e.pointerId === pid) { apply(e.clientX, e.clientY); e.preventDefault(); }
    });
    const end = (e) => { if (e.pointerId === pid) reset(); };
    base.addEventListener("pointerup", end);
    base.addEventListener("pointercancel", end);
    base.addEventListener("lostpointercapture", end);
  }

  // 對話框氣泡：圓角白框 + 下方尖角（指向 NPC），完整台詞自動換行。回傳 container。
  _makeBubble(x, y, text) {
    // MAXW 上限再夾「可視世界寬度的 82%」：泡泡是 world 物件、會跟相機 zoom 放大，
    // 放大或窄螢幕時 230 仍可能橫跨出畫面 → 依當下視野收斂，確保永不爆出螢幕
    const z = (this.cameras && this.cameras.main && this.cameras.main.zoom) || 1;
    const viewW = (this.scale.width / z) * 0.82;
    const PAD = 11, MAXW = Math.max(140, Math.min(230, Math.floor(viewW))), TAIL = 11, RAD = 13;
    const txt = this.add.text(0, 0, text, {
      fontFamily: '"PingFang TC","Microsoft JhengHei",sans-serif',
      fontSize: "17px", color: "#3a2a14", align: "center", lineSpacing: 3,
      // useAdvancedWrap 必開：中文無空格，預設斷行斷不了 → 泡泡會跟著文字寬到橫跨整個畫面
      wordWrap: { width: MAXW, useAdvancedWrap: true },
    }).setOrigin(0.5, 0.5);
    const w = Math.ceil(txt.width) + PAD * 2, h = Math.ceil(txt.height) + PAD * 2;
    const top = -(TAIL + h), left = -w / 2;
    const g = this.add.graphics();
    g.fillStyle(0xfffdf5, 1); g.lineStyle(3, 0xd8a85a, 1);
    g.fillRoundedRect(left, top, w, h, RAD);
    g.strokeRoundedRect(left, top, w, h, RAD);
    // 尖角：白三角蓋住框底中段，再描兩條斜邊
    g.fillStyle(0xfffdf5, 1);
    g.fillTriangle(-11, -TAIL - 1, 11, -TAIL - 1, 0, 0);
    g.lineStyle(3, 0xd8a85a, 1);
    g.beginPath(); g.moveTo(-11, -TAIL); g.lineTo(0, 0); g.lineTo(11, -TAIL); g.strokePath();
    txt.setPosition(0, top + h / 2);
    const c = this.add.container(x, y, [g, txt]);
    c.setSize(w, h);
    return c;
  }

  _zoomParts() {
    const sw = this.scale.width, sh = this.scale.height;
    const aspectThreshold = this.VIEW_BASE_WIDTH / this.WORLD_H;  // ~1.111
    let base = (sw / sh) >= aspectThreshold ? sw / this.VIEW_BASE_WIDTH : sh / this.WORLD_H;
    // 手機 portrait（高 > 寬）視野放大，避免世界看起來太小
    if (sh > sw) base *= 1.5;
    // cover = 剛好填滿世界：相機縮到這裡就是最遠，再遠會露出地圖邊界(底色綠)
    const cover = Math.max(sw / this.WORLD_W, sh / this.WORLD_H);
    return { base, cover };
  }

  _adjustZoom() {
    const { base, cover } = this._zoomParts();
    // 派派手動縮放倍率
    let z = base * (this.userZoom || 1);
    // 最小縮放 = cover：不論螢幕比例、不論雙指縮小，都不會 letterbox 露綠。
    if (z < cover) z = cover;
    this.cameras.main.setZoom(z);
  }

  // 有任何會擋操作的 DOM 面板開著嗎？（含牧場面板：它用 style.display 不是 .open class）
  _anyPanelOpen() {
    if (document.querySelector("#ca-overlay.open,#ao-overlay.open,#jc-overlay.open,#shop-overlay.open,#eq-overlay.open,#dh-overlay.open,#en-overlay.open,#info-modal.open,#taxi-overlay.open")) return true;
    const r = document.getElementById("ranch-overlay");
    return !!(r && r.style.display && r.style.display !== "none");
  }

  _onResize() {
    // 旋轉/改視窗後重算縮放下限，確保任何方向都縮得回最遠景（不卡在進場時的舊下限）
    if (this.userZoom != null) {
      const zp = this._zoomParts();
      this.MIN_USER_ZOOM = Math.min(0.5, zp.cover / zp.base);
    }
    this._adjustZoom();
  }

  _tryInteract() {
    if (this.modalOpen || this._transitioning) return;
    if (this._nearPortal) { this._enterPortal(this._nearPortal); return; }
    const item = this.currentInteractable;
    if (!item) return;
    if (item.type === "open_modal") this._showModal(item);
    else if (item.type === "fountain_splash") this._fountainSplash(item.cx, item.cy - 100);
    else if (item.type === "open_shop" && item.shop_id === "taxi") {
      this.modalOpen = true; this._hideEnter();
      this._openTaxi(() => { this.modalOpen = false; });
    }
    else if (item.type === "open_shop" && window.openShop) {
      this.modalOpen = true;
      this._hideEnter();
      window.openShop(item.shop_id, () => { this.modalOpen = false; });
    }
  }

  // 資訊彈窗（open_modal 的 NPC/建築對話，如占卜師）：用 DOM overlay，不用 Phaser。
  // Phaser 物件會被相機 zoom 放大、手機直式(zoom×1.5)+DPR 下整個框爆出螢幕被左右切掉
  // （跟「進入」按鈕改 HTML 同因，見 line 559）。DOM 免疫 zoom/DPR、CSS 自動換行、響應式。
  // 注意：本彈窗開啟時 this.modalContainer 維持 null，看門狗(767/1330)靠 _anyPanelOpen() 認得 #info-modal，
  // 不會誤判卡死解鎖——改這裡務必同步維護 _anyPanelOpen 的選擇器。
  _ensureInfoModal() {
    let ov = document.getElementById("info-modal");
    if (ov) return ov;
    const st = document.createElement("style");
    st.textContent =
      "#info-modal{position:fixed;inset:0;z-index:30000;display:none;align-items:center;justify-content:center;background:rgba(0,0,0,.55);padding:24px;box-sizing:border-box}" +
      "#info-modal.open{display:flex}" +
      "#info-modal .im-box{background:#fff8e0;border:4px solid #4a3520;border-radius:16px;max-width:360px;width:100%;padding:24px 22px 20px;box-sizing:border-box;text-align:center;font-family:-apple-system,'PingFang TC','Microsoft JhengHei',sans-serif;box-shadow:0 10px 34px rgba(0,0,0,.32)}" +
      "#info-modal .im-title{font-size:26px;font-weight:800;color:#4a3520;margin-bottom:14px;line-height:1.2}" +
      "#info-modal .im-body{font-size:17px;line-height:1.75;color:#4a3520;white-space:pre-wrap;word-break:break-word;margin-bottom:18px}" +
      "#info-modal .im-close{background:none;border:none;font-size:19px;font-weight:800;color:#a04020;cursor:pointer;padding:6px 18px;font-family:inherit}";
    document.head.appendChild(st);
    ov = document.createElement("div");
    ov.id = "info-modal";
    ov.innerHTML = '<div class="im-box"><div class="im-title"></div><div class="im-body"></div><button class="im-close">[ 關閉 ]</button></div>';
    document.body.appendChild(ov);
    const close = () => this._closeModal();
    ov.addEventListener("click", (e) => { if (e.target === ov) close(); });   // 點 backdrop 關閉
    ov.querySelector(".im-close").addEventListener("click", close);
    return ov;
  }
  _showModal(item) {
    this.modalOpen = true;
    const ov = this._ensureInfoModal();
    ov.querySelector(".im-title").textContent = item.label || "";
    ov.querySelector(".im-body").textContent = item.body || "";
    ov.classList.add("open");
  }
  _closeModal() {
    const ov = document.getElementById("info-modal");
    if (ov) ov.classList.remove("open");
    this.modalOpen = false;
  }

  _addFountainParticles(anchorX, anchorY) {
    // 連續水流粒子（從噴泉頂端噴出，重力往下落）
    // 噴泉視覺頂端在 anchor 上方 ~140 px（fountain sprite 中段）
    const topY = anchorY - 140;
    // 主水柱：往上噴 + 重力下落
    this.add.particles(anchorX, topY, "water_drop", {
      speed: { min: 60, max: 110 },
      angle: { min: 255, max: 285 },   // 往上 ±15 度散
      gravityY: 280,
      lifespan: 900,
      alpha: { start: 0.85, end: 0 },
      scale: { start: 0.7, end: 0.25 },
      frequency: 70,
      quantity: 1,
    }).setDepth(anchorY + 1);  // 比噴泉 sprite 稍前
    // 環流（盆口邊緣輕微飄）
    this.add.particles(anchorX, topY + 30, "water_drop", {
      speed: { min: 20, max: 40 },
      angle: { min: 200, max: 340 },
      gravityY: 100,
      lifespan: 600,
      alpha: { start: 0.5, end: 0 },
      scale: { start: 0.4, end: 0.15 },
      frequency: 150,
      quantity: 1,
    }).setDepth(anchorY + 1);
  }

  _fountainSplash(fx, fy) {
    for (let i = 0; i < 12; i++) {
      const drop = this.add.circle(
        fx + Phaser.Math.Between(-10, 10),
        fy + Phaser.Math.Between(-6, 6),
        Phaser.Math.Between(5, 8),
        0x86d4ff, 0.9
      ).setStrokeStyle(1.5, 0x4080a0, 0.8).setDepth(9999);
      const angle = Phaser.Math.DegToRad(-90 + (i - 6) * 14);
      const dist = Phaser.Math.Between(70, 120);
      this.tweens.add({
        targets: drop,
        x: fx + Math.cos(angle) * dist,
        y: fy + Math.abs(Math.sin(angle)) * 50 + 90,
        alpha: 0, scale: 0.3,
        duration: 800 + Math.random() * 300,
        ease: "Quad.easeOut",
        onComplete: () => drop.destroy(),
      });
    }
  }

  // polygon → multiple rectangle approximation (scan-line)
  _polygonToRects(pts, bandH) {
    if (pts.length < 3) return [];
    let minY = Infinity, maxY = -Infinity;
    for (const p of pts) { minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y); }
    const rects = [];
    for (let y = minY; y < maxY; y += bandH) {
      const ymid = y + bandH / 2;
      // 找出 polygon 在 y=ymid 的 horizontal extent
      const xs = [];
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i], b = pts[(i + 1) % pts.length];
        if ((a.y <= ymid && b.y > ymid) || (b.y <= ymid && a.y > ymid)) {
          const t = (ymid - a.y) / (b.y - a.y);
          xs.push(a.x + t * (b.x - a.x));
        }
      }
      xs.sort((a, b) => a - b);
      // 兩兩 pair = inside polygon
      for (let i = 0; i + 1 < xs.length; i += 2) {
        const xL = xs[i], xR = xs[i+1];
        if (xR - xL > 10) {
          rects.push({ cx: (xL + xR) / 2, cy: y + bandH/2, w: xR - xL, h: bandH });
        }
      }
    }
    return rects;
  }

  _updateNPC(npc, delta) {
    if (!npc.cfg.patrol || npc.cfg.patrol.length === 0) return;
    const speed = npc.cfg.speed || 60;

    // 卡住偵測：累計 0.4 秒位移 < 5px 就跳下一個 patrol 點 + 觸發 detour
    if (!npc._stuck) npc._stuck = { lastX: npc.body.x, lastY: npc.body.y, t: 0, retries: 0 };
    npc._stuck.t += delta;
    if (npc._stuck.t > 400) {
      const moved = Math.hypot(npc.body.x - npc._stuck.lastX, npc.body.y - npc._stuck.lastY);
      if (moved < 5) {
        npc._stuck.retries += 1;
        if (npc._stuck.retries <= 3) {
          // 試 1~3 次：跳下一個 patrol + 隨機方向 detour 0.8 秒繞開
          npc.patrolIdx = (npc.patrolIdx + 1) % npc.cfg.patrol.length;
          npc._detourMs = 800;
          npc._detourAngle = Math.random() * Math.PI * 2;
        } else {
          // 連跳 3 次都還卡 → 重設 spawn 位置（避免永遠抖在牆角）
          const sp = npc.cfg.spawn;
          if (sp) { npc.body.x = this._nx(sp.x); npc.body.y = this._ny(sp.y); }
          npc._stuck.retries = 0;
        }
      } else {
        npc._stuck.retries = 0;
      }
      npc._stuck.lastX = npc.body.x;
      npc._stuck.lastY = npc.body.y;
      npc._stuck.t = 0;
    }

    // Detour 中：朝隨機方向走一段（繞過障礙物）
    if (npc._detourMs > 0) {
      npc._detourMs -= delta;
      npc.body.body.setVelocity(Math.cos(npc._detourAngle) * speed, Math.sin(npc._detourAngle) * speed);
    } else {
      const target = npc.cfg.patrol[npc.patrolIdx];
      const tx = this._nx(target.x), ty = this._ny(target.y);
      const tdx = tx - npc.body.x, tdy = ty - npc.body.y;
      const tdist = Math.hypot(tdx, tdy);
      if (tdist < 8) {
        npc.patrolIdx = (npc.patrolIdx + 1) % npc.cfg.patrol.length;
        npc.body.body.setVelocity(0, 0);
      } else {
        npc.body.body.setVelocity((tdx / tdist) * speed, (tdy / tdist) * speed);
      }
    }
    // 動畫方向用實際 velocity（collide 後可能被阻擋的方向）
    const dx = npc.body.body.velocity.x;
    const dy = npc.body.body.velocity.y;
    npc.sprite.x = npc.body.x;
    npc.sprite.y = npc.body.y + 22;
    npc.shadow.x = npc.body.x;
    npc.shadow.y = npc.body.y + 18;
    // depth_override：天上飛的 NPC（鳥群）固定最高 depth，不被地面物件遮
    const dz = npc.cfg.depth_override;
    if (typeof dz === 'number') {
      npc.sprite.setDepth(dz);
      npc.shadow.setDepth(dz - 1);
      if (npc.bubble) npc.bubble.setDepth(dz + 1);
    } else {
      npc.sprite.setDepth(npc.sprite.y);
      npc.shadow.setDepth(npc.sprite.y - 1);
      if (npc.bubble) npc.bubble.setDepth(npc.sprite.y + 1);
    }
    if (npc.bubble) {
      npc.bubble.x = npc.body.x;
      npc.bubble.y = npc.body.y - 90;
    }
    const horizMore = Math.abs(dx) > Math.abs(dy);
    const keys = npc.animKeys;
    let want = keys.side;
    if (!horizMore) want = dy > 0 ? keys.down : keys.up;
    const cur = npc.sprite.anims.currentAnim;
    if (!cur || cur.key !== want) npc.sprite.play(want);
    // 每張 sprite 原圖朝向可能不同 — 讀 sprite.sprites.side.facing ('left'/'right'，預設 'right')
    if (want === keys.side) {
      const sideCfg = (npc.cfg.sprite && npc.cfg.sprite.sprites && npc.cfg.sprite.sprites.side) || {};
      const forwardRight = (sideCfg.facing || 'right') === 'right';
      // 朝右走 (dx>0)：朝右圖不翻、朝左圖翻；朝左走相反
      npc.sprite.setFlipX(forwardRight ? dx < 0 : dx > 0);
    } else {
      npc.sprite.setFlipX(false);
    }
  }

  _updateInteractable() {
    let nearest = null;
    let bestDist = Infinity;
    const px = this.player.x, py = this.player.y;
    for (const it of this.interactables) {
      const d = Math.hypot(px - it.cx, py - it.cy);
      if (d < it.radius && d < bestDist) { nearest = it; bestDist = d; }
    }
    // NPC：冒氣泡；若帶 open_shop 互動，走近也納入「進入」鈕偵測（NPC 會走動 → 用動態座標）
    for (const npc of this.npcs) {
      const it = npc.cfg.interaction || {};
      const r = it.radius || 110;
      const d = Math.hypot(px - npc.body.x, py - npc.body.y);
      const inRange = d < r;
      if (npc.bubble) npc.bubble.setVisible(inRange && !this.modalOpen);
      if (it.type === "open_shop" && it.shop_id && inRange && d < bestDist) {
        nearest = { type: "open_shop", shop_id: it.shop_id, npc: true,
                    label: it.label || (npc.cfg.name || ""),
                    cx: npc.body.x, cy: npc.body.y, radius: r };
        bestDist = d;
      }
    }

    this._nearShop = (nearest && (nearest.type === "open_shop" || nearest.type === "open_modal") && !this.modalOpen) ? nearest : null;
    this.currentInteractable = nearest;
    // 派派 6/12：人物（魔王/怪物、各學院院長老師、入魔師長、考官等所有 NPC）
    // 跟遊戲機台「碰到不自動開」——走近只顯示按鈕，按下才開始對話/開戰。
    // 判定：走動人物=npc:true、建物型人物=category "npc"、機台=arcade: 前綴；
    // 其餘建築（商店/面板類）維持 6/11 的走近直接開。
    const isManual = !!(this._nearShop && (
      (this._nearShop.type === "open_shop" && (
        this._nearShop.npc === true
        || this._nearShop.category === "npc"
        || (this._nearShop.shop_id && String(this._nearShop.shop_id).indexOf("arcade:") === 0)))
      // 對話型人物（open_modal + category npc，例：競技場裁判/勇士）也要按鈕才開（派派 6/12）；
      // 走動村民/動物（npc:true 無 category）維持走近直接開，不在此列
      || (this._nearShop.type === "open_modal" && this._nearShop.category === "npc")));
    if (isManual && !this.modalOpen && !this._transitioning) {
      this._showEnter((this._nearShop.label || "對話") + " →");
    } else {
      this._hideEnter();   // 進入按鈕退役（派派 6/11：走近建築直接開）
    }
    // 走近直接開：觸發=互動半徑 60%（要走到門口才開，路過不誤開）。
    // 逐棟抑制：只抑制「剛開過的那棟」（關面板原地不重開），跨棟照常觸發；
    // 離開該棟半徑 70%（遲滯）才解除抑制 → 回頭要先走開一步。
    const trig = !!(this._nearShop && !isManual && bestDist < nearest.radius * 0.6);
    // NPC 商店會走動 → 抑制用 shop_id 追蹤、釋放距離跟著 NPC 即時位置算；靜態建築用座標比對
    const mkSuppress = (n) => ({ cx: n.cx, cy: n.cy, r: n.radius, npcShopId: n.npc ? (n.shop_id || "") : null });
    if (this._suppress) {
      let sx = this._suppress.cx, sy = this._suppress.cy;
      if (this._suppress.npcShopId) {
        const live = this.npcs.find((n) => n.cfg.interaction && n.cfg.interaction.shop_id === this._suppress.npcShopId);
        if (live && live.body) { sx = live.body.x; sy = live.body.y; }
      }
      if (Math.hypot(px - sx, py - sy) > this._suppress.r * 0.7) this._suppress = null;
    }
    if (!this._interactInit) {
      // 落地第一幀：若出生點已在某棟觸發區內（例如從遊戲機返回站在機台前）→ 先記抑制不開，防落地秒重開
      this._interactInit = true;
      if (trig) this._suppress = mkSuppress(nearest);
      return;
    }
    const suppressed = this._suppress && nearest && (
      this._suppress.npcShopId != null
        ? (nearest.npc && (nearest.shop_id || "") === this._suppress.npcShopId)
        : (!nearest.npc && Math.hypot(nearest.cx - this._suppress.cx, nearest.cy - this._suppress.cy) < 4));
    if (trig && !suppressed && !this.modalOpen && !this._transitioning) {
      this._suppress = mkSuppress(nearest);
      if (nearest.type === "open_modal") this._showModal(nearest);
      else if (nearest.shop_id === "taxi") { this.modalOpen = true; this._openTaxi(() => { this.modalOpen = false; }); }
      else if (window.openShop) {
        this.modalOpen = true;
        window.openShop(nearest.shop_id, () => { this.modalOpen = false; });
      }
    }
  }

  // 任務 NPC 頭頂 ❗/❓：依任務狀態算（主線走後端 API、支線/無 token 走本機進度），❗可領獎優先於 ❓可接
  async _refreshQuestMarks() {
    if (this._qBusy) { this._qPending = true; return; }   // 重入：標記待跑，finally 補一次
    this._qBusy = true;
    const runMapId = this.mapId, runId = (this._qRunId = (this._qRunId || 0) + 1);
    // 過期判定：runId(被新 run/restart/shutdown 取代) + mapId(換圖) + !this.scene(plugin 沒了)；
    // 不可查 scene.isActive()——本函式從 _buildScene(資產載入 callback)呼叫時場景常還在
    // CREATING(未 RUNNING)，isActive 會誤判過期→bail→符號永遠不建立(切場景符號消失的真因，?dbg 實測 act:false)。
    const stale = () => runId !== this._qRunId || this.mapId !== runMapId || !this.scene;
    try {
      if (!this.npcs) return;
      const subj = _questSubjectOf(this.mapId);
      if (!subj) {                    // 非學院室內：清掉任何殘留符號
        for (const npc of this.npcs) { if (npc.questMark) { npc.questMark.destroy(); npc.questMark = null; } if (npc.questGlow) { npc.questGlow.destroy(); npc.questGlow = null; } npc.questState = null; }
        return;
      }
      // academy.json（各 NPC 的任務鏈定義）快取
      let acad = (this._questAcad || {})[subj];
      if (!acad) {
        try { acad = await (await fetch(subj + "_academy.json?v=1")).json(); }
        catch (e) { return; }
        this._questAcad = this._questAcad || {}; this._questAcad[subj] = acad;
      }
      if (stale()) return;   // await 後可能已切地圖/重啟
      const npcsDef = (acad && acad.npcs) || {};

      // 主線狀態：有 token 才向後端拿（後端才是權威）。有 token 但 API 失敗→狀態不可信，主線不顯示（不 fallback 成錯誤的可接）
      let mainAPI = null, token = "";
      try { token = localStorage.getItem("eduarena_demo_token") || ""; } catch (e) {}
      if (token) {
        try {
          const r = await fetch(QUEST_DEMO_API + "/api/main-quests?chain=" + subj + "_main",
            { headers: { "Authorization": "Bearer " + token } });
          if (!r.ok) throw new Error("http " + r.status);
          const d = await r.json(); mainAPI = {};
          (d.quests || []).forEach((q) => { mainAPI[q.seq] = q; });
        } catch (e) { mainAPI = null; }
      }
      if (stale()) return;
      const lsProg = (chain) => {
        try { return Math.max(0, parseInt(localStorage.getItem("village_" + subj + "_" + chain) || "0", 10) || 0); }
        catch (e) { return 0; }
      };
      // 一隻 NPC 的綜合狀態：'claim'(❗可領) > 'avail'(❓可接) > 'progress'(灰❗進行中) > null
      const stateOf = (npcId) => {
        const def = npcsDef[npcId]; if (!def) return null;
        let canClaim = false, canAccept = false, inProgress = false;
        (def.lines || []).forEach((ln) => {
          const chain = ln.chain === "side" ? "side" : "main";
          const base = Number(ln.seq_start) || 1;
          const quests = ln.quests || [];
          for (let qi = 0; qi < quests.length; qi++) {
            const seq = base + qi;
            if (chain === "main") {
              if (mainAPI) {                          // 有 token 且後端成功
                const aq = mainAPI[seq], st = aq ? aq.status : "locked";
                if (st === "active" && aq && aq.can_claim) canClaim = true;
                else if (st === "active") inProgress = true;   // 已接、還沒達成 → 進行中
                else if (st === "available") canAccept = true;
              } else if (!token) {                    // 無 token → 本機進度 fallback
                if (seq === lsProg("main") + 1) canAccept = true;
              }
              // 有 token 但 API 失敗：主線狀態不可信，不顯示
            } else {                                   // 支線：永遠走本機進度（當前關＝可接）
              if (seq === lsProg("side") + 1) canAccept = true;
            }
          }
        });
        return canClaim ? "claim" : (canAccept ? "avail" : (inProgress ? "progress" : null));
      };

      // 各狀態的光圈顏色：❗亮黃 / ❓金黃 / 🩶灰
      const GLOW_TINT = { claim: 0xffe14d, avail: 0xffb733, progress: 0xd0d0d0 };
      for (const npc of this.npcs) {
        const id = npc.cfg && npc.cfg.id;
        const state = id ? stateOf(id) : null;
        if (!state) {
          if (npc.questMark) { npc.questMark.destroy(); npc.questMark = null; }
          if (npc.questGlow) { npc.questGlow.destroy(); npc.questGlow = null; }
          npc.questState = null;
          continue;
        }
        const tex = state === "claim" ? "quest_mark" : state === "avail" ? "quest_ask" : "quest_progress";
        if (!this.textures.exists(tex)) {
          if (npc.questMark) { npc.questMark.destroy(); npc.questMark = null; }
          if (npc.questGlow) { npc.questGlow.destroy(); npc.questGlow = null; }
          npc.questState = null; continue;
        }
        // 光圈墊在符號後面（depth 比符號低一階），缺貼圖就純符號不崩潰
        if (this.textures.exists("quest_glow")) {
          if (!npc.questGlow) {
            npc.questGlow = this.add.image(npc.body.x, npc.body.y, "quest_glow").setDisplaySize(54, 54).setDepth(99998);
          }
          npc.questGlow.setTint(GLOW_TINT[state] || 0xffe14d);
        }
        if (!npc.questMark) {
          npc.questMark = this.add.image(npc.body.x, npc.body.y, tex).setDisplaySize(26, 26).setDepth(99999);
        } else if (npc.questState !== state) {
          npc.questMark.setTexture(tex).setDisplaySize(26, 26);
        }
        npc.questState = state;
      }
      // 英文學院：莎士比亞是「建築入口」非 NPC、academy.json 也無 npcs；改用英文主線(mainAPI)
      // 的綜合狀態（可領>可接>進行中），把符號掛到院長建築上方，與其他院長一致
      let deanState = null;
      if (this._questDeans && this._questDeans.length) {
        if (mainAPI) {
          let claim = false, avail = false, prog = false;
          Object.keys(mainAPI).forEach((k) => {
            const aq = mainAPI[k];
            if (aq.status === "active" && aq.can_claim) claim = true;
            else if (aq.status === "active") prog = true;
            else if (aq.status === "available") avail = true;
          });
          deanState = claim ? "claim" : avail ? "avail" : prog ? "progress" : null;
        } else if (!token) {
          deanState = "avail";   // 無 token fallback：先顯示❓可接引導玩家點進去(點了會自動補身分)，與其他四科一致
        }
        // 有 token 但 API 失敗：狀態不可信，不顯示（同四科主線）
      }
      for (const d of (this._questDeans || [])) {
        if (!deanState) {
          if (d.questMark) { d.questMark.destroy(); d.questMark = null; }
          if (d.questGlow) { d.questGlow.destroy(); d.questGlow = null; }
          d.questState = null; continue;
        }
        const dtex = deanState === "claim" ? "quest_mark" : deanState === "avail" ? "quest_ask" : "quest_progress";
        if (!this.textures.exists(dtex)) continue;
        if (this.textures.exists("quest_glow")) {
          if (!d.questGlow) d.questGlow = this.add.image(d.x, d.y, "quest_glow").setDisplaySize(60, 60).setDepth(99998);
          d.questGlow.setTint(GLOW_TINT[deanState] || 0xffe14d);
        }
        if (!d.questMark) d.questMark = this.add.image(d.x, d.y, dtex).setDisplaySize(30, 30).setDepth(99999);
        else if (d.questState !== deanState) d.questMark.setTexture(dtex).setDisplaySize(30, 30);
        d.questState = deanState;
      }
    } finally {
      // 只有「最新的 run」(runId 仍是 _qRunId)才清 busy/補跑；被 restart 作廢的舊 run resume 後
      // 不可把新場景 in-flight run 的 _qBusy 誤清掉（Codex P2：否則 observer 觸發的並跑會誤殺新 run）
      if (runId === this._qRunId) {
        this._qBusy = false;
        if (this._qPending) { this._qPending = false; this._refreshQuestMarks(); }   // 補跑重入期間漏掉的更新
      }
    }
  }

  // 監看任務面板（ca/ao/en-overlay）class 變動 → 關閉後即時重算符號（不必改 shop.js）
  _setupQuestObserver() {
    if (this._questObserver || typeof MutationObserver === "undefined") return;
    let timer = null;
    this._questObserver = new MutationObserver((muts) => {
      for (const m of muts) {
        const el = m.target;
        if (el && el.id && /^(ca|ao|en)-overlay$/.test(el.id)) {
          // 只在面板「關閉」(移除 open) 時重算，避免開啟/操作中多餘觸發
          if (el.classList && !el.classList.contains("open")) {
            if (timer) clearTimeout(timer);
            timer = setTimeout(() => this._refreshQuestMarks(), 300);
          }
          break;
        }
      }
    });
    try { this._questObserver.observe(document.body, { attributes: true, subtree: true, attributeFilter: ["class"] }); } catch (e) {}
    this.events.once("shutdown", () => {
      if (timer) clearTimeout(timer);
      if (this._questObserver) { this._questObserver.disconnect(); this._questObserver = null; }
      // 場景關閉時 bump：作廢任何在途的 _refreshQuestMarks，避免它 resume 後對已銷毀場景
      // this.add.image（Codex P2：restart 走 init 會再 bump，但純 shutdown/destroy 沒 init 也要擋）
      this._qRunId = (this._qRunId || 0) + 1;
    });
  }

  update(time, delta) {
    if (this._dbgEl) {
      const ov = document.querySelector("#ca-overlay.open,#ao-overlay.open,#jc-overlay.open,#shop-overlay.open,#eq-overlay.open,#dh-overlay.open,#en-overlay.open");
      const f = document.getElementById("map-fade");
      const p2 = this.input.pointer2 && this.input.pointer2.isDown;
      this._dbgEl.textContent =
        "map:" + this.mapId + "\nmodalOpen:" + this.modalOpen + " trans:" + this._transitioning +
        "\nplayer:" + !!this.player + " target:" + !!this.moveTarget +
        "\npd:" + this._pdCount + " p1:" + this.input.pointer1.isDown + " p2:" + p2 + " nDown:" + this._nDown +
        "\nopenOv:" + (ov ? ov.id : "-") + " fade:" + !!(f && f.classList.contains("show")) +
        "\ninputEnabled:" + this.input.enabled;
    }
    if (!this.player) return;  // scene loading
    // 自癒看門狗：pointerdown 版自癒要「點擊有進到引擎」才會跑——
    // 若點擊被隱形 DOM 層吃掉，玩家會永久卡死。這裡不依賴輸入，每秒檢查一次；
    // 「連續 3 次」都是卡死樣態才解鎖（慢網路面板載入中 modalOpen=true 但 overlay 還沒開，
    // 幾秒內就會開出來，不能急著誤判——Codex P2）。真卡死是永遠卡，多等 2 秒沒差。
    this._healT = (this._healT || 0) + delta;
    if (this._healT > 1000) {
      this._healT = 0;
      const _hf = document.getElementById("map-fade");
      const stuckLook = (this.modalOpen || this._transitioning) && !this.modalContainer &&
          !(_hf && _hf.classList.contains("show")) && !this._anyPanelOpen();
      this._healStreak = stuckLook ? (this._healStreak || 0) + 1 : 0;
      if (this._healStreak >= 3) {
        this._healStreak = 0;
        this.modalOpen = false;
        this._transitioning = false;
      }
    }
    // 轉場中：凍結玩家、不處理輸入（等黑幕淡入後 scene.restart）
    if (this._transitioning) { if (this.player.body) this.player.body.setVelocity(0, 0); return; }
    let dx = 0, dy = 0;
    if (!this.modalOpen) {
      // 鍵盤輸入（電腦版仍可用方向鍵 / WASD）
      if (this.cursors.left.isDown  || this.wasd.A.isDown) dx -= 1;
      if (this.cursors.right.isDown || this.wasd.D.isDown) dx += 1;
      if (this.cursors.up.isDown    || this.wasd.W.isDown) dy -= 1;
      if (this.cursors.down.isDown  || this.wasd.S.isDown) dy += 1;
      // 虛擬搖桿（手機）：鍵盤沒輸入時用搖桿方向向量
      if (dx === 0 && dy === 0 && this._joyVec && (this._joyVec.x || this._joyVec.y)) {
        dx = this._joyVec.x; dy = this._joyVec.y;
      }
    }
    const len = Math.hypot(dx, dy);
    if (len > 1) { dx /= len; dy /= len; }
    this.player.body.setVelocity(dx * this.PLAYER_SPEED, dy * this.PLAYER_SPEED);

    // 樹（play_on_proximity）：玩家靠近才搖，離開停回靜止幀
    if (this._proxAnims) {
      const px = this.player.x, py = this.player.y;
      for (const t of this._proxAnims) {
        const near = Math.hypot(t.x - px, t.y - py) < t.r;
        if (near && !t.on) { t.spr.play(t.animKey); t.on = true; }
        else if (!near && t.on) { t.spr.stop(); t.spr.setFrame(0); t.on = false; }
      }
    }

    this.playerSprite.x = this.player.x;
    this.playerSprite.y = this.player.y + 22;
    this.playerShadow.x = this.player.x;
    this.playerShadow.y = this.player.y + 18;
    this.playerSprite.setDepth(this.playerSprite.y);
    this.playerShadow.setDepth(this.playerSprite.y - 1);

    const moving = Math.hypot(dx, dy) > 0.1;
    const horizMore = Math.abs(dx) > Math.abs(dy);
    let wantAnim = "hero_idle";
    if (moving) {
      if (horizMore)      wantAnim = "hero_walk";
      else if (dy > 0)    wantAnim = "hero_walk_down";
      else                wantAnim = "hero_walk_up";
    }
    // 換裝重載 texture 期間動畫暫時不存在 → 跳過切換，載完由 applyWalkOutfit 接手
    const cur = this.playerSprite.anims.currentAnim;
    if (!this._outfitSwapping && (!cur || cur.key !== wantAnim)) this.playerSprite.play(wantAnim);
    // 玩家 side spritesheet 朝向讀 config.player.sprites.side.facing (預設 'right')
    if (wantAnim === "hero_walk") {
      const sideCfg = (this.config.player.sprites && this.config.player.sprites.side) || {};
      const forwardRight = (sideCfg.facing || 'right') === 'right';
      if (dx >  0.1) this.playerSprite.setFlipX(forwardRight ? false : true);
      else if (dx < -0.1) this.playerSprite.setFlipX(forwardRight ? true : false);
    } else {
      this.playerSprite.setFlipX(false);
    }

    if (!this.modalOpen) for (const npc of this.npcs) this._updateNPC(npc, delta);
    // 任務 NPC 頭頂驚嘆號：跟著 NPC、上下浮動（不受 modalOpen 影響，位置才不會飄）
    const bob = Math.sin(time / 320) * 4;
    const glowPulse = 1 + Math.sin(time / 360) * 0.10;          // 0.90~1.10 緩慢呼吸
    const glowAlpha = 0.72 + Math.sin(time / 360) * 0.18;       // 0.54~0.90
    for (const npc of this.npcs) {
      if (!npc.questMark || !npc.body || !npc.sprite || !npc.sprite.active) continue;
      const mx = npc.body.x, my = npc.sprite.y - npc.sprite.displayHeight - 10 + bob;
      npc.questMark.x = mx;
      npc.questMark.y = my;
      if (npc.questGlow) {
        npc.questGlow.x = mx;
        npc.questGlow.y = my;
        npc.questGlow.setDisplaySize(54 * glowPulse, 54 * glowPulse);   // 光圈脈動
        npc.questGlow.alpha = glowAlpha;
      }
    }
    this._updateInteractable();
    this._updatePortals();
    if (window.__mp) window.__mp.onUpdate(this, this.player.x, this.player.y, dx, dy, moving); // 多人整合
  }
}

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: "game",
  scale: {
    mode: Phaser.Scale.NONE,
    width: window.innerWidth * DPR,
    height: window.innerHeight * DPR,
  },
  input: { activePointers: 3 },  // 允許多指輸入給 pinch zoom 用
  physics: { default: "arcade", arcade: { gravity: { y: 0 }, debug: false } },
  plugins: {
    global: [
      { key: "rexVirtualJoystick", plugin: rexvirtualjoystickplugin, start: true },
    ],
  },
  backgroundColor: "#8cb45a",
  scene: ExploreScene,
  render: { pixelArt: false, antialias: true },
});
// 掛到 window 方便除錯 / 自動化驗證取得目前 scene（不影響玩法）
window.game = game;

// Retina：backbuffer = CSS × dpr，canvas 顯示維持 CSS 尺寸，手機高 dpr 才不糊
// CSS 尺寸用 visualViewport（iOS Safari 真實可見高度），fallback innerWidth/Height
const _applyDpr = () => {
  const vp = window.visualViewport;
  const cssW = vp ? vp.width : window.innerWidth;
  const cssH = vp ? vp.height : window.innerHeight;
  game.scale.resize(cssW * DPR, cssH * DPR);
  game.canvas.style.width = cssW + "px";
  game.canvas.style.height = cssH + "px";
};
game.events.once("ready", () => {
  _applyDpr();
  window.addEventListener("resize", _applyDpr);
  window.addEventListener("orientationchange", _applyDpr);
  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", _applyDpr);
  }
});

// 服裝店買衣服「買了馬上變」：當場把 hero 三方向 texture+動畫換成新造型
// （shop.js 購買/更衣室切換時呼叫；新圖尺寸幀數同原版，config 設定照用）
window.applyWalkOutfit = function (sceneArg) {
  const sc = (sceneArg && sceneArg.playerSprite && sceneArg) ||
    game.scene.getScenes(true).find((s) => s.playerSprite && s.config);
  if (!sc) return;
  // 換裝進行中又被呼叫（連點兩件衣服）→ 排隊，這輪載完後用最新 localStorage 重套
  if (sc._outfitSwapping) { sc._outfitReapply = true; return; }
  const oc = walkOutfitCurrent();
  if (window.__walkOutfitApplied === oc.id) return;   // 已經是目標造型
  const ps = sc.config.player.sprites;
  const ow = oc.sheets;
  const files = {
    hero:      ow ? ow.side : ps.side.image,
    hero_down: ow ? ow.down : ps.down.image,
    hero_up:   ow ? ow.up   : ps.up.image,
  };
  sc._outfitSwapping = true;
  const gen = sc._outfitGen;   // 載入中走 portal（init 會 +1）→ 這輪回呼直接作廢
  // 第一階段：先載到暫存 key，玩家照常顯示舊造型（不能先刪 hero——畫面上還在用，會 glTexture 噴錯）
  const SWAP = ["hero_swap_side", "hero_swap_down", "hero_swap_up"];
  SWAP.forEach((k) => { if (sc.textures.exists(k)) sc.textures.remove(k); });
  sc.load.spritesheet("hero_swap_side", sc.assetBase + files.hero      + "?v=4", { frameWidth: ps.side.frame_width, frameHeight: ps.side.frame_height });
  sc.load.spritesheet("hero_swap_down", sc.assetBase + files.hero_down + "?v=4", { frameWidth: ps.down.frame_width, frameHeight: ps.down.frame_height });
  sc.load.spritesheet("hero_swap_up",   sc.assetBase + files.hero_up   + "?v=4", { frameWidth: ps.up.frame_width,   frameHeight: ps.up.frame_height });
  sc.load.once("complete", () => {
    if (gen !== sc._outfitGen) return;   // restart 已重置狀態，殘留回呼不准碰新場景（create 端會自癒補套）
    const done = (okId) => {
      sc._outfitSwapping = false;
      if (okId) window.__walkOutfitApplied = okId;
      if (sc._outfitReapply) { sc._outfitReapply = false; window.applyWalkOutfit(); }
    };
    // 缺圖載失敗或 sprite 已被銷毀 → 清暫存、維持舊造型、不卡死
    if (!SWAP.every((k) => sc.textures.exists(k)) || !sc.playerSprite || !sc.playerSprite.scene) {
      SWAP.forEach((k) => { if (sc.textures.exists(k)) sc.textures.remove(k); });
      return done(null);
    }
    // 第二階段：sprite 先暫掛到暫存圖 → 安全移除舊 hero → 用新圖重建 hero 三 key + 動畫
    sc.playerSprite.anims.stop();
    sc.playerSprite.setTexture("hero_swap_down", 0);
    ["hero_walk", "hero_walk_down", "hero_walk_up", "hero_idle"].forEach((k) => { if (sc.anims.exists(k)) sc.anims.remove(k); });
    ["hero", "hero_down", "hero_up"].forEach((k) => { if (sc.textures.exists(k)) sc.textures.remove(k); });
    sc.textures.addSpriteSheet("hero",      sc.textures.get("hero_swap_side").getSourceImage(), { frameWidth: ps.side.frame_width, frameHeight: ps.side.frame_height });
    sc.textures.addSpriteSheet("hero_down", sc.textures.get("hero_swap_down").getSourceImage(), { frameWidth: ps.down.frame_width, frameHeight: ps.down.frame_height });
    sc.textures.addSpriteSheet("hero_up",   sc.textures.get("hero_swap_up").getSourceImage(),   { frameWidth: ps.up.frame_width,   frameHeight: ps.up.frame_height });
    sc.anims.create({ key: "hero_walk",      frames: sc.anims.generateFrameNumbers("hero",      { start: 0, end: (ps.side.frames || 9) - 1 }), frameRate: ps.side.frame_rate || 12, repeat: -1 });
    sc.anims.create({ key: "hero_walk_down", frames: sc.anims.generateFrameNumbers("hero_down", { start: 0, end: (ps.down.frames || 9) - 1 }), frameRate: ps.down.frame_rate || 14, repeat: -1 });
    sc.anims.create({ key: "hero_walk_up",   frames: sc.anims.generateFrameNumbers("hero_up",   { start: 0, end: (ps.up.frames   || 9) - 1 }), frameRate: ps.up.frame_rate   || 14, repeat: -1 });
    sc.anims.create({ key: "hero_idle",      frames: [{ key: "hero_down", frame: 0 }], frameRate: 1 });
    sc.playerSprite.setTexture("hero_down", 0);
    SWAP.forEach((k) => sc.textures.remove(k));   // sprite 已改掛 hero_down，移除暫存安全
    done(oc.id);
    sc.playerSprite.play("hero_idle");
  });
  sc.load.start();
};
