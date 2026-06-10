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

class ExploreScene extends Phaser.Scene {
  constructor() { super("explore"); }

  // 進入點：第一次啟動 data 為空 → 看 ?map= 或預設 village；
  // 走 portal 切地圖時 scene.restart({mapId, spawn}) 會把資料帶進來
  init(data) {
    this.mapId = (data && data.mapId) || _qParam("map") || "village";
    this.spawnOverride = (data && data.spawn) || null;
    this.facingOverride = (data && data.facing) || null;
    this._transitioning = false;
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
    // 傳送點箭頭（有 portal 才載）
    if ((config.portals || []).length && !this.textures.exists("portal_arrow")) {
      this.load.image("portal_arrow", this.assetBase + "deco_portal_arrow.webp?v=1");
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
    const ps = config.player.sprites;
    if (!this.textures.exists("hero"))      this.load.spritesheet("hero",      this.assetBase + ps.side.image + "?v=3", { frameWidth: ps.side.frame_width, frameHeight: ps.side.frame_height });
    if (!this.textures.exists("hero_down")) this.load.spritesheet("hero_down", this.assetBase + ps.down.image + "?v=3", { frameWidth: ps.down.frame_width, frameHeight: ps.down.frame_height });
    if (!this.textures.exists("hero_up"))   this.load.spritesheet("hero_up",   this.assetBase + ps.up.image   + "?v=3", { frameWidth: ps.up.frame_width,   frameHeight: ps.up.frame_height });

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
        spr.setDepth(anchor.y);
        // render_depth：覆寫排序深度。平鋪地面(翻土田)用低值永遠在玩家下；柵欄後排用低值永遠在玩家後
        if (typeof b.render_depth === "number") spr.setDepth(b.render_depth);
        // 噴泉自動加連續粒子水流（fountain_splash 互動類型，加強動感）
        if (b.interaction && b.interaction.type === "fountain_splash") {
          this._addFountainParticles(anchor.x, anchor.y);
        }
        // 插牌動態名（遊樂場統一街機）：sign_text 寫在建築頂端的空白木牌上
        if (b.sign_text) {
          const sh = spr.displayHeight;
          const tx = this.add.text(anchor.x, anchor.y - sh * (typeof b.sign_text_y === "number" ? b.sign_text_y : 0.93), b.sign_text, {
            fontFamily: '"PingFang TC","Microsoft JhengHei",sans-serif',
            fontSize: Math.max(13, Math.round(sh * 0.072)) + "px",
            fontStyle: "bold", color: "#5a3c14", align: "center",
          }).setOrigin(0.5, 0.5);
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
        });
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
        };
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

