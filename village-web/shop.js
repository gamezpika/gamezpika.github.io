// 商人販售介面 — 純展示（不扣金幣、不穿上身），商品/服裝套 EDU 素材
(function () {
  let CATALOG = null;
  let onCloseCb = null;

  // 商人招呼台詞（隨機 + 購買反應）
  const GREET = {
    grocer: ["新鮮蔬果，來看看唷！", "今天的菜很青喔～", "歡迎光臨蔬果攤！"],
    boutique: ["新款到貨，快來試試！", "這件超適合你的～", "歡迎光臨服裝店！"],
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
        <img src="${it.img}" alt="${it.name}" loading="lazy">
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
    ov.querySelector(".shop-merchant img").src = shop.merchant + "?v=2";
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
  const SUBJ = { math: "數學", chinese: "國語", social: "社會" };
  const JOBS = {
    math_detective: { name: "數學偵探", subj: "math", tier: 1, sprite: "math_detective.png",
      desc: "用偵探般的眼光破解每一道數學題！", skill: "數學魔王戰多 1 顆愛心",
      need: "入門職業 · 免條件", next: "engineer",
      quest: { title: "破解 5 道數學謎題", reward: "金幣 ×100 + 偵探放大鏡" } },
    engineer: { name: "工程師", subj: "math", tier: 2, sprite: "engineer.png",
      desc: "用科學打造未來。", skill: "數學魔王戰 +2 愛心 + 牧場 exp ×1.5",
      need: "需：數學 60+ 且 自然 60+", next: "ai_engineer",
      quest: { title: "設計並建造 3 座裝置", reward: "金幣 ×300 + 工程計算機" } },
    ai_engineer: { name: "AI 工程師", subj: "math", tier: 3, sprite: "ai_engineer.png",
      desc: "用 AI 改變未來。", skill: "每天可自動跳過 1 題（一定答對）",
      need: "需：已解鎖工程師 + 數學 120+", next: null,
      quest: { title: "訓練 AI 模型答對 20 題", reward: "金幣 ×800 + AI 晶片" } },
    poet: { name: "詩人", subj: "chinese", tier: 1, sprite: "poet.png",
      desc: "用文字編織意境的人。", skill: "答對國語題金幣 +50%",
      need: "入門職業 · 免條件", next: null, nextNeed: "需：文字大師已解鎖 + 國語 90+ + 答對國語 200 題",
      quest: { title: "創作 3 首主題詩", reward: "金幣 ×100 + 詩人之筆" } },
    explorer: { name: "探險家", subj: "social", tier: 1, sprite: "explorer.png",
      desc: "走遍世界尋找歷史的人。", skill: "答對社會題自動解鎖背景知識卡",
      need: "入門職業 · 免條件", next: null, nextNeed: "需：社會 60+ + 答對社會 100 題",
      quest: { title: "探索 5 個歷史遺跡", reward: "金幣 ×100 + 古代地圖" } },
  };
  const JC_KEY = "village_job";
  // 防呆：非法/過期的存值一律視為「無職業」，避免 JOBS[cur] 取值炸掉把玩家鎖死
  const getJob = () => { const k = localStorage.getItem(JC_KEY); return k && JOBS[k] ? k : null; };
  const setJob = (k) => localStorage.setItem(JC_KEY, k);
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
          <button class="jc-tab" data-tab="pick">選擇職業</button>
          <button class="jc-tab" data-tab="promote">轉職</button>
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
    return `<div class="jc-card${opts.cur ? " cur" : ""}${opts.locked ? " locked" : ""}" data-job="${k}">
        <img src="${JOB_IMG}${j.sprite}?v=1" alt="${j.name}" loading="lazy">
        <div class="jc-info">
          <div class="jc-nm">${j.name} <span class="jc-badge">${SUBJ[j.subj]}·階${j.tier}</span></div>
          <div class="jc-desc">${j.desc}</div>
          <div class="jc-skill">🌟 ${j.skill}</div>
          <div class="jc-need">${opts.needText || j.need}</div>
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
      : "目前職業：<b>無</b>（還是學院實習生）";
    const box = ov.querySelector(".jc-content");
    box.innerHTML = "";

    if (jcTab === "pick") {
      jcBubble(ov, "想成為什麼樣的人呢？選一個入門職業吧！");
      const starters = Object.keys(JOBS).filter((k) => JOBS[k].tier === 1);
      box.innerHTML = starters.map((k) => jcJobCard(k, { cur: k === cur, btn: k === cur ? "目前職業" : "選擇" })).join("");
      box.querySelectorAll(".jc-card").forEach((c) => c.addEventListener("click", () => {
        const k = c.dataset.job;
        if (k === getJob()) { jcBubble(ov, "這已經是你目前的職業囉～"); return; }
        setJob(k); jcBubble(ov, "恭喜！你成為了「" + JOBS[k].name + "」！");
        jcRender(ov);
      }));
    } else if (jcTab === "promote") {
      if (!cur) { jcBubble(ov, "先到「選擇職業」挑一個入門職業，才能轉職唷！");
        box.innerHTML = `<div class="jc-empty">尚未選擇職業<br>請先到「選擇職業」分頁</div>`; return; }
      const j = JOBS[cur];
      if (j.next) {
        jcBubble(ov, "達成條件就能轉職到更高階的職業！");
        box.innerHTML = jcJobCard(j.next, { btn: "轉職", needText: JOBS[j.next].need });
        box.querySelector(".jc-act").addEventListener("click", () => {
          setJob(j.next); jcBubble(ov, "轉職成功！你現在是「" + JOBS[j.next].name + "」！");
          jcTab = "promote"; jcRender(ov);
        });
      } else if (j.nextNeed) {
        jcBubble(ov, "下一階職業尚未開放，先去達成條件吧！");
        box.innerHTML = `<div class="jc-locked-note">🔒 下一階轉職條件<br><span>${j.nextNeed}</span><br><i>（demo 展示用，達成後開放）</i></div>`;
      } else {
        jcBubble(ov, "你已經達到這條職業路線的最高階了，太厲害了！");
        box.innerHTML = `<div class="jc-empty">🏆 已達最高階職業<br>${j.name}</div>`;
      }
    } else if (jcTab === "quest") {
      if (!cur) { jcBubble(ov, "先選擇職業，才有專屬任務可以領取唷！");
        box.innerHTML = `<div class="jc-empty">尚未選擇職業<br>請先到「選擇職業」分頁</div>`; return; }
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
})();
