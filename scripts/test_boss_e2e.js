/* P62 demo 端到端驗證（本機後端 8077 + 靜態 8743）：
 * 1) arcade-boss.html 真打一場 T1 怪物戰：全對 → 第 6 題擊殺、雙方 10 顆愛心渲染、
 *    連對倍率標示出現、結算頁勝利＋精通文案
 * 2) 禁忌森林深處地圖：15 隻怪物建物載入、點擊路由跳對網址
 * 跑法：NODE_PATH=$(npm root -g) node scripts/test_boss_e2e.js
 */
const { chromium } = require("playwright");

const PAGE = "http://localhost:8743";
const API = "http://localhost:8077";
let failures = 0;
function ok(cond, label) {
    console.log(`${cond ? "PASS" : "FAIL"}  ${label}`);
    if (!cond) failures++;
}

(async () => {
    const browser = await chromium.launch();
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });

    /* ── 1. 獨立魔王戰頁：全對打 T1 怪物 ── */
    {
        const page = await ctx.newPage();
        const errs = [];
        page.on("pageerror", (e) => errs.push(e.message));
        await page.goto(`${PAGE}/arcade-boss.html?api=${encodeURIComponent(API)}&subject=math&tier=1`);
        // 等 HUD 出現（訪客建立+出題+Phaser 載入）
        await page.waitForSelector("#bh-overlay.is-on", { timeout: 60000 });
        ok(true, "魔王戰頁載入、HUD 出現");
        // 雙方 10 顆愛心
        const eh = await page.locator("#bh-ehearts .bh-heart").count();
        const ph = await page.locator("#bh-hearts .bh-heart").count();
        ok(eh === 10 && ph === 10, `雙方各 10 顆愛心（敵 ${eh}／我 ${ph}）`);
        const hpLabel = await page.locator("#bh-hp-label").innerText();
        ok(hpLabel === "50/50", `怪物血量 50/50（實際 ${hpLabel}）`);
        const phpLabel = await page.locator("#bh-php-label").innerText();
        ok(phpLabel === "100/100", `玩家血量 100/100（實際 ${phpLabel}）`);
        // 沒有計時條
        ok((await page.locator("#bh-timer-fill").count()) === 0, "計時條已移除");

        // 全對打：每題點文字為 A 的選項；第 4 題起應出現連擊標示
        let comboSeen = false;
        let q = 0;
        for (; q < 10; q++) {
            await page.waitForFunction(() => {
                const btns = document.querySelectorAll("#bh-choices .bh-choice");
                return Array.from(btns).some((b) => !b.disabled && b.textContent.trim().length > 0);
            }, null, { timeout: 20000 });
            if (q === 3 || q === 4) {
                const comboVisible = await page.locator("#bh-combo").isVisible();
                if (comboVisible) comboSeen = true;
            }
            // 點正解 A
            const btns = page.locator("#bh-choices .bh-choice");
            const n = await btns.count();
            let clicked = false;
            for (let i = 0; i < n; i++) {
                if ((await btns.nth(i).innerText()).trim() === "A") {
                    await btns.nth(i).click();
                    clicked = true;
                    break;
                }
            }
            ok(clicked, `第 ${q + 1} 題點到正解 A`);
            // 等下一題或結束
            const ended = await Promise.race([
                page.waitForSelector("#screen-boss-result.active", { timeout: 15000 }).then(() => true).catch(() => false),
                page.waitForFunction((prev) => {
                    const el = document.getElementById("bh-progress");
                    return el && el.textContent.trim() !== prev;
                }, `${q + 1}/10`, { timeout: 15000 }).then(() => false).catch(() => false),
            ]);
            if (ended) { q++; break; }
        }
        ok(q === 6, `全對在第 ${q} 題擊殺（怪物血 50：5+5+5+10+10+15）`);
        ok(comboSeen, "連對倍率標示有出現");
        await page.waitForSelector("#screen-boss-result.active", { timeout: 15000 });
        const title = await page.locator("#boss-result-title").innerText();
        const sub = await page.locator("#boss-result-sub").innerText();
        ok(title.includes("擊敗"), `結算標題=${title}`);
        ok(sub.includes("精通 +20") && sub.includes("剩餘血量 100/100"), `結算副標=${sub}`);
        const coins = await page.locator("#boss-result-coins").innerText();
        ok(/\+\d+/.test(coins), `金幣=${coins.trim()}`);
        await page.screenshot({ path: "/home/gamezpika/eduarena-skill-demo/ui-bossfight-result-preview.png" });
        ok(errs.length === 0, `魔王戰頁零 pageerror${errs.length ? "：" + errs.join(" | ") : ""}`);
        await page.close();
    }

    /* ── 2. 答錯掉血＋玩家愛心減少（新開一場，前 2 題故意錯） ── */
    {
        const page = await ctx.newPage();
        await page.goto(`${PAGE}/arcade-boss.html?api=${encodeURIComponent(API)}&subject=math&tier=1`);
        await page.waitForSelector("#bh-overlay.is-on", { timeout: 60000 });
        await page.waitForFunction(() => {
            const btns = document.querySelectorAll("#bh-choices .bh-choice");
            return Array.from(btns).some((b) => !b.disabled && b.textContent.trim().length > 0);
        }, null, { timeout: 20000 });
        // 點錯誤答案 B
        const btns = page.locator("#bh-choices .bh-choice");
        const n = await btns.count();
        for (let i = 0; i < n; i++) {
            if ((await btns.nth(i).innerText()).trim() === "B") { await btns.nth(i).click(); break; }
        }
        // 玩家血量 100-8=92（怪物攻10−防5/2）
        await page.waitForFunction(() => {
            const el = document.getElementById("bh-php-label");
            return el && el.textContent.trim() === "92/100";
        }, null, { timeout: 15000 });
        ok(true, "答錯被怪物攻擊：玩家血 100 → 92（攻10−防2.5）");
        await page.screenshot({ path: "/home/gamezpika/eduarena-skill-demo/ui-bossfight-game-preview.png" });
        await page.close();
    }

    /* ── 3. 禁忌森林深處：15 隻怪物上地圖＋點擊路由 ── */
    {
        const page = await ctx.newPage();
        const errs = [];
        page.on("pageerror", (e) => errs.push((e.stack || e.message).split("\n").slice(0, 4).join(" >> ")));
        await page.goto(`${PAGE}/village-web/index.html?map=forest_deep`);
        await page.waitForFunction(() => {
            const s = window.game && window.game.scene && window.game.scene.scenes[0];
            return s && s.player && s.mapId === "forest_deep";
        }, null, { timeout: 30000 });
        await page.waitForTimeout(1500);   // 等建物全建好
        const info = await page.evaluate(() => {
            const s = window.game.scene.scenes[0];
            const its = s.interactables || [];
            const monsters = its.filter((i) => String(i.shop_id || "").indexOf("bossfight:") === 0).length;
            return { count: its.length, monsters };
        });
        ok(info.monsters === 15, `禁忌森林深處 15 隻怪物互動載入（實際 ${info.monsters}／互動 ${info.count}）`);
        // 點怪物 → 跳獨立魔王戰頁（直接呼叫路由，驗證跳轉網址）
        // 導航後 pageerror 屬於魔王戰頁（無本機 api 參數），地圖錯誤只算導航前的
        const mapErrCount = errs.length;
        await page.evaluate(() => { window.openShop("bossfight:science:3"); });
        await page.waitForURL(/arcade-boss\.html\?subject=science&tier=3/, { timeout: 10000 });
        ok(true, "點怪物路由 → arcade-boss.html?subject=science&tier=3");
        ok(mapErrCount === 0, `地圖零 pageerror${mapErrCount ? "：" + errs.slice(0, mapErrCount).join(" | ") : ""}`);
        await page.screenshot({ path: "/home/gamezpika/eduarena-skill-demo/ui-forestdeep-monsters-preview.png" });
        await page.close();
    }

    await browser.close();
    console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
    process.exit(failures === 0 ? 0 : 1);
})();
