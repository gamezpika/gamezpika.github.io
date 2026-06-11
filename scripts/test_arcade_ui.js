/* 遊樂場三遊戲 UI 改版驗證：
 * 1) 封面+教學（自動彈出/略過/怎麼玩/按開始才開局）
 * 2) 共用勝利結算頁（win/fail、獎勵格、金幣非同步入帳、再玩一次）
 * 3) 三頁零 console pageerror
 * 跑法：NODE_PATH=$(npm root -g) node scripts/test_arcade_ui.js
 */
const { chromium } = require("playwright");

const BASE = "http://localhost:8743";
const SHOT = (n) => `/home/gamezpika/eduarena-skill-demo/ui-${n}-preview.png`;

let failures = 0;
function ok(cond, label) {
    console.log(`${cond ? "PASS" : "FAIL"}  ${label}`);
    if (!cond) failures++;
}

async function newPage(ctx, name) {
    const page = await ctx.newPage();
    page._errs = [];
    page.on("pageerror", (e) => page._errs.push(`[${name}] ${e.message}`));
    page.on("dialog", (d) => d.accept());
    return page;
}

async function checkIntro(page, label) {
    // 進頁：封面 overlay 開、教學卡自動彈出
    await page.waitForSelector("#ag-intro.open", { timeout: 15000 });
    ok(await page.isVisible("#agi-tutwrap"), `${label} 教學卡自動彈出`);
    ok((await page.locator(".agi-step").count()) === 3, `${label} 教學 3 步驟`);
    // 略過 → 回封面
    await page.click("#agi-skip");
    ok(!(await page.isVisible(".agi-tutcard")), `${label} 略過後教學卡關閉`);
    ok(await page.isVisible("#agi-start"), `${label} 封面有開始遊戲鈕`);
    // 怎麼玩 → 教學再開 → 再略過
    await page.click("#agi-how");
    ok(await page.isVisible(".agi-tutcard"), `${label} 「怎麼玩」可重看教學`);
    await page.click("#agi-skip");
}

