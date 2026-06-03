// 商人販售介面 — 純展示（不扣金幣、不穿上身），商品/服裝套 EDU 素材
(function () {
  let CATALOG = null;
  let onCloseCb = null;

  // 商人招呼台詞（隨機 + 購買反應）— 帶老闆個性
  const GREET = {
    grocer: ["大量批發最划算啦！", "新鮮貨色，俗俗賣！", "來來來，整箱搬回家！"],
    boutique: ["親愛的，這款超適合你～", "本季新款，時尚必備！", "美麗是一種態度唷♥"],
    menswear: ["先生，這套很襯您的氣質。", "紳士的衣櫥，不能將就。", "為您量身打造，請慢慢挑。"],
  };
  const BUY_REACT = ["好眼光！", "謝謝惠顧～", "包在我身上！", "下次再來唷！"];

  function el(tag, cls, html) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }

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

  function renderCats(ov, shop) {
    const cats = ["全部", ...Array.from(new Set(shop.items.map((it) => it.cat).filter(Boolean)))];
    const bar = ov.querySelector(".shop-cats");
    bar.innerHTML = "";
    // 服裝店若沒分類就不顯示分類列
    if (cats.length <= 1) return;
    cats.forEach((c, i) => {
      const b = el("div", "shop-cat" + (i === 0 ? " active" : ""), c);
      b.addEventListener("click", () => {
        bar.querySelectorAll(".shop-cat").forEach((x) => x.classList.remove("active"));
        b.classList.add("active");
        renderGrid(ov, shop, c);
      });
      bar.appendChild(b);
    });
  }

  async function openShop(shopId, onClose) {
    if (shopId === "job_center") { openJobCenter(onClose); return; }
    if (shopId === "academy_office") { openAcademyOffice(onClose); return; }
    if (shopId === "chinese_academy") { openChineseAcademy(onClose); return; }
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
    ov.querySelector(".shop-merchant img").src = shop.merchant + "?v=5";
    ov.querySelector(".shop-owner").textContent = shop.owner ? "👤 老闆 · " + shop.owner : "";
    const g = GREET[shopId] || ["歡迎光臨！"];
    bubble(ov, g[Math.floor(Math.random() * g.length)]);
    renderCats(ov, shop);
    renderGrid(ov, shop, "全部");
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
  let caTab = 0;   // 目前任務線 index
  async function caLoad() {
    if (CA_CONTENT) return CA_CONTENT;
    const r = await fetch("chinese_academy.json?v=1");
    if (!r.ok) throw new Error("chinese academy HTTP " + r.status);
    CA_CONTENT = await r.json();
    return CA_CONTENT;
  }
  function caBuildOverlay() {
    let ov = document.getElementById("ca-overlay");
    if (ov) return ov;
    ov = el("div"); ov.id = "ca-overlay";
    ov.innerHTML = `
      <div class="shop-panel ao-panel">
        <div class="shop-title">孔丘書院</div>
        <button class="shop-close" aria-label="關閉">×</button>
        <div class="ao-principal">
          <div class="ao-bubble"></div>
          <img class="ao-principal-img" src="kongqiu_npc.webp?v=1" alt="孔丘書院 院長 孔丘" draggable="false">
          <div class="ao-owner">👤 孔丘書院 · 院長 孔丘</div>
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

  function caRender(ov) {
    const c = CA_CONTENT || { lines: [] };
    const d = c.dean;
    if (d) {                                   // 院長資料以 JSON 為準，避免與畫面漂移
      if (d.img) ov.querySelector(".ao-principal-img").src = d.img + "?v=1";
      ov.querySelector(".ao-owner").textContent = "👤 " + (d.title || "") + (d.name ? " " + d.name : "");
    }
    const lines = c.lines || [];
    if (caTab >= lines.length) caTab = 0;
    const tabs = ov.querySelector(".ao-tabs4");
    tabs.innerHTML = lines.map((ln, i) =>
      `<button class="jc-tab${i === caTab ? " active" : ""}" data-i="${i}">${aoEsc(ln.tab)}</button>`).join("");
    tabs.querySelectorAll(".jc-tab").forEach((b) =>
      b.addEventListener("click", () => { caTab = +b.dataset.i; caRender(ov); }));
    const ln = lines[caTab] || { quests: [] };
    caBubble(ov, ln.intro || "");
    const box = ov.querySelector(".ao-content");
    box.innerHTML = (ln.quests || []).map((q) => `
      <div class="ao-quest">
        <div class="ao-quest-ic">${aoEsc(q.icon || "📜")}</div>
        <div class="ao-quest-body">
          <div class="ao-quest-title">${aoEsc(q.title)}</div>
          <div class="ao-quest-desc">${aoEsc(q.desc)}<span class="ca-npc">· ${aoEsc(ln.npc)}</span></div>
          <div class="ao-quest-foot"><span class="ao-quest-reward">🎁 ${aoEsc(q.reward)}</span>${q.progress ? `<span class="ao-quest-prog">${aoEsc(q.progress)}</span>` : ""}</div>
        </div>
        <button class="jc-act ao-quest-claim">領取</button>
      </div>`).join("") || `<div class="jc-empty">目前沒有任務</div>`;
    box.querySelectorAll(".ao-quest-claim").forEach((b) => b.addEventListener("click", function () {
      if (this.classList.contains("done")) return;
      this.classList.add("done"); this.textContent = "✓ 已領取";
      caBubble(ov, "好！學而時習之，這份獎勵你當之無愧。");
    }));
  }

  async function openChineseAcademy(onClose) {
    onCloseCb = onClose || null;
    const ov = caBuildOverlay();
    caTab = 0;
    try { await caLoad(); }
    catch (e) { console.warn("chinese academy 載入失敗", e); }
    caRender(ov);
    ov.classList.add("open");
  }
  function caClose() {
    const ov = document.getElementById("ca-overlay");
    if (ov) ov.classList.remove("open");
    release();
  }
  window.openChineseAcademy = openChineseAcademy;

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
    // 寵物項圈格：依目前寵物顯示「對應配件」(acc_*)
    pet: { label: "寵物項圈", items: [
      { id: "pet_cat", name: "小貓", acc_img: "equip/acc_yarn.webp", acc_name: "毛線球" },
      { id: "pet_bunny", name: "兔子", acc_img: "equip/acc_carrot.webp", acc_name: "紅蘿蔔" },
      { id: "pet_puppy", name: "小狗", acc_img: "equip/acc_collar.webp", acc_name: "項圈" },
      { id: "pet_penguin", name: "企鵝", acc_img: "equip/acc_fish.webp", acc_name: "小魚" },
      { id: "pet_panda", name: "熊貓", acc_img: "equip/acc_bamboo.webp", acc_name: "竹子" },
    ] },
  };
  const EQ_SLOTS = ["hat", "weapon", "pet"]; // 右側三格
  const EQ_ALL = ["body", "hat", "weapon", "pet"];
  function getEquip() {
    let s = {};
    try { const p = JSON.parse(localStorage.getItem(EQ_KEY) || "{}"); if (p && typeof p === "object") s = p; } catch (e) {}
    EQ_ALL.forEach((cat) => { if (!EQUIP[cat].items.some((it) => it.id === s[cat])) s[cat] = EQUIP[cat].items[0].id; });
    return s;
  }
  function eqItem(cat, id) { return EQUIP[cat].items.find((it) => it.id === id) || EQUIP[cat].items[0]; }

  function eqBuildOverlay() {
    let ov = document.getElementById("eq-overlay");
    if (ov) return ov;
    ov = el("div"); ov.id = "eq-overlay";
    ov.innerHTML = `
      <div class="shop-panel jc-panel eq-panel">
        <div class="shop-title">裝備 / 寵物</div>
        <button class="shop-close" aria-label="關閉">×</button>
        <div class="eq-main">
          <div class="eq-portrait"><img id="eq-port" alt="目前造型"></div>
          <div class="eq-slots"></div>
        </div>
      </div>`;
    document.body.appendChild(ov);
    ov.querySelector(".shop-close").addEventListener("click", eqClose);
    ov.addEventListener("click", (e) => { if (e.target === ov) eqClose(); });
    return ov;
  }

  // 純展示：左=目前造型(衣服店)，右三格=帽子/武器/寵物配件(依寵物)
  function eqRender(ov) {
    const s = getEquip();
    // 左大立繪 = 目前造型
    ov.querySelector("#eq-port").src = eqItem("body", s.body).img + "?v=1";
    // 右三格
    ov.querySelector(".eq-slots").innerHTML = EQ_SLOTS.map((cat) => {
      const it = eqItem(cat, s[cat]);
      const img = cat === "pet" ? it.acc_img : it.img;
      const nm = cat === "pet" ? it.acc_name : it.name;
      return `<div class="eq-slot" data-cat="${cat}">
          <div class="eq-slot-ic"><img src="${img}?v=1" alt="${nm}"></div>
          <div class="eq-slot-tx"><div class="eq-slot-lb">${EQUIP[cat].label}</div><div class="eq-slot-nm">${nm}</div></div>
        </div>`;
    }).join("");
  }

  function openEquip() {
    const ov = eqBuildOverlay();
    eqRender(ov);
    ov.classList.add("open");
  }
  function eqClose() { const ov = document.getElementById("eq-overlay"); if (ov) ov.classList.remove("open"); }
  window.openEquip = openEquip;
})();
