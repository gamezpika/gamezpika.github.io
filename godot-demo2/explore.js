// godot-demo2 Phaser 版 — 2.5D 大富翁風村莊
// 全部 driven by /assets/village_config.json
// 派派用 map-editor.html?map=village 編輯 → 推 GitHub → 自動上線

const CONFIG_URL = "../assets/village_config.json";
const DPR = Math.max(1, window.devicePixelRatio || 1);

class ExploreScene extends Phaser.Scene {
  constructor() { super("explore"); }
  // backbuffer 是 css × dpr，UI/zoom 計算要用 CSS 尺寸（除以 dpr）
  get cssW() { return this.scale.width / DPR; }
  get cssH() { return this.scale.height / DPR; }

  preload() {
    this.load.json("village", CONFIG_URL + "?v=" + Date.now());
  }

  create() {
    const config = this.cache.json.get("village").map_config;
    this.config = config;
    const dim = config.dimensions;
    this.IMG_W = dim.image_width;
    this.IMG_H = dim.image_height;
    this.WORLD_W = dim.world_width;
    this.WORLD_H = dim.world_height;
    this.WORLD_OFFSET_Y = dim.world_offset_y;  // ground 放在 (0, -400)
    this.SKY_PAD = (config.camera && config.camera.sky_pad) || 400;
    this.VIEW_BASE_WIDTH = (config.camera && config.camera.view_base_width) || 1200;

    // asset_base 是相對 repo 根的路徑 (e.g. "godot-demo2/")
    // 從 godot-demo2/index.html 出發要 "../" 跳到 repo 根
    this.assetBase = "../" + (config.asset_base || "");

    // Stage 1: 預載所有 asset 後進入第二階段
    this.load.image("village_ground", "../" + config.background + "?v=2");
    this.load.spritesheet("river", "../godot-demo2/river.jpg?v=3", { frameWidth: 768, frameHeight: 666 });
    config.buildings.forEach(b => {
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
    });
    // Player sprites（3 方向）
    const ps = config.player.sprites;
    this.load.spritesheet("hero",      this.assetBase + ps.side.image + "?v=3", { frameWidth: ps.side.frame_width, frameHeight: ps.side.frame_height });
    this.load.spritesheet("hero_down", this.assetBase + ps.down.image + "?v=3", { frameWidth: ps.down.frame_width, frameHeight: ps.down.frame_height });
    this.load.spritesheet("hero_up",   this.assetBase + ps.up.image   + "?v=3", { frameWidth: ps.up.frame_width,   frameHeight: ps.up.frame_height });

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

    // Loading progress UI（圖檔大、手機網路慢時不會看到一片綠）
    const sw = this.scale.width, sh = this.scale.height;
    const loadText = this.add.text(sw / 2, sh / 2, "載入中 0%", {
      fontFamily: '-apple-system, "PingFang TC", sans-serif',
      fontSize: 24 * DPR, color: "#ffffff",
      backgroundColor: "#1a2412",
      padding: { x: 16 * DPR, y: 10 * DPR },
    }).setOrigin(0.5).setDepth(99999);
    this.load.on("progress", (p) => loadText.setText(`載入中 ${Math.floor(p * 100)}%`));
    this.load.on("loaderror", (file) => {
      loadText.setText(`載入失敗：${file.key || file.src}`).setColor("#ff7070");
    });
    this.load.once("complete", () => { loadText.destroy(); this._buildScene(); });
    this.load.start();
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
    this.add.image(0, this.WORLD_OFFSET_Y, "village_ground").setOrigin(0, 0).setDepth(0);
    // 河流流動：疊在背景河流位置(0,814)，持續慢流（扭曲晃動）
    const river = this.add.sprite(0, this.WORLD_OFFSET_Y + 814, "river", 0).setOrigin(0, 0).setDepth(0.5);
    if (!this.anims.exists("river_flow")) {
      this.anims.create({ key: "river_flow", frames: this.anims.generateFrameNumbers("river", { start: 0, end: 15 }), frameRate: 6, repeat: -1 });
    }
    river.play("river_flow");

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
    config.buildings.forEach(b => {
      // Sprite
      if (b.sprite && b.sprite.image && this.textures.exists(b.sprite.image)) {
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
            (this._proxAnims = this._proxAnims || []).push({ spr, animKey, x: anchor.x, y: anchor.y, on: false });
          } else {
            spr.play(animKey);
          }
        } else {
          spr = this.add.image(anchor.x, anchor.y, b.sprite.image);
        }
        spr.setOrigin(b.sprite.anchor_x || 0.5, b.sprite.anchor_y || 1.0);
        spr.setScale(b.sprite.scale || 1.0);
        spr.setDepth(anchor.y);
        // 噴泉自動加連續粒子水流（fountain_splash 互動類型，加強動感）
        if (b.interaction && b.interaction.type === "fountain_splash") {
          this._addFountainParticles(anchor.x, anchor.y);
        }
      }
      // Collision bbox
      if (b.bounding_box) {
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
          label: b.interaction.label || b.name,
          body: b.interaction.body || "",
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

    // 4. Player
    const p = config.player;
    const PX = this._nx(p.spawn.x), PY = this._ny(p.spawn.y);
    this.PLAYER_SPEED = p.speed || 220;
    this.playerShadow = this.add.ellipse(PX, PY + 12, 56, 16, 0x000000, 0.4);
    this.player = this.add.rectangle(PX, PY, 22, 22, 0xffffff, 0).setVisible(false);
    this.physics.add.existing(this.player);
    this.player.body.setSize(22, 22);
    this.player.body.setCollideWorldBounds(true);
    this.playerSprite = this.add.sprite(PX, PY + 22, "hero", 0);
    this.playerSprite.setOrigin(0.5, 1);
    this.playerSprite.setScale(p.scale || 0.66);

    // 5. 動畫
    this.anims.create({ key: "hero_walk",      frames: this.anims.generateFrameNumbers("hero",      { start: 0, end: (p.sprites.side.frames || 9) - 1  }), frameRate: p.sprites.side.frame_rate || 12, repeat: -1 });
    this.anims.create({ key: "hero_walk_down", frames: this.anims.generateFrameNumbers("hero_down", { start: 0, end: (p.sprites.down.frames || 25) - 1 }), frameRate: p.sprites.down.frame_rate || 14, repeat: -1 });
    this.anims.create({ key: "hero_walk_up",   frames: this.anims.generateFrameNumbers("hero_up",   { start: 0, end: (p.sprites.up.frames   || 16) - 1 }), frameRate: p.sprites.up.frame_rate || 14, repeat: -1 });
    this.anims.create({ key: "hero_idle",      frames: [{ key: "hero_down", frame: 0 }],                                                                  frameRate: 1                                });
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

        // 氣泡：玩家走近就冒「哞～」「你好～」這類短招呼
        const greeting = npcCfg.greeting
          || (npcCfg.interaction && npcCfg.interaction.body
              && String(npcCfg.interaction.body).split(/[！。!.\n]/)[0].slice(0, 12))
          || npcCfg.name || "";
        if (greeting) {
          npc.bubble = this.add.text(npc.body.x, npc.body.y - 80, greeting, {
            fontFamily: '"PingFang TC","Microsoft JhengHei",sans-serif',
            fontSize: "18px",
            color: "#1a1a1a",
            backgroundColor: "#ffffff",
            padding: { x: 10, y: 6 },
            stroke: "#ffffff", strokeThickness: 0,
          }).setOrigin(0.5, 1).setVisible(false);
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
    this.scale.on("resize", () => this._onResize());

    // 10. State
    this.currentInteractable = null;
    this.modalOpen = false;
  }

  _setupTapToMove() {
    // 玩家點地圖某處，主角就朝那邊走
    this.moveTarget = null;
    this.targetMarker = this.add.circle(0, 0, 14 * DPR, 0xffffff, 0.65)
      .setStrokeStyle(3 * DPR, 0x101010, 0.7)
      .setDepth(9999)
      .setVisible(false);

    // userZoom：派派手動縮放倍率（最終 zoom = base × userZoom）
    this.userZoom = 1;
    this.MIN_USER_ZOOM = 0.5;
    this.MAX_USER_ZOOM = 3.0;
    this._pinchStart = null;  // { dist, zoom } 雙指開始狀態

    this.input.on("pointerdown", (pointer) => {
      if (this.modalOpen) return;
      // 雙指開始 = pinch zoom，不觸發 tap-to-move
      if (this.input.pointer1.isDown && this.input.pointer2 && this.input.pointer2.isDown) {
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
      // 任一指放開就結束 pinch
      this._pinchStart = null;
    });

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

  _adjustZoom() {
    const sw = this.scale.width, sh = this.scale.height;
    const aspectThreshold = this.VIEW_BASE_WIDTH / this.WORLD_H;  // ~1.111
    let z = (sw / sh) >= aspectThreshold ? sw / this.VIEW_BASE_WIDTH : sh / this.WORLD_H;
    // 手機 portrait（高 > 寬）視野放大，避免世界看起來太小
    const isPortrait = sh > sw;
    if (isPortrait) z *= 1.5;
    // 派派手動縮放倍率
    z *= (this.userZoom || 1);
    this.cameras.main.setZoom(z);
  }

  _onResize() {
    this._adjustZoom();
  }

  _tryInteract() {
    if (this.modalOpen) return;
    const item = this.currentInteractable;
    if (!item) return;
    if (item.type === "open_modal") this._showModal(item);
    else if (item.type === "fountain_splash") this._fountainSplash(item.cx, item.cy - 100);
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
    // NPC：只冒氣泡，不再列入 A button 互動（派派要求：經過就有泡、不用按 A 對話）
    for (const npc of this.npcs) {
      const r = (npc.cfg.interaction && npc.cfg.interaction.radius) || 110;
      const d = Math.hypot(px - npc.body.x, py - npc.body.y);
      const inRange = d < r;
      if (npc.bubble) npc.bubble.setVisible(inRange);
    }

    this.currentInteractable = nearest;
  }

  update(time, delta) {
    if (!this.player) return;  // scene loading
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
        const near = Math.hypot(t.x - px, t.y - py) < 170;
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
