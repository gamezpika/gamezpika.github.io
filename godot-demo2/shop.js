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
    ov.querySelector(".shop-merchant img").src = shop.merchant + "?v=1";
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
})();