(async () => {
    const browser = await chromium.launch();
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });

    /* ── 1. 打地鼠 ───────────────────────────── */
    {
        const page = await newPage(ctx, "whack");
        await page.clock.install();
        await page.goto(`${BASE}/arcade-whack.html`);
        await checkIntro(page, "打地鼠");
        await page.screenshot({ path: SHOT("whack-cover") });
        // 開始 → 倒數出現（沒按開始前遊戲不會動：倒數 overlay 應該還是隱藏）
        ok((await page.locator("#whack-countdown").isHidden()), "打地鼠 未按開始前不開局");
        await page.click("#agi-start");
        await page.waitForSelector("#ag-intro.open", { state: "detached", timeout: 5000 }).catch(() => {});
        ok(!(await page.isVisible("#agi-start")), "打地鼠 按開始後封面關閉");
        await page.waitForSelector("#whack-countdown", { state: "visible", timeout: 10000 });
        ok(true, "打地鼠 開始後進入倒數");
        // 逐秒快轉過 準備中+3-2-1-GO+60 秒（await 鏈每步排新 timer，要分段推）
        for (let i = 0; i < 90; i++) {
            await page.clock.fastForward(1000);
            await page.waitForTimeout(30);   // 讓 microtask/await 鏈接上
            if (await page.locator("#ag-victory.open").count()) break;
        }
        await page.waitForSelector("#ag-victory.open", { timeout: 15000 });
        ok(true, "打地鼠 60 秒到 → 共用結算頁出現");
        const title = await page.locator(".agv-title").innerText();
        ok(/VICTORY|再接再厲/.test(title.replace(/\s/g, "")), `打地鼠 結算標題=${title.replace(/\s/g, "")}`);
        ok((await page.locator(".agv-tile").count()) === 3, "打地鼠 3 個獎勵格(金幣/分數/星)");
        ok(await page.isVisible(".agv-badge img"), "打地鼠 徽章顯示");
        ok(await page.isVisible("#agv-exit"), "打地鼠 回遊樂場鈕在");
        // 金幣非同步入帳（真後端）
        let coinLabel = "";
        for (let i = 0; i < 40; i++) {
            coinLabel = await page.locator('.agv-tile[data-rw="coins"] .agv-tile-label').innerText();
            if (coinLabel !== "計算中…") break;
            await page.waitForTimeout(500);
        }
        ok(/^\+\d+/.test(coinLabel), `打地鼠 金幣入帳=${coinLabel}`);
        await page.screenshot({ path: SHOT("whack-victory") });
        // 再玩一次 → 結算關、重新倒數
        await page.click("#agv-replay");
        ok(!(await page.isVisible("#ag-victory.open")) || !(await page.locator("#ag-victory").evaluate(e => e.classList.contains("open"))), "打地鼠 再玩一次關閉結算");
        await page.waitForSelector("#whack-countdown", { state: "visible", timeout: 10000 });
        ok(true, "打地鼠 再玩一次重新開局");
        ok(page._errs.length === 0, `打地鼠 零 pageerror${page._errs.length ? "：" + page._errs.join(" | ") : ""}`);
        await page.close();
    }

    /* ── 2. 聽力小火車 ────────────────────────── */
    {
        const page = await newPage(ctx, "listen");
        await page.goto(`${BASE}/arcade-listen.html`);
        await checkIntro(page, "小火車");
        // 未按開始前不該打 API 出題（題目區還是預設字）
        const prompt0 = await page.locator("#enp-prompt").innerText();
        ok(prompt0.includes("中文意思"), "小火車 未按開始前不出題");
        await page.click("#agi-start");
        // 等真後端出題（首次語音可能久）
        await page.waitForFunction(() => {
            // listen mode 出題後：字塊池有車廂、喇叭鈕顯示（中文題目框會被隱藏，別看它）
            const pool = document.getElementById("enp-chip-pool");
            const lb = document.getElementById("enp-listen-btn");
            return pool && pool.children.length > 0 && lb && lb.style.display !== "none";
        }, null, { timeout: 90000 });
        ok(true, "小火車 開始後成功出題");
        // 暖色外殼驗證：螢幕底色不再是深紫
        const bg = await page.locator("#screen-en-puzzle").evaluate(e => getComputedStyle(e).backgroundColor);
        ok(bg === "rgb(247, 239, 226)", `小火車 外殼換暖色=${bg}`);
        await page.screenshot({ path: SHOT("listen-game") });
        // 中離 → 結算（0 題 → 低分銀灰版）
        await page.click("#enp-back");
        await page.waitForSelector("#ag-victory.open", { timeout: 20000 });
        ok(true, "小火車 結算用共用勝利頁");
        ok(await page.locator("#ag-victory").evaluate(e => e.classList.contains("fail")), "小火車 0 分走銀灰再接再厲版");
        ok((await page.locator(".agv-tile").count()) === 3, "小火車 3 個獎勵格");
        await page.screenshot({ path: SHOT("listen-victory-fail") });
        ok(page._errs.length === 0, `小火車 零 pageerror${page._errs.length ? "：" + page._errs.join(" | ") : ""}`);
        await page.close();
    }

    /* ── 3. 名人九宮格（全 5 關真實玩完） ───────── */
    {
        const page = await newPage(ctx, "figures");
        await page.goto(`${BASE}/figures.html?from=playground`);
        await checkIntro(page, "九宮格");
        ok((await page.locator("#fg-status").innerText()).includes("準備中"), "九宮格 未按開始前不開局");
        await page.click("#agi-start");
        for (let round = 1; round <= 5; round++) {
            await page.waitForFunction(() => {
                const s = document.getElementById("fg-status");
                return s && s.classList.contains("guess") && s.textContent.includes("你的回合");
            }, null, { timeout: 40000 });
            const target = await page.locator("#fg-target-name").innerText();
            await page.click(`.fg-card:has(.fg-card-name:text-is("${target}"))`);
            await page.waitForSelector("#fg-modal.show", { timeout: 10000 });
            ok(true, `九宮格 第 ${round} 關答對(${target}) → 知識卡`);
            await page.click("#fg-modal-close");
            if (round < 5) await page.click("#fg-next");
        }
        await page.waitForSelector("#ag-victory.open", { timeout: 10000 });
        ok(true, "九宮格 破關 → 共用結算頁出現");
        ok((await page.locator(".agv-tile").count()) === 2, "九宮格 2 個獎勵格(知識卡/答對)");
        ok(await page.isVisible("#agv-exit"), "九宮格 from=playground 有回遊樂場鈕");
        const exitHref = await page.locator("#agv-exit").isVisible();
        ok(exitHref, "九宮格 回遊樂場鈕可見");
        await page.screenshot({ path: SHOT("figures-victory") });
        // 再玩一次 → 直接重開局（不再跳教學）
        await page.click("#agv-replay");
        ok(!(await page.locator("#ag-victory").evaluate(e => e.classList.contains("open"))), "九宮格 再玩一次關閉結算");
        ok(!(await page.locator("#ag-intro").evaluate(e => e.classList.contains("open"))), "九宮格 再玩不重跳教學");
        await page.waitForFunction(() => document.getElementById("fg-status").textContent.includes("記住"), null, { timeout: 10000 });
        ok(true, "九宮格 再玩一次直接進預覽");
        // 頂欄統一驗證：screen-header 棕木底
        const hbg = await page.locator(".screen-header").evaluate(e => getComputedStyle(e).backgroundImage);
        ok(hbg.includes("linear-gradient"), "九宮格 頂欄=統一棕木 header");
        await page.screenshot({ path: SHOT("figures-game") });
        ok(page._errs.length === 0, `九宮格 零 pageerror${page._errs.length ? "：" + page._errs.join(" | ") : ""}`);
        await page.close();
    }

    await browser.close();
    console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
    process.exit(failures === 0 ? 0 : 1);
})();
