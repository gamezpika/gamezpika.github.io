/* arcade 獨立頁共用墊片：取代 LIFF app 的 eduApp/eduApi 殼
 * 遊戲 JS（game_whack.js / english_puzzle.js）原封從正式版搬來，只認這兩個介面。 */
(function () {
    // 本機測試可用 ?api=http://localhost:8000 指到本機後端
    const API = new URLSearchParams(location.search).get("api")
        || "https://eduarena-tutoring-production.up.railway.app";
    window.ARCADE_API = API;

    // 返回網址：機台跳轉時帶來 ?back_spawn=x,y → 回去落在原本機台前面（不是傳送點）
    // ?back_map=competitive → 回指定地圖（競技場 PK 用）；沒帶維持遊樂場
    function playgroundUrl() {
        let bs = "", bm = "";
        try {
            const q = new URLSearchParams(location.search);
            bs = q.get("back_spawn") || "";
            bm = q.get("back_map") || "";
        } catch (e) {}
        const map = /^[a-z_]{1,30}$/.test(bm) ? bm : "playground";
        return "village-web/index.html?map=" + map + (/^0\.\d+,0\.\d+$/.test(bs) ? "&spawn=" + bs : "");
    }

    function getToken() {
        try { return localStorage.getItem("eduarena_demo_token") || ""; } catch (e) { return ""; }
    }

    // 沒身分（直接開連結）→ 自動建 demo 訪客（同 shop.js ensureDemoPlayer 流程）
    let provisioning = null;
    function ensureToken() {
        if (getToken()) return Promise.resolve(getToken());
        if (!provisioning) provisioning = (async () => {
            try {
                const j = (r) => r.json();
                const uid = "demo_" + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36);
                await fetch(API + "/api/auth", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "web", userId: uid, name: "小訪客" }) }).then(j);
                const ch = await fetch(API + "/api/auth/child/create", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ platform: "web", platform_user_id: uid, child_name: "小訪客", grade: 2, semester: 1 }) }).then(j);
                const cid = ch && ch.child && ch.child.id;
                if (cid) {
                    const sel = await fetch(API + "/api/auth/child/select", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ platform: "web", platform_user_id: uid, child_id: cid }) }).then(j);
                    if (sel && sel.token) {
                        localStorage.setItem("eduarena_demo_token", sel.token);
                        localStorage.setItem("eduarena_demo_uid", uid);
                        localStorage.setItem("eduarena_demo_child_id", String(cid));
                    }
                }
            } catch (e) { console.warn("[arcade] provision failed:", e); }
            return getToken();
        })();
        return provisioning;
    }
    window.arcadeEnsureToken = ensureToken;

    // eduApi：同正式版簽名（回傳 fetch Response），自動帶 demo token
    window.eduApi = async function (path, opts = {}) {
        await ensureToken();
        const headers = { ...(opts.headers || {}) };
        const t = getToken();
        if (t) headers["Authorization"] = "Bearer " + t;
        return fetch(API + path, { ...opts, headers });
    };

    // showScreen：本頁內切換 .screen.active；任何「回島/回首頁」一律回遊樂場
    const EXIT_SCREENS = ["math-hub", "english-hub", "home", "chinese-hub", "science-hub", "social-hub"];
    function showScreen(id) {
        if (EXIT_SCREENS.includes(id)) { location.href = playgroundUrl(); return; }
        document.querySelectorAll(".screen").forEach((s) => s.classList.toggle("active", s.id === "screen-" + id));
        window.scrollTo(0, 0);
    }

    function toast(msg) {
        let el = document.getElementById("arcade-toast");
        if (!el) {
            el = document.createElement("div");
            el.id = "arcade-toast";
            el.style.cssText = "position:fixed;left:50%;bottom:60px;transform:translateX(-50%);background:rgba(40,30,15,.92);color:#fff;padding:10px 18px;border-radius:20px;font-size:14px;z-index:9999;transition:opacity .3s;pointer-events:none;max-width:86vw;";
            document.body.appendChild(el);
        }
        el.textContent = msg;
        el.style.opacity = "1";
        clearTimeout(el._t);
        el._t = setTimeout(() => { el.style.opacity = "0"; }, 2600);
    }

    window.eduApp = Object.assign(window.eduApp || {}, {
        showScreen, toast,
        confirm: function (msg) { return Promise.resolve(window.confirm(msg)); },
        syncUserStats: function () {},
        showRuiPopup: function () {},
    });
})();