    // 9. 點地圖走過去（取代搖桿/A 按鈕）
    this._setupTapToMove();
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
        // 傳送點箭頭方向：一般門指向地圖外（離中心），但「進入室內」的學院入口改指向其建築
        // （門通常在建築正下方，朝外會背對建築 → 改指最近的建築門口）+ 脈動
        let dir = Math.atan2(pt.anchor.y - 0.5, pt.anchor.x - 0.5);
        if (/_interior$/.test(pt.target_map || "")) {
          let best = null, bestD = Infinity;
          (config.buildings || []).forEach(b => {
            const bx = b.anchor && b.anchor.x, by = b.anchor && b.anchor.y;
            if (bx == null || by == null) return;
            const d = Math.hypot(bx - pt.anchor.x, by - pt.anchor.y);
            if (d < bestD) { bestD = d; best = b; }
          });
          if (best && bestD < 0.2) dir = Math.atan2(best.anchor.y - pt.anchor.y, best.anchor.x - pt.anchor.x);
        }
        const arrow = this.add.image(cx, cy, "portal_arrow")
          .setRotation(dir).setScale(0.18).setAlpha(0.9).setDepth(cy - 6);
        this.tweens.add({
          targets: arrow, scale: { from: 0.15, to: 0.21 },
          alpha: { from: 0.6, to: 1 }, duration: 850, yoyo: true, repeat: -1,
        });
        // 傳送點標籤：圓角膠囊（呼應底部按鈕的藍漸層白邊風格，取代舊的直角純色塊）
        const lbl = this.add.text(0, 0, (pt.label || "前往") + "  ›", {
          fontFamily: '"PingFang TC","Microsoft JhengHei",sans-serif', fontSize: "19px",
          color: "#eaf6ff", fontStyle: "bold",
        }).setOrigin(0.5);
        lbl.setShadow(0, 1, "rgba(8,30,50,0.55)", 3, false, true);
        const pw = Math.ceil(lbl.width) + 30, ph = Math.ceil(lbl.height) + 16, pr = ph / 2;
        const pg = this.add.graphics();
        pg.fillStyle(0x08233a, 0.32); pg.fillRoundedRect(-pw / 2, -ph / 2 + 4, pw, ph, pr);          // 落影
        pg.fillStyle(0x1f6fa8, 1); pg.fillRoundedRect(-pw / 2, -ph / 2, pw, ph, pr);                  // 主體（下深）
        pg.fillStyle(0x3a9bd8, 1); pg.fillRoundedRect(-pw / 2, -ph / 2, pw, ph * 0.52,                // 上亮（假漸層）
          { tl: pr, tr: pr, bl: 0, br: 0 });
        pg.fillStyle(0xffffff, 0.16); pg.fillRoundedRect(-pw / 2 + 3, -ph / 2 + 3, pw - 6, ph * 0.34, // 頂高光
          { tl: pr - 3, tr: pr - 3, bl: 0, br: 0 });
        pg.lineStyle(2, 0xdff1ff, 0.9); pg.strokeRoundedRect(-pw / 2, -ph / 2, pw, ph, pr);           // 亮邊框
        this.add.container(cx, cy - 66, [pg, lbl]).setDepth(cy + 2);
        this.portals.push({
          id: pt.id, cx, cy, radius: pt.radius || 130,
          target_map: pt.target_map, target_spawn: pt.target_spawn, facing: pt.facing,
          label: pt.label || "前往",
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
    if (!window.openShop) return;
    const id = this._nearShop.shop_id;
    this.modalOpen = true;
    this._hideEnter();
    window.openShop(id, () => { this.modalOpen = false; });
  }

  _showPortalBtn(label) {
    if (this.portalEl) { this.portalEl.textContent = (label || "前往") + " →"; this.portalEl.classList.add("show"); }
  }
  _hidePortalBtn() { if (this.portalEl) this.portalEl.classList.remove("show"); }

  // 走 portal 換地圖：黑幕淡入 → scene.restart（Phaser 自動拆掉舊場景所有 NPC/collider/粒子）→ 新場景淡出黑幕
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
      const d = Math.hypot(px - pt.cx, py - pt.cy);
      if (d < pt.radius) { anyInside = true; if (d < best) { best = d; nearest = pt; } }
    }
    if (!anyInside) this._portalArmed = true;  // 離開所有傳送門圈後才武裝（防一落地就被彈回）
    if (this._portalArmed && nearest && !this.modalOpen && !this._transitioning) {
      this._nearPortal = nearest; this._showPortalBtn(nearest.label);
    } else {
      this._nearPortal = null; this._hidePortalBtn();
    }
  }

  _setupTapToMove() {
    // 玩家點地圖某處，主角就朝那邊走
    this.moveTarget = null;
    this.targetMarker = this.add.circle(0, 0, 14 * DPR, 0xffffff, 0.65)
      .setStrokeStyle(3 * DPR, 0x101010, 0.7)
      .setDepth(9999)
      .setVisible(false);

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
      if ((this.modalOpen || this._transitioning) && !this.modalContainer && !_fadeShow &&
          !document.querySelector("#ca-overlay.open,#ao-overlay.open,#jc-overlay.open,#shop-overlay.open,#eq-overlay.open,#dh-overlay.open,#en-overlay.open")) {
        this.modalOpen = false;
        this._transitioning = false;
      }
      if (this.modalOpen || this._transitioning) return;
      // 雙指真的同時觸控才是 pinch（用自管計數，避免卡住的 pointer2.isDown 害每次點擊都被當縮放→不能走）
      if (this._nDown >= 2 && this.input.pointer2 && this.input.pointer2.isDown) {
        this._beginPinch();
        return;
      }
      const wx = pointer.worldX, wy = pointer.worldY;
      this.moveTarget = { x: wx, y: wy };
      this.targetMarker.setPosition(wx, wy).setVisible(true);
      this.tweens.killTweensOf(this.targetMarker);
      this.tweens.add({ targets: this.targetMarker, alpha: 0, duration: 600,
                        onComplete: () => { this.targetMarker.setAlpha(0.65).setVisible(false); } });
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

  // 對話框氣泡：圓角白框 + 下方尖角（指向 NPC），完整台詞自動換行。回傳 container。
  _makeBubble(x, y, text) {
    const PAD = 11, MAXW = 230, TAIL = 11, RAD = 13;
    const txt = this.add.text(0, 0, text, {
      fontFamily: '"PingFang TC","Microsoft JhengHei",sans-serif',
      fontSize: "17px", color: "#3a2a14", align: "center", lineSpacing: 3,
      wordWrap: { width: MAXW },
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
    else if (item.type === "open_shop" && window.openShop) {
      this.modalOpen = true;
      this._hideEnter();
      window.openShop(item.shop_id, () => { this.modalOpen = false; });
    }
  }

  _showModal(item) {
    this.modalOpen = true;
    const sw = this.scale.width, sh = this.scale.height;
    this.modalContainer = this.add.container(sw/2, sh/2).setScrollFactor(0).setDepth(20000);
    const backdrop = this.add.rectangle(0, 0, sw*3, sh*3, 0x000000, 0.55).setInteractive();
    const box = this.add.rectangle(0, 0, 360 * DPR, 200 * DPR, 0xfff8e0).setStrokeStyle(5 * DPR, 0x4a3520);
    const title = this.add.text(0, -55 * DPR, item.label, {
      fontFamily: "-apple-system, 'PingFang TC', sans-serif",
      fontSize: 30 * DPR, color: "#4a3520", fontStyle: "bold",
    }).setOrigin(0.5);
    const body = this.add.text(0, 0, item.body, {
      fontFamily: "-apple-system, 'PingFang TC', sans-serif",
      fontSize: 18 * DPR, color: "#4a3520",
    }).setOrigin(0.5);
    const closeBtn = this.add.text(0, 60 * DPR, "[ 關閉 ]", {
      fontFamily: "-apple-system, 'PingFang TC', sans-serif",
      fontSize: 20 * DPR, color: "#a04020", fontStyle: "bold",
    }).setOrigin(0.5).setInteractive();
    const closeFn = () => {
      if (this.modalContainer) { this.modalContainer.destroy(); this.modalContainer = null; }
      this.modalOpen = false;
    };
    closeBtn.on("pointerdown", closeFn);
    backdrop.on("pointerdown", closeFn);
    this.modalContainer.add([backdrop, box, title, body, closeBtn]);
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

    if (nearest && (nearest.type === "open_shop" || nearest.type === "open_modal") && !this.modalOpen) {
      this._nearShop = nearest;
      const verb = nearest.type === "open_modal" ? "探查 "
        : (nearest.shop_id && nearest.shop_id.indexOf("fpract:") === 0) ? "📖 進入 "
        : (nearest.npc ? "📜 找 " : "🛒 進入 ");
      this._showEnter(verb + nearest.label);
    } else {
      this._nearShop = null; this._hideEnter();
    }
    this.currentInteractable = nearest;
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
    // 轉場中：凍結玩家、不處理輸入（等黑幕淡入後 scene.restart）
    if (this._transitioning) { if (this.player.body) this.player.body.setVelocity(0, 0); return; }
    let dx = 0, dy = 0;
    if (!this.modalOpen) {
      // 鍵盤輸入（電腦版仍可用方向鍵 / WASD）
      if (this.cursors.left.isDown  || this.wasd.A.isDown) dx -= 1;
      if (this.cursors.right.isDown || this.wasd.D.isDown) dx += 1;
      if (this.cursors.up.isDown    || this.wasd.W.isDown) dy -= 1;
      if (this.cursors.down.isDown  || this.wasd.S.isDown) dy += 1;
      // 鍵盤一動立刻取消點擊目標
      if (dx !== 0 || dy !== 0) this.moveTarget = null;
      // 點擊移動：朝 moveTarget 直線走，撞牆自然停
      if (dx === 0 && dy === 0 && this.moveTarget) {
        const tx = this.moveTarget.x - this.player.x;
        const ty = this.moveTarget.y - this.player.y;
        const dist = Math.hypot(tx, ty);
        if (dist < 10) {
          this.moveTarget = null;
        } else {
          dx = tx / dist; dy = ty / dist;
        }
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
    const cur = this.playerSprite.anims.currentAnim;
    if (!cur || cur.key !== wantAnim) this.playerSprite.play(wantAnim);
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
    this._updateInteractable();
    this._updatePortals();
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
