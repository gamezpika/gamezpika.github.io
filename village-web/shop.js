// 商人販售介面 — 純展示（不扣金幣、不穿上身），商品/服裝套 EDU 素材
(function () {
  let CATALOG = null;
  let onCloseCb = null;

  // 商人招呼台詞（隨機 + 購買反應）— 帶老闆個性
  const GREET = {
    grocer: ["大量批發最划算啦！", "新鮮貨色，俗俗賣！", "來來來，整箱搬回家！"],
    boutique: ["親愛的，這款超適合你～", "本季新款，時尚必備！", "美麗是一種態度唷♥"],
    menswear: ["先生，這套很襯您的氣質。", "紳士的衣櫥，不能將就。", "為您量身打造，請慢慢挑。"],
    costcool: ["量販批發，買越多越省！", "會員價，整箱搬最划算！", "歡迎光臨 COSTCOOL～"],
    publisher: ["想看什麼書？我幫你找！", "閱讀，是最划算的投資。", "新書到貨囉，快來翻翻看～"],
  };
  const BUY_REACT = ["好眼光！", "謝謝惠顧～", "包在我身上！", "下次再來唷！"];
  const SELL_REACT = ["收下囉，這是你的金幣！", "好貨！全收了～", "牧場豐收啊，謝謝！", "下次再帶來唷！"];
  const CAT_BUYBACK = "🐮 收購牧場收成";
  const CAT_QUEST = "📜 閱讀任務";

  function el(tag, cls, html) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }

  // innerHTML 前跳脫（資料來自 JSON，仍防呆避免欄位含 HTML 被注入）
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  async function loadCatalog() {
    if (CATALOG) return CATALOG;
    const r = await fetch("shop_catalog.json?v=2");
    if (!r.ok) throw new Error("catalog HTTP " + r.status);
    CATALOG = await r.json();
    return CATALOG;
  }

  // 取出並清掉 onClose callback 後呼叫（避免重複觸發 / 釋放 modalOpen 鎖）
  function release() {
    const cb = onCloseCb; onCloseCb = null;
    if (cb) cb();
  }

  function buildOverlay() {
    let ov = document.getElementById("shop-overlay");
    if (ov) return ov;
    ov = el("div");
    ov.id = "shop-overlay";
    ov.innerHTML = `
      <div class="shop-panel">
        <div class="shop-title"></div>
        <button class="shop-close" aria-label="關閉">×</button>
        <div class="shop-merchant">
          <div class="shop-bubble"></div>
          <img alt="商人">
          <div class="shop-owner"></div>
        </div>
        <div class="shop-grid-wrap">
          <div class="shop-banner" hidden></div>
          <div class="shop-cats"></div>
          <div class="shop-grid"></div>
        </div>
      </div>`;
    document.body.appendChild(ov);
    ov.querySelector(".shop-close").addEventListener("click", closeShop);
    ov.addEventListener("click", (e) => { if (e.target === ov) closeShop(); });
    return ov;
  }

  function bubble(ov, txt) { ov.querySelector(".shop-bubble").textContent = txt; }

  // 服裝店「真商品」4 套：買了記擁有＋走路造型馬上換（其餘商品照舊純展示）
  const OUTFIT_OWN_KEY = "village_outfits_owned";
  function ownedOutfits() {
    try { const a = JSON.parse(localStorage.getItem(OUTFIT_OWN_KEY) || "[]"); return Array.isArray(a) ? a : []; } catch (e) { return []; }
  }
  function addOwnedOutfit(id) {
    const a = ownedOutfits();
    if (a.indexOf(id) < 0) { a.push(id); try { localStorage.setItem(OUTFIT_OWN_KEY, JSON.stringify(a)); } catch (e) {} }
  }
  function realOutfitId(it) {
    // 資料驅動：EQUIP.body 裡標 shop:true 的造型＝真商品（美人魚/配件類沒入表，自動維持純展示）
    const m = /outfits\/([a-z0-9_]+)\.webp$/.exec(it.img || "");
    if (!m) return null;
    const eq = EQUIP.body.items.find((x) => x.id === m[1] && x.shop);
    return eq ? m[1] : null;
  }

  function renderGrid(ov, shop, cat) {
    const grid = ov.querySelector(".shop-grid");
    grid.innerHTML = "";
    const items = shop.items.filter((it) => !cat || cat === "全部" || it.cat === cat);
    items.forEach((it, i) => {
      const card = el("div", "shop-card");
      const realId = realOutfitId(it);   // 真商品不套賣光/VIP 裝飾，永遠買得到
      // 少量裝飾狀態：每 7 個一個賣光、VIP（純展示，圖二那種感覺）
      if (!realId && i % 7 === 5) card.classList.add("sold");
      else if (!realId && i % 11 === 9) card.classList.add("vip");
      card.innerHTML = `
        <span class="tag">${card.classList.contains("sold") ? "賣光啦" : "VIP"}</span>
        ${it.img ? `<img src="${it.img}" alt="${it.name}" loading="lazy">` : `<div class="shop-emoji">${it.emoji || "🎁"}</div>`}
        <div class="nm">${it.name}</div>
        <div class="pr">${it.price}</div>`;
      card.addEventListener("click", () => {
        if (card.classList.contains("sold") || card.classList.contains("vip")) {
          bubble(ov, card.classList.contains("sold") ? "這個賣完囉，下次請早～" : "這是 VIP 限定的唷！");
          return;
        }
        if (card.classList.contains("bought")) return;
        if (realId) {
          // 性別擋：男生不能買女裝、女生不能買男裝（依 onboarding 建角的 village_gender）
          const fem = isFemale();
          if (realId.charAt(0) === "f" && !fem) { bubble(ov, "這套是女生的衣服唷，幫你推薦男裝店～"); return; }
          if (realId.charAt(0) === "m" && fem) { bubble(ov, "這套是男生的衣服唷，幫你推薦女裝店～"); return; }
          if (getEquip().body === realId) { bubble(ov, "你已經穿著這套囉！"); return; }
          const had = ownedOutfits().indexOf(realId) >= 0;
          addOwnedOutfit(realId);
          setEquip("body", realId);
          if (window.applyWalkOutfit) window.applyWalkOutfit();
          card.classList.add("bought");
          bubble(ov, (had ? "再次換上「" : "購買成功！馬上換上「") + it.name + "」✨ 走出去看看新造型吧！");
          setTimeout(() => card.classList.remove("bought"), 900);
          return;
        }
        card.classList.add("bought");
        bubble(ov, BUY_REACT[Math.floor(Math.random() * BUY_REACT.length)]);
        setTimeout(() => card.classList.remove("bought"), 900);
      });
      grid.appendChild(card);
    });
  }

  // 收購牧場收成（玩家賣 → 批發中心，純展示假交易）
  function renderBuyback(ov, shop) {
    const grid = ov.querySelector(".shop-grid");
    grid.innerHTML = "";
    (shop.buyback || []).forEach((it) => {
      const card = el("div", "shop-card sell");
      card.innerHTML = `
        <span class="tag tag-sell">收購</span>
        ${it.img ? `<img src="${esc(it.img)}" alt="${esc(it.name)}">` : `<div class="shop-emoji">${esc(it.emoji || "📦")}</div>`}
        <div class="nm">${esc(it.name)}</div>
        <div class="pr">+${esc(it.price)} 金幣</div>`;
      card.addEventListener("click", () => {
        if (card.classList.contains("bought")) return;
        card.classList.add("bought");
        bubble(ov, SELL_REACT[Math.floor(Math.random() * SELL_REACT.length)]);
        setTimeout(() => card.classList.remove("bought"), 900);
      });
      grid.appendChild(card);
    });
  }

  // 閱讀任務（出版社，純展示假領獎，仿學院辦公室）
  function renderQuests(ov, shop) {
    const grid = ov.querySelector(".shop-grid");
    grid.innerHTML = `<div class="shop-quests">` + (shop.quests || []).map((q) => `
      <div class="shop-quest">
        <div class="sq-ic">${esc(q.icon || "📜")}</div>
        <div class="sq-body">
          <div class="sq-title">${esc(q.title)}</div>
          <div class="sq-desc">${esc(q.desc || "")}</div>
          <div class="sq-reward">🎁 ${esc(q.reward || "")}</div>
        </div>
        <button class="jc-act sq-claim">領取任務</button>
      </div>`).join("") + `</div>`;
    grid.querySelectorAll(".sq-claim").forEach((b) => b.addEventListener("click", function () {
      if (this.classList.contains("done")) return;
      this.classList.add("done"); this.textContent = "✓ 已領取";
      bubble(ov, "任務已領取，完成後回來領獎勵唷！");
    }));
  }

  // 依分類路由：偽分類(收購/任務)走專屬渲染，其餘走商品格
  function renderBody(ov, shop, cat) {
    if (cat === CAT_BUYBACK) { renderBuyback(ov, shop); return; }
    if (cat === CAT_QUEST) { renderQuests(ov, shop); return; }
    renderGrid(ov, shop, cat);
  }

  function renderCats(ov, shop) {
    const its = Array.isArray(shop.items) ? shop.items : [];
    const cats = ["全部", ...Array.from(new Set(its.map((it) => it.cat).filter(Boolean)))];
    if (Array.isArray(shop.buyback) && shop.buyback.length) cats.push(CAT_BUYBACK);
    if (Array.isArray(shop.quests) && shop.quests.length) cats.push(CAT_QUEST);
    const bar = ov.querySelector(".shop-cats");
    bar.innerHTML = "";
    // 只有「全部」一項就不顯示分類列（服裝店）
    if (cats.length <= 1) return;
    cats.forEach((c, i) => {
      const b = el("div", "shop-cat" + (i === 0 ? " active" : ""), c);
      b.addEventListener("click", () => {
        bar.querySelectorAll(".shop-cat").forEach((x) => x.classList.remove("active"));
        b.classList.add("active");
        renderBody(ov, shop, c);
      });
      bar.appendChild(b);
    });
  }

  async function openShop(shopId, onClose) {
    // 遊樂場機台：arcade:<key> → 跳獨立遊戲頁（頁內自建 demo 身分、玩完導回遊樂場）
    if (shopId.indexOf("arcade:") === 0) {
      const ARCADE_PAGES = { whack: "arcade-whack.html", listen: "arcade-listen.html", figures: "figures.html?from=playground", poem: "arcade-poem.html", idiom: "arcade-idiom.html" };
      const page = ARCADE_PAGES[shopId.slice(7)];
      if (page) {
        // 帶上玩家當下位置 → 返回時落回原本機台前面（不是傳送點）
        let bs = "";
        try {
          const sc = window.game.scene.scenes.find((s) => s.player && s.WORLD_W);
          if (sc) bs = (page.indexOf("?") >= 0 ? "&" : "?") + "back_spawn=" + (sc.player.x / sc.WORLD_W).toFixed(4) + "," + (sc.player.y / sc.WORLD_H).toFixed(4);
        } catch (e) {}
        location.href = "../" + page + bs;
        return;
      }
      if (onClose) onClose();
      return;
    }
    // 禁忌森林深處怪物/魔王（pptx v8 P62）：bossfight:<subject>:<tier> → 跳獨立魔王戰頁
    if (shopId.indexOf("bossfight:") === 0) {
      const parts = shopId.split(":");
      const bSubj = parts[1] || "math";
      const bTier = parts[2] || "1";
      let q = "?subject=" + encodeURIComponent(bSubj) + "&tier=" + encodeURIComponent(bTier);
      try {
        const sc = window.game.scene.scenes.find((s) => s.player && s.WORLD_W);
        if (sc) {
          q += "&map=" + encodeURIComponent(sc.mapId || "forest_deep");
          q += "&back_spawn=" + (sc.player.x / sc.WORLD_W).toFixed(4) + "," + (sc.player.y / sc.WORLD_H).toFixed(4);
        }
      } catch (e) {}
      location.href = "../arcade-boss.html" + q;
      return;
    }
    // 競技場裁判（pptx v8 P66）：玩家開設遊戲房間 PK → 跳獨立 PK 頁（正式版三模式整包）
    if (shopId === "pvparena") {
      let q = "?back_map=competitive";
      try {
        const sc = window.game.scene.scenes.find((s) => s.player && s.WORLD_W);
        if (sc) q += "&back_spawn=" + (sc.player.x / sc.WORLD_W).toFixed(4) + "," + (sc.player.y / sc.WORLD_H).toFixed(4);
      } catch (e) {}
      location.href = "../arcade-pvp.html" + q;
      return;
    }
    if (shopId === "job_center") { openJobCenter(onClose); return; }
    if (shopId === "academy_office") { openAcademyOffice(onClose); return; }
    if (shopId === "dorm") { openDormHub(onClose); return; }
    if (shopId === "chinese_academy") { caSubject = "chinese"; caMainAPI = null; caAwards = null; openChineseAcademy(onClose); return; }
    if (shopId === "math_academy") { caSubject = "math"; caMainAPI = null; caAwards = null; openChineseAcademy(onClose); return; }
    // 禁忌森林課本練習（A/B 版）：fpract:<subj>
    if (shopId.indexOf("fpract:") === 0) { caSubject = shopId.slice(7); caMainAPI = null; caAwards = null; openForestPractice(onClose); return; }
    // 英文學院（魔法陣樣板）：入口院長 / 布告欄基礎練習 / 入魔NPC答題淨化對決 / 已淨化NPC對話
    if (shopId === "english_entrance") { enOpenEntrance(onClose); return; }
    if (shopId === "english_board") { caSubject = "english"; caMainAPI = null; caAwards = null; enOpenBoard(onClose); return; }
    if (shopId.indexOf("enpurify:") === 0) { enOpenDuel(shopId.slice(9), onClose); return; }
    if (shopId.indexOf("enclear:") === 0) { enOpenCleared(shopId.slice(8), onClose); return; }
    // 封印之門：enseal:<下一層地圖>:<本層師長id> → 淨化本層才開門
    if (shopId.indexOf("enseal:") === 0) { const p = shopId.split(":"); enOpenSeal(p[1], p[2], onClose); return; }
    // 考試院：歐陽修(模擬考) / 笛卡兒(檢定考)
    if (shopId === "exam_mock") { exOpen("mock", onClose); return; }
    if (shopId === "exam_cert") { exOpen("cert", onClose); return; }
    // 通用學院路由（任何科目）：acad:<subj> 院長門面 / anpc:<subj>:<id> 任務面板 / afig:<subj>:<名> 圖鑑卡
    if (shopId.indexOf("acad:") === 0) { caSubject = shopId.slice(5); caMainAPI = null; caAwards = null; openChineseAcademy(onClose); return; }
    if (shopId.indexOf("anpc:") === 0) { const p = shopId.split(":"); caSubject = p[1]; caMainAPI = null; caAwards = null; openNpcQuest(p.slice(2).join(":"), onClose); return; }
    if (shopId.indexOf("afig:") === 0) { const p = shopId.split(":"); caSubject = p[1]; caMainAPI = null; caAwards = null; openNpcIntro(p.slice(2).join(":"), onClose); return; }
    if (shopId.indexOf("mnpcintro:") === 0) { caSubject = "math"; caMainAPI = null; caAwards = null; openNpcIntro(shopId.slice(10), onClose); return; }
    if (shopId.indexOf("npcintro:") === 0) { caSubject = "chinese"; openNpcIntro(shopId.slice(9), onClose); return; }
    if (shopId.indexOf("mnpc_") === 0) { caSubject = "math"; caMainAPI = null; caAwards = null; openNpcQuest(shopId.slice(5), onClose); return; }
    if (shopId.indexOf("npc_") === 0) { caSubject = "chinese"; caMainAPI = null; caAwards = null; openNpcQuest(shopId.slice(4), onClose); return; }
    onCloseCb = onClose || null;
    let cat;
    try {
      cat = await loadCatalog();
    } catch (e) {
      console.warn("shop catalog 載入失敗", e);
      release();   // 釋放 modalOpen 鎖，玩家不會被卡住
      return;
    }
    const shop = cat[shopId];
    if (!shop) { console.warn("unknown shop", shopId); release(); return; }
    const ov = buildOverlay();
    ov.querySelector(".shop-title").textContent = shop.title;
    // 橫幅（如 COSTCOOL 特約商店預告）
    const ban = ov.querySelector(".shop-banner");
    if (shop.banner) { ban.textContent = shop.banner; ban.hidden = false; }
    else { ban.textContent = ""; ban.hidden = true; }
    // 老闆頭像可選：沒有 merchant 就隱藏整個頭像區（出版社）
    const mImg = ov.querySelector(".shop-merchant img");
    if (shop.merchant) { mImg.src = shop.merchant + "?v=5"; mImg.hidden = false; }
    else { mImg.removeAttribute("src"); mImg.hidden = true; }
    ov.querySelector(".shop-owner").textContent = shop.owner ? "👤 老闆 · " + shop.owner : "";
    const g = GREET[shopId] || ["歡迎光臨！"];
    bubble(ov, g[Math.floor(Math.random() * g.length)]);
    renderCats(ov, shop);
    renderBody(ov, shop, "全部");
    ov.classList.add("open");
  }

  function closeShop() {
    const ov = document.getElementById("shop-overlay");
    if (ov) ov.classList.remove("open");
    release();
  }

  window.openShop = openShop;
  window.closeShop = closeShop;

  /* ───────────────────── 職業介紹所（純展示 demo，localStorage 記職業）───────────────────── */
  const JOB_IMG = "../assets/images/jobs/";
  const SUBJ = { chinese: "國語", math: "數學", english: "英語", science: "自然", social: "社會" };
  // 職業樹（依派派職業分支圖）：5 學院 ×（院生階2 → 執業人員階3 → 三選一進階階4）。
  // item = 升到此職業所需道具（純展示標示，批發中心購買，不硬擋）；next = 下一階（字串；陣列=三選一）。
  const JOBS = {
    // ── 國語 ──
    chinese_student: { name: "國語學院院生", subj: "chinese", tier: 2, sprite: "student_chinese.png",
      desc: "踏入國語學院，鑽研語文之美。", skill: "答對國語題金幣 +10%", next: "chinese_pro",
      quest: { title: "完成 5 道國語練習", reward: "金幣 ×100" } },
    chinese_pro: { name: "國語執業人員", subj: "chinese", tier: 3, sprite: "pro_chinese.png",
      desc: "通過國語認證、正式執業。", skill: "國語魔王戰多 1 顆愛心", item: "國語證照",
      next: ["reporter", "cn_teacher", "writer"],
      quest: { title: "通過國語檢定考", reward: "金幣 ×300 + 國語證照" } },
    reporter: { name: "記者", subj: "chinese", tier: 4, sprite: "reporter.png",
      desc: "追逐真相、報導世界的人。", skill: "答對國語題自動解鎖新聞卡", item: "記者證",
      quest: { title: "完成 3 篇採訪報導", reward: "金幣 ×500 + 採訪麥克風" } },
    cn_teacher: { name: "國文老師", subj: "chinese", tier: 4, sprite: "teacher_chinese.png",
      desc: "傳道授業、桃李滿天下。", skill: "教學相長：國語經驗 ×1.5", item: "國語教師證",
      quest: { title: "備課並教 3 堂國文課", reward: "金幣 ×500 + 教鞭" } },
    writer: { name: "作家", subj: "chinese", tier: 4, sprite: "writer.png",
      desc: "用文字創造世界的人。", skill: "答對國語題金幣 +50%", item: "靈感鋼筆",
      quest: { title: "創作 1 篇短篇故事", reward: "金幣 ×500 + 靈感鋼筆" } },
    // ── 數學 ──
    math_student: { name: "數學學院院生", subj: "math", tier: 2, sprite: "student_math.png",
      desc: "進入數學學院，探索數字奧秘。", skill: "答對數學題金幣 +10%", next: "math_pro",
      quest: { title: "完成 5 道數學練習", reward: "金幣 ×100" } },
    math_pro: { name: "數學執業人員", subj: "math", tier: 3, sprite: "pro_math.png",
      desc: "通過數學認證、正式執業。", skill: "數學魔王戰多 1 顆愛心", item: "數學證照",
      next: ["trader", "math_teacher", "accountant"],
      quest: { title: "通過數學檢定考", reward: "金幣 ×300 + 數學證照" } },
    trader: { name: "交易員", subj: "math", tier: 4, sprite: "trader.png",
      desc: "在金融市場運籌帷幄的人。", skill: "牧場販售金幣 +30%", item: "財金人員資格證",
      quest: { title: "完成 3 筆模擬交易", reward: "金幣 ×500 + 行情平板" } },
    math_teacher: { name: "數學老師", subj: "math", tier: 4, sprite: "teacher_math.png",
      desc: "把抽象變簡單的引路人。", skill: "教學相長：數學經驗 ×1.5", item: "數學教師證",
      quest: { title: "備課並教 3 堂數學課", reward: "金幣 ×500 + 教鞭" } },
    accountant: { name: "會計師", subj: "math", tier: 4, sprite: "accountant.png",
      desc: "與數字為伍的理財專家。", skill: "每日金幣利息 +5%", item: "會計師資格證",
      quest: { title: "結算 3 份帳本", reward: "金幣 ×500 + 計算機" } },
    // ── 英語 ──
    english_student: { name: "英語學院院生", subj: "english", tier: 2, sprite: "student_english.png",
      desc: "踏入英語學院，連結世界。", skill: "答對英語題金幣 +10%", next: "english_pro",
      quest: { title: "完成 5 道英語練習", reward: "金幣 ×100" } },
    english_pro: { name: "英語執業人員", subj: "english", tier: 3, sprite: "pro_english.png",
      desc: "通過英語認證、正式執業。", skill: "英語魔王戰多 1 顆愛心", item: "英語證照",
      next: ["translator", "en_teacher", "foreign_corp"],
      quest: { title: "通過英語檢定考", reward: "金幣 ×300 + 英語證照" } },
    translator: { name: "英文翻譯", subj: "english", tier: 4, sprite: "translator.png",
      desc: "跨越語言隔閡的橋樑。", skill: "答對英語題自動解鎖單字卡", item: "超級電子字典",
      quest: { title: "翻譯 3 段文章", reward: "金幣 ×500 + 電子字典" } },
    en_teacher: { name: "英文老師", subj: "english", tier: 4, sprite: "teacher_english.png",
      desc: "帶你開口說世界語言。", skill: "教學相長：英語經驗 ×1.5", item: "英語教師證",
      quest: { title: "備課並教 3 堂英文課", reward: "金幣 ×500 + 教鞭" } },
    foreign_corp: { name: "外商企業職員", subj: "english", tier: 4, sprite: "foreign_corp.png",
      desc: "在國際舞台工作的人。", skill: "完成英語任務金幣 +30%", item: "外商員工證",
      quest: { title: "完成 3 場國際會議", reward: "金幣 ×500 + 公事包" } },
    // ── 自然 ──
    science_student: { name: "自然學院院生", subj: "science", tier: 2, sprite: "student_science.png",
      desc: "進入自然學院，觀察萬物。", skill: "答對自然題金幣 +10%", next: "science_pro",
      quest: { title: "完成 5 道自然練習", reward: "金幣 ×100" } },
    science_pro: { name: "自然執業人員", subj: "science", tier: 3, sprite: "pro_science.png",
      desc: "通過自然認證、正式執業。", skill: "自然魔王戰多 1 顆愛心", item: "自然證照",
      next: ["engineer", "sci_teacher", "researcher"],
      quest: { title: "通過自然檢定考", reward: "金幣 ×300 + 自然證照" } },
    engineer: { name: "工程師", subj: "science", tier: 4, sprite: "engineer.png",
      desc: "用科學打造未來的人。", skill: "牧場 exp ×1.5", item: "科技業員工證",
      quest: { title: "打造 3 座裝置", reward: "金幣 ×500 + 工程計算機" } },
    sci_teacher: { name: "自然老師", subj: "science", tier: 4, sprite: "teacher_science.png",
      desc: "帶你認識大自然的奧妙。", skill: "教學相長：自然經驗 ×1.5", item: "自然教師證",
      quest: { title: "備課並教 3 堂自然課", reward: "金幣 ×500 + 教鞭" } },
    researcher: { name: "研究人員", subj: "science", tier: 4, sprite: "biologist.png",
      desc: "在實驗室追尋真理的人。", skill: "答對自然題自動解鎖科學卡", item: "研究人員資格證",
      quest: { title: "完成 3 項研究", reward: "金幣 ×500 + 顯微鏡" } },
    // ── 社會 ──
    social_student: { name: "社會學院院生", subj: "social", tier: 2, sprite: "student_social.png",
      desc: "踏入社會學院，理解人群。", skill: "答對社會題金幣 +10%", next: "social_pro",
      quest: { title: "完成 5 道社會練習", reward: "金幣 ×100" } },
    social_pro: { name: "社會執業人員", subj: "social", tier: 3, sprite: "pro_social.png",
      desc: "通過社會認證、正式執業。", skill: "社會魔王戰多 1 顆愛心", item: "社會證照",
      next: ["social_worker", "social_teacher", "congress_aide"],
      quest: { title: "通過社會檢定考", reward: "金幣 ×300 + 社會證照" } },
    social_worker: { name: "社工人員", subj: "social", tier: 4, sprite: "social_worker.png",
      desc: "用愛心幫助他人的人。", skill: "完成社會任務金幣 +30%", item: "社工證",
      quest: { title: "完成 3 次社區服務", reward: "金幣 ×500 + 服務徽章" } },
    social_teacher: { name: "社會學老師", subj: "social", tier: 4, sprite: "teacher_social.png",
      desc: "帶你讀懂社會脈動。", skill: "教學相長：社會經驗 ×1.5", item: "社會教師證",
      quest: { title: "備課並教 3 堂社會課", reward: "金幣 ×500 + 教鞭" } },
    congress_aide: { name: "國會助理", subj: "social", tier: 4, sprite: "congress_aide.png",
      desc: "在議事殿堂幕後奔走的人。", skill: "完成社會任務經驗 +30%", item: "助理證",
      quest: { title: "協助 3 場議事", reward: "金幣 ×500 + 公文夾" } },
  };
  const JC_KEY = "village_job";
  // 防呆：非法/過期的存值一律視為「無職業」，避免 JOBS[cur] 取值炸掉把玩家鎖死
  const getJob = () => { const k = localStorage.getItem(JC_KEY); return k && JOBS[k] ? k : null; };
  const setJob = (k) => localStorage.setItem(JC_KEY, k);
  // 性別（讀 onboarding 建角存的 village_gender）：女角職業圖用 _female 版
  const isFemale = () => localStorage.getItem("village_gender") === "female";
  // 「原本造型」(basic) 卡圖按性別：女生顯示女版初始造型，其餘衣服圖照舊
  const bodyImg = (it) => (it && it.id === "basic" && isFemale()) ? "outfits/f_default.webp" : (it ? it.img : "");
  // 依性別取圖檔名（女→插 _female），附 onerror 退回男版的 HTML 屬性
  const femFile = (file) => file.replace(/\.png$/, "_female.png");
  const spriteFile = (file) => (isFemale() ? femFile(file) : file);
  const spriteImg = (file, alt, cls) => {
    const male = JOB_IMG + file + "?v=1";
    const src = JOB_IMG + spriteFile(file) + "?v=1";
    const onerr = isFemale() ? ` onerror="this.onerror=null;this.src='${male}'"` : "";
    return `<img${cls ? ` class="${cls}"` : ""} src="${src}" alt="${alt}" loading="lazy"${onerr}>`;
  };
  let jcTab = "pick";

  function jcBuildOverlay() {
    let ov = document.getElementById("jc-overlay");
    if (ov) return ov;
    ov = el("div"); ov.id = "jc-overlay";
    ov.innerHTML = `
      <div class="shop-panel jc-panel">
        <div class="shop-title">職業介紹所</div>
        <button class="shop-close" aria-label="關閉">×</button>
        <div class="jc-tabs">
          <button class="jc-tab" data-tab="pick">選擇學院</button>
          <button class="jc-tab" data-tab="promote">轉職進階</button>
          <button class="jc-tab" data-tab="quest">職業任務</button>
        </div>
        <div class="jc-current"></div>
        <div class="jc-content"></div>
        <div class="jc-bubble"></div>
      </div>`;
    document.body.appendChild(ov);
    ov.querySelector(".shop-close").addEventListener("click", jcClose);
    ov.addEventListener("click", (e) => { if (e.target === ov) jcClose(); });
    ov.querySelectorAll(".jc-tab").forEach((b) =>
      b.addEventListener("click", () => { jcTab = b.dataset.tab; jcRender(ov); }));
    return ov;
  }

  function jcBubble(ov, txt) { ov.querySelector(".jc-bubble").textContent = txt || ""; }

  function jcJobCard(k, opts) {
    const j = JOBS[k]; opts = opts || {};
    const reqLine = opts.needText != null ? opts.needText
      : (j.item ? `🎫 需道具：${j.item}（批發中心購買）` : "選擇即可加入學院");
    return `<div class="jc-card${opts.cur ? " cur" : ""}${opts.locked ? " locked" : ""}" data-job="${k}">
        ${spriteImg(j.sprite, j.name)}
        <div class="jc-info">
          <div class="jc-nm">${j.name} <span class="jc-badge">${SUBJ[j.subj]}·階${j.tier}</span></div>
          <div class="jc-desc">${j.desc}</div>
          <div class="jc-skill">🌟 ${j.skill}</div>
          <div class="jc-need">${reqLine}</div>
        </div>
        ${opts.btn ? `<button class="jc-act"${opts.locked ? " disabled" : ""}>${opts.btn}</button>` : ""}
      </div>`;
  }

  function jcRender(ov) {
    ov.querySelectorAll(".jc-tab").forEach((b) =>
      b.classList.toggle("active", b.dataset.tab === jcTab));
    const cur = getJob();
    const curEl = ov.querySelector(".jc-current");
    curEl.innerHTML = cur
      ? `目前職業：<b>${JOBS[cur].name}</b>（${SUBJ[JOBS[cur].subj]}·階${JOBS[cur].tier}）`
      : `<div class="jc-intern">${spriteImg("student_v2.png", "學院實習生", "jc-intern-img")}<div class="jc-intern-txt">目前身份：<b>學院實習生</b><br><span>到下方「選擇學院」開始你的職涯！</span></div></div>`;
    curEl.classList.toggle("has-intern", !cur);
    const box = ov.querySelector(".jc-content");
    box.innerHTML = "";

    if (jcTab === "pick") {
      jcBubble(ov, "要進入哪一個學院呢？選一個學院開始你的職涯！");
      const academies = Object.keys(JOBS).filter((k) => JOBS[k].tier === 2);
      box.innerHTML = academies.map((k) => jcJobCard(k, { cur: k === cur, btn: k === cur ? "目前學院" : "加入", needText: "選擇即可加入學院" })).join("");
      box.querySelectorAll(".jc-card").forEach((c) => c.addEventListener("click", () => {
        const k = c.dataset.job;
        if (k === getJob()) { jcBubble(ov, "你已經在這個學院囉～"); return; }
        setJob(k); jcBubble(ov, "歡迎加入「" + JOBS[k].name + "」！");
        jcRender(ov);
      }));
    } else if (jcTab === "promote") {
      if (!cur) { jcBubble(ov, "先到「選擇學院」加入一個學院，才能往上轉職唷！");
        box.innerHTML = `<div class="jc-empty">尚未選擇學院<br>請先到「選擇學院」分頁</div>`; return; }
      const j = JOBS[cur];
      const nexts = j.next ? (Array.isArray(j.next) ? j.next : [j.next]) : [];
      if (nexts.length === 0) {
        jcBubble(ov, "你已經走到這條職業路線的頂端了，太厲害了！");
        box.innerHTML = `<div class="jc-empty">🏆 已達職業樹頂端<br>${j.name}</div>`;
      } else {
        jcBubble(ov, nexts.length === 1
          ? "取得「" + JOBS[nexts[0]].item + "」即可升級成執業人員！"
          : "選擇想走的方向，取得對應道具即可轉職！");
        box.innerHTML = nexts.map((nk) => jcJobCard(nk, { btn: "轉職" })).join("");
        box.querySelectorAll(".jc-card").forEach((c) => c.addEventListener("click", () => {
          const nk = c.dataset.job;
          setJob(nk); jcBubble(ov, "轉職成功！你現在是「" + JOBS[nk].name + "」！（展示版不檢查道具）");
          jcTab = "promote"; jcRender(ov);
        }));
      }
    } else if (jcTab === "quest") {
      if (!cur) { jcBubble(ov, "先選擇學院，才有專屬任務可以領取唷！");
        box.innerHTML = `<div class="jc-empty">尚未選擇學院<br>請先到「選擇學院」分頁</div>`; return; }
      const j = JOBS[cur];
      jcBubble(ov, j.name + "的專屬任務，完成可拿獎勵！");
      box.innerHTML = `<div class="jc-quest">
          <div class="jc-quest-head">【${j.name} 專屬任務】</div>
          <div class="jc-quest-title">📜 ${j.quest.title}</div>
          <div class="jc-quest-reward">獎勵：${j.quest.reward}</div>
          <button class="jc-act jc-claim">領取任務</button>
        </div>`;
      box.querySelector(".jc-claim").addEventListener("click", function () {
        if (this.classList.contains("done")) return;
        this.classList.add("done"); this.textContent = "✓ 已領取";
        jcBubble(ov, "任務已領取！快去完成它吧～");
      });
    }
  }

  function openJobCenter(onClose) {
    onCloseCb = onClose || null;
    const ov = jcBuildOverlay();
    jcTab = "pick"; jcRender(ov);
    ov.classList.add("open");
  }
  function jcClose() {
    const ov = document.getElementById("jc-overlay");
    if (ov) ov.classList.remove("open");
    release();
  }
  window.openJobCenter = openJobCenter;

  /* ───────────────────── 學院辦公室（客服/公告：更新日誌 / 回報 Bug / 遊戲規則）───────────────────── */
  let AO_CONTENT = null;
  let aoTab = "log";
  const BUG_KEY = "village_bugs";
  const BUG_CATS = ["畫面顯示", "卡關 / 動不了", "閃退 / 當機", "操作問題", "建議", "其他"];
  // 內容來自可編輯 JSON，innerHTML 前一律跳脫，避免日後內容含 HTML 被注入
  const aoEsc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  // icon 欄位可填 emoji（純文字）或圖片路徑（如 icons/ic_quest_daily.webp）→ 是圖就出 <img>
  const aoIcon = (ic, fallback) => {
    const v = String(ic || fallback || "");
    // 只接受同源相對路徑的圖（icons/檔名.webp|png|jpg），其餘一律當 emoji 文字，
    // 杜絕外部網址 / data: / svg 等非預期資源載入（Codex P3）
    return /^icons\/[\w.-]+\.(webp|png|jpg)$/i.test(v)
      ? `<img src="${aoEsc(v)}?v=1" alt="" style="width:1.15em;height:1.15em;object-fit:contain;display:block;">`
      : aoEsc(v);
  };

  async function aoLoad() {
    if (AO_CONTENT) return AO_CONTENT;
    const r = await fetch("academy_content.json?v=5");
    if (!r.ok) throw new Error("academy content HTTP " + r.status);
    AO_CONTENT = await r.json();
    return AO_CONTENT;
  }

  function aoBuildOverlay() {
    let ov = document.getElementById("ao-overlay");
    if (ov) return ov;
    ov = el("div"); ov.id = "ao-overlay";
    ov.innerHTML = `
      <div class="shop-panel ao-panel">
        <div class="shop-title">學院辦公室</div>
        <button class="shop-close" aria-label="關閉">×</button>
        <div class="ao-principal">
          <div class="ao-bubble"></div>
          <img class="ao-principal-img" src="socrates_anim.webp?v=1" alt="學園園長 蘇格拉底" draggable="false">
          <div class="ao-owner">👤 學園園長 · 蘇格拉底</div>
        </div>
        <div class="ao-right">
          <div class="jc-tabs ao-tabs4">
            <button class="jc-tab" data-tab="log">更新日誌</button>
            <button class="jc-tab" data-tab="quest">學院任務</button>
            <button class="jc-tab" data-tab="bug">回報 Bug</button>
            <button class="jc-tab" data-tab="rules">遊戲規則</button>
          </div>
          <div class="jc-content ao-content"></div>
        </div>
      </div>`;
    document.body.appendChild(ov);
    ov.querySelector(".shop-close").addEventListener("click", aoClose);
    ov.addEventListener("click", (e) => { if (e.target === ov) aoClose(); });
    ov.querySelectorAll(".jc-tab").forEach((b) =>
      b.addEventListener("click", () => { aoTab = b.dataset.tab; aoRender(ov); }));
    attachReportBtn(ov);
    return ov;
  }
  function aoBubble(ov, txt) { ov.querySelector(".ao-bubble").textContent = txt || ""; }

  function aoRender(ov) {
    ov.querySelectorAll(".jc-tab").forEach((b) =>
      b.classList.toggle("active", b.dataset.tab === aoTab));
    const box = ov.querySelector(".ao-content");
    box.innerHTML = "";
    const c = AO_CONTENT || { changelog: [], rules: [] };

    if (aoTab === "log") {
      aoBubble(ov, "這裡看得到遊戲的最新更新內容唷！");
      box.innerHTML = (c.changelog || []).map((v) => `
        <div class="ao-log">
          <div class="ao-log-head"><span class="ao-ver">${aoEsc(v.version)}</span><span class="ao-date">${aoEsc(v.date)}</span></div>
          <ul class="ao-log-items">${(v.items || []).map((it) => `<li>${aoEsc(it)}</li>`).join("")}</ul>
        </div>`).join("") || `<div class="jc-empty">目前沒有更新紀錄</div>`;
    } else if (aoTab === "quest") {
      aoBubble(ov, "這些是學園的每日任務，完成後別忘了回來領獎勵！");
      box.innerHTML = (c.quests || []).map((q) => `
        <div class="ao-quest">
          <div class="ao-quest-ic">${aoIcon(q.icon, "📜")}</div>
          <div class="ao-quest-body">
            <div class="ao-quest-title">${aoEsc(q.title)}</div>
            <div class="ao-quest-desc">${aoEsc(q.desc)}</div>
            <div class="ao-quest-foot"><span class="ao-quest-reward">🎁 ${aoEsc(q.reward)}</span>${q.progress ? `<span class="ao-quest-prog">${aoEsc(q.progress)}</span>` : ""}</div>
          </div>
          <button class="jc-act ao-quest-claim">領取</button>
        </div>`).join("") || `<div class="jc-empty">目前沒有任務</div>`;
      box.querySelectorAll(".ao-quest-claim").forEach((b) => b.addEventListener("click", function () {
        if (this.classList.contains("done")) return;
        this.classList.add("done"); this.textContent = "✓ 已領取";
        aoBubble(ov, "任務獎勵已領取，繼續加油！");
      }));
    } else if (aoTab === "bug") {
      aoBubble(ov, "遇到問題了嗎？填一下，我們會盡快處理！");
      box.innerHTML = `
        <div class="ao-form">
          <label class="ao-fld"><span>問題類型</span>
            <select id="ao-bug-cat">${BUG_CATS.map((x) => `<option>${x}</option>`).join("")}</select></label>
          <label class="ao-fld col"><span>問題描述</span>
            <textarea id="ao-bug-txt" rows="4" maxlength="300" placeholder="請描述你遇到的問題，越詳細越好～"></textarea></label>
          <button class="jc-act ao-send">送出回報</button>
          <div class="ao-bug-hint" id="ao-bug-hint"></div>
        </div>`;
      const sendBtn = box.querySelector(".ao-send");
      let bugSending = false;
      sendBtn.addEventListener("click", async () => {
        if (bugSending) return;                       // 防重入（Codex P2）
        const txtEl = box.querySelector("#ao-bug-txt");
        const hint = box.querySelector("#ao-bug-hint");
        const cat = box.querySelector("#ao-bug-cat").value;
        const txt = (txtEl.value || "").trim();
        if (!txt) { hint.textContent = "請先描述問題再送出唷～"; hint.className = "ao-bug-hint err"; return; }
        bugSending = true; sendBtn.disabled = true;
        hint.textContent = "送出中…"; hint.className = "ao-bug-hint";
        // 結果三態：ok=後端收下 / reject=後端明確拒收(不假裝成功) / neterr=連不上(才退本機備援)
        let result = "neterr";
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 10000);   // 10 秒逾時，免按鈕卡死
        try {
          let page = "village";
          try { page = new URLSearchParams(location.search).get("map") || "village"; } catch (e) {}
          const r = await fetch(DEMO_API + "/api/bug-report", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ category: cat, description: txt, page, user_agent: navigator.userAgent }),
            signal: ctrl.signal,
          });
          result = r.ok ? "ok" : "reject";
        } catch (e) { result = "neterr"; }
        finally { clearTimeout(timer); bugSending = false; }
        if (result === "neterr") {
          // 只有真的連不上才存本機當離線備援，不讓玩家白填
          let list = [];
          try { const p = JSON.parse(localStorage.getItem(BUG_KEY) || "[]"); list = Array.isArray(p) ? p : []; } catch (e) { list = []; }
          list.push({ cat, txt, t: Date.now() });
          try { localStorage.setItem(BUG_KEY, JSON.stringify(list)); } catch (e) {}
        }
        if (!hint.isConnected) return;                // 面板已被切走/重繪就不動 UI（Codex P2）
        sendBtn.disabled = false;
        if (result === "reject") {
          // 後端明確拒收：顯示失敗、保留輸入，不假裝送出成功（Codex P2）
          hint.textContent = "送出失敗了，請稍後再試一次（你的內容還留著）"; hint.className = "ao-bug-hint err";
          aoBubble(ov, "唉呀送出失敗了，再試一次好嗎？");
          return;
        }
        txtEl.value = "";
        hint.textContent = result === "ok"
          ? "✓ 已收到你的回報，謝謝！我們會盡快處理～"
          : "✓ 已記下你的回報，謝謝！（暫時連不上伺服器，已先存在本機）";
        hint.className = "ao-bug-hint ok";
        aoBubble(ov, "收到囉，謝謝你的回報！");
      });
    } else if (aoTab === "rules") {
      aoBubble(ov, "不熟悉玩法嗎？這裡有完整的遊戲規則！");
      box.innerHTML = (c.rules || []).map((r) => `
        <div class="ao-rule">
          <div class="ao-rule-ic">${aoIcon(r.icon, "📋")}</div>
          <div class="ao-rule-body"><div class="ao-rule-title">${aoEsc(r.title)}</div><div class="ao-rule-txt">${aoEsc(r.body)}</div></div>
        </div>`).join("") || `<div class="jc-empty">目前沒有規則說明</div>`;
    }
  }

  async function openAcademyOffice(onClose) {
    onCloseCb = onClose || null;
    const ov = aoBuildOverlay();
    aoTab = "log";
    try { await aoLoad(); }
    catch (e) { console.warn("academy content 載入失敗", e); }
    aoRender(ov);
    ov.classList.add("open");
  }
  function aoClose() {
    const ov = document.getElementById("ao-overlay");
    if (ov) ov.classList.remove("open");
    release();
  }
  window.openAcademyOffice = openAcademyOffice;

  /* ───────────────────── 孔丘書院（國語學院·院長孔丘，16 主線任務，純展示假領獎）───────────────────── */
  let CA_CONTENT = null;
  let caTab = 0;          // 門面:'overview'/'fig'；NPC:line index
  let caMode = "academy"; // "academy" 建築門面 / "npc" 任務面板
  let caNpcId = null;
  let caSubject = "chinese";        // 目前學院科目：chinese / math（決定載哪個 *_academy.json、*_main 鏈、哪科練習）
  const CA_CACHE = {};              // 各科內容快取（避免切科互相覆蓋）
  // 各科練習端點/文案對照（顆星型「去基礎練習」用）
  const CA_SUBJ = {
    chinese: { label: "國語", game: "zhuyin" },
    math: { label: "數學", game: "arithmetic" },
    science: { label: "自然", game: "science" },
    social: { label: "社會", game: "social" },
    english: { label: "英語", game: "vocab" },
  };
  function caSubjConf() { return CA_SUBJ[caSubject] || CA_SUBJ.chinese; }
  function caDeanName() { return (((CA_CONTENT || {}).academy || {}).dean_name) || "院長"; }
  async function caLoad() {
    const subj = caSubject;                              // 鎖定本次載入科目，避免 await 後被切換污染
    if (CA_CACHE[subj]) { if (caSubject === subj) CA_CONTENT = CA_CACHE[subj]; return CA_CACHE[subj]; }
    const r = await fetch(subj + "_academy.json?v=1");
    if (!r.ok) throw new Error(subj + " academy HTTP " + r.status);
    const data = await r.json();
    CA_CACHE[subj] = data;
    if (caSubject === subj) CA_CONTENT = data;            // 只有當下科目沒被切走才更新全域
    return data;
  }
  function caBuildOverlay() {
    let ov = document.getElementById("ca-overlay");
    if (ov) return ov;
    ov = el("div"); ov.id = "ca-overlay";
    ov.innerHTML = `
      <div class="shop-panel ao-panel">
        <div class="shop-title">國語學院</div>
        <button class="shop-close" aria-label="關閉">×</button>
        <div class="ao-principal">
          <div class="ao-bubble"></div>
          <img class="ao-principal-img" src="kongqiu_front.webp?v=1" alt="國語學院 院長" draggable="false">
          <div class="ao-owner"></div>
        </div>
        <div class="ao-right">
          <div class="jc-tabs ao-tabs4"></div>
          <div class="jc-content ao-content"></div>
        </div>
      </div>`;
    document.body.appendChild(ov);
    ov.querySelector(".shop-close").addEventListener("click", caClose);
    ov.addEventListener("click", (e) => { if (e.target === ov) caClose(); });
    attachReportBtn(ov);
    return ov;
  }
  function caBubble(ov, txt) { ov.querySelector(".ao-bubble").textContent = txt || ""; }
  function caSetPrincipal(ov, img, owner) {
    const prin = ov.querySelector(".ao-principal"); if (prin) prin.style.display = "";   // 森林練習會隱藏它，這裡還原（overlay 單例重用）
    ov.classList.remove("ao-noprincipal");
    ov.classList.remove("ca-quizpage");
    caQuizHidPrin = false;   // 立繪已還原，避免殘留旗標害下個流程誤還原
    if (img) ov.querySelector(".ao-principal-img").src = img + "?v=1";
    ov.querySelector(".ao-owner").textContent = owner || "";
  }
  function caFigBadgeCls(b) { return b === "院長" ? "dean" : (b === "教授" ? "prof" : "assoc"); }
  function caRenderFigures(ov, figs) {
    caBubble(ov, "這些都是" + (((CA_CONTENT || {}).academy || {}).title || "學院") + "的師長，點一張卡片認識他們吧！");
    const box = ov.querySelector(".ao-content");
    box.innerHTML = `<div class="ca-figs">` + figs.map((f, i) => `
      <div class="ca-fig" data-fi="${i}">
        <span class="ca-fig-badge b-${caFigBadgeCls(f.badge)}">${aoEsc(f.badge || "")}</span>
        <div class="ca-fig-pic"><img src="${aoEsc(f.img)}?v=1" alt="${aoEsc(f.name)}" draggable="false"></div>
        <div class="ca-fig-nm">${aoEsc(f.name)}<span class="ca-fig-era">${aoEsc(f.era || "")}</span></div>
        <div class="ca-fig-wk">${aoEsc(f.works || "")}</div>
      </div>`).join("") + `</div>`;
    box.querySelectorAll(".ca-fig").forEach((cd) => cd.addEventListener("click", function () {
      const f = figs[+this.dataset.fi]; if (!f) return;
      box.querySelectorAll(".ca-fig").forEach((x) => x.classList.remove("sel"));
      this.classList.add("sel");
      caBubble(ov, f.name + "（" + (f.era || "") + "） " + (f.works || "") + "　" + (f.desc || ""));
    }));
  }

  /* ── 典籍收藏（slide 14 掉落物品，純展示）── */
  function caRenderBooks(ov, books) {
    caBubble(ov, "勤學有成，這些典籍便會收入囊中。");
    const box = ov.querySelector(".ao-content");
    const sec = (title, arr, cls, tag) => (Array.isArray(arr) && arr.length)
      ? `<div class="ca-navsec">${title}</div><div class="ca-books">` + arr.map((bk) =>
          `<div class="ca-book ${cls}"><span class="ca-book-ic">${aoEsc(bk.icon || "📖")}</span><span class="ca-book-nm">${aoEsc(bk.name)}</span><span class="ca-book-rate">${tag}</span></div>`).join("") + `</div>`
      : "";
    box.innerHTML = sec("📘 必定掉落 · 典籍", books.guaranteed || [], "g", "必掉")
                  + sec("📕 稀有掉落 · 藏書", books.rare || [], "r", "20%")
                  || `<div class="jc-empty">尚無典籍</div>`;
  }

  /* ── 建築門面：孔丘致詞 + 任務一覽(唯讀導覽) + 人物圖鑑 ── */
  function caRenderAcademy(ov) {
    const c = CA_CONTENT || {};
    const a = c.academy || {};
    const npcs = c.npcs || {};
    const figs = Array.isArray(c.figures) ? c.figures : [];
    ov.querySelector(".shop-title").textContent = a.title || "國語學院";
    caSetPrincipal(ov, a.dean_img, "👤 " + (a.dean_title || "") + (a.dean_name ? " " + a.dean_name : ""));
    updateReportBtn(ov, { chain: caSubject, giver: CA_DEAN_GIVER[caSubject] });
    if (caTab !== "overview" && caTab !== "fig" && caTab !== "books") caTab = "overview";
    const tabs = ov.querySelector(".ao-tabs4");
    const TABS = [{ k: "overview", t: "任務一覽" }, { k: "books", t: "典籍收藏" }, { k: "fig", t: "人物圖鑑" }];
    tabs.innerHTML = TABS.map((tb) =>
      `<button class="jc-tab${caTab === tb.k ? " active" : ""}" data-k="${tb.k}">${tb.t}</button>`).join("");
    tabs.querySelectorAll(".jc-tab").forEach((b) =>
      b.addEventListener("click", () => { caTab = b.dataset.k; caRenderAcademy(ov); }));
    if (caTab === "fig") { caRenderFigures(ov, figs); return; }
    if (caTab === "books") { caRenderBooks(ov, a.books || {}); return; }
    // 任務一覽（唯讀，導引去找路上 NPC）
    caBubble(ov, a.intro || "");
    const box = ov.querySelector(".ao-content");
    const ids = Object.keys(npcs);
    // 一位師長可同時有主線與支線（如孔丘），按 line.chain 分區呈現
    const group = (id, wantSide) => {
      const n = npcs[id];
      const lines = (n.lines || []).filter((l) => (l.chain === "side") === wantSide);
      if (!lines.length) return "";
      const quests = lines.reduce((acc, l) => acc.concat(l.quests || []), []);
      return `<div class="ca-navgroup">
        <div class="ca-navhd"><img src="${aoEsc(n.img)}?v=1" draggable="false"><span class="ca-navnm">${aoEsc(n.name)}</span><i class="ca-navti">${aoEsc(n.title || "")}</i></div>
        ${quests.map((q) => `<div class="ca-navq"><span class="ca-navq-ic">${aoEsc(q.icon || "📜")}</span><span class="ca-navq-t">${aoEsc(q.title)}</span><span class="ca-navq-r">🎁 ${aoEsc(q.reward)}</span></div>`).join("")}
        <div class="ca-navgo">→ 去找路上的「${aoEsc(n.name)}」接取</div>
      </div>`;
    };
    const minSeq = (id, wantSide) => {
      const ls = (npcs[id].lines || []).filter((l) => (l.chain === "side") === wantSide);
      return ls.length ? Math.min.apply(null, ls.map((l) => Number(l.seq_start) || 999)) : 999;
    };
    const order = (wantSide) => ids.filter((id) => minSeq(id, wantSide) < 999)
      .sort((a, b) => minSeq(a, wantSide) - minSeq(b, wantSide));
    const sideIds = order(true);

    // demo 真後台：主線顯示真進度，當前可動的那關直接接取/領取（孔丘院長面板＝這裡）
    const groupLive = (id) => {
      const n = npcs[id];
      const lines = (n.lines || []).filter((l) => l.chain !== "side");
      if (!lines.length) return "";
      let rows = "";
      lines.forEach((l) => {
        const base = Number(l.seq_start) || 1;
        (l.quests || []).forEach((q, qi) => {
          const aq = caMainAPI[base + qi];
          const stt = aq ? aq.status : "locked";
          let right;
          if (stt === "completed") right = `<span class="ca-navq-st" style="color:#3a8f3a;font-weight:800">✓ 已完成</span>`;
          else if (stt === "available") right = `<button class="jc-act ca-accept" data-key="${aq ? aoEsc(aq.key) : ""}">接取</button>`;
          else if (stt === "active" && aq && aq.can_claim) right = `<button class="jc-act ca-claim" data-key="${aoEsc(aq.key)}">領取</button>`;
          else if (stt === "active") {
            const lbl = caActLabel(aq.cond_type);
            right = `<span class="ca-navq-st" style="color:#c98a2b;font-weight:700">進行中 ${aq.current}/${aq.target}</span>`
              + (lbl ? ` <button class="jc-act ca-fulfill" data-key="${aoEsc(aq.key)}">${lbl}</button>` : "");
          }
          else right = `<span class="ca-navq-st" style="opacity:.45">🔒</span>`;
          rows += `<div class="ca-navq"><span class="ca-navq-ic">${stt === "locked" ? "🔒" : aoEsc(q.icon || "📜")}</span><span class="ca-navq-t">${aoEsc(q.title)}</span><span class="ca-navq-r">🎁 ${aoEsc(q.reward)}</span>${right}</div>`;
        });
      });
      return `<div class="ca-navgroup"><div class="ca-navhd"><img src="${aoEsc(n.img)}?v=1" draggable="false"><span class="ca-navnm">${aoEsc(n.name)}</span><i class="ca-navti">${aoEsc(n.title || "")}</i></div>${rows}</div>`;
    };
    const renderOverview = () => {
      const mainIds = order(false);
      const live = demoToken() && caMainAPI;
      if (live && caAwards === null) { caLoadAwards().then((aw) => { caAwards = aw; renderOverview(); }); }
      let html = "";
      if (live) html += `<div style="text-align:center;margin:2px 0 12px;"><button class="jc-act ca-practice" style="font-size:15px;padding:10px 20px;">📝 去基礎練習（答題賺星星）</button></div>`;
      if (live && caAwards && caAwards.length) {
        html += `<div class="ca-navsec">🏅 已獲成就</div><div style="display:flex;flex-wrap:wrap;gap:6px;padding:2px 4px 10px;">`
          + caAwards.map((aw) => `<span style="display:inline-block;background:#fff4d6;border:1px solid #e6c873;border-radius:14px;padding:4px 12px;font-size:13px;font-weight:700;color:#8a6a1e;">${aw.kind === "title" ? "🏆" : "📜"} ${aoEsc(aw.label)}</span>`).join("")
          + `</div>`;
      }
      if (mainIds.length) html += `<div class="ca-navsec">📘 主線任務</div>` + mainIds.map((id) => live ? groupLive(id) : group(id, false)).join("");
      if (sideIds.length) html += `<div class="ca-navsec">📙 支線任務</div>` + sideIds.map((id) => group(id, true)).join("");
      box.innerHTML = html || `<div class="jc-empty">目前沒有任務</div>`;
      if (live) {
        const refresh = async () => { caMainAPI = await caLoadMainAPI(); caAwards = await caLoadAwards(); caRenderAcademy(ov); };
        box.querySelectorAll(".ca-practice").forEach((b) => b.addEventListener("click", () => caOpenPractice(ov, 'ai')));
        box.querySelectorAll(".ca-accept").forEach((b) => b.addEventListener("click", async function (e) {
          e.stopPropagation(); this.disabled = true; await caMainAction("accept", this.dataset.key); await refresh();
        }));
        box.querySelectorAll(".ca-fulfill").forEach((b) => b.addEventListener("click", async function (e) {
          e.stopPropagation(); this.disabled = true; this.textContent = "完成中…";
          await caFulfillQuest(this.dataset.key); await refresh();
        }));
        box.querySelectorAll(".ca-claim").forEach((b) => b.addEventListener("click", async function (e) {
          e.stopPropagation(); this.disabled = true;
          const r = await caMainAction("claim", this.dataset.key);
          if (r && r.ok) caBubble(ov, "獎勵入帳！" + (r.reward_label ? ("獲得「" + r.reward_label + "」") : ("+" + (r.reward_coins || 0) + " 金幣")));
          else if (r && r.error === "condition_not_met") caBubble(ov, "還沒達成條件唷～");
          await refresh();
        }));
      }
    };
    if (!demoToken() && !caProvisioned) {   // 沒走 onboarding 直接進村莊→先自動補身分
      box.innerHTML = `<div class="jc-empty">任務載入中…</div>`;
      ensureDemoPlayer().then(() => caRenderAcademy(ov));
      return;
    }
    if (demoToken() && !caMainAPI) {
      box.innerHTML = `<div class="jc-empty">任務載入中…</div>`;
      caLoadMainAPI().then((m) => { caMainAPI = m; renderOverview(); });
    } else {
      renderOverview();
    }
  }

  /* ── Demo 真後台：主線任務（孔丘那條鏈）改讀真 API；沒通行證就退回舊假版 ── */
  const DEMO_API = "https://eduarena-tutoring-production.up.railway.app";
  function demoToken() { try { return localStorage.getItem("eduarena_demo_token") || ""; } catch (e) { return ""; } }
  let caMainAPI = null; // { seq: quest } 快取
  async function caLoadMainAPI() {
    const t = demoToken(); if (!t) return {};
    const subj = caSubject;                              // 鎖定科目，await 後若已切走則丟棄
    try {
      const r = await fetch(DEMO_API + "/api/main-quests?chain=" + subj + "_main", { headers: { "Authorization": "Bearer " + t } });
      const d = await r.json(); const by = {};
      (d.quests || []).forEach((q) => { by[q.seq] = q; });
      if (caSubject !== subj) return {};                 // 切換到別科了，這份資料作廢
      return by;
    } catch (e) { return {}; }
  }
  // 「📥 回報任務」（pptx v8 人物介面調整）：只在「這位 NPC 真的有可交付的任務」時出現。
  // 劇情規則＝跟誰接的任務就跟誰回報（quest.giver_key 對上面板的 NPC），平常隱藏。
  const QUEST_BAG_ITEMS = {
    "魔法陣傳送石": { id: "stone_teleport", img: "../assets/images/jobtools/stone_teleport.png", desc: "英語學院主線任務道具：安全傳送進出魔法陣的奇石。" },
    "封印鑰匙": { id: "key_seal", img: "../assets/images/jobtools/key_seal.png", desc: "鎮魔塔封印的一部分。從魔王汀其手中奪回的關鍵道具。" },
  };
  // 院長＝該院主線的發放人（pptx：孔丘/阿基米德/愛因斯坦/韋伯/莎士比亞）
  const CA_DEAN_GIVER = { chinese: "kongqiu", math: "archimedes", science: "einstein", social: "weber", english: "shakespeare" };
  let _reportSeq = 0;   // 防 await 競態：晚到的舊查詢不准蓋新狀態
  async function updateReportBtn(ov, ctx) {
    const b = ov.querySelector(".ao-report"); if (!b) return;
    const seq = ++_reportSeq;
    b.style.display = "none"; b._ready = null; b._ctx = null;
    const prin0 = b.closest(".ao-principal"); if (prin0) prin0.classList.remove("has-report");
    if (!ctx || !ctx.chain || !ctx.giver || !demoToken()) return;
    let d; try {
      d = await fetch(DEMO_API + "/api/main-quests?chain=" + ctx.chain + "_main",
        { headers: { "Authorization": "Bearer " + demoToken() } }).then((r) => r.json());
    } catch (e) { return; }
    if (seq !== _reportSeq) return;   // 面板已切到別的 NPC，這份結果作廢
    const ready = ((d && d.quests) || []).filter((q) => q.can_claim && q.giver_key === ctx.giver);
    if (!ready.length) return;
    b.textContent = "📥 回報任務（" + ready.length + "）";
    b._ready = ready.map((q) => q.key); b._ctx = ctx;
    b.style.display = "";
    if (prin0) prin0.classList.add("has-report");   // 泡泡文字讓位給按鈕（Codex P3）
  }
  function attachReportBtn(ov) {
    const prin = ov.querySelector(".ao-principal");
    if (!prin || prin.querySelector(".ao-report")) return;
    const b = el("button");
    b.className = "jc-act ao-report";
    b.textContent = "📥 回報任務";
    b.style.display = "none";   // 預設隱藏，updateReportBtn 查到可交付才現身
    b.addEventListener("click", async () => {
      const keys = b._ready || [], ctx = b._ctx;
      if (!keys.length) { b.style.display = "none"; return; }
      b.disabled = true;
      const seqAtClick = _reportSeq;   // claims 期間若面板換人(_reportSeq 變)，結束後不准動 UI（Codex P2）
      const say = (m) => { if (_reportSeq === seqAtClick) { const bb = ov.querySelector(".ao-bubble"); if (bb) bb.textContent = m; } };
      say("回報中…");
      let claimed = 0, coins = 0; const got = [];
      for (const k of keys) {
        const r = await caMainAction("claim", k);
        if (!(r && r.ok)) continue;
        claimed++; coins += r.reward_coins || 0;
        [r.reward_label, r.reward2_label].forEach((lb) => {
          if (!lb) return;
          got.push(lb);
          const bi = QUEST_BAG_ITEMS[lb];
          if (bi && !bagCurrent().some((it) => it.id === bi.id)) addToBag({ id: bi.id, img: bi.img, name: lb, desc: bi.desc });
        });
      }
      caMainAPI = null;   // 鏈進度變了，院長面板下次重抓
      say(claimed
        ? "回報完成！共交付 " + claimed + " 關 ✅" + (coins ? "＋" + coins + " 金幣" : "") + (got.length ? "，獲得「" + got.join("」「") + "」" : "")
        : "這些任務剛剛已經交付過了！");
      b.disabled = false;
      if (_reportSeq === seqAtClick) updateReportBtn(ov, ctx);   // 面板沒換人才重查；換了就交給新面板的 update（Codex P2）
    });
    prin.appendChild(b);
  }

  async function caMainAction(path, quest_key) {
    const t = demoToken(); if (!t) return { ok: false };
    try {
      const r = await fetch(DEMO_API + "/api/main-quests/" + path, {
        method: "POST", headers: { "Content-Type": "application/json", "Authorization": "Bearer " + t },
        body: JSON.stringify({ quest_key }),
      });
      return await r.json();
    } catch (e) { return { ok: false, error: "network" }; }
  }

  // 打王 / 競技場 / 模擬考型任務，村莊裡沒玩法可走 → demo「一鍵達成」按鈕文案
  function caActLabel(ct) {
    return ct === "boss_clear" ? "⚔️ 去挑戰禁忌森林"
      : ct === "pvp_win" ? "🏟️ 去競技場挑戰"
        : ct === "exam_pass" ? "📝 去考檢定"
          : ct === "teacher_cert" ? "🎓 去考四院檢定"
            : ct === "cert_pass" ? "📜 去考英語檢定"
              : ct === "duel_win" ? "🔮 去魔法陣對決" : "";
  }
  // demo 一鍵達成：後台灌剛好足夠的紀錄，讓這關可領獎（顆星型不走這裡，用去基礎練習）
  async function caFulfillQuest(quest_key) {
    const t = demoToken(); if (!t) return { ok: false };
    try {
      const r = await fetch(DEMO_API + "/api/demo/fulfill-quest?quest_key=" + encodeURIComponent(quest_key), {
        method: "POST", headers: { "Authorization": "Bearer " + t },
      });
      return await r.json();
    } catch (e) { return { ok: false, error: "network" }; }
  }
  // 已獲成就（主線終獎的稱號/證書），門面顯示用
  let caAwards = null;
  async function caLoadAwards() {
    const t = demoToken(); if (!t) return [];
    try {
      const r = await fetch(DEMO_API + "/api/awards", { headers: { "Authorization": "Bearer " + t } });
      const d = await r.json(); return Array.isArray(d.awards) ? d.awards : [];
    } catch (e) { return []; }
  }

  /* ── 自動補身分：直接開村莊(沒走 onboarding)時，自動建一個展示玩家，讓孔丘永遠是真資料模式 ── */
  let caProvisioned = false, caProvisioning = null;
  function ensureDemoPlayer() {
    if (demoToken()) return Promise.resolve(true);
    if (caProvisioned) return Promise.resolve(!!demoToken());
    if (!caProvisioning) caProvisioning = (async () => {
      try {
        const j = (r) => r.json();
        const uid = "demo_" + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36);
        await fetch(DEMO_API + "/api/auth", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "web", userId: uid, name: "小訪客" }) }).then(j);
        const ch = await fetch(DEMO_API + "/api/auth/child/create", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ platform: "web", platform_user_id: uid, child_name: "小訪客", grade: 2, semester: 1 }) }).then(j);
        const cid = ch && ch.child && ch.child.id;
        if (cid) {
          const sel = await fetch(DEMO_API + "/api/auth/child/select", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ platform: "web", platform_user_id: uid, child_id: cid }) }).then(j);
          if (sel && sel.token) {
            localStorage.setItem("eduarena_demo_token", sel.token);
            localStorage.setItem("eduarena_demo_uid", uid);
            localStorage.setItem("eduarena_demo_child_id", String(cid));
            await fetch(DEMO_API + "/api/demo/grant-stars?subject=chinese&pct=60", { method: "POST", headers: { "Authorization": "Bearer " + sel.token } }).then(j).catch(() => {});
          }
        }
      } catch (e) { console.warn("[demo auto-provision] 失敗，退回唯讀版:", e); }
      caProvisioned = true;
    })();
    return caProvisioning.then(() => !!demoToken());
  }
  try { ensureDemoPlayer(); } catch (e) {}   // 載入即先補，等玩家走到孔丘時通常已就緒

  /* ── 國語基礎練習：分頁挑章節（年級 → 版本 → 章節），再進去答題 ── */
  function caStars(n) { n = Math.max(0, Math.min(3, Number(n) || 0)); return "⭐".repeat(n) + "☆".repeat(3 - n); }
  function caStars(n) { n = Math.max(0, Math.min(3, Number(n) || 0)); return "⭐".repeat(n) + "☆".repeat(3 - n); }
  let caPractChs = null, caPractGrade = null, caPractSource = null;
  let caQuizHidPrin = false;   // 答題頁有沒有「動手藏過」立繪（森林/布告欄本來就藏著的不算，回選章節時不用還原）

  async function caOpenPractice(ov, sourceFilter) {
    if (sourceFilter !== undefined) caPractSource = sourceFilter || null;   // 'ai'=基礎練習(五大學院)；'uploaded'=課本(禁忌森林)；不帶參數=沿用(換一章用)
    ov.classList.remove("ca-quizpage");
    if (caQuizHidPrin) {   // 從答題頁回來：把學院模式藏掉的立繪還原（森林/布告欄 caQuizHidPrin=false 不會誤還原）
      const prin = ov.querySelector(".ao-principal"); if (prin) prin.style.display = "";
      ov.classList.remove("ao-noprincipal");
      caQuizHidPrin = false;
    }
    const t = demoToken(); if (!t) { caBubble(ov, "請先建立角色～"); return; }
    const hdr = { "Content-Type": "application/json", "Authorization": "Bearer " + t };
    const box = ov.querySelector(".ao-content");
    updateReportBtn(ov, null);
    ov.querySelector(".shop-title").textContent = caSubjConf().label + " · 選擇章節";
    box.innerHTML = `<div class="jc-empty">章節載入中…</div>`;
    let topics; try { topics = await fetch(DEMO_API + "/api/" + caSubject + "/topics", { headers: hdr }).then((r) => r.json()); } catch (e) { box.innerHTML = `<div class="jc-empty">載入失敗，請再試一次</div>`; return; }
    // 攝平所有章節，帶上年級與學期標籤；依 source 過濾(ai=基礎練習、uploaded=課本)
    const chs = [];
    (Array.isArray(topics.curriculum) ? topics.curriculum : []).forEach((g) => {
      (g.chapters || []).forEach((c) => chs.push(Object.assign({ _vol: g.volume_label || "", _grade: c.grade || g.grade }, c)));
    });
    // 禁忌森林=全題庫(課本+AI,一到六有什麼秀什麼;派派 6/10 不鎖年級)；五大學院=只 AI(非課本)
    // 注意:caPractSource 值 'uploaded' 現在是「森林模式」記號(沿用,UI 文案/按鈕靠它分流),不再代表只濾課本
    caPractChs = caPractSource === "ai" ? chs.filter((c) => c.source !== "uploaded")
               : chs;
    caPractGrade = null;
    caRenderPractice(ov);
  }

  // 渲染：年級 tabs → 該年級章節清單(依學期小標分段)。已依 source 過濾，不再有版本分頁。
  function caRenderPractice(ov) {
    const box = ov.querySelector(".ao-content");
    const chs = caPractChs || [];
    if (!chs.length) { box.innerHTML = `<div class="jc-empty">目前沒有可練習的章節</div>`; return; }
    caBubble(ov, "選年級，再挑章節練習～");

    const grades = [...new Set(chs.map((c) => c._grade))].sort((a, b) => a - b);
    if (caPractGrade == null || !grades.includes(caPractGrade)) caPractGrade = grades[0];
    const sel = chs.filter((c) => c._grade === caPractGrade);

    const gradeTabs = grades.map((gr) => `<button class="jc-tab${gr === caPractGrade ? " active" : ""}" data-g="${gr}">${gr} 年級</button>`).join("");

    let list = "", lastVol = null;
    sel.forEach((c) => {
      if (c._vol && c._vol !== lastVol) { list += `<div class="ca-navsec" style="font-size:13px;">${aoEsc(c._vol)}</div>`; lastVol = c._vol; }
      const right = `<span style="white-space:nowrap;font-size:13px;">${caStars(c.stars)}</span>`;
      if (c.unlocked) {
        list += `<button class="jc-act ca-pick" data-id="${c.id}" data-name="${aoEsc(c.name)}" style="display:flex;align-items:center;justify-content:space-between;gap:10px;width:100%;text-align:left;white-space:nowrap;margin:4px 0;padding:10px 14px;"><span style="overflow:hidden;text-overflow:ellipsis;">${aoEsc(c.name)}</span>${right}</button>`;
      } else {
        list += `<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;width:100%;white-space:nowrap;margin:4px 0;padding:10px 14px;opacity:.45;font-size:14px;">🔒 ${aoEsc(c.name)} ${right}</div>`;
      }
    });

    box.innerHTML = `
      <div class="jc-tabs ao-tabs4" style="margin-bottom:10px;flex-shrink:0;">${gradeTabs}</div>
      <div>${list || `<div class="jc-empty">這個年級沒有章節</div>`}</div>`;

    box.querySelectorAll("[data-g]").forEach((b) => b.addEventListener("click", function () {
      caPractGrade = Number(this.dataset.g); caRenderPractice(ov);
    }));
    box.querySelectorAll(".ca-pick").forEach((b) => b.addEventListener("click", function () {
      caRunPractice(ov, { id: Number(this.dataset.id), name: this.dataset.name });
    }));
  }

  /* ── 共用題目渲染（四個答題畫面共用：基礎練習/禁忌森林/魔法陣/考試）──
     處理：圖片題(image_url)、一二年級注音(bopomofo/zhuyin ruby)、字級一致 ── */
  function qZhuyin(q) { return (q && (q.bopomofo || q.zhuyin)) || null; }
  function qRuby(text, zh) {
    const s = String(text == null ? "" : text);
    if (!zh) return aoEsc(s);
    let out = "";
    for (const ch of s) out += zh[ch] ? `<ruby>${aoEsc(ch)}<rt>${aoEsc(zh[ch])}</rt></ruby>` : aoEsc(ch);
    return out;
  }
  // 題目圖片放在正式版 static(web-production)，demo 後台沒有那些檔→用正式版當圖床(img 顯示不需 CORS)
  const Q_IMG_BASE = "https://web-production-48b09.up.railway.app";
  // 題幹區＝白色題卡（圖片 + display 大字 + prompt）；模板 v2（派派 6/12）
  function qBodyHTML(q) {
    const zh = qZhuyin(q);
    let h = "";
    const rawImg = typeof q.image_url === "string" ? q.image_url.trim() : "";
    if (rawImg) { const isrc = /^https?:/i.test(rawImg) ? rawImg : (Q_IMG_BASE + rawImg); h += `<img src="${aoEsc(isrc)}" alt="題目圖" onerror="this.style.display='none'" style="max-width:100%;max-height:36vh;object-fit:contain;display:block;margin:4px auto;border-radius:8px;">`; }
    const disp = String(q.display || "").trim(), prom = String(q.prompt || "").trim();
    if (disp) {
      h += `<div style="font-size:28px;font-weight:900;line-height:1.55;margin:4px 0;color:#2f2415;">${qRuby(disp, zh)}</div>`;
      if (prom) h += `<div style="font-size:17px;line-height:1.8;margin:4px 0;color:#5a4630;">${qRuby(prom, zh)}</div>`;
    } else if (prom) {
      h += `<div style="font-size:19px;line-height:1.8;margin:4px 0;color:#5a4630;">${qRuby(prom, zh)}</div>`;
    }
    return `<div class="qt-card">${h}</div>`;
  }
  // 單一選項按鈕（A/B/C/D 圓徽章＋靠左，含注音）；cls=各畫面的選項 class（ca-choice/en-choice/ex-choice）
  function qChoiceHTML(c, q, cls, i) {
    const abc = "ABCDEFGH"[i] || "·";
    return `<button class="${cls} qt-opt" data-c="${aoEsc(c)}"><span class="qt-abc">${abc}</span><span class="qt-optxt">${qRuby(c, qZhuyin(q))}</span></button>`;
  }
  // 進度條列（取代小字題號）
  function qProgressHTML(idx, total, right) {
    const pct = Math.round((idx + 1) / Math.max(1, total) * 100);   // Codex P3：條跟題號一致（第1題就有進度）
    const tail = right ? `　${right}` : "";
    return `<div class="qt-top"><div class="qt-bar"><i style="width:${pct}%"></i></div><div class="qt-num">${idx + 1} / ${total}${tail}</div></div>`;
  }
  // 答題回饋（共用）：對=綠+蓋章；錯=紅+標正解。回傳是否答對。
  function qMarkAnswer(box, cls, btn, r) {
    box.querySelectorAll("." + cls).forEach((b) => { b.disabled = true; });
    if (r.correct) { btn.classList.add("qt-ok"); return true; }
    btn.classList.add("qt-bad");
    box.querySelectorAll("." + cls).forEach((b) => {
      if (b.dataset.c === String(r.correct_answer)) {
        b.classList.add("qt-ok");
        if (!b.querySelector(".qt-tag")) b.insertAdjacentHTML("beforeend", `<span class="qt-tag">正確答案</span>`);
      }
    });
    return false;
  }

  // 進入某一章節答題（章節由玩家在 caOpenPractice 挑）
  async function caRunPractice(ov, pick) {
    // 開始時就鎖定來源：caPractSource 是共用狀態，結算才讀的話，中途關掉換開另一邊會用錯畫面
    const isForest = caPractSource === "uploaded";
    const t = demoToken(); if (!t) { caBubble(ov, "請先建立角色～"); return; }
    const hdr = { "Content-Type": "application/json", "Authorization": "Bearer " + t };
    const box = ov.querySelector(".ao-content");
    // 題目獨立成整頁：藏立繪+外層分頁，題目佔滿面板（派派 6/12：題目不要擠在立繪下方）
    const prin = ov.querySelector(".ao-principal");
    if (prin && prin.style.display !== "none") { caQuizHidPrin = true; prin.style.display = "none"; ov.classList.add("ao-noprincipal"); }
    ov.classList.add("ca-quizpage");
    ov.querySelector(".shop-title").textContent = caSubjConf().label + " · 練習";
    box.innerHTML = `<div class="jc-empty">題目載入中…</div>`;
    let sess; try { sess = await fetch(DEMO_API + "/api/" + caSubject + "/session/start", { method: "POST", headers: hdr, body: JSON.stringify({ topic_id: pick.id, game: caSubjConf().game }) }).then((r) => r.json()); } catch (e) { box.innerHTML = `<div class="jc-empty">開始失敗</div>`; return; }
    if (sess.error || !(sess.questions || []).length) { box.innerHTML = `<div class="jc-empty">這個章節暫無題目（${aoEsc(sess.error || "")}）<div style="margin-top:14px;"><button class="jc-act ca-backpick">← 換一章</button></div></div>`; const bb = box.querySelector(".ca-backpick"); if (bb) bb.addEventListener("click", () => caOpenPractice(ov)); return; }
    caBubble(ov, isForest ? `來練習「${aoEsc(pick.name)}」吧！` : `來練習「${aoEsc(pick.name)}」吧！答對越多，星星越多～`);
    const qs = sess.questions; let idx = 0, correct = 0;
    const renderQ = () => {
      const q = qs[idx];
      const choices = (q.choices || []).map((c, ci) => qChoiceHTML(c, q, "ca-choice", ci)).join("");
      box.innerHTML = `<div style="padding:6px 4px;">
        ${qProgressHTML(idx, qs.length, `答對 ${correct}`)}
        ${qBodyHTML(q)}
        <div class="ca-choices qt-opts">${choices}</div>
        <div class="ca-fb qt-stamp"></div>
        <div class="ca-nextwrap"></div></div>`;
      const goNext = () => { idx++; (idx < qs.length) ? renderQ() : finish(); };
      box.querySelectorAll(".ca-choice").forEach((btn) => btn.addEventListener("click", async function () {
        box.querySelectorAll(".ca-choice").forEach((b) => { b.disabled = true; });
        const ans = this.dataset.c; let r;
        try { r = await fetch(DEMO_API + "/api/" + caSubject + "/session/answer", { method: "POST", headers: hdr, body: JSON.stringify({ session_id: sess.session_id, question_id: q.id, answer: ans, time_ms: 0 }) }).then((x) => x.json()); } catch (e) { r = {}; }
        const fb = box.querySelector(".ca-fb");
        if (qMarkAnswer(box, "ca-choice", this, r)) {
          // 答對：快節奏自動下一題
          correct++; fb.textContent = "✓ 答對了！"; fb.style.color = "#3a8f3a";
          setTimeout(goNext, 900);
        } else {
          // 答錯：停下來看正解，按了「下一題」才走（派派 6/12 模板：錯題要看懂再走）
          fb.textContent = "✗ 答錯了，看一下正確答案"; fb.style.color = "#c0392b";
          const last = idx + 1 >= qs.length;
          box.querySelector(".ca-nextwrap").innerHTML = `<button class="qt-next ca-next">${last ? "看結果 →" : "下一題 →"}</button>`;
          box.querySelector(".ca-next").addEventListener("click", goNext);
        }
      }));
    };
    const finish = async () => {
      box.innerHTML = `<div class="jc-empty">結算中…</div>`;
      let end; try { end = await fetch(DEMO_API + "/api/" + caSubject + "/session/end", { method: "POST", headers: hdr, body: JSON.stringify({ session_id: sess.session_id }) }).then((r) => r.json()); } catch (e) { end = {}; }
      const stars = Number(end.stars || 0);
      caMainAPI = await caLoadMainAPI();   // 刷新主線進度（星星已累積）
      // 森林(課本)不搜集星星：結尾不顯示星星與主線文案；也沒有院長可回(回去會跳學院總覽)→改「離開」
      box.innerHTML = `<div style="text-align:center;padding:22px 10px;">
        <div style="font-size:20px;font-weight:900;color:#3a2c1a;">練習完成！</div>
        <div style="font-size:15px;margin:10px 0;color:#5a4630;">答對 ${correct} / ${qs.length} 題</div>
        ${isForest ? "" : `<div style="font-size:34px;margin:6px 0;">${"⭐".repeat(stars)}${"☆".repeat(Math.max(0, 3 - stars))}</div>
        <div style="font-size:13px;color:#8a6d3b;">星星已累積到${caSubjConf().label}進度，回去找${caDeanName()}領獎吧！</div>`}
        <div style="margin-top:16px;display:flex;gap:10px;justify-content:center;flex-wrap:nowrap;">
          <button class="jc-act ca-backpick">📖 再選章節</button>
          ${isForest ? `<button class="jc-act ca-leave">← 離開</button>` : `<button class="jc-act ca-back">← 回到${caDeanName()}</button>`}</div></div>`;
      const bk = box.querySelector(".ca-back");
      if (bk) bk.addEventListener("click", () => { caTab = "overview"; caRenderAcademy(ov); });
      const lv = box.querySelector(".ca-leave");
      if (lv) lv.addEventListener("click", () => caClose());
      box.querySelector(".ca-backpick").addEventListener("click", () => caOpenPractice(ov));
    };
    renderQ();
  }

  /* ── NPC 任務面板：單一師長立繪 + 對白 + 任務領取 ── */
  function caRenderNpc(ov) {
    const c = CA_CONTENT || {};
    const n = (c.npcs || {})[caNpcId];
    updateReportBtn(ov, { chain: caSubject, giver: caNpcId });
    if (!n) {                                  // 未知 npcId：清空避免殘留上一位師長的任務卡
      caBubble(ov, "找不到這位師長。");
      ov.querySelector(".ao-tabs4").innerHTML = "";
      ov.querySelector(".ao-content").innerHTML = `<div class="jc-empty">找不到這位師長</div>`;
      return;
    }
    ov.querySelector(".shop-title").textContent = (c.academy && c.academy.title) || "國語學院";
    caSetPrincipal(ov, n.img, "👤 " + (n.title || "") + (n.name ? " " + n.name : ""));
    const lines = Array.isArray(n.lines) ? n.lines : [];
    if (typeof caTab !== "number" || caTab >= lines.length) caTab = 0;
    const tabs = ov.querySelector(".ao-tabs4");
    tabs.innerHTML = lines.map((l, i) =>
      `<button class="jc-tab${i === caTab ? " active" : ""}" data-i="${i}">${aoEsc(l.tab)}</button>`).join("");
    tabs.querySelectorAll(".jc-tab").forEach((b) =>
      b.addEventListener("click", () => { caTab = +b.dataset.i; caRenderNpc(ov); }));
    const ln = lines[caTab] || { quests: [] };
    caBubble(ov, ln.intro || "");
    const box = ov.querySelector(".ao-content");
    // 順序解鎖：主線(chain=main)1→20跨NPC一條鏈、支線(side)各自；進度存 localStorage
    const chain = ln.chain === "side" ? "side" : "main";
    const pkey = "village_" + caSubject + "_" + chain;
    let prog = 0;
    try { prog = Math.max(0, parseInt(localStorage.getItem(pkey) || "0", 10) || 0); } catch (e) { prog = 0; }
    const base = Number(ln.seq_start) || 1;

    // 沒走 onboarding 直接進村莊 → 先自動補身分再讀真後台
    if (chain === "main" && !demoToken() && !caProvisioned) {
      box.innerHTML = `<div class="jc-empty">任務載入中…</div>`;
      ensureDemoPlayer().then(() => caRenderNpc(ov));
      return;
    }
    // ★ 主線 + 有通行證 → 讀真後台（接取/領獎/進度都走 API）
    if (chain === "main" && demoToken()) {
      if (!caMainAPI) {
        box.innerHTML = `<div class="jc-empty">任務載入中…</div>`;
        caLoadMainAPI().then((m) => { caMainAPI = m; caRenderNpc(ov); });
        return;
      }
      box.innerHTML = (ln.quests || []).map((q, qi) => {
        const seq = base + qi;
        const aq = caMainAPI[seq];
        const status = aq ? aq.status : "locked";  // available/active/completed/locked
        const cls = status === "completed" ? "done" : (status === "locked" ? "locked" : "active");
        let btn;
        if (status === "completed") btn = `<button class="jc-act done" disabled>✓ 已完成</button>`;
        else if (status === "available") btn = `<button class="jc-act ca-accept">接取</button>`;
        else if (status === "active" && aq && aq.can_claim) btn = `<button class="jc-act ca-claim">領取</button>`;
        else if (status === "active") { const lbl = caActLabel(aq.cond_type); btn = lbl ? `<button class="jc-act ca-fulfill">${lbl}</button>` : `<span class="ao-quest-lock">進行中 ${aq.current}/${aq.target}</span>`; }
        else btn = `<span class="ao-quest-lock">🔒 未解鎖</span>`;
        const progTxt = (aq && status !== "completed" && status !== "locked") ? `${aq.current}/${aq.target}` : "";
        return `<div class="ao-quest ${cls}" data-key="${aq ? aoEsc(aq.key) : ""}">
          <div class="ao-quest-ic">${status === "locked" ? "🔒" : aoEsc(q.icon || "📜")}</div>
          <div class="ao-quest-body">
            <div class="ao-quest-title"><span class="ao-quest-seq">${seq}</span>${aoEsc(q.title)}</div>
            <div class="ao-quest-desc">${aoEsc(q.desc)}</div>
            ${q.dialog ? `<div class="ao-quest-dialog">「${aoEsc(q.dialog)}」</div>` : ""}
            <div class="ao-quest-foot"><span class="ao-quest-reward">🎁 ${aoEsc(q.reward)}</span>${progTxt ? `<span class="ao-quest-prog">${progTxt}</span>` : ""}</div>
          </div>
          ${btn}
        </div>`;
      }).join("") || `<div class="jc-empty">目前沒有任務</div>`;
      const refresh = async () => { caMainAPI = await caLoadMainAPI(); caRenderNpc(ov); };
      box.querySelectorAll(".ca-accept").forEach((b) => b.addEventListener("click", async function (e) {
        e.stopPropagation(); this.disabled = true;
        const key = this.closest(".ao-quest").dataset.key;
        await caMainAction("accept", key); await refresh();
      }));
      box.querySelectorAll(".ca-fulfill").forEach((b) => b.addEventListener("click", async function (e) {
        e.stopPropagation(); this.disabled = true; this.textContent = "完成中…";
        const key = this.closest(".ao-quest").dataset.key;
        await caFulfillQuest(key); await refresh();
      }));
      box.querySelectorAll(".ca-claim").forEach((b) => b.addEventListener("click", async function (e) {
        e.stopPropagation(); this.disabled = true;
        const key = this.closest(".ao-quest").dataset.key;
        const r = await caMainAction("claim", key);
        if (r && r.ok) caBubble(ov, "獎勵入帳！" + (r.reward_label ? ("獲得「" + r.reward_label + "」") : ("+" + (r.reward_coins || 0) + " 金幣")));
        else if (r && r.error === "condition_not_met") caBubble(ov, "還沒達成條件唷～再去努力一下！");
        await refresh();
      }));
      return;
    }

    box.innerHTML = (ln.quests || []).map((q, qi) => {
      const seq = base + qi;
      const st = seq <= prog ? "done" : (seq === prog + 1 ? "active" : "locked");
      const btn = st === "done" ? `<button class="jc-act done" disabled>✓ 已完成</button>`
        : st === "active" ? `<button class="jc-act ao-quest-claim">領取</button>`
        : `<span class="ao-quest-lock">🔒 未解鎖</span>`;
      return `<div class="ao-quest ${st}" data-qi="${qi}" data-seq="${seq}">
        <div class="ao-quest-ic">${st === "locked" ? "🔒" : aoEsc(q.icon || "📜")}</div>
        <div class="ao-quest-body">
          <div class="ao-quest-title"><span class="ao-quest-seq">${seq}</span>${aoEsc(q.title)}</div>
          <div class="ao-quest-desc">${aoEsc(q.desc)}</div>
          ${q.dialog ? `<div class="ao-quest-dialog">「${aoEsc(q.dialog)}」</div>` : ""}
          <div class="ao-quest-foot"><span class="ao-quest-reward">🎁 ${aoEsc(q.reward)}</span>${q.progress ? `<span class="ao-quest-prog">${aoEsc(q.progress)}</span>` : ""}</div>
        </div>
        ${btn}
      </div>`;
    }).join("") || `<div class="jc-empty">目前沒有任務</div>`;
    box.querySelectorAll(".ao-quest-claim").forEach((b) => b.addEventListener("click", function (e) {
      e.stopPropagation();
      const card = this.closest(".ao-quest");
      const seq = card ? +card.dataset.seq : 0;
      const q = card ? (ln.quests || [])[+card.dataset.qi] : null;
      try { localStorage.setItem(pkey, String(seq)); } catch (e2) {}
      // 支線道具獎勵：真的放進背包＋彈窗秀圖（主線走真後台不進這裡的入包邏輯）
      const got = (chain === "side" && q) ? sideRewardItems(q.reward) : [];
      const granted = got.filter(sideItemGrant);   // 滿包 addToBag 回 false，沒進包的不能騙玩家說獲得（Codex P2）
      caBubble(ov, (q && q.dialog) ? q.dialog : "好！這份獎勵你當之無愧。");
      caRenderNpc(ov);   // 重渲染：解鎖下一關
      if (granted.length) caShowItemGet(ov, granted);
      if (granted.length < got.length) caBubble(ov, "背包滿了，道具裝不下！整理出空位後重新進入遊戲，會自動補發給你。");
    }));
  }

  /* ── 人物簡介卡（朱熹等尚無任務的師長，走近顯示簡介+任務籌備中）── */
  function caRenderIntro(ov, figName) {
    updateReportBtn(ov, null);
    const c = CA_CONTENT || {};
    const figs = Array.isArray(c.figures) ? c.figures : [];
    const f = figs.find((x) => x.name === figName);
    ov.querySelector(".shop-title").textContent = (c.academy && c.academy.title) || "國語學院";
    ov.querySelector(".ao-tabs4").innerHTML = "";
    if (!f) {
      caBubble(ov, "找不到這位師長。");
      ov.querySelector(".ao-owner").textContent = "";
      ov.querySelector(".ao-content").innerHTML = `<div class="jc-empty">找不到這位師長</div>`;
      return;
    }
    caSetPrincipal(ov, f.img, "👤 " + (f.badge || "") + " " + f.name);
    caBubble(ov, f.name + "（" + (f.era || "") + "） " + (f.works || ""));
    ov.querySelector(".ao-content").innerHTML = `
      <div class="ca-intro">
        <div class="ca-intro-desc">${aoEsc(f.desc || "")}</div>
        <div class="ca-intro-soon">📜 任務籌備中，敬請期待</div>
      </div>`;
  }
  async function openNpcIntro(figName, onClose) {
    onCloseCb = onClose || null;
    const ov = caBuildOverlay();
    caMode = "intro";
    try { await caLoad(); }
    catch (e) { console.warn("npc intro 載入失敗", e); }
    caRenderIntro(ov, figName);
    ov.classList.add("open");
  }

  // 禁忌森林：直接進該科「課本練習」（A/B 版），重用學院 overlay 與練習選擇器
  async function openForestPractice(onClose) {
    onCloseCb = onClose || null;
    const ov = caBuildOverlay();
    caMode = "academy";
    const prin = ov.querySelector(".ao-principal"); if (prin) prin.style.display = "none";   // 森林練習不需院長立繪
    ov.classList.add("ao-noprincipal");   // 手機版讓 .ao-right 補回標題列間距(沒立繪撐空間)
    ov.classList.add("open");
    try { await ensureDemoPlayer(); } catch (e) {}
    await caOpenPractice(ov, 'uploaded');
    const tt = ov.querySelector(".shop-title"); if (tt) tt.textContent = caSubjConf().label + "禁忌森林 · 課本練習";
  }

  async function openChineseAcademy(onClose) {
    onCloseCb = onClose || null;
    const ov = caBuildOverlay();
    caMode = "academy"; caTab = "overview";
    try { await caLoad(); }
    catch (e) { console.warn("chinese academy 載入失敗", e); }
    caRenderAcademy(ov);
    ov.classList.add("open");
  }
  async function openNpcQuest(npcId, onClose) {
    onCloseCb = onClose || null;
    const ov = caBuildOverlay();
    caMode = "npc"; caNpcId = npcId; caTab = 0;
    try { await caLoad(); }
    catch (e) { console.warn("npc quest 載入失敗", e); }
    caRenderNpc(ov);
    ov.classList.add("open");
  }
  function caClose() {
    const ov = document.getElementById("ca-overlay");
    if (ov) {
      ov.classList.remove("open"); ov.classList.remove("ca-quizpage");
      const ig = ov.querySelector(".ca-itemget"); if (ig) ig.remove();   // 獲得道具彈窗別殘留到下次開
    }
    caQuizHidPrin = false;   // 答題中直接關閉：旗標歸零，免得下次開森林/布告欄被誤還原立繪
    release();
  }
  window.openChineseAcademy = openChineseAcademy;
  window.openNpcQuest = openNpcQuest;

  /* ───────────────────── 英文學院 · 魔法陣（樣板：入口 + 第一層）───────────────────── */
  // 入魔師長資料（魔法陣每層一位；第 5 層為魔王汀其假扮院長）
  const EN_NPC = {
    andersen: {
      name: "安徒生", wake: "清醒的安徒生", layer: 1, grade: 1,
      darkLine: "嘿嘿……黑暗的力量真是舒服。想救我？先在答題對決中勝過我吧！",
      wakeLine: "謝謝你淨化了我！我終於清醒了……前往下一層，救救其他師長吧！",
    },
    hemingway: {
      name: "海明威", wake: "清醒的海明威", layer: 2, grade: 2,
      darkLine: "黑暗讓我的文字更冷酷。哼，用你的英語贏過我再說吧！",
      wakeLine: "你贏了，乾淨俐落。謝謝你喚醒我——再深處還有同伴等著你。",
    },
    hugo: {
      name: "雨果", wake: "清醒的雨果", layer: 3, grade: 3,
      darkLine: "悲慘世界？現在輪到你嚐嚐絕望了！答得出來就試試看！",
      wakeLine: "正義終究戰勝了黑暗。謝謝你，孩子，繼續前進吧！",
    },
    milton: {
      name: "約翰彌爾頓", wake: "清醒的約翰彌爾頓", layer: 4, grade: 4,
      darkLine: "失樂園……你也將墜入其中。除非你能在答題中勝過我！",
      wakeLine: "光明重返樂園。最深處的魔王正等著你——小心，他假扮成院長。",
    },
    tinch: {
      name: "汀其", wake: "真正的院長已歸位", layer: 5, grade: 6, boss: true, last: true,
      darkLine: "哈哈哈！我才是這座魔法陣真正的主人！區區學生，也想阻止我？放馬過來！",
      wakeLine: "可惡……被你看穿了。魔王汀其被擊退，英文學院的光輝完全恢復了！",
    },
  };
  let enOnClose = null;
  function enKey(id) { return "village_en_purify_" + id; }
  function enIsPurified(id) { try { return !!localStorage.getItem(enKey(id)); } catch (e) { return false; } }
  function enSetPurified(id) { try { localStorage.setItem(enKey(id), "1"); } catch (e) {} }
  // 3 勝才淨化（pptx v8 P76-84：取得勝利三次）；本機計數做畫面，後端 en_duel_win 紀錄做主線任務計數
  const EN_WINS_NEED = 3;
  function enWinCount(id) { try { return Number(localStorage.getItem("village_en_wins_" + id)) || 0; } catch (e) { return 0; } }
  function enAddWin(id) { const n = enWinCount(id) + 1; try { localStorage.setItem("village_en_wins_" + id, String(n)); } catch (e) {} return n; }
  function enReportWin(id) {   // 回報後端一場真實勝利（fire-and-forget，沒 token 就略過）
    const t = demoToken(); if (!t) return;
    try { fetch(DEMO_API + "/api/demo/duel-win?npc=" + encodeURIComponent(id), { method: "POST", headers: { "Authorization": "Bearer " + t } }); } catch (e) {}
  }
  function enBuildOverlay() {
    let ov = document.getElementById("en-overlay");
    if (ov) return ov;
    ov = el("div"); ov.id = "en-overlay";
    ov.innerHTML = `
      <div class="shop-panel ao-panel">
        <div class="shop-title">英文學院</div>
        <button class="shop-close" aria-label="關閉">×</button>
        <div class="ao-principal">
          <div class="ao-bubble"></div>
          <img class="ao-principal-img" src="shakespeare_front.webp?v=1" alt="英文學院" draggable="false">
          <div class="ao-owner"></div>
        </div>
        <div class="ao-right"><div class="jc-content ao-content en-content"></div></div>
      </div>`;
    document.body.appendChild(ov);
    ov.querySelector(".shop-close").addEventListener("click", enClose);
    ov.addEventListener("click", (e) => { if (e.target === ov) enClose(); });
    attachReportBtn(ov);
    return ov;
  }
  function enClose() {
    const ov = document.getElementById("en-overlay");
    if (ov) ov.classList.remove("open");
    release();
  }
  function enFace(ov, img, bubble, owner) {
    ov.querySelector(".ao-principal-img").src = img + "?v=1";
    ov.querySelector(".ao-bubble").textContent = bubble || "";
    ov.querySelector(".ao-owner").textContent = owner || "";
  }

  // 入口：莎士比亞院長 → 布告欄(基礎練習) + 進入魔法陣第一層
  async function enOpenEntrance(onClose) {
    onCloseCb = onClose || null; enOnClose = onClose || null;
    const ov = enBuildOverlay();
    enFace(ov, "shakespeare_front.webp", "歡迎來到英文學院！我是院長莎士比亞。魔法陣中的師長們被黑暗力量入魔了，需要你逐層淨化他們。", "👑 英文學院 · 院長 莎士比亞");
    updateReportBtn(ov, { chain: "english", giver: "shakespeare" });
    ov.querySelector(".shop-title").textContent = "英文學院";
    ov.querySelector(".en-content").innerHTML = `
      <div style="font-size:13px;color:#8a6d3b;line-height:1.7;margin-bottom:12px;">
        🔮 <b>魔法陣共五層</b>，每層有一位入魔的師長。<br>
        答題對決勝利三場，就能淨化他、開啟下一層。<br>
        <span style="opacity:.7;">（需先完成國、數、自、社四大學院的主線任務）</span>
      </div>
      <div style="display:flex;flex-direction:column;gap:10px;">
        <button class="jc-act en-board" style="width:100%;">📋 英語基礎練習（布告欄）</button>
        <button class="jc-act en-main" style="width:100%;">📜 主線任務（空蕩蕩的學院）</button>
        <button class="jc-act en-enter" style="width:100%;background:linear-gradient(135deg,#7b4dd8,#a06bf0);color:#fff;">🔮 進入魔法陣</button>
      </div>`;
    ov.classList.add("open");
    ov.querySelector(".en-board").addEventListener("click", () => {
      ov.classList.remove("open");          // 收起入口、保留 modal 鎖，去開練習面板
      enOpenBoard(enOnClose);
    });
    ov.querySelector(".en-main").addEventListener("click", () => enOpenMainQuests());
    ov.querySelector(".en-enter").addEventListener("click", () => enOpenGate());
  }

  // 主線任務(一) 空蕩蕩的學院：english_main 鏈（pptx 第8版 P74），讀真後台接取/進度/領獎
  async function enOpenMainQuests() {
    const ov = enBuildOverlay();
    enFace(ov, "shakespeare_front.webp", "拜託你了，幫我解開學院空蕩蕩的謎團……", "👑 英文學院 · 院長 莎士比亞");
    updateReportBtn(ov, { chain: "english", giver: "shakespeare" });
    ov.querySelector(".shop-title").textContent = "英語主線 · 空蕩蕩的學院";
    const box = ov.querySelector(".en-content");
    box.innerHTML = `<div class="jc-empty">任務載入中…</div>`;
    ov.classList.add("open");
    if (!demoToken()) await ensureDemoPlayer();
    caSubject = "english";
    const render = async () => {
      const by = await caLoadMainAPI();
      const seqs = Object.keys(by).map(Number).sort((a, b) => a - b);
      if (!seqs.length) { box.innerHTML = `<div class="jc-empty">任務載入失敗，請再試一次</div>`; return; }
      let rows = "";
      seqs.forEach((s) => {
        const aq = by[s];
        const stt = aq.status;
        let right;
        if (stt === "completed") right = `<span class="ca-navq-st" style="color:#3a8f3a;font-weight:800">✓ 已完成</span>`;
        else if (stt === "available") right = `<button class="jc-act ca-accept" data-key="${aoEsc(aq.key)}">接取</button>`;
        else if (stt === "active" && aq.can_claim) right = `<button class="jc-act ca-claim" data-key="${aoEsc(aq.key)}">領取</button>`;
        else if (stt === "active") {
          const lbl = caActLabel(aq.cond_type);
          right = `<span class="ca-navq-st" style="color:#c98a2b;font-weight:700">進行中 ${aq.current}/${aq.target}</span>`
            + (lbl ? ` <button class="jc-act ca-fulfill" data-key="${aoEsc(aq.key)}">${lbl}</button>` : "");
        } else right = `<span class="ca-navq-st" style="opacity:.45">🔒</span>`;
        const kindWord = (k) => k === "title" ? "稱號" : k === "card" ? "圖鑑" : "道具";
        let gift = aq.reward_label
          ? `${kindWord(aq.reward_kind)}「${aoEsc(aq.reward_label)}」${aq.reward_coins ? "＋" + aq.reward_coins + " 金幣" : ""}`
          : (aq.reward_coins ? aq.reward_coins + " 金幣" : "—");
        if (aq.reward2_label) gift += `＋${kindWord(aq.reward2_kind)}「${aoEsc(aq.reward2_label)}」`;
        rows += `<div class="ca-navq"><span class="ca-navq-ic">${stt === "locked" ? "🔒" : "📜"}</span><span class="ca-navq-t">${aoEsc(aq.title)}</span><span class="ca-navq-r">🎁 ${gift}</span>${right}</div>`;
      });
      box.innerHTML = `<div class="ca-navgroup">${rows}</div>`;
      // 對白泡泡＝目前進行中（沒有就下一個可接取）那關的任務內文
      const all = seqs.map((s) => by[s]);
      const cur = all.find((q) => q.status === "active") || all.find((q) => q.status === "available");
      if (cur && cur.intro) enFace(ov, "shakespeare_front.webp", cur.intro, "👑 院長 莎士比亞");
      box.querySelectorAll(".ca-accept").forEach((b) => b.addEventListener("click", async function () {
        this.disabled = true; await caMainAction("accept", this.dataset.key); await render();
      }));
      box.querySelectorAll(".ca-fulfill").forEach((b) => b.addEventListener("click", async function () {
        this.disabled = true; this.textContent = "完成中…"; await caFulfillQuest(this.dataset.key); await render();
      }));
      box.querySelectorAll(".ca-claim").forEach((b) => b.addEventListener("click", async function () {
        this.disabled = true;
        const r = await caMainAction("claim", this.dataset.key);
        if (r && r.ok) {
          if (r.reward_label === "魔法陣傳送石" && !bagCurrent().some((it) => it.id === "stone_teleport")) {
            addToBag({ id: "stone_teleport", img: "../assets/images/jobtools/stone_teleport.png",
                       name: "魔法陣傳送石", desc: "英語學院主線任務道具：安全傳送進出魔法陣的奇石。" });
          }
          if (r.reward_label === "封印鑰匙" && !bagCurrent().some((it) => it.id === "key_seal")) {
            addToBag({ id: "key_seal", img: "../assets/images/jobtools/key_seal.png",
                       name: "封印鑰匙", desc: "鎮魔塔封印的一部分。從魔王汀其手中奪回的關鍵道具。" });
          }
          let gotLine = r.reward_label ? "獲得「" + r.reward_label + "」" : "";
          if (r.reward2_label) gotLine += "＋「" + r.reward2_label + "」";
          enFace(ov, "shakespeare_front.webp",
            "獎勵入帳！" + (gotLine ? gotLine + "＋" + (r.reward_coins || 0) + " 金幣" : "+" + (r.reward_coins || 0) + " 金幣"),
            "👑 院長 莎士比亞");
        } else if (r && r.error === "condition_not_met") {
          enFace(ov, "shakespeare_front.webp", "還沒達成條件唷～", "👑 院長 莎士比亞");
        }
        await render();
      }));
    };
    await render();
  }

  // 解鎖門檻面板（軟門檻）：讀真實進度顯示，demo 一律可試玩直接進
  async function enOpenGate() {
    const ov = enBuildOverlay();
    enFace(ov, "shakespeare_front.webp", "進入魔法陣前，先看看你的修行進度吧。", "🔮 魔法陣 · 解鎖條件");
    updateReportBtn(ov, null);
    ov.querySelector(".shop-title").textContent = "魔法陣 · 解鎖條件";
    const box = ov.querySelector(".en-content");
    box.innerHTML = `<div class="jc-empty">讀取進度中…</div>`;
    ov.classList.add("open");
    // 門檻＝四大學院主線任務全部完成（pptx v8 P73）；讀四條鏈的真實完成數，demo 照舊可直接試玩
    const GATE_SUBJ = [
      { key: "chinese", ic: "📖", label: "國語學院主線任務" },
      { key: "math", ic: "🔢", label: "數學學院主線任務" },
      { key: "science", ic: "🔬", label: "自然學院主線任務" },
      { key: "social", ic: "🏛️", label: "社會學院主線任務" },
    ];
    const t = demoToken();
    const reqs = await Promise.all(GATE_SUBJ.map(async (s) => {
      let done = 0, total = 20;
      if (t) {
        try {
          const d = await fetch(DEMO_API + "/api/main-quests?chain=" + s.key + "_main",
            { headers: { "Authorization": "Bearer " + t } }).then((r) => r.json());
          const qs = (d && d.quests) || [];
          if (qs.length) total = qs.length;
          done = qs.filter((q) => q.status === "completed").length;
        } catch (e) {}
      }
      return { ic: s.ic, label: s.label, cur: done, target: total };
    }));
    const allMet = reqs.every((r) => r.cur >= r.target);
    const rows = reqs.map((r) => {
      const ok = r.cur >= r.target;
      return `<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:9px 12px;margin:5px 0;border-radius:10px;background:${ok ? "#e7f6e7" : "#f6efe2"};">
        <span style="font-size:14px;color:#5a4630;">${r.ic} ${r.label}</span>
        <span style="font-size:14px;font-weight:800;color:${ok ? "#3a8f3a" : "#c98a2b"};white-space:nowrap;">${ok ? "✅ 達成" : r.cur + " / " + r.target}</span>
      </div>`;
    }).join("");
    box.innerHTML = `
      <div style="padding:4px 2px;">
        ${rows}
        <div style="text-align:center;margin-top:10px;font-size:13px;color:${allMet ? "#3a8f3a" : "#8a6d3b"};">
          ${allMet ? "✅ 條件已達成，魔法陣為你開啟！" : "（demo 展示：條件未達成也可直接試玩）"}
        </div>
        <div style="margin-top:14px;text-align:center;">
          <button class="jc-act en-go" style="width:auto;background:linear-gradient(135deg,#7b4dd8,#a06bf0);color:#fff;">${allMet ? "🔮 正式進入魔法陣" : "🎮 demo 試玩直接進入"}</button>
        </div>
      </div>`;
    box.querySelector(".en-go").addEventListener("click", () => {
      enClose();
      if (window.__exploreGoMap) window.__exploreGoMap("magic_layer1", { x: 0.5, y: 0.86 });
    });
  }

  // 布告欄：英語基礎練習（重用學院練習面板，AI 生來源）
  async function enOpenBoard(onClose) {
    onCloseCb = onClose || null;
    caSubject = "english"; caMainAPI = null; caAwards = null;
    const ov = caBuildOverlay();
    const prin = ov.querySelector(".ao-principal"); if (prin) prin.style.display = "none";
    ov.classList.add("ao-noprincipal");   // 手機版讓 .ao-right 補回標題列間距(沒立繪撐空間)
    ov.classList.add("open");
    try { await caLoad(); } catch (e) {}          // 載 english_academy.json（讓「回到院長」能正確渲染）
    try { await ensureDemoPlayer(); } catch (e) {}
    await caOpenPractice(ov, "ai");
    const tt = ov.querySelector(".shop-title"); if (tt) tt.textContent = "英語基礎練習 · 布告欄";
  }

  // 已淨化的師長：清醒對話
  function enOpenCleared(npcId, onClose) {
    onCloseCb = onClose || null;
    const d = EN_NPC[npcId] || { wake: "清醒的師長", wakeLine: "謝謝你淨化了我！" };
    const ov = enBuildOverlay();
    enFace(ov, npcId + "_front.webp", d.wakeLine, "✨ " + d.wake);
    updateReportBtn(ov, { chain: "english", giver: npcId + "_wake" });
    ov.querySelector(".shop-title").textContent = "魔法陣 · 第 " + (d.layer || 1) + " 層";
    const hint = d.last
      ? "🎉 你已淨化全部師長，通關英文學院魔法陣！"
      : "封印之門已開啟，走到上方的門即可前往下一層。";
    ov.querySelector(".en-content").innerHTML = `
      <div style="text-align:center;padding:18px 8px;">
        <div style="font-size:42px;">${d.last ? "🏆" : "✨"}</div>
        <div style="font-size:16px;font-weight:800;color:#3a2c1a;margin:8px 0;">${aoEsc(d.wake)}</div>
        <div style="font-size:13px;color:#8a6d3b;">${aoEsc(hint)}</div>
        <div style="margin-top:16px;display:flex;gap:10px;justify-content:center;">
          <button class="jc-act en-spar" style="width:auto;">⚔️ 再切磋一場</button>
          <button class="jc-act en-x" style="width:auto;">離開</button></div>
      </div>`;
    ov.classList.add("open");
    // 再切磋：淨化後仍可重打（勝場照樣回報後端）。主線(二)~(六)接取後靠這個補勝場，
    // 不會因為「先淨化才接任務」或舊玩家 1 勝淨化而卡死（Codex P1）
    ov.querySelector(".en-spar").addEventListener("click", () => enRunDuel(ov, npcId, d));
    ov.querySelector(".en-x").addEventListener("click", enClose);
  }

  // 答題對決（PK）：勝過入魔師長就淨化他
  async function enOpenDuel(npcId, onClose) {
    onCloseCb = onClose || null;
    const d = EN_NPC[npcId] || { name: npcId, wake: "清醒的" + npcId, layer: 1, darkLine: "想救我？先勝過我！", wakeLine: "謝謝你淨化了我！" };
    if (enIsPurified(npcId)) { enOpenCleared(npcId, onClose); return; }
    const ov = enBuildOverlay();
    enFace(ov, npcId + "_dark.webp", d.darkLine, (d.boss ? "😈 魔王 " : "👹 入魔的 ") + d.name);
    updateReportBtn(ov, null);
    ov.querySelector(".shop-title").textContent = "魔法陣 · 第 " + d.layer + " 層" + (d.boss ? "（魔王）" : "");
    ov.classList.add("open");
    const box = ov.querySelector(".en-content");
    box.innerHTML = `
      <div style="text-align:center;padding:14px 8px;">
        <div style="font-size:14px;color:#5a4630;line-height:1.7;margin-bottom:14px;">⚔️ 用英語答題對決他（答對六成以上算贏一場）。<br>累計勝利 ${EN_WINS_NEED} 場即可${d.boss ? "擊退魔王、通關魔法陣" : "淨化他、開啟下一層"}！${enWinCount(npcId) ? `<br>目前 ${Math.min(enWinCount(npcId), EN_WINS_NEED)}/${EN_WINS_NEED} 勝` : ""}</div>
        <button class="jc-act en-start" style="width:auto;background:linear-gradient(135deg,#7b4dd8,#a06bf0);color:#fff;">⚔️ ${d.boss ? "開始魔王決戰" : "開始淨化對決"}</button>
      </div>`;
    box.querySelector(".en-start").addEventListener("click", () => enRunDuel(ov, npcId, d));
  }

  async function enRunDuel(ov, npcId, d) {
    const box = ov.querySelector(".en-content");
    box.innerHTML = `<div class="jc-empty">準備對決中…</div>`;
    const t = demoToken(); if (!t) { try { await ensureDemoPlayer(); } catch (e) {} }
    const hdr = { "Content-Type": "application/json", "Authorization": "Bearer " + demoToken() };
    // 取英語章節（AI 生來源），挑一個可玩的章節當對決題庫
    let topics; try { topics = await fetch(DEMO_API + "/api/english/topics", { headers: hdr }).then((r) => r.json()); } catch (e) { box.innerHTML = `<div class="jc-empty">題庫載入失敗，請再試一次</div>`; return; }
    const chs = [];
    (Array.isArray(topics.curriculum) ? topics.curriculum : []).forEach((g) => (g.chapters || []).forEach((c) => chs.push(Object.assign({ _grade: c.grade || g.grade || 1 }, c))));
    // 候選：英語 ai 題庫，排除「聽力」章(要聽音檔、選項全中文，不適合文字對決)
    const hasCJK = (s) => /[㐀-䶿一-鿿豈-﫿぀-ヿ가-힯]/.test(String(s || ""));
    const choicesOf = (q) => (q && Array.isArray(q.choices)) ? q.choices : [];
    const hasEnglishChoice = (q) => choicesOf(q).some((ch) => !hasCJK(ch));
    // 濾掉「選項全中文」的單題(中譯/聽力題)，只留有英文答案的題；剩太少(<3)就不濾以免沒題
    const enOnly = (arr) => { const a = Array.isArray(arr) ? arr : []; const f = a.filter(hasEnglishChoice); return f.length >= 3 ? f : a; };
    const tg = d.grade || d.layer || 1;
    const cands = chs.filter((c) => c.source !== "uploaded" && !/聽力/.test(c.name || ""));
    // 排序：已解鎖優先 → 年級≤目標且最接近 → 其餘（各層難度仍遞增）
    cands.sort((a, b) => {
      const sc = (c) => (c.unlocked ? 0 : 1000) + (c._grade > tg ? 100 : 0) + Math.abs(c._grade - tg);
      return sc(a) - sc(b);
    });
    if (!cands.length) { box.innerHTML = `<div class="jc-empty">目前沒有英語題目可對決</div><div style="text-align:center;margin-top:12px;"><button class="jc-act en-x">離開</button></div>`; box.querySelector(".en-x").addEventListener("click", enClose); return; }
    // 逐個試開 session，挑「選項是英文」的章節(避開中譯/聽力題)；最多試 6 個，都不行用第一個有題的保底
    const isEnglishQs = (q) => { const a = (Array.isArray(q) ? q : []).slice(0, 3); const ok = a.filter(hasEnglishChoice).length; return a.length > 0 && ok >= Math.ceil(a.length / 2); };
    let pick = null, sess = null, qs = [], fbPick = null, fbSess = null, fbQs = [];
    for (let i = 0; i < cands.length && i < 6; i++) {
      let s; try { s = await fetch(DEMO_API + "/api/english/session/start", { method: "POST", headers: hdr, body: JSON.stringify({ topic_id: cands[i].id, game: "vocab" }) }).then((r) => r.json()); } catch (e) { continue; }
      const q = (s && s.questions) || [];
      if (!q.length) continue;
      if (!fbSess) { fbPick = cands[i]; fbSess = s; fbQs = q; }
      if (isEnglishQs(q)) { pick = cands[i]; sess = s; qs = q; break; }
    }
    if (!sess) { pick = fbPick; sess = fbSess; qs = fbQs; }
    if (!sess || !qs.length) { box.innerHTML = `<div class="jc-empty">這位師長暫時無法對決（無題目）</div><div style="text-align:center;margin-top:12px;"><button class="jc-act en-x">離開</button></div>`; box.querySelector(".en-x").addEventListener("click", enClose); return; }
    qs = enOnly(qs);   // 同章節內混入的全中文題也濾掉
    // 血量制戰鬥：玩家攻防血(裝備加成) vs 敵人血量/攻擊
    const st = playerStats();
    const pMaxHP = st.hp;
    let pHP = pMaxHP;
    const eMaxHP = d.boss ? 50 : 40;   // 魔王 50 / 入魔師長 40
    let eHP = eMaxHP, eAtk = 10;
    const dmgToEnemy = Math.max(1, Math.round(st.atk / 2 + 2.5));   // 攻5→5；攻+10→多扣5
    const dmgToPlayer = Math.max(1, Math.round(eAtk - st.def / 2)); // 防5→扣8；防+10→少扣5
    let idx = 0, correct = 0, asked = 0;
    const bar = (cur, max, color) => `<div style="background:#e0d6c0;border-radius:6px;height:14px;overflow:hidden;"><div style="width:${Math.max(0, Math.round(cur / max * 100))}%;height:100%;background:${color};transition:width .25s;"></div></div>`;
    // 題目用完換一批新 session（避免同 session 重送同 question_id）；拿不到新題則依血量比例判勝負
    const advance = async () => {
      if (eHP <= 0) return finish(true);
      if (pHP <= 0) return finish(false);
      idx++;
      if (idx >= qs.length) {
        box.innerHTML = `<div class="jc-empty">敵人換招中…</div>`;
        let ns; try { ns = await fetch(DEMO_API + "/api/english/session/start", { method: "POST", headers: hdr, body: JSON.stringify({ topic_id: pick.id, game: "vocab" }) }).then((r) => r.json()); } catch (e) { ns = null; }
        const nq = enOnly((ns && ns.questions) || []);
        if (!nq.length) { return finish((eHP / eMaxHP) <= (pHP / pMaxHP)); }   // 沒新題：血量比例低的一方輸
        sess = ns; qs = nq; idx = 0;
      }
      renderQ();
    };
    const renderQ = () => {
      const q = qs[idx];
      const choices = (q.choices || []).map((c, ci) => qChoiceHTML(c, q, "en-choice", ci)).join("");
      box.innerHTML = `<div style="padding:4px 4px;">
        <div style="display:flex;gap:10px;margin-bottom:8px;">
          <div style="flex:1;"><div style="font-size:12px;color:#3a8f3a;font-weight:700;">你 ❤️ ${Math.max(0, pHP)}/${pMaxHP}</div>${bar(pHP, pMaxHP, "#48b048")}</div>
          <div style="flex:1;"><div style="font-size:12px;color:#c0392b;font-weight:700;text-align:right;">${d.boss ? "魔王" : "入魔"}的${aoEsc(d.name)} 💀 ${Math.max(0, eHP)}/${eMaxHP}</div>${bar(eHP, eMaxHP, "#d8503a")}</div>
        </div>
        <div style="text-align:center;font-size:12px;color:#7b4dd8;margin-bottom:6px;">答對攻擊 −${dmgToEnemy}／答錯被扣 −${dmgToPlayer}</div>
        ${qBodyHTML(q)}
        <div class="qt-opts">${choices}</div>
        <div class="en-fb qt-stamp"></div></div>`;
      box.querySelectorAll(".en-choice").forEach((btn) => btn.addEventListener("click", async function () {
        // 點擊當下立刻鎖全部選項（Codex P1：等 API 回來才鎖會被連點重複送答/重複扣血）
        box.querySelectorAll(".en-choice").forEach((b) => { b.disabled = true; });
        asked++;
        let r; try { r = await fetch(DEMO_API + "/api/english/session/answer", { method: "POST", headers: hdr, body: JSON.stringify({ session_id: sess.session_id, question_id: q.id, answer: this.dataset.c, time_ms: 0 }) }).then((x) => x.json()); } catch (e) { r = {}; }
        const fb = box.querySelector(".en-fb");
        if (qMarkAnswer(box, "en-choice", this, r)) {
          correct++; eHP -= dmgToEnemy; fb.textContent = "✓ 答對！對敵人造成 " + dmgToEnemy + " 傷害"; fb.style.color = "#3a8f3a";
          setTimeout(advance, 1000);
        } else {
          // 對戰保持自動節奏，但答錯多停 0.6 秒讓正解看得到（綠框＋標籤）
          pHP -= dmgToPlayer; fb.textContent = "✗ 你被扣 " + dmgToPlayer + " 血"; fb.style.color = "#c0392b";
          setTimeout(advance, 1600);
        }
      }));
    };
    const finish = async (win) => {
      box.innerHTML = `<div class="jc-empty">結算中…</div>`;
      try { await fetch(DEMO_API + "/api/english/session/end", { method: "POST", headers: hdr, body: JSON.stringify({ session_id: sess.session_id }) }); } catch (e) {}
      if (win) {
        const wins = enAddWin(npcId);
        enReportWin(npcId);
        if (wins < EN_WINS_NEED && !enIsPurified(npcId)) {
          // 還沒滿 3 勝：記分、給經驗，但不淨化（pptx v8：勝利三次才解救）
          const gm0 = gainMastery("english", 50);
          const exp0 = gm0 ? `英語精通值 +${gm0.gained}（LV.${gm0.lv}${gm0.leveled ? " ⬆️升級！" : ""}）` : "";
          box.innerHTML = `<div style="text-align:center;padding:18px 8px;">
            <div style="font-size:44px;">⚔️</div>
            <div style="font-size:18px;font-weight:900;color:#7b4dd8;margin:8px 0;">勝利！（${wins}/${EN_WINS_NEED}）</div>
            <div style="font-size:14px;color:#5a4630;">黑暗力量被削弱了……再勝 ${EN_WINS_NEED - wins} 場就能${d.boss ? "擊退魔王" : "淨化 " + aoEsc(d.name)}！</div>
            <div style="font-size:13px;color:#3a8f3a;font-weight:700;margin-top:6px;">${aoEsc(exp0)}</div>
            <div style="margin-top:16px;display:flex;gap:10px;justify-content:center;">
              <button class="jc-act en-again" style="width:auto;background:linear-gradient(135deg,#7b4dd8,#a06bf0);color:#fff;">⚔️ 再戰一場</button>
              <button class="jc-act en-x2" style="width:auto;">離開</button></div></div>`;
          box.querySelector(".en-again").addEventListener("click", () => enRunDuel(ov, npcId, d));
          box.querySelector(".en-x2").addEventListener("click", enClose);
          return;
        }
        enSetPurified(npcId);
        const gm = gainMastery("english", 50);   // 魔法陣通關給英語精通經驗 LV×50
        const expLine = gm ? `英語精通值 +${gm.gained}（LV.${gm.lv}${gm.leveled ? " ⬆️升級！" : ""}）` : "";
        enFace(ov, npcId + "_front.webp", d.wakeLine, "✨ " + d.wake);
        box.innerHTML = `<div style="text-align:center;padding:18px 8px;">
          <div style="font-size:44px;">${d.boss ? "🏆" : "✨"}</div>
          <div style="font-size:18px;font-weight:900;color:#7b4dd8;margin:8px 0;">${d.boss ? "魔王擊退！通關！" : "淨化成功！"}</div>
          <div style="font-size:14px;color:#5a4630;">${d.boss ? "英文學院光輝恢復了！" : aoEsc(d.name) + " 恢復清醒了！"}</div>
          <div style="font-size:13px;color:#3a8f3a;font-weight:700;margin-top:6px;">${aoEsc(expLine)}</div>
          <div style="font-size:13px;color:#8a6d3b;margin-top:4px;">${d.last ? "" : "封印之門已開啟，走到上方的門前往下一層。"}</div>
          <div style="margin-top:16px;"><button class="jc-act en-done" style="width:auto;background:linear-gradient(135deg,#7b4dd8,#a06bf0);color:#fff;">離開魔法陣</button></div></div>`;
        box.querySelector(".en-done").addEventListener("click", () => {
          enClose();
          if (window.__exploreReload) window.__exploreReload();   // 重載本層 → 立繪變清醒、封印之門開通
        });
      } else {
        box.innerHTML = `<div style="text-align:center;padding:18px 8px;">
          <div style="font-size:44px;">💀</div>
          <div style="font-size:18px;font-weight:900;color:#c0392b;margin:8px 0;">你被擊倒了…</div>
          <div style="font-size:14px;color:#5a4630;">血量歸零。提升裝備（攻/防/血）或多答對幾題，再回來挑戰！</div>
          <div style="margin-top:16px;display:flex;gap:10px;justify-content:center;">
            <button class="jc-act en-retry" style="width:auto;">⚔️ 再挑戰</button>
            <button class="jc-act en-x" style="width:auto;">離開</button></div></div>`;
        box.querySelector(".en-retry").addEventListener("click", () => enRunDuel(ov, npcId, d));
        box.querySelector(".en-x").addEventListener("click", enClose);
      }
    };
    renderQ();
  }

  // 封印之門：淨化本層師長後才開啟，通往下一層。reqId=本層師長 id；nextMap=下一層地圖
  function enOpenSeal(nextMap, reqId, onClose) {
    onCloseCb = onClose || null;
    if (enIsPurified(reqId)) {                 // 已淨化 → 直接前往下一層
      release();                                // 釋放這次 tap 的 modal 鎖
      if (window.__exploreGoMap) window.__exploreGoMap(nextMap, { x: 0.5, y: 0.86 });
      return;
    }
    const d = EN_NPC[reqId] || { name: "本層師長" };
    const ov = enBuildOverlay();
    enFace(ov, "shakespeare_front.webp", "封印之門緊閉著……必須先淨化本層的入魔師長，門才會開啟。", "🔒 封印之門");
    updateReportBtn(ov, null);
    ov.querySelector(".shop-title").textContent = "封印之門";
    ov.querySelector(".en-content").innerHTML = `
      <div style="text-align:center;padding:20px 8px;">
        <div style="font-size:44px;">🔒</div>
        <div style="font-size:15px;color:#5a4630;margin:10px 0;line-height:1.7;">先淨化「入魔的 ${aoEsc(d.name)}」<br>封印之門才會開啟。</div>
        <div style="margin-top:14px;"><button class="jc-act en-x" style="width:auto;">知道了</button></div>
      </div>`;
    ov.classList.add("open");
    ov.querySelector(".en-x").addEventListener("click", enClose);
  }
  window.enOpenEntrance = enOpenEntrance;

  /* ───────────────────── 考試院（歐陽修 模擬考 / 笛卡兒 檢定考；導入後端考試系統，demo 自做精簡答題）───────────────────── */
  const EX_NPC = {
    mock: { img: "ouyang_front.webp", name: "歐陽修", title: "考試院 · 模擬考官",
            intro: "模擬考純練習，不影響等級。挑一科、選年級，磨練一下吧！" },
    cert: { img: "descartes_front.webp", name: "笛卡兒", title: "考試院 · 檢定考官",
            intro: "檢定考全對才過、過了就升級。準備好證明自己了嗎？" },
  };
  let exType = "mock", exStatus = null;

  async function exOpen(type, onClose) {
    onCloseCb = onClose || null;
    exType = type;
    const d = EX_NPC[type] || EX_NPC.mock;
    const ov = caBuildOverlay();
    const tabs = ov.querySelector(".ao-tabs4"); if (tabs) tabs.innerHTML = "";   // 清掉學院殘留的任務/圖鑑分頁，避免污染考試
    updateReportBtn(ov, null);
    caSetPrincipal(ov, d.img, "📜 " + d.title + " " + d.name);
    caBubble(ov, d.intro);
    ov.querySelector(".shop-title").textContent = (type === "mock" ? "模擬考 · 歐陽修" : "檢定考 · 笛卡兒");
    ov.classList.add("open");
    ov.querySelector(".ao-content").innerHTML = `<div class="jc-empty">載入考試狀態中…</div>`;
    try { await ensureDemoPlayer(); } catch (e) {}
    await exRenderSubjects(ov);
  }

  async function exRenderSubjects(ov) {
    const box = ov.querySelector(".ao-content");
    const t = demoToken(); const hdr = { "Authorization": "Bearer " + t };
    try { exStatus = await fetch(DEMO_API + "/api/exam/center/status", { headers: hdr }).then((r) => r.json()); } catch (e) { exStatus = null; }
    const smap = {}; ((exStatus && exStatus.subjects) || []).forEach((s) => { smap[s.subject_key] = s; });
    caBubble(ov, "選一科" + (exType === "mock" ? "模擬考" : "檢定考") + "：");
    const order = ["chinese", "math", "english", "science", "social"];
    let html = `<div style="display:flex;flex-direction:column;gap:8px;">`;
    order.forEach((k) => {
      const s = smap[k] || { grade_max: 1, challenge: { state: "ready", grade: 1 } };
      let right;
      if (exType === "mock") right = "≤ " + (s.grade_max || 1) + " 年級";
      else {
        const ch = s.challenge || {};
        right = ch.state === "topped" ? "已封頂 🏆"
              : ch.state === "cooldown" ? "冷卻 " + ch.cooldown_minutes + " 分"
              : "挑戰 G" + (ch.grade || s.grade_max || 1);
      }
      html += `<button class="jc-act ex-subj" data-k="${k}" style="display:flex;justify-content:space-between;align-items:center;width:100%;padding:11px 14px;"><span>${aoEsc(SUBJ[k] || k)}</span><span style="font-size:13px;opacity:.8;white-space:nowrap;">${aoEsc(right)}</span></button>`;
    });
    html += `</div>`;
    box.innerHTML = html;
    box.querySelectorAll(".ex-subj").forEach((b) => b.addEventListener("click", function () {
      exPickGrade(ov, this.dataset.k, smap[this.dataset.k]);
    }));
  }

  function exPickGrade(ov, subjectKey, s) {
    const box = ov.querySelector(".ao-content");
    const gmax = (s && s.grade_max) || 1;
    if (exType === "cert") {   // 檢定考：直接挑戰目前等級（放寬：不在前端擋冷卻/封頂，後端若擋再友善顯示）
      const g = (s && s.challenge && s.challenge.grade) || gmax;
      exStartExam(ov, subjectKey, g);
      return;
    }
    caBubble(ov, (SUBJ[subjectKey] || subjectKey) + " 模擬考 · 選年級：");
    let html = `<div style="display:flex;flex-wrap:wrap;gap:8px;justify-content:center;">`;
    for (let g = 1; g <= gmax; g++) html += `<button class="jc-act ex-g" data-g="${g}" style="min-width:84px;">${g} 年級</button>`;
    html += `</div><div style="text-align:center;margin-top:14px;"><button class="jc-act ex-back" style="width:auto;">← 換一科</button></div>`;
    box.innerHTML = html;
    box.querySelectorAll(".ex-g").forEach((b) => b.addEventListener("click", function () { exStartExam(ov, subjectKey, Number(this.dataset.g)); }));
    box.querySelector(".ex-back").addEventListener("click", () => exRenderSubjects(ov));
  }

  async function exStartExam(ov, subjectKey, grade) {
    const box = ov.querySelector(".ao-content");
    box.innerHTML = `<div class="jc-empty">出題中…</div>`;
    const hdr = { "Content-Type": "application/json", "Authorization": "Bearer " + demoToken() };
    const path = exType === "mock" ? "/api/exam/mock/start" : "/api/exam/cert/start";
    let sess; try { sess = await fetch(DEMO_API + path, { method: "POST", headers: hdr, body: JSON.stringify({ subject_key: subjectKey, grade: grade }) }).then((r) => r.json()); } catch (e) { sess = {}; }
    const qs = (sess && sess.questions) || [];
    if (!qs.length) {
      const msg = sess.detail || sess.error || "目前無法開始考試（可能冷卻中或題庫不足）";
      box.innerHTML = `<div style="text-align:center;padding:18px 8px;"><div style="font-size:36px;">⏳</div><div style="font-size:14px;color:#5a4630;margin:10px 0;line-height:1.6;">${aoEsc(String(msg))}</div><button class="jc-act ex-back" style="width:auto;">← 返回</button></div>`;
      box.querySelector(".ex-back").addEventListener("click", () => exRenderSubjects(ov));
      return;
    }
    const sid = sess.session_id, answers = {}, total = qs.length;
    let idx = 0;
    const renderQ = () => {
      const q = qs[idx];
      const choices = (q.choices || []).map((c, ci) => qChoiceHTML(c, q, "ex-choice", ci)).join("");
      box.innerHTML = `<div style="padding:6px 4px;">
        ${qProgressHTML(idx, total, exType === "mock" ? "模擬考" : "檢定考")}
        ${qBodyHTML(q)}
        <div class="qt-opts">${choices}</div></div>`;
      box.querySelectorAll(".ex-choice").forEach((btn) => btn.addEventListener("click", function () {
        answers[String(q.question_id)] = this.dataset.c;
        idx++;
        (idx < total) ? renderQ() : exSubmit();
      }));
    };
    const exSubmit = async () => {
      box.innerHTML = `<div class="jc-empty">閱卷中…</div>`;
      let res = null, ok = false;
      try { const r = await fetch(DEMO_API + "/api/exam/submit", { method: "POST", headers: hdr, body: JSON.stringify({ session_id: sid, answers: answers }) }); ok = r.ok; res = await r.json().catch(() => null); } catch (e) { ok = false; }
      if (!ok || !res || res.correct_count == null) {   // 交卷失敗：別把網路/4xx/5xx 誤判成 0 分成績
        const msg = (res && (res.detail || res.error)) || "交卷失敗，請再送一次";
        box.innerHTML = `<div style="text-align:center;padding:18px 8px;"><div style="font-size:36px;">⚠️</div><div style="font-size:14px;color:#c0392b;margin:10px 0;">${aoEsc(String(msg))}</div><div style="display:flex;gap:10px;justify-content:center;"><button class="jc-act ex-resend" style="width:auto;">↻ 再送出</button><button class="jc-act ex-x" style="width:auto;">離開</button></div></div>`;
        box.querySelector(".ex-resend").addEventListener("click", exSubmit);
        box.querySelector(".ex-x").addEventListener("click", caClose);
        return;
      }
      const correct = res.correct_count != null ? res.correct_count : 0;
      const score = res.score != null ? res.score : 0;
      const passed = !!res.passed;
      const passLine = exType === "cert"
        ? (passed ? "🏆 全對通過！等級提升！" : "未通過（檢定考需全對），再接再厲！")
        : "模擬考完成，純練習不影響等級～";
      // 給精通經驗：檢定考通過 LV×50、模擬考 LV×30（pptx 規則）
      let gm = null;
      if (exType === "cert" && passed) gm = gainMastery(subjectKey, 50);
      else if (exType === "mock") gm = gainMastery(subjectKey, 30);
      const expLine = gm && gm.gained ? `${SUBJ[subjectKey] || subjectKey}精通值 +${gm.gained}（LV.${gm.lv}${gm.leveled ? " ⬆️升級！" : ""}）` : "";
      box.innerHTML = `<div style="text-align:center;padding:20px 8px;">
        <div style="font-size:44px;">${passed ? "🏆" : (exType === "cert" ? "💪" : "✅")}</div>
        <div style="font-size:22px;font-weight:900;color:#7b4dd8;margin:8px 0;">${score} 分</div>
        <div style="font-size:14px;color:#5a4630;">答對 ${correct} / ${total} 題</div>
        <div style="font-size:13px;color:#8a6d3b;margin-top:6px;">${aoEsc(passLine)}</div>
        ${expLine ? `<div style="font-size:13px;color:#3a8f3a;font-weight:700;margin-top:4px;">${aoEsc(expLine)}</div>` : ""}
        <div style="margin-top:16px;display:flex;gap:10px;justify-content:center;">
          <button class="jc-act ex-again" style="width:auto;">📚 再考一科</button>
          <button class="jc-act ex-x" style="width:auto;">離開</button></div></div>`;
      box.querySelector(".ex-again").addEventListener("click", () => exRenderSubjects(ov));
      box.querySelector(".ex-x").addEventListener("click", caClose);
    };
    renderQ();
  }

  /* ───────────────────── 裝備欄（純展示：左=目前造型 / 右=帽子·武器·寵物項圈配件）───────────────────── */
  const EQ_KEY = "village_equip";
  // 裝備加成（角色系統 C）：武器+攻擊、衣服(造型)+防禦、帽子/寵物+血量
  const EQUIP = {
    // body=目前造型(衣服店買的)，顯示在左大立繪，不放右格；def=防禦加成
    // shop:true = 服裝店真商品（要買過才出現在更衣室；買了走路圖整套換，見 explore.js WALK_OUTFITS）
    // ⚠️ 第一項是 getEquip() 的預設值＝原本造型（藍帽小男孩），shop 商品不能排第一
    // 美人魚/名牌包/珍珠項鍊/公事包 4 件派派定案跳過（配件類/魚尾不能走路），維持純展示不入此表
    body: { label: "造型", items: [
      { id: "basic", img: "outfits/m_default.webp", name: "原本造型", def: 5 },
      { id: "f_academic", img: "outfits/f_academic.webp", name: "女 學院風", def: 5, shop: true },
      { id: "f_angel", img: "outfits/f_angel.webp", name: "女 天使裝", def: 7, shop: true },
      { id: "f_beach", img: "outfits/f_beach.webp", name: "女 海灘風", def: 6, shop: true },
      { id: "f_blackcat", img: "outfits/f_blackcat.webp", name: "女 黑貓裝", def: 8, shop: true },
      { id: "f_bunny", img: "outfits/f_bunny.webp", name: "女 兔子裝", def: 5, shop: true },
      { id: "f_dress", img: "outfits/f_dress.webp", name: "女 洋裝", def: 4, shop: true },
      { id: "f_dress_pearl", img: "outfits/f_dress_pearl.webp", name: "女 珍珠洋裝", def: 5, shop: true },
      { id: "f_elf", img: "outfits/f_elf.webp", name: "女 精靈裝", def: 6, shop: true },
      { id: "f_kawaii", img: "outfits/f_kawaii.webp", name: "女 可愛風", def: 4, shop: true },
      { id: "f_lady_full", img: "outfits/f_lady_full.webp", name: "女 淑女全套", def: 5, shop: true },
      { id: "f_party_dress", img: "outfits/f_party_dress.webp", name: "女 派對洋裝", def: 5, shop: true },
      { id: "f_reindeer", img: "outfits/f_reindeer.webp", name: "女 馴鹿裝", def: 6, shop: true },
      { id: "f_streetwear", img: "outfits/f_streetwear.webp", name: "女 街頭風", def: 7, shop: true },
      { id: "m_beach", img: "outfits/m_beach.webp", name: "男 海灘風", def: 6, shop: true },
      { id: "m_biker", img: "outfits/m_biker.webp", name: "男 機車服", def: 8, shop: true },
      { id: "m_casual", img: "outfits/m_casual.webp", name: "男 休閒風", def: 5, shop: true },
      { id: "m_dino", img: "outfits/m_dino.webp", name: "男 Dino", def: 6, shop: true },
      { id: "m_knight", img: "outfits/m_knight.webp", name: "男 Knight", def: 10, shop: true },
      { id: "m_santa", img: "outfits/m_santa.webp", name: "男 Santa", def: 6, shop: true },
      { id: "m_sports", img: "outfits/m_sports.webp", name: "男 Sports", def: 6, shop: true },
      { id: "m_streetwear", img: "outfits/m_streetwear.webp", name: "男 街頭風", def: 5, shop: true },
      { id: "m_suit_full", img: "outfits/m_suit_full.webp", name: "男 Suit Full", def: 7, shop: true },
      { id: "m_suit_jacket", img: "outfits/m_suit_jacket.webp", name: "男 Suit Jacket", def: 5, shop: true },
      { id: "m_suit_pants", img: "outfits/m_suit_pants.webp", name: "男 Suit Pants", def: 4, shop: true },
      { id: "m_suit_set", img: "outfits/m_suit_set.webp", name: "男 Suit Set", def: 6, shop: true },
      { id: "m_superhero", img: "outfits/m_superhero.webp", name: "男 Superhero", def: 8, shop: true },
      { id: "m_vampire", img: "outfits/m_vampire.webp", name: "男 Vampire", def: 7, shop: true },
      { id: "m_wizard_kid", img: "outfits/m_wizard_kid.webp", name: "男 Wizard Kid", def: 7, shop: true },
    ] },
    hat: { label: "帽子", items: [
      { id: "hat_student", img: "equip/hat_student.webp", name: "學生帽", hp: 20 },
      { id: "hat_wizard", img: "equip/hat_wizard.webp", name: "巫師帽", hp: 35 },
      { id: "hat_crown", img: "equip/hat_crown.webp", name: "皇冠", hp: 50 },
      { id: "hat_catear", img: "equip/hat_catear.webp", name: "貓耳髮箍", hp: 25 },
      { id: "hat_straw", img: "equip/hat_straw.webp", name: "草帽", hp: 30 },
    ] },
    weapon: { label: "武器", items: [
      { id: "knife", img: "../assets/images/onboarding/knife.png", name: "巨大美工刀", atk: 8 },
    ] },
    // 寵物項圈格：依目前寵物顯示「對應配件」(acc_*)；img=寵物本體圖(寵物頁用)；hp=血量加成
    pet: { label: "寵物項圈", items: [
      { id: "pet_cat", name: "小貓", img: "equip/pet_cat.webp", acc_img: "equip/acc_yarn.webp", acc_name: "毛線球", hp: 20 },
      { id: "pet_bunny", name: "兔子", img: "equip/pet_bunny.webp", acc_img: "equip/acc_carrot.webp", acc_name: "紅蘿蔔", hp: 25 },
      { id: "pet_puppy", name: "小狗", img: "equip/pet_puppy.webp", acc_img: "equip/acc_collar.webp", acc_name: "項圈", hp: 30 },
      { id: "pet_penguin", name: "企鵝", img: "equip/pet_penguin.webp", acc_img: "equip/acc_fish.webp", acc_name: "小魚", hp: 35 },
      { id: "pet_panda", name: "熊貓", img: "equip/pet_panda.webp", acc_img: "equip/acc_bamboo.webp", acc_name: "竹子", hp: 50 },
    ] },
  };
  // 角色三圍（角色系統）：初始攻5/防5/血100 + 裝備加成
  const BASE_ATK = 5, BASE_DEF = 5, BASE_HP = 100;
  function playerStats() {
    const s = getEquip();
    const atk = BASE_ATK + (eqItem("weapon", s.weapon).atk || 0);
    const def = BASE_DEF + (eqItem("body", s.body).def || 0);
    const hp = BASE_HP + (eqItem("hat", s.hat).hp || 0) + (eqItem("pet", s.pet).hp || 0);
    return { atk, def, hp };
  }
  window.playerStats = playerStats;

  /* ── 精通值經驗系統（角色系統，前端 localStorage）──
     每級所需經驗 = 該科目前 LV × 500；上限 LV 100。
     通關給經驗 = 該科目前 LV × mult（魔王/檢定 50、模擬 30、小怪 20、任務 0）。 */
  const MASTERY_KEY = "village_mastery", MASTERY_CAP = 100;
  const MASTERY_SUBJ = ["chinese", "math", "english", "science", "social"];
  function getMastery() {
    let m = {};
    try { const p = JSON.parse(localStorage.getItem(MASTERY_KEY) || "{}"); if (p && typeof p === "object") m = p; } catch (e) {}
    MASTERY_SUBJ.forEach((k) => {
      if (!m[k] || typeof m[k] !== "object") m[k] = { lv: 1, exp: 0 };
      if (typeof m[k].lv !== "number") m[k].lv = 1;
      if (typeof m[k].exp !== "number") m[k].exp = 0;
    });
    return m;
  }
  function saveMastery(m) { try { localStorage.setItem(MASTERY_KEY, JSON.stringify(m)); } catch (e) {} }
  function gainMastery(subj, mult) {
    if (!MASTERY_SUBJ.includes(subj)) return null;
    const m = getMastery(), e = m[subj];
    if (e.lv >= MASTERY_CAP) { e.exp = 0; saveMastery(m); return { subj, gained: 0, lv: e.lv, leveled: false }; }
    const before = e.lv;
    const gained = e.lv * mult;   // 經驗用「升級前 LV」算，顯示才正確
    e.exp += gained;
    while (e.lv < MASTERY_CAP && e.exp >= e.lv * 500) { e.exp -= e.lv * 500; e.lv++; }
    if (e.lv >= MASTERY_CAP) { e.lv = MASTERY_CAP; e.exp = 0; }
    saveMastery(m);
    return { subj, gained, lv: e.lv, leveled: e.lv > before };
  }
  window.gainMastery = gainMastery;
  const EQ_SLOTS = ["hat", "body", "weapon"]; // 中間三格：帽子 / 衣服 / 武器
  const EQ_SLOT_LB = { hat: "帽子", body: "衣服", weapon: "武器" };
  const EQ_ALL = ["body", "hat", "weapon", "pet"];
  function setEquip(cat, id) {
    const s = getEquip(); s[cat] = id;
    try { localStorage.setItem(EQ_KEY, JSON.stringify(s)); } catch (e) {}
  }
  function getEquip() {
    let s = {};
    try { const p = JSON.parse(localStorage.getItem(EQ_KEY) || "{}"); if (p && typeof p === "object") s = p; } catch (e) {}
    EQ_ALL.forEach((cat) => { if (!EQUIP[cat].items.some((it) => it.id === s[cat])) s[cat] = EQUIP[cat].items[0].id; });
    // 移轉防呆：穿著的造型是真商品但沒買過（舊存檔預設 f_academic 轉真商品）→ 回原本造型
    const bIt = EQUIP.body.items.find((it) => it.id === s.body);
    if (bIt && bIt.shop && ownedOutfits().indexOf(bIt.id) < 0) s.body = EQUIP.body.items[0].id;
    return s;
  }
  function eqItem(cat, id) { return EQUIP[cat].items.find((it) => it.id === id) || EQUIP[cat].items[0]; }

  /* ── 背包道具欄（真實 inventory）：addToBag 給未來「獲得道具」用；demo 放 16 職業道具(jobtools 真圖)看看 ── */
  const BAG_KEY = "village_bag", BAG_MAX = 30, JT_IMG = "../assets/images/jobtools/";
  const BAG_DEMO = [
    { id: "cert_chinese", img: "cert_chinese.png", name: "國語證照", desc: "通過國語認證的專業證書，成為國語執業人員的憑證。" },
    { id: "cert_math", img: "cert_math.png", name: "數學證照", desc: "通過數學認證的專業證書，數學執業人員的憑證。" },
    { id: "cert_english", img: "cert_english.png", name: "英語證照", desc: "通過英語認證的專業證書，英語執業人員的憑證。" },
    { id: "cert_science", img: "cert_science.png", name: "自然證照", desc: "通過自然認證的專業證書，自然執業人員的憑證。" },
    { id: "cert_social", img: "cert_social.png", name: "社會證照", desc: "通過社會認證的專業證書，社會執業人員的憑證。" },
    { id: "cert_teacher_cn", img: "cert_teacher_cn.png", name: "國語教師證", desc: "國語學院教師資格證書（依學院分證，不再共用）。" },
    // cert_teacher_math 不預塞：歐幾里得支線任務獎勵，做完任務才入包（SIDE_QUEST_ITEMS）
    { id: "cert_teacher_en", img: "cert_teacher_en.png", name: "英語教師證", desc: "英語學院教師資格證書。" },
    { id: "cert_teacher_sci", img: "cert_teacher_sci.png", name: "自然教師證", desc: "自然學院教師資格證書。" },
    { id: "cert_teacher_social", img: "cert_teacher_social.png", name: "社會教師證", desc: "社會學院教師資格證書。" },
    // 記者證/靈感鋼筆/研究人員資格證/社工證/助理證 不預塞：支線任務獎勵，做完才入包（SIDE_QUEST_ITEMS）
    { id: "tool_trader", img: "tool_trader.png", name: "財金人員資格證", desc: "金融市場的入場券，交易員運籌帷幄的證明。" },
    { id: "tool_accountant", img: "tool_accountant.png", name: "會計師資格證", desc: "會計師的專業資格，與數字為伍的理財憑證。" },
    { id: "tool_translator", img: "tool_translator.png", name: "超級電子字典", desc: "翻譯的好幫手，跨越語言隔閡、即時查詢。" },
    { id: "tool_foreign_corp", img: "tool_foreign_corp.png", name: "外商員工證", desc: "外商企業的員工證，通往國際舞台的門票。" },
    { id: "tool_engineer", img: "tool_engineer.png", name: "科技業員工證", desc: "科技業的員工證，用科學打造未來的憑證。" },
  ].map((it) => ({ id: it.id, img: JT_IMG + it.img, name: it.name, desc: it.desc }));
  function bagWrite(b) { try { localStorage.setItem(BAG_KEY, JSON.stringify(b)); } catch (e) {} }
  function bagCurrent() {
    let b; try { b = JSON.parse(localStorage.getItem(BAG_KEY) || "null"); } catch (e) {}
    if (!Array.isArray(b) || (b.length && !b[0].img)) { b = BAG_DEMO.slice(); bagWrite(b); }   // 未設或舊格式→重 seed
    // 教師證拆五科（pptx v8 P63）：老背包裡的舊共用教師證原位換成五張
    const ti = b.findIndex((it) => it && it.id === "cert_teacher");
    if (ti >= 0) {
      const five = BAG_DEMO.filter((it) => it.id.indexOf("cert_teacher_") === 0)
        .filter((it) => !b.some((x) => x && x.id === it.id));
      b.splice(ti, 1, ...five.slice(0, Math.max(0, BAG_MAX - (b.length - 1))));
      bagWrite(b);
    }
    return b;
  }
  function getBag() { return bagCurrent().slice(0, BAG_MAX); }
  // 未來「獲得道具」呼叫：addToBag({id, img, name})；背包滿 30 回 false
  function addToBag(item) {
    const b = bagCurrent(); if (b.length >= BAG_MAX) return false;
    b.push(item); bagWrite(b); return true;
  }
  window.addToBag = addToBag;

  /* ── 支線任務道具入背包（派派 6/12 核准：第 1+2 類共 12 件；圖鑑/人物圖鑑/稱號類前綴不在白名單、不入包）──
     subj+seq 對應 localStorage village_<subj>_side 的進度值，開機 reconcile 用它判定「已領沒領」 */
  const SIDE_ITEM_RE = /(轉職道具|任務道具|道具|文件|書籍)「([^」]+)」/g;
  const SIDE_QUEST_ITEMS = {
    "靈感鋼筆": { id: "tool_writer", img: "tool_writer.png", subj: "chinese", seq: 8, desc: "作家的靈感泉源，握筆時文思泉湧、創造故事。" },
    "鬼面具": { id: "ghost_mask", img: "ghost_mask.png", subj: "chinese", seq: 10, desc: "聊齋畫皮裡的青面面具。蒲松齡的任務信物，提醒人心比鬼面更難測。" },
    "判決書": { id: "verdict_doc", img: "verdict_doc.png", subj: "chinese", seq: 11, desc: "席方平案的判決文書，正義雖遲但到的證明。" },
    "記者證": { id: "tool_reporter", img: "tool_reporter.png", subj: "chinese", seq: 12, desc: "記者的身分證明，憑它追逐真相、報導世界。" },
    "無理數事件調查報告": { id: "report_irrational", img: "report_irrational.png", subj: "math", seq: 3, desc: "畢氏學派祕密事件的調查檔案，√2 的真相就藏在裡面。" },
    "定理的證明": { id: "book_proof", img: "book_proof.png", subj: "math", seq: 6, desc: "歐幾里得的幾何證明集，一步一步推理出真理。" },
    "數學教師證": { id: "cert_teacher_math", img: "cert_teacher_math.png", subj: "math", seq: 8, desc: "數學學院教師資格證書。" },
    "青囊書": { id: "book_qingnang", img: "book_qingnang.png", subj: "science", seq: 3, desc: "華佗畢生醫術的結晶，失而復得的傳世醫書。" },
    "研究人員資格證": { id: "tool_researcher", img: "tool_researcher.png", subj: "science", seq: 8, desc: "研究人員的資格證，在實驗室追尋真理的證明。" },
    "助理證": { id: "tool_congress_aide", img: "tool_congress_aide.png", subj: "social", seq: 4, desc: "國會助理的識別證，在議事殿堂幕後奔走。" },
    "一條鞭法": { id: "book_yitiaobian", img: "book_yitiaobian.png", subj: "social", seq: 7, desc: "張居正改革的政策典籍，一條鞭理清天下賦稅。" },
    "社工證": { id: "tool_social_worker", img: "tool_social_worker.png", subj: "social", seq: 8, desc: "社工的專業證照，用愛心幫助他人的憑證。" },
  };
  // 從獎勵文字撈出可入包的道具（只認白名單前綴＋註冊表名字，圖鑑「青囊書」這種不會誤中）
  function sideRewardItems(rw) {
    const out = []; SIDE_ITEM_RE.lastIndex = 0;
    let m; while ((m = SIDE_ITEM_RE.exec(String(rw || "")))) {
      const def = SIDE_QUEST_ITEMS[m[2]];
      if (def && !out.some((d) => d.id === def.id)) out.push(Object.assign({ name: m[2] }, def));
    }
    return out;
  }
  function sideItemGrant(def) {
    if (bagCurrent().some((it) => it && it.id === def.id)) return true;   // 已有就不重複
    return addToBag({ id: def.id, img: JT_IMG + def.img, name: def.name, desc: def.desc });
  }
  // 開機對帳：照支線進度補發/收回（已領過卻不在包→補發；舊版預塞但任務還沒做→收回，做了才有獲得感）
  function bagReconcileQuestItems() {
    const b = bagCurrent(); let dirty = false;
    Object.keys(SIDE_QUEST_ITEMS).forEach((nm) => {
      const def = SIDE_QUEST_ITEMS[nm];
      let prog = 0; try { prog = parseInt(localStorage.getItem("village_" + def.subj + "_side") || "0", 10) || 0; } catch (e) {}
      const idx = b.findIndex((it) => it && it.id === def.id);
      if (prog >= def.seq && idx < 0 && b.length < BAG_MAX) { b.push({ id: def.id, img: JT_IMG + def.img, name: nm, desc: def.desc }); dirty = true; }
      else if (prog < def.seq && idx >= 0) { b.splice(idx, 1); dirty = true; }
    });
    if (dirty) bagWrite(b);
  }
  try { bagReconcileQuestItems(); } catch (e) {}
  // 獲得道具彈窗（蓋在面板上，點任意處關閉）
  function caShowItemGet(ov, items) {
    const panel = ov.querySelector(".shop-panel"); if (!panel || !items.length) return;
    const old = panel.querySelector(".ca-itemget"); if (old) old.remove();
    const d = el("div"); d.className = "ca-itemget";
    d.innerHTML = `<div class="ca-itemget-card">
      <div class="ca-itemget-ttl">🎁 獲得道具！</div>
      ${items.map((it) => `<img src="${JT_IMG + it.img}?v=1" alt="${aoEsc(it.name)}"><div class="ca-itemget-nm">${aoEsc(it.name)}</div>`).join("")}
      <div class="ca-itemget-hint">已放進背包，點一下關閉</div></div>`;
    d.addEventListener("click", () => d.remove());
    panel.appendChild(d);
  }

  function eqBuildOverlay() {
    let ov = document.getElementById("eq-overlay");
    if (ov) return ov;
    ov = el("div"); ov.id = "eq-overlay";
    ov.innerHTML = `
      <div class="shop-panel jc-panel eq-panel">
        <div class="shop-title">人物裝備</div>
        <button class="shop-close" aria-label="關閉">×</button>
        <div class="eq-main">
          <div class="eq-leftcol">
            <div class="eq-charbox">
              <div class="eq-portrait"><img id="eq-port" alt="目前造型"></div>
              <div class="eq-slots"></div>
            </div>
            <div class="eq-gender" role="group" aria-label="切換性別">
              <button class="eq-g-opt" data-g="male"><img class="ui-ic" src="icons/ic_male.webp?v=1" alt=""> 男生</button>
              <button class="eq-g-opt" data-g="female"><img class="ui-ic" src="icons/ic_female.webp?v=1" alt=""> 女生</button>
            </div>
            <button class="jc-act eq-charbtn"><img class="ui-ic" src="icons/ic_stats.webp?v=1" alt=""> 角色數值</button>
          </div>
          <div class="eq-backpack">
            <div class="eq-bp-head">背包</div>
            <div class="eq-bp-grid"></div>
          </div>
        </div>
        <div class="eq-item-pop" style="display:none;">
          <div class="eq-item-card">
            <button class="eq-item-x" aria-label="關閉">×</button>
            <div class="eq-item-ic"><img class="eq-item-img" alt=""></div>
            <div class="eq-item-nm"></div>
            <div class="eq-item-desc"></div>
          </div>
        </div>
      </div>`;
    document.body.appendChild(ov);
    ov.querySelector(".shop-close").addEventListener("click", eqClose);
    ov.addEventListener("click", (e) => { if (e.target === ov) eqClose(); });
    ov.querySelector(".eq-charbtn").addEventListener("click", () => { eqClose(); openCharSheet(); });
    // 性別切換（demo）：點不同性別 → 換回該性別「原本造型」才看得出男/女外表差異
    // （穿著的真商品造型是固定的、不分性別，不回 basic 的話切性別看起來沒變）
    ov.querySelectorAll(".eq-g-opt").forEach((opt) => opt.addEventListener("click", () => {
      const g = opt.dataset.g;
      if ((isFemale() ? "female" : "male") === g) return;   // 已是該性別不動作（不脫掉身上衣服）
      try { localStorage.setItem("village_gender", g); } catch (e) {}
      setEquip("body", "basic");                      // 回原本造型，立繪/走路才會呈現該性別預設
      eqRender(ov);                                   // 重繪立繪+高亮
      if (window.applyWalkOutfit) window.applyWalkOutfit();   // 村莊走路造型即時換
    }));
    const pop = ov.querySelector(".eq-item-pop");
    pop.querySelector(".eq-item-x").addEventListener("click", () => { pop.style.display = "none"; });
    pop.addEventListener("click", (e) => { if (e.target === pop) pop.style.display = "none"; });
    return ov;
  }

  // 純展示：左=目前造型立繪 / 中三格=帽子·衣服·武器 / 右=背包(30格)
  const EQ_BP_SLOTS = 30;
  function eqRender(ov) {
    const s = getEquip();
    // 左大立繪 = 目前造型
    ov.querySelector("#eq-port").src = bodyImg(eqItem("body", s.body)) + "?v=1";
    // 性別切換器（demo）：高亮目前性別那半
    const cur = isFemale() ? "female" : "male";
    ov.querySelectorAll(".eq-g-opt").forEach((o) => o.classList.toggle("on", o.dataset.g === cur));
    // 中三格 帽子/衣服/武器
    ov.querySelector(".eq-slots").innerHTML = EQ_SLOTS.map((cat) => {
      const it = eqItem(cat, s[cat]);
      const img = (cat === "body") ? bodyImg(it) : it.img;   // 衣服格 basic 也按性別
      return `<div class="eq-slot" data-cat="${cat}">
          <div class="eq-slot-ic"><img src="${img}?v=1" alt="${it.name}"></div>
          <div class="eq-slot-tx"><div class="eq-slot-lb">${EQ_SLOT_LB[cat]}</div><div class="eq-slot-nm">${it.name}</div></div>
        </div>`;
    }).join("");
    // 右背包：道具欄（真實 inventory，demo 放 16 職業道具）；點道具→顯示介紹
    const bag = getBag();
    const grid = ov.querySelector(".eq-bp-grid");
    grid.innerHTML =
      Array.from({ length: EQ_BP_SLOTS }, (_, i) => {
        const it = bag[i];
        return it
          ? `<div class="eq-bp-cell filled" data-idx="${i}" title="${it.name}"><img src="${it.img}?v=1" alt="${it.name}"></div>`
          : `<div class="eq-bp-cell"></div>`;
      }).join("");
    grid.querySelectorAll(".eq-bp-cell.filled").forEach((c) =>
      c.addEventListener("click", () => eqShowItem(ov, bag[Number(c.dataset.idx)])));
  }

  // 點背包道具 → 顯示介紹彈窗
  function eqShowItem(ov, it) {
    if (!it) return;
    const pop = ov.querySelector(".eq-item-pop");
    pop.querySelector(".eq-item-img").src = it.img + "?v=1";
    pop.querySelector(".eq-item-nm").textContent = it.name || "";
    pop.querySelector(".eq-item-desc").textContent = it.desc || "（暫無介紹）";
    pop.style.display = "flex";
  }

  function openEquip() {
    const ov = eqBuildOverlay();
    eqRender(ov);
    ov.classList.add("open");
  }
  function eqClose() { const ov = document.getElementById("eq-overlay"); if (ov) ov.classList.remove("open"); }
  window.openEquip = openEquip;

  /* ── 角色頁面（人物系統）：立繪 + 姓名/年級/職業 + 攻防血 + 5 科精通值 LV ── */
  async function openCharSheet() {
    onCloseCb = null;
    const ov = caBuildOverlay();
    const tabs = ov.querySelector(".ao-tabs4"); if (tabs) tabs.innerHTML = "";
    const s = getEquip();
    caSetPrincipal(ov, bodyImg(eqItem("body", s.body)), "角色資訊");
    { const own = ov.querySelector(".ao-owner"); if (own) own.innerHTML = '<img class="ui-ic" src="icons/ic_char.webp?v=1" alt=""> 角色資訊'; }
    caBubble(ov, "這是你的角色狀態～");
    ov.querySelector(".shop-title").textContent = "角色頁面";
    ov.classList.add("open");
    const box = ov.querySelector(".ao-content");
    box.innerHTML = `<div class="jc-empty">載入中…</div>`;
    let name = "小訪客", grade = "—";
    const t = demoToken();
    if (t) { try { const u = await fetch(DEMO_API + "/api/user/status", { headers: { Authorization: "Bearer " + t } }).then((r) => r.json()); if (u && !u.error) { name = u.name || name; grade = (u.grade != null) ? (u.grade + " 年級") : grade; } } catch (e) {} }
    const jobKey = (typeof getJob === "function") ? getJob() : null;
    const jobName = (jobKey && typeof JOBS !== "undefined" && JOBS[jobKey]) ? JOBS[jobKey].name : "見習生";
    const st = playerStats();
    const m = getMastery();
    const ORDER = [["chinese", "國語"], ["math", "數學"], ["science", "自然"], ["social", "社會"], ["english", "英語"]];
    const rows = ORDER.map(([k, lb]) => {
      const e = m[k], need = e.lv * 500;
      return `<div style="display:flex;justify-content:space-between;align-items:center;padding:5px 2px;font-size:14px;color:#5a4630;border-bottom:1px solid #efe2c8;">
        <span>${lb}精通值</span>
        <span style="font-weight:800;color:#7b4dd8;">LV.${e.lv}<span style="font-size:11px;color:#8a6d3b;font-weight:400;margin-left:5px;">${e.lv >= MASTERY_CAP ? "(MAX)" : e.exp + "/" + need}</span></span></div>`;
    }).join("");
    box.innerHTML = `<div style="padding:2px 4px;">
      <div style="font-size:15px;color:#3a2c1a;margin-bottom:4px;">姓名：<b>${aoEsc(name)}</b></div>
      <div style="font-size:15px;color:#3a2c1a;margin-bottom:4px;">年級：<b>${aoEsc(String(grade))}</b></div>
      <div style="font-size:15px;color:#3a2c1a;margin-bottom:10px;">當前職業：<b>${aoEsc(jobName)}</b></div>
      <div style="display:flex;gap:8px;margin-bottom:12px;">
        <div style="flex:1;text-align:center;background:#fdecea;border-radius:10px;padding:8px 4px;"><div style="font-size:12px;color:#c0392b;"><img class="ui-ic" src="icons/ic_atk.webp?v=1" alt=""> 攻擊力</div><div style="font-size:20px;font-weight:900;color:#c0392b;">${st.atk}</div></div>
        <div style="flex:1;text-align:center;background:#eaf2fb;border-radius:10px;padding:8px 4px;"><div style="font-size:12px;color:#2b6cb0;"><img class="ui-ic" src="icons/ic_def.webp?v=1" alt=""> 防禦力</div><div style="font-size:20px;font-weight:900;color:#2b6cb0;">${st.def}</div></div>
        <div style="flex:1;text-align:center;background:#eafaea;border-radius:10px;padding:8px 4px;"><div style="font-size:12px;color:#3a8f3a;"><img class="ui-ic" src="icons/ic_hp.webp?v=1" alt=""> 血量</div><div style="font-size:20px;font-weight:900;color:#3a8f3a;">${st.hp}</div></div>
      </div>
      ${rows}
      <div style="font-size:11px;color:#8a6d3b;margin-top:10px;opacity:.85;line-height:1.5;">攻防血由裝備加成（武器+攻／衣服+防／帽子·寵物+血）；精通值靠通關累積（每級需 LV×500 經驗）。</div>
    </div>`;
  }
  window.openCharSheet = openCharSheet;

  /* ───────────────────── 個人小屋 hub（學生宿舍：更衣室 / 角色裝備 / 寵物 / 圖鑑，純展示）───────────────────── */
  let dhTab = "outfit";
  let dhAwards = null, dhCerts = null, dhLoadSeq = 0; // 成就(/api/awards)/證書(/api/certs)快取；dhLoadSeq=世代守衛，重開作廢舊 fetch 寫回
  function dhBuildOverlay() {
    let ov = document.getElementById("dh-overlay");
    if (ov) return ov;
    ov = el("div"); ov.id = "dh-overlay";
    ov.innerHTML = `
      <div class="shop-panel dh-panel">
        <div class="shop-title">個人小屋</div>
        <button class="shop-close" aria-label="關閉">×</button>
        <div class="dh-leftcol">
          <div class="dh-preview"><img class="dh-port" alt="目前造型" draggable="false"></div>
          <div class="dh-owner"><img class="ui-ic" src="icons/ic_home.webp?v=1" alt=""> 你的小屋</div>
        </div>
        <div class="dh-rightcol">
          <div class="jc-tabs dh-tabs" style="overflow-x:auto;-webkit-overflow-scrolling:touch;scrollbar-width:none">
            <button class="jc-tab" data-tab="outfit" style="flex:0 0 auto;white-space:nowrap">更衣室</button>
            <button class="jc-tab" data-tab="gear" style="flex:0 0 auto;white-space:nowrap">角色裝備</button>
            <button class="jc-tab" data-tab="pet" style="flex:0 0 auto;white-space:nowrap">寵物</button>
            <button class="jc-tab" data-tab="book" style="flex:0 0 auto;white-space:nowrap">圖鑑</button>
            <button class="jc-tab" data-tab="ach" style="flex:0 0 auto;white-space:nowrap">成就</button>
            <button class="jc-tab" data-tab="cert" style="flex:0 0 auto;white-space:nowrap">證書</button>
          </div>
          <div class="jc-content dh-content"></div>
          <div class="dh-bubble"></div>
        </div>
      </div>`;
    document.body.appendChild(ov);
    ov.querySelector(".shop-close").addEventListener("click", dhClose);
    ov.addEventListener("click", (e) => { if (e.target === ov) dhClose(); });
    ov.querySelectorAll(".dh-tabs .jc-tab").forEach((b) =>
      b.addEventListener("click", () => { dhTab = b.dataset.tab; dhRender(ov); }));
    return ov;
  }
  function dhBubble(ov, txt) { ov.querySelector(".dh-bubble").textContent = txt || ""; }
  function dhCard(opts) {
    return `<div class="dh-card${opts.sel ? " sel" : ""}${opts.ro ? " ro" : ""}" data-cat="${opts.cat || ""}" data-id="${opts.id || ""}">
        <img src="${opts.img}?v=1" alt="${opts.name}" loading="lazy" draggable="false">
        <div class="dh-nm">${opts.name}</div>${opts.sub ? `<div class="dh-sub2">${opts.sub}</div>` : ""}</div>`;
  }
  function dhRender(ov) {
    ov.querySelectorAll(".dh-tabs .jc-tab").forEach((b) =>
      b.classList.toggle("active", b.dataset.tab === dhTab));
    const s = getEquip();
    ov.querySelector(".dh-port").src = bodyImg(eqItem("body", s.body)) + "?v=1";   // 左預覽=目前造型
    const box = ov.querySelector(".dh-content"); box.innerHTML = "";

    if (dhTab === "outfit") {
      dhBubble(ov, "換上喜歡的造型吧！");
      // 服裝店真商品(shop:true)買過才出現；換裝同步換走路造型
      const owned = ownedOutfits();
      box.innerHTML = `<div class="dh-grid">` +
        EQUIP.body.items.filter((it) => !it.shop || owned.indexOf(it.id) >= 0)
          .map((it) => dhCard({ id: it.id, img: bodyImg(it), name: it.name, sel: it.id === s.body })).join("") + `</div>`;
      box.querySelectorAll(".dh-card").forEach((c) => c.addEventListener("click", () => {
        setEquip("body", c.dataset.id);
        if (window.applyWalkOutfit) window.applyWalkOutfit();
        dhBubble(ov, "換上「" + eqItem("body", c.dataset.id).name + "」！"); dhRender(ov);
      }));
    } else if (dhTab === "gear") {
      dhBubble(ov, "選頂帽子、看看你的裝備～");
      box.innerHTML = `<div class="dh-sub">帽子</div><div class="dh-grid">` +
        EQUIP.hat.items.map((it) => dhCard({ cat: "hat", id: it.id, img: it.img, name: it.name, sel: it.id === s.hat })).join("") + `</div>` +
        `<div class="dh-sub">武器</div><div class="dh-grid">` +
        EQUIP.weapon.items.map((it) => dhCard({ cat: "weapon", id: it.id, img: it.img, name: it.name, sel: true })).join("") + `</div>`;
      box.querySelectorAll('.dh-card[data-cat="hat"]').forEach((c) => c.addEventListener("click", () => {
        setEquip("hat", c.dataset.id); dhBubble(ov, "戴上「" + eqItem("hat", c.dataset.id).name + "」！"); dhRender(ov);
      }));
    } else if (dhTab === "pet") {
      dhBubble(ov, "挑一隻夥伴陪你冒險！");
      box.innerHTML = `<div class="dh-grid">` +
        EQUIP.pet.items.map((it) => dhCard({ id: it.id, img: it.img, name: it.name, sub: "配件：" + it.acc_name, sel: it.id === s.pet })).join("") + `</div>`;
      box.querySelectorAll(".dh-card").forEach((c) => c.addEventListener("click", () => {
        setEquip("pet", c.dataset.id); dhBubble(ov, "選擇「" + eqItem("pet", c.dataset.id).name + "」當夥伴！"); dhRender(ov);
      }));
    } else if (dhTab === "book") {
      dhBubble(ov, "你收集到的造型、帽子、夥伴都在這！");
      const sect = (label, items) => `<div class="dh-sub">${label}</div><div class="dh-grid">` +
        items.map((it) => dhCard({ img: it.img, name: it.name, ro: true })).join("") + `</div>`;
      box.innerHTML = sect("造型", EQUIP.body.items) + sect("帽子", EQUIP.hat.items) + sect("寵物", EQUIP.pet.items);
    } else if (dhTab === "ach") {
      // 🏅 成就：讀後端 /api/awards（主線終獎稱號/證照）
      dhBubble(ov, "你達成的成就都在這！");
      if (dhAwards === null) { box.innerHTML = `<div class="dh-sub">載入中…</div>`; dhLoadData().then(() => { if (dhTab === "ach") dhRender(ov); }); return; }
      if (!dhAwards.length) { box.innerHTML = `<div class="jc-empty">${demoToken() ? "還沒有成就，完成學院主線任務就會解鎖！" : "建立角色、闖學院後，成就會出現在這裡！"}</div>`; return; }
      box.innerHTML = `<div style="display:flex;flex-direction:column;gap:8px">` + dhAwards.map((a) =>
        `<div style="display:flex;align-items:center;gap:10px;background:#fff4d6;border:1px solid #e6c873;border-radius:12px;padding:10px 12px">
           <span style="font-size:22px">${a.kind === "title" ? "🏆" : "📜"}</span>
           <span style="font-weight:800;color:#8a6a1e">${aoEsc(a.label)}</span></div>`).join("") + `</div>`;
    } else if (dhTab === "cert") {
      // 📜 證書：接 EDU 真證書系統（同後端）— 12 張收藏證書，拿到的顯示真合成圖+QR驗證
      dhBubble(ov, "集滿圖鑑知識卡就能拿到收藏證書！");
      if (dhCerts === null) { box.innerHTML = `<div class="dh-sub">載入中…</div>`; dhLoadData().then(() => { if (dhTab === "cert") dhRender(ov); }); return; }
      const owned = {}; (dhCerts || []).forEach((c) => { owned[c.cert_key] = c; });
      box.innerHTML = `<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px">` + DH_CERTS.map((meta) => {
        const ok = !!owned[meta.key];
        return `<div class="dh-cert ${ok ? "on" : "off"}" data-k="${meta.key}" style="border:2px solid ${ok ? "#d4a017" : "#ccc"};border-radius:12px;padding:11px 4px;text-align:center;background:${ok ? "linear-gradient(160deg,#fffceb,#fff1bf)" : "#f1f1f1"};opacity:${ok ? 1 : .5};cursor:pointer">
            <div style="font-size:28px;line-height:1.1">${ok ? meta.emoji : "🔒"}</div>
            <div style="font-weight:800;color:#6a4a12;font-size:12.5px">${meta.name}</div>
            <div style="font-size:10.5px;color:${ok ? "#b8860b" : "#999"}">${ok ? "已獲得" : "未獲得"}</div></div>`;
      }).join("") + `</div>` + (demoToken() ? "" : `<div class="jc-empty" style="margin-top:8px">建立角色、集滿圖鑑卡，就能拿到真證書！</div>`);
      box.querySelectorAll(".dh-cert").forEach((c) => c.addEventListener("click", () => {
        const k = c.dataset.k, rec = owned[k], meta = DH_CERTS.find((m) => m.key === k);
        if (rec) dhShowEduCert(rec, meta);
        else dhBubble(ov, "「" + (meta ? meta.name : "") + "」還沒拿到，去集滿對應的圖鑑卡吧！");
      }));
    }
  }
  // 載入成就/檢定狀態（一次抓，之後快取；reuse caLoadAwards）
  async function dhLoadData() {
    const seq = dhLoadSeq; // 這次載入的世代；重開 hub 會 ++，舊 fetch 完成不寫回
    if (dhAwards === null) {
      let aw = []; try { aw = (typeof caLoadAwards === "function") ? (await caLoadAwards()) : []; } catch (e) {}
      if (seq !== dhLoadSeq) return; dhAwards = aw;
    }
    if (dhCerts === null) {
      const t = demoToken(); let cs = [];
      if (t) {
        // demo 展示：先一鍵全發 12 張收藏證書(冪等)，再列出 → 證書牆直接是滿的
        try { await fetch(DEMO_API + "/api/demo/grant-all-certs", { method: "POST", headers: { Authorization: "Bearer " + t } }); } catch (e) {}
        try { const d = await fetch(DEMO_API + "/api/certs/me", { headers: { Authorization: "Bearer " + t } }).then((r) => r.json()); cs = (d && d.certificates) || []; } catch (e) {}
      }
      if (seq !== dhLoadSeq) return; dhCerts = cs;
    }
  }
  // EDU 12 張收藏證書目錄（對齊後端 cards.py CERTIFICATES）
  const DH_CERTS = [
    { key: "cert_pet", name: "寵物收藏家", emoji: "🐾" }, { key: "cert_animal", name: "牧場主人", emoji: "🐔" },
    { key: "cert_plant", name: "綠手指", emoji: "🥦" }, { key: "cert_food", name: "美食達人", emoji: "🍎" },
    { key: "cert_exercise", name: "運動健將", emoji: "🏃" }, { key: "cert_habit", name: "習慣養成", emoji: "📅" },
    { key: "cert_math", name: "數學大師", emoji: "➗" }, { key: "cert_chinese", name: "國語大師", emoji: "📜" },
    { key: "cert_english", name: "英文大師", emoji: "🔤" }, { key: "cert_science", name: "自然大師", emoji: "🔬" },
    { key: "cert_social", name: "社會大師", emoji: "🌍" }, { key: "cert_grand", name: "圖鑑大師", emoji: "👑" },
  ];
  // 顯示 EDU 真證書：用「公開 by-token」圖端點(免登入、HMAC token 不可偽造)直接 <img src>
  // → 跨域顯示圖片不需 CORS、不必 fetch/blob/Bearer（後端 docstring 就是設計給 <img> 用的）
  function dhShowEduCert(rec, meta) {
    const tok = encodeURIComponent(rec.verification_token || "");
    const imgUrl = DEMO_API + "/api/certs/by-token/" + tok + "/full.png";
    const verify = DEMO_API + "/cert/" + tok;
    const nm = aoEsc(meta ? meta.name : "證書");
    let m = document.getElementById("dh-cert-modal");
    if (!m) { m = el("div"); m.id = "dh-cert-modal"; m.style.cssText = "position:fixed;inset:0;z-index:7200;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:16px;background:rgba(0,0,0,.62)"; document.body.appendChild(m); m.addEventListener("click", (e) => { if (e.target === m) m.remove(); }); }
    m.style.display = "flex";
    m.innerHTML = `<img id="dh-cert-img" src="${imgUrl}" alt="${nm}" style="max-width:min(440px,92vw);max-height:70vh;border-radius:12px;box-shadow:0 14px 44px rgba(0,0,0,.5);background:#fff">` +
      `<div style="display:flex;gap:10px;flex-wrap:wrap;justify-content:center">` +
        `<a href="${verify}" target="_blank" rel="noopener" style="background:#4a9fff;color:#fff;text-decoration:none;border-radius:12px;padding:9px 18px;font-weight:800">🔍 驗證</a>` +
        `<button id="dh-cert-ok" style="border:none;border-radius:12px;padding:9px 22px;background:#c9a227;color:#fff;font-weight:800;cursor:pointer">關閉</button></div>`;
    const img = m.querySelector("#dh-cert-img");
    if (img) img.addEventListener("error", function () { this.outerHTML = `<div style="background:#fff;border-radius:12px;padding:22px 18px;text-align:center;max-width:86vw">😶 證書圖載入失敗</div>`; });
    m.querySelector("#dh-cert-ok").addEventListener("click", () => m.remove());
  }
  function openDormHub(onClose) {
    onCloseCb = onClose || null;
    dhLoadSeq++; dhAwards = null; dhCerts = null; // 重開重抓成就/證書（世代+1 作廢舊 fetch）
    const ov = dhBuildOverlay();
    dhTab = "outfit"; dhRender(ov);
    ov.classList.add("open");
  }
  function dhClose() {
    const cm = document.getElementById("dh-cert-modal"); if (cm) cm.remove(); // 關 hub 一併清證書 modal
    const ov = document.getElementById("dh-overlay");
    if (ov) ov.classList.remove("open");
    release();
  }
  window.openDormHub = openDormHub;
})();
