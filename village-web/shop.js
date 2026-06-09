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
    const r = await fetch("shop_catalog.json?v=1");
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

  function renderGrid(ov, shop, cat) {
    const grid = ov.querySelector(".shop-grid");
    grid.innerHTML = "";
    const items = shop.items.filter((it) => !cat || cat === "全部" || it.cat === cat);
    items.forEach((it, i) => {
      const card = el("div", "shop-card");
      // 少量裝飾狀態：每 7 個一個賣光、VIP（純展示，圖二那種感覺）
      if (i % 7 === 5) card.classList.add("sold");
      else if (i % 11 === 9) card.classList.add("vip");
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
      desc: "傳道授業、桃李滿天下。", skill: "教學相長：國語經驗 ×1.5", item: "教師證",
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
      desc: "把抽象變簡單的引路人。", skill: "教學相長：數學經驗 ×1.5", item: "教師證",
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
      desc: "帶你開口說世界語言。", skill: "教學相長：英語經驗 ×1.5", item: "教師證",
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
      desc: "帶你認識大自然的奧妙。", skill: "教學相長：自然經驗 ×1.5", item: "教師證",
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
      desc: "帶你讀懂社會脈動。", skill: "教學相長：社會經驗 ×1.5", item: "教師證",
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

  async function aoLoad() {
    if (AO_CONTENT) return AO_CONTENT;
    const r = await fetch("academy_content.json?v=1");
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
          <div class="ao-quest-ic">${aoEsc(q.icon || "📜")}</div>
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
      box.querySelector(".ao-send").addEventListener("click", () => {
        const cat = box.querySelector("#ao-bug-cat").value;
        const txt = box.querySelector("#ao-bug-txt").value.trim();
        const hint = box.querySelector("#ao-bug-hint");
        if (!txt) { hint.textContent = "請先描述問題再送出唷～"; hint.className = "ao-bug-hint err"; return; }
        let list = [];
        try { const p = JSON.parse(localStorage.getItem(BUG_KEY) || "[]"); list = Array.isArray(p) ? p : []; } catch (e) { list = []; }
        list.push({ cat, txt, t: Date.now() });
        try { localStorage.setItem(BUG_KEY, JSON.stringify(list)); } catch (e) {}
        box.querySelector("#ao-bug-txt").value = "";
        hint.textContent = "✓ 已收到你的回報，謝謝！（目前為展示版，回報暫存本機）";
        hint.className = "ao-bug-hint ok";
        aoBubble(ov, "收到囉，謝謝你的回報！");
      });
    } else if (aoTab === "rules") {
      aoBubble(ov, "不熟悉玩法嗎？這裡有完整的遊戲規則！");
      box.innerHTML = (c.rules || []).map((r) => `
        <div class="ao-rule">
          <div class="ao-rule-ic">${aoEsc(r.icon || "📋")}</div>
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
    return ov;
  }
  function caBubble(ov, txt) { ov.querySelector(".ao-bubble").textContent = txt || ""; }
  function caSetPrincipal(ov, img, owner) {
    const prin = ov.querySelector(".ao-principal"); if (prin) prin.style.display = "";   // 森林練習會隱藏它，這裡還原（overlay 單例重用）
    ov.classList.remove("ao-noprincipal");
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
        : ct === "exam_pass" ? "📝 去考檢定" : "";
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

  async function caOpenPractice(ov, sourceFilter) {
    if (sourceFilter !== undefined) caPractSource = sourceFilter || null;   // 'ai'=基礎練習(五大學院)；'uploaded'=課本(禁忌森林)；不帶參數=沿用(換一章用)
    const t = demoToken(); if (!t) { caBubble(ov, "請先建立角色～"); return; }
    const hdr = { "Content-Type": "application/json", "Authorization": "Bearer " + t };
    const box = ov.querySelector(".ao-content");
    ov.querySelector(".shop-title").textContent = caSubjConf().label + " · 選擇章節";
    box.innerHTML = `<div class="jc-empty">章節載入中…</div>`;
    let topics; try { topics = await fetch(DEMO_API + "/api/" + caSubject + "/topics", { headers: hdr }).then((r) => r.json()); } catch (e) { box.innerHTML = `<div class="jc-empty">載入失敗，請再試一次</div>`; return; }
    // 攝平所有章節，帶上年級與學期標籤；依 source 過濾(ai=基礎練習、uploaded=課本)
    const chs = [];
    (Array.isArray(topics.curriculum) ? topics.curriculum : []).forEach((g) => {
      (g.chapters || []).forEach((c) => chs.push(Object.assign({ _vol: g.volume_label || "", _grade: c.grade || g.grade }, c)));
    });
    // 互斥又窮盡：禁忌森林=只 uploaded(課本)；五大學院=其餘全收(ai/無題目/任何其他來源)→不會有章節兩邊都不顯示
    caPractChs = caPractSource === "uploaded" ? chs.filter((c) => c.source === "uploaded")
               : caPractSource === "ai" ? chs.filter((c) => c.source !== "uploaded")
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

  // 進入某一章節答題（章節由玩家在 caOpenPractice 挑）
  async function caRunPractice(ov, pick) {
    const t = demoToken(); if (!t) { caBubble(ov, "請先建立角色～"); return; }
    const hdr = { "Content-Type": "application/json", "Authorization": "Bearer " + t };
    const box = ov.querySelector(".ao-content");
    ov.querySelector(".shop-title").textContent = caSubjConf().label + " · 練習";
    box.innerHTML = `<div class="jc-empty">題目載入中…</div>`;
    let sess; try { sess = await fetch(DEMO_API + "/api/" + caSubject + "/session/start", { method: "POST", headers: hdr, body: JSON.stringify({ topic_id: pick.id, game: caSubjConf().game }) }).then((r) => r.json()); } catch (e) { box.innerHTML = `<div class="jc-empty">開始失敗</div>`; return; }
    if (sess.error || !(sess.questions || []).length) { box.innerHTML = `<div class="jc-empty">這個章節暫無題目（${aoEsc(sess.error || "")}）<div style="margin-top:14px;"><button class="jc-act ca-backpick">← 換一章</button></div></div>`; const bb = box.querySelector(".ca-backpick"); if (bb) bb.addEventListener("click", () => caOpenPractice(ov)); return; }
    caBubble(ov, `來練習「${aoEsc(pick.name)}」吧！答對越多，星星越多～`);
    const qs = sess.questions; let idx = 0, correct = 0;
    const renderQ = () => {
      const q = qs[idx];
      const choices = (q.choices || []).map((c) => `<button class="ca-choice jc-act" data-c="${aoEsc(c)}" style="width:100%;text-align:center;font-size:18px;padding:12px;">${aoEsc(c)}</button>`).join("");
      box.innerHTML = `<div style="text-align:center;padding:6px 4px;">
        <div style="font-size:13px;color:#8a6d3b;">第 ${idx + 1} / ${qs.length} 題　答對 ${correct}</div>
        <div style="font-size:15px;margin:8px 0 2px;color:#5a4630;">${aoEsc(q.prompt || "")}</div>
        ${q.display ? `<div style="font-size:52px;font-weight:900;margin:6px 0;color:#3a2c1a;">${aoEsc(q.display)}</div>` : ""}
        <div class="ca-choices" style="display:flex;flex-direction:column;gap:8px;max-width:320px;margin:10px auto 0;">${choices}</div>
        <div class="ca-fb" style="height:24px;margin-top:10px;font-weight:800;"></div></div>`;
      box.querySelectorAll(".ca-choice").forEach((btn) => btn.addEventListener("click", async function () {
        box.querySelectorAll(".ca-choice").forEach((b) => { b.disabled = true; });
        const ans = this.dataset.c; let r;
        try { r = await fetch(DEMO_API + "/api/" + caSubject + "/session/answer", { method: "POST", headers: hdr, body: JSON.stringify({ session_id: sess.session_id, question_id: q.id, answer: ans, time_ms: 0 }) }).then((x) => x.json()); } catch (e) { r = {}; }
        const fb = box.querySelector(".ca-fb");
        if (r.correct) { correct++; this.style.background = "#bfe6bf"; fb.textContent = "✓ 答對了！"; fb.style.color = "#3a8f3a"; }
        else { this.style.background = "#f0b9b9"; fb.textContent = "✗ 正解：" + aoEsc(r.correct_answer || ""); fb.style.color = "#c0392b"; box.querySelectorAll(".ca-choice").forEach((b) => { if (b.dataset.c === String(r.correct_answer)) b.style.background = "#bfe6bf"; }); }
        setTimeout(() => { idx++; (idx < qs.length) ? renderQ() : finish(); }, 1100);
      }));
    };
    const finish = async () => {
      box.innerHTML = `<div class="jc-empty">結算中…</div>`;
      let end; try { end = await fetch(DEMO_API + "/api/" + caSubject + "/session/end", { method: "POST", headers: hdr, body: JSON.stringify({ session_id: sess.session_id }) }).then((r) => r.json()); } catch (e) { end = {}; }
      const stars = Number(end.stars || 0);
      caMainAPI = await caLoadMainAPI();   // 刷新主線進度（星星已累積）
      box.innerHTML = `<div style="text-align:center;padding:22px 10px;">
        <div style="font-size:20px;font-weight:900;color:#3a2c1a;">練習完成！</div>
        <div style="font-size:15px;margin:10px 0;color:#5a4630;">答對 ${correct} / ${qs.length} 題</div>
        <div style="font-size:34px;margin:6px 0;">${"⭐".repeat(stars)}${"☆".repeat(Math.max(0, 3 - stars))}</div>
        <div style="font-size:13px;color:#8a6d3b;">星星已累積到${caSubjConf().label}進度，回去找${caDeanName()}領獎吧！</div>
        <div style="margin-top:16px;display:flex;gap:10px;justify-content:center;flex-wrap:nowrap;">
          <button class="jc-act ca-backpick">📖 再選章節</button>
          <button class="jc-act ca-back">← 回到${caDeanName()}</button></div></div>`;
      box.querySelector(".ca-back").addEventListener("click", () => { caTab = "overview"; caRenderAcademy(ov); });
      box.querySelector(".ca-backpick").addEventListener("click", () => caOpenPractice(ov));
    };
    renderQ();
  }

  /* ── NPC 任務面板：單一師長立繪 + 對白 + 任務領取 ── */
  function caRenderNpc(ov) {
    const c = CA_CONTENT || {};
    const n = (c.npcs || {})[caNpcId];
    if (!n) {                                  // 未知 npcId：清空避免殘留上一位師長的任務卡
      caBubble(ov, "找不到這位師長。");
      ov.querySelector(".ao-tabs4").innerHTML = "";
      ov.querySelector(".ao-content").innerHTML = `<div class="jc-empty">找不到這位師長</div>`;
      return;
    }
    ov.querySelector(".shop-title").textContent = "國語學院";
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
      caBubble(ov, (q && q.dialog) ? q.dialog : "好！這份獎勵你當之無愧。");
      caRenderNpc(ov);   // 重渲染：解鎖下一關
    }));
  }

  /* ── 人物簡介卡（朱熹等尚無任務的師長，走近顯示簡介+任務籌備中）── */
  function caRenderIntro(ov, figName) {
    const c = CA_CONTENT || {};
    const figs = Array.isArray(c.figures) ? c.figures : [];
    const f = figs.find((x) => x.name === figName);
    ov.querySelector(".shop-title").textContent = "國語學院";
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
    if (ov) ov.classList.remove("open");
    release();
  }
  window.openChineseAcademy = openChineseAcademy;
  window.openNpcQuest = openNpcQuest;

  /* ───────────────────── 英文學院 · 魔法陣（樣板：入口 + 第一層）───────────────────── */
  // 入魔師長資料（魔法陣每層一位；第 5 層為魔王汀其假扮院長）
  const EN_NPC = {
    andersen: {
      name: "安徒生", wake: "清醒的安徒生", layer: 1,
      darkLine: "嘿嘿……黑暗的力量真是舒服。想救我？先在答題對決中勝過我吧！",
      wakeLine: "謝謝你淨化了我！我終於清醒了……前往下一層，救救其他師長吧！",
    },
    hemingway: {
      name: "海明威", wake: "清醒的海明威", layer: 2,
      darkLine: "黑暗讓我的文字更冷酷。哼，用你的英語贏過我再說吧！",
      wakeLine: "你贏了，乾淨俐落。謝謝你喚醒我——再深處還有同伴等著你。",
    },
    hugo: {
      name: "雨果", wake: "清醒的雨果", layer: 3,
      darkLine: "悲慘世界？現在輪到你嚐嚐絕望了！答得出來就試試看！",
      wakeLine: "正義終究戰勝了黑暗。謝謝你，孩子，繼續前進吧！",
    },
    milton: {
      name: "約翰彌爾頓", wake: "清醒的約翰彌爾頓", layer: 4,
      darkLine: "失樂園……你也將墜入其中。除非你能在答題中勝過我！",
      wakeLine: "光明重返樂園。最深處的魔王正等著你——小心，他假扮成院長。",
    },
    tinch: {
      name: "汀其", wake: "真正的院長已歸位", layer: 5, boss: true, last: true,
      darkLine: "哈哈哈！我才是這座魔法陣真正的主人！區區學生，也想阻止我？放馬過來！",
      wakeLine: "可惡……被你看穿了。魔王汀其被擊退，英文學院的光輝完全恢復了！",
    },
  };
  let enOnClose = null;
  function enKey(id) { return "village_en_purify_" + id; }
  function enIsPurified(id) { try { return !!localStorage.getItem(enKey(id)); } catch (e) { return false; } }
  function enSetPurified(id) { try { localStorage.setItem(enKey(id), "1"); } catch (e) {} }
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
    ov.querySelector(".shop-title").textContent = "英文學院";
    ov.querySelector(".en-content").innerHTML = `
      <div style="font-size:13px;color:#8a6d3b;line-height:1.7;margin-bottom:12px;">
        🔮 <b>魔法陣共五層</b>，每層有一位入魔的師長。<br>
        用答題對決勝過他，就能淨化他、開啟下一層。<br>
        <span style="opacity:.7;">（解鎖門檻：集滿四院教師證 + 英語禁忌森林/模擬考/檢定考次數 — 樣板暫時開放）</span>
      </div>
      <div style="display:flex;flex-direction:column;gap:10px;">
        <button class="jc-act en-board" style="width:100%;">📋 英語基礎練習（布告欄）</button>
        <button class="jc-act en-enter" style="width:100%;background:linear-gradient(135deg,#7b4dd8,#a06bf0);color:#fff;">🔮 進入魔法陣 · 第一層</button>
      </div>`;
    ov.classList.add("open");
    ov.querySelector(".en-board").addEventListener("click", () => {
      ov.classList.remove("open");          // 收起入口、保留 modal 鎖，去開練習面板
      enOpenBoard(enOnClose);
    });
    ov.querySelector(".en-enter").addEventListener("click", () => {
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
    ov.querySelector(".shop-title").textContent = "魔法陣 · 第 " + (d.layer || 1) + " 層";
    const hint = d.last
      ? "🎉 你已淨化全部師長，通關英文學院魔法陣！"
      : "封印之門已開啟，走到上方的門即可前往下一層。";
    ov.querySelector(".en-content").innerHTML = `
      <div style="text-align:center;padding:18px 8px;">
        <div style="font-size:42px;">${d.last ? "🏆" : "✨"}</div>
        <div style="font-size:16px;font-weight:800;color:#3a2c1a;margin:8px 0;">${aoEsc(d.wake)}</div>
        <div style="font-size:13px;color:#8a6d3b;">${aoEsc(hint)}</div>
        <div style="margin-top:16px;"><button class="jc-act en-x" style="width:auto;">離開</button></div>
      </div>`;
    ov.classList.add("open");
    ov.querySelector(".en-x").addEventListener("click", enClose);
  }

  // 答題對決（PK）：勝過入魔師長就淨化他
  async function enOpenDuel(npcId, onClose) {
    onCloseCb = onClose || null;
    const d = EN_NPC[npcId] || { name: npcId, wake: "清醒的" + npcId, layer: 1, darkLine: "想救我？先勝過我！", wakeLine: "謝謝你淨化了我！" };
    if (enIsPurified(npcId)) { enOpenCleared(npcId, onClose); return; }
    const ov = enBuildOverlay();
    enFace(ov, npcId + "_dark.webp", d.darkLine, (d.boss ? "😈 魔王 " : "👹 入魔的 ") + d.name);
    ov.querySelector(".shop-title").textContent = "魔法陣 · 第 " + d.layer + " 層" + (d.boss ? "（魔王）" : "");
    ov.classList.add("open");
    const box = ov.querySelector(".en-content");
    box.innerHTML = `
      <div style="text-align:center;padding:14px 8px;">
        <div style="font-size:14px;color:#5a4630;line-height:1.7;margin-bottom:14px;">⚔️ 用英語答題對決他。<br>答對六成以上即可${d.boss ? "擊退魔王、通關魔法陣" : "淨化他、開啟下一層"}！</div>
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
    (Array.isArray(topics.curriculum) ? topics.curriculum : []).forEach((g) => (g.chapters || []).forEach((c) => chs.push(c)));
    const pool = chs.filter((c) => c.source !== "uploaded");
    const pick = pool.find((c) => c.unlocked) || pool[0] || chs[0];
    if (!pick) { box.innerHTML = `<div class="jc-empty">目前沒有英語題目可對決</div><div style="text-align:center;margin-top:12px;"><button class="jc-act en-x">離開</button></div>`; box.querySelector(".en-x").addEventListener("click", enClose); return; }
    let sess; try { sess = await fetch(DEMO_API + "/api/english/session/start", { method: "POST", headers: hdr, body: JSON.stringify({ topic_id: pick.id, game: "vocab" }) }).then((r) => r.json()); } catch (e) { sess = {}; }
    const qs = (sess && sess.questions) || [];
    if (sess.error || !qs.length) { box.innerHTML = `<div class="jc-empty">這位師長暫時無法對決（${aoEsc(sess.error || "無題目")}）</div><div style="text-align:center;margin-top:12px;"><button class="jc-act en-x">離開</button></div>`; box.querySelector(".en-x").addEventListener("click", enClose); return; }
    let idx = 0, correct = 0;
    const need = Math.max(1, Math.ceil(qs.length * 0.6));
    const renderQ = () => {
      const q = qs[idx];
      const choices = (q.choices || []).map((c) => `<button class="en-choice jc-act" data-c="${aoEsc(c)}" style="width:100%;text-align:center;font-size:18px;padding:12px;">${aoEsc(c)}</button>`).join("");
      box.innerHTML = `<div style="text-align:center;padding:6px 4px;">
        <div style="font-size:13px;color:#7b4dd8;font-weight:800;">⚔️ 對決中　第 ${idx + 1}/${qs.length} 題　答對 ${correct}（需 ${need}）</div>
        <div style="font-size:15px;margin:8px 0 2px;color:#5a4630;">${aoEsc(q.prompt || "")}</div>
        ${q.display ? `<div style="font-size:40px;font-weight:900;margin:6px 0;color:#3a2c1a;">${aoEsc(q.display)}</div>` : ""}
        <div style="display:flex;flex-direction:column;gap:8px;max-width:320px;margin:10px auto 0;">${choices}</div>
        <div class="en-fb" style="height:24px;margin-top:10px;font-weight:800;"></div></div>`;
      box.querySelectorAll(".en-choice").forEach((btn) => btn.addEventListener("click", async function () {
        box.querySelectorAll(".en-choice").forEach((b) => { b.disabled = true; });
        let r; try { r = await fetch(DEMO_API + "/api/english/session/answer", { method: "POST", headers: hdr, body: JSON.stringify({ session_id: sess.session_id, question_id: q.id, answer: this.dataset.c, time_ms: 0 }) }).then((x) => x.json()); } catch (e) { r = {}; }
        const fb = box.querySelector(".en-fb");
        if (r.correct) { correct++; this.style.background = "#bfe6bf"; fb.textContent = "✓ 答對！"; fb.style.color = "#3a8f3a"; }
        else { this.style.background = "#f0b9b9"; fb.textContent = "✗ 正解：" + aoEsc(r.correct_answer || ""); fb.style.color = "#c0392b"; box.querySelectorAll(".en-choice").forEach((b) => { if (b.dataset.c === String(r.correct_answer)) b.style.background = "#bfe6bf"; }); }
        setTimeout(() => { idx++; (idx < qs.length) ? renderQ() : finish(); }, 1000);
      }));
    };
    const finish = async () => {
      box.innerHTML = `<div class="jc-empty">結算中…</div>`;
      try { await fetch(DEMO_API + "/api/english/session/end", { method: "POST", headers: hdr, body: JSON.stringify({ session_id: sess.session_id }) }); } catch (e) {}
      const win = correct >= need;
      if (win) {
        enSetPurified(npcId);
        enFace(ov, npcId + "_front.webp", d.wakeLine, "✨ " + d.wake);
        box.innerHTML = `<div style="text-align:center;padding:18px 8px;">
          <div style="font-size:44px;">${d.boss ? "🏆" : "✨"}</div>
          <div style="font-size:18px;font-weight:900;color:#7b4dd8;margin:8px 0;">${d.boss ? "魔王擊退！通關！" : "淨化成功！"}</div>
          <div style="font-size:14px;color:#5a4630;">答對 ${correct}/${qs.length}　${d.boss ? "英文學院光輝恢復了！" : aoEsc(d.name) + " 恢復清醒了！"}</div>
          <div style="font-size:13px;color:#8a6d3b;margin-top:6px;">${d.last ? "" : "封印之門已開啟，走到上方的門前往下一層。"}</div>
          <div style="margin-top:16px;"><button class="jc-act en-done" style="width:auto;background:linear-gradient(135deg,#7b4dd8,#a06bf0);color:#fff;">離開魔法陣</button></div></div>`;
        box.querySelector(".en-done").addEventListener("click", () => {
          enClose();
          if (window.__exploreReload) window.__exploreReload();   // 重載本層 → 立繪變清醒、封印之門開通
        });
      } else {
        box.innerHTML = `<div style="text-align:center;padding:18px 8px;">
          <div style="font-size:44px;">💢</div>
          <div style="font-size:18px;font-weight:900;color:#c0392b;margin:8px 0;">對決失敗…</div>
          <div style="font-size:14px;color:#5a4630;">只答對 ${correct}/${qs.length}（需 ${need}）。再加強英語，回來挑戰！</div>
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

  /* ───────────────────── 裝備欄（純展示：左=目前造型 / 右=帽子·武器·寵物項圈配件）───────────────────── */
  const EQ_KEY = "village_equip";
  const EQUIP = {
    // body=目前造型(衣服店買的)，顯示在左大立繪，不放右格
    body: { label: "造型", items: [
      { id: "f_academic", img: "outfits/f_academic.webp", name: "學院風" },
      { id: "f_dress", img: "outfits/f_dress.webp", name: "洋裝" },
      { id: "f_elf", img: "outfits/f_elf.webp", name: "精靈裝" },
      { id: "f_kawaii", img: "outfits/f_kawaii.webp", name: "可愛風" },
      { id: "m_knight", img: "outfits/m_knight.webp", name: "騎士裝" },
      { id: "m_sports", img: "outfits/m_sports.webp", name: "運動服" },
      { id: "m_superhero", img: "outfits/m_superhero.webp", name: "英雄裝" },
      { id: "m_wizard_kid", img: "outfits/m_wizard_kid.webp", name: "小巫師" },
    ] },
    hat: { label: "帽子", items: [
      { id: "hat_student", img: "equip/hat_student.webp", name: "學生帽" },
      { id: "hat_wizard", img: "equip/hat_wizard.webp", name: "巫師帽" },
      { id: "hat_crown", img: "equip/hat_crown.webp", name: "皇冠" },
      { id: "hat_catear", img: "equip/hat_catear.webp", name: "貓耳髮箍" },
      { id: "hat_straw", img: "equip/hat_straw.webp", name: "草帽" },
    ] },
    weapon: { label: "武器", items: [
      { id: "knife", img: "../assets/images/onboarding/knife.png", name: "巨大美工刀" },
    ] },
    // 寵物項圈格：依目前寵物顯示「對應配件」(acc_*)；img=寵物本體圖(寵物頁用)
    pet: { label: "寵物項圈", items: [
      { id: "pet_cat", name: "小貓", img: "equip/pet_cat.webp", acc_img: "equip/acc_yarn.webp", acc_name: "毛線球" },
      { id: "pet_bunny", name: "兔子", img: "equip/pet_bunny.webp", acc_img: "equip/acc_carrot.webp", acc_name: "紅蘿蔔" },
      { id: "pet_puppy", name: "小狗", img: "equip/pet_puppy.webp", acc_img: "equip/acc_collar.webp", acc_name: "項圈" },
      { id: "pet_penguin", name: "企鵝", img: "equip/pet_penguin.webp", acc_img: "equip/acc_fish.webp", acc_name: "小魚" },
      { id: "pet_panda", name: "熊貓", img: "equip/pet_panda.webp", acc_img: "equip/acc_bamboo.webp", acc_name: "竹子" },
    ] },
  };
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
    return s;
  }
  function eqItem(cat, id) { return EQUIP[cat].items.find((it) => it.id === id) || EQUIP[cat].items[0]; }

  /* ── 背包道具欄（真實 inventory）：addToBag 給未來「獲得道具」用；demo 放 16 職業道具(jobtools 真圖)看看 ── */
  const BAG_KEY = "village_bag", BAG_MAX = 30, JT_IMG = "../assets/images/jobtools/";
  const BAG_DEMO = [
    { id: "cert_chinese", img: "cert_chinese.png", name: "國語證照" },
    { id: "cert_math", img: "cert_math.png", name: "數學證照" },
    { id: "cert_english", img: "cert_english.png", name: "英語證照" },
    { id: "cert_science", img: "cert_science.png", name: "自然證照" },
    { id: "cert_social", img: "cert_social.png", name: "社會證照" },
    { id: "cert_teacher", img: "cert_teacher.png", name: "教師證" },
    { id: "tool_reporter", img: "tool_reporter.png", name: "記者證" },
    { id: "tool_writer", img: "tool_writer.png", name: "靈感鋼筆" },
    { id: "tool_trader", img: "tool_trader.png", name: "財金人員資格證" },
    { id: "tool_accountant", img: "tool_accountant.png", name: "會計師資格證" },
    { id: "tool_translator", img: "tool_translator.png", name: "超級電子字典" },
    { id: "tool_foreign_corp", img: "tool_foreign_corp.png", name: "外商員工證" },
    { id: "tool_engineer", img: "tool_engineer.png", name: "科技業員工證" },
    { id: "tool_researcher", img: "tool_researcher.png", name: "研究人員資格證" },
    { id: "tool_social_worker", img: "tool_social_worker.png", name: "社工證" },
    { id: "tool_congress_aide", img: "tool_congress_aide.png", name: "助理證" },
  ].map((it) => ({ id: it.id, img: JT_IMG + it.img, name: it.name }));
  function bagWrite(b) { try { localStorage.setItem(BAG_KEY, JSON.stringify(b)); } catch (e) {} }
  function bagCurrent() {
    let b; try { b = JSON.parse(localStorage.getItem(BAG_KEY) || "null"); } catch (e) {}
    if (!Array.isArray(b) || (b.length && !b[0].img)) { b = BAG_DEMO.slice(); bagWrite(b); }   // 未設或舊格式→重 seed
    return b;
  }
  function getBag() { return bagCurrent().slice(0, BAG_MAX); }
  // 未來「獲得道具」呼叫：addToBag({id, img, name})；背包滿 30 回 false
  function addToBag(item) {
    const b = bagCurrent(); if (b.length >= BAG_MAX) return false;
    b.push(item); bagWrite(b); return true;
  }
  window.addToBag = addToBag;

  function eqBuildOverlay() {
    let ov = document.getElementById("eq-overlay");
    if (ov) return ov;
    ov = el("div"); ov.id = "eq-overlay";
    ov.innerHTML = `
      <div class="shop-panel jc-panel eq-panel">
        <div class="shop-title">人物裝備</div>
        <button class="shop-close" aria-label="關閉">×</button>
        <div class="eq-main">
          <div class="eq-portrait"><img id="eq-port" alt="目前造型"></div>
          <div class="eq-slots"></div>
          <div class="eq-backpack">
            <div class="eq-bp-head">背包</div>
            <div class="eq-bp-grid"></div>
          </div>
        </div>
      </div>`;
    document.body.appendChild(ov);
    ov.querySelector(".shop-close").addEventListener("click", eqClose);
    ov.addEventListener("click", (e) => { if (e.target === ov) eqClose(); });
    return ov;
  }

  // 純展示：左=目前造型立繪 / 中三格=帽子·衣服·武器 / 右=背包(30格)
  const EQ_BP_SLOTS = 30;
  function eqRender(ov) {
    const s = getEquip();
    // 左大立繪 = 目前造型
    ov.querySelector("#eq-port").src = eqItem("body", s.body).img + "?v=1";
    // 中三格 帽子/衣服/武器
    ov.querySelector(".eq-slots").innerHTML = EQ_SLOTS.map((cat) => {
      const it = eqItem(cat, s[cat]);
      return `<div class="eq-slot" data-cat="${cat}">
          <div class="eq-slot-ic"><img src="${it.img}?v=1" alt="${it.name}"></div>
          <div class="eq-slot-tx"><div class="eq-slot-lb">${EQ_SLOT_LB[cat]}</div><div class="eq-slot-nm">${it.name}</div></div>
        </div>`;
    }).join("");
    // 右背包：道具欄（真實 inventory，demo 放 25 職業道具）
    const bag = getBag();
    ov.querySelector(".eq-bp-grid").innerHTML =
      Array.from({ length: EQ_BP_SLOTS }, (_, i) => {
        const it = bag[i];
        return it
          ? `<div class="eq-bp-cell filled" title="${it.name}"><img src="${it.img}?v=1" alt="${it.name}"></div>`
          : `<div class="eq-bp-cell"></div>`;
      }).join("");
  }

  function openEquip() {
    const ov = eqBuildOverlay();
    eqRender(ov);
    ov.classList.add("open");
  }
  function eqClose() { const ov = document.getElementById("eq-overlay"); if (ov) ov.classList.remove("open"); }
  window.openEquip = openEquip;

  /* ───────────────────── 個人小屋 hub（學生宿舍：更衣室 / 角色裝備 / 寵物 / 圖鑑，純展示）───────────────────── */
  let dhTab = "outfit";
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
          <div class="dh-owner">🏠 你的小屋</div>
        </div>
        <div class="dh-rightcol">
          <div class="jc-tabs dh-tabs">
            <button class="jc-tab" data-tab="outfit">更衣室</button>
            <button class="jc-tab" data-tab="gear">角色裝備</button>
            <button class="jc-tab" data-tab="pet">寵物</button>
            <button class="jc-tab" data-tab="book">圖鑑</button>
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
    ov.querySelector(".dh-port").src = eqItem("body", s.body).img + "?v=1";   // 左預覽=目前造型
    const box = ov.querySelector(".dh-content"); box.innerHTML = "";

    if (dhTab === "outfit") {
      dhBubble(ov, "換上喜歡的造型吧！");
      box.innerHTML = `<div class="dh-grid">` +
        EQUIP.body.items.map((it) => dhCard({ id: it.id, img: it.img, name: it.name, sel: it.id === s.body })).join("") + `</div>`;
      box.querySelectorAll(".dh-card").forEach((c) => c.addEventListener("click", () => {
        setEquip("body", c.dataset.id); dhBubble(ov, "換上「" + eqItem("body", c.dataset.id).name + "」！"); dhRender(ov);
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
    }
  }
  function openDormHub(onClose) {
    onCloseCb = onClose || null;
    const ov = dhBuildOverlay();
    dhTab = "outfit"; dhRender(ov);
    ov.classList.add("open");
  }
  function dhClose() {
    const ov = document.getElementById("dh-overlay");
    if (ov) ov.classList.remove("open");
    release();
  }
  window.openDormHub = openDormHub;
})();
