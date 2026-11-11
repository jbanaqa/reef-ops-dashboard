/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const http = require("node:http");
const { build } = require("esbuild");
const { chromium } = require("playwright");

(async () => {
  const output = process.env.MARKETING_CART_THREE_STEP_OUTPUT || "C:/Users/GuestUser/.codex/artifacts/cart-three-step-2026-11-11";
  await fs.mkdir(output, { recursive: true });
  const bundle = await build({ entryPoints: ["scripts/cart-three-step.browser.fixture.tsx"], bundle: true, write: false, platform: "browser", jsx: "automatic", tsconfig: "scripts/tsconfig.marketing-tests.json", define: { "process.env.NODE_ENV": '"development"', "process.env": "{}" } });
  const css = (await Promise.all(["marketing.css", "flows.css", "stock.css", "flow-results.css"].map(file => fs.readFile("app/our-klaviyo/" + file, "utf8")))).join("\n") + ":root{--surface:#fff;--surface-muted:#f5f8f7;--border:#dce5e3;--text-main:#203e38;--text-muted:#627872}*{box-sizing:border-box}dialog{margin:0}body{font-family:Arial,sans-serif}";
  const server = http.createServer((req, res) => {
    if (req.url === "/app.js") { res.setHeader("Content-Type", "text/javascript"); res.end(bundle.outputFiles[0].contents); }
    else if (req.url === "/style.css") { res.setHeader("Content-Type", "text/css"); res.end(css); }
    else res.end('<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body style="margin:0;background:#e8efef"><div id="root"></div><script src="/app.js"></script></body></html>');
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true, executablePath: process.env.MARKETING_TEST_BROWSER || "C:/Program Files/Google/Chrome/Application/chrome.exe" });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
    const errors = [], apiRequests = [], screenshots = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/*", route => {
      const url = new URL(route.request().url());
      if (url.pathname.startsWith("/api/marketing")) { apiRequests.push(route.request().url()); return route.abort(); }
      return url.hostname === "127.0.0.1" || url.protocol === "data:" ? route.continue() : route.abort();
    });
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    const map = page.locator(".mk-cart-map");
    await map.getByText("Email #3 · 15% final offer", { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => localStorage.getItem("threeStepSaved")), null, "Opening the upgrade never saves or changes the live flow");
    assert.equal(await map.getByText("Purchased in the last 2 weeks?", { exact: true }).count(), 0);
    assert.equal(await map.getByText("Can receive marketing texts?", { exact: true }).count(), 0);
    await map.getByText("Wait 3 hours", { exact: true }).waitFor();
    await map.getByText("Wait 4 hours", { exact: true }).waitFor();
    await map.getByText("Wait 1 day", { exact: true }).waitFor();
    await page.getByText("Sends at any hour. Other campaign or flow emails do not delay this recovery sequence.", { exact: true }).waitFor();
    assert.equal(await page.getByText("Email sending hours", { exact: true }).count(), 0);
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 1100 });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Default map has no overflow at " + width);
      const file = path.join(output, `cart-three-step-default-${width}.png`); await map.screenshot({ path: file }); screenshots.push(file);
    }
    await page.setViewportSize({ width: 1440, height: 1100 });
    for (const [label, expected, newSubject] of [
      ["Email #1 · Cart reminder", "Saved first email HTML", "Custom first subject"],
      ["Email #2 · 10% offer", "Your saved offer: 10% off", "Custom 10% subject"],
      ["Email #3 · 15% final offer", "Your saved offer: 15% off", "Custom 15% subject"],
    ]) {
      await map.getByText(label, { exact: true }).click();
      const html = await page.getByTitle("Email preview").getAttribute("srcdoc");
      assert.ok(html.includes(expected), "Each email preserves its HTML and correct rate");
      if (label.includes("15%")) {
        assert.ok(!/\b10\s*%/.test(html), "The 15% preview must not contain a stale generated 10% term");
        assert.ok(html.includes("AC300-PREVIEW"));
      }
      await page.getByLabel("Subject", { exact: true }).fill(newSubject);
      await page.getByRole("button", { name: "Save email", exact: true }).click();
      await page.getByLabel("Back to flow", { exact: true }).click();
    }
    for (const [detail, expected, value] of [["After email #1 is sent.", "240", "300"], ["After email #2 is sent.", "1440", "1500"]]) {
      await map.getByRole("button").filter({ hasText: detail }).click();
      const dialog = page.getByRole("dialog");
      assert.equal(await dialog.getByLabel("Wait (minutes)", { exact: true }).inputValue(), expected);
      assert.match(await dialog.innerText(), /Minutes after email #\d sends/);
      await dialog.getByLabel("Wait (minutes)", { exact: true }).fill(value);
      await dialog.getByRole("button", { name: "Close editor", exact: true }).click();
    }
    await map.getByText("One code · 10% → 15%", { exact: true }).click();
    const coupon = page.getByRole("dialog");
    assert.equal(await coupon.getByLabel("Code valid for (days)", { exact: true }).inputValue(), "7");
    await coupon.getByText("Starts when the 10% code is created. The 15% upgrade keeps the original expiration.", { exact: true }).waitFor();
    await coupon.getByLabel("Code valid for (days)", { exact: true }).fill("8");
    await coupon.getByRole("button", { name: "Close editor", exact: true }).click();
    await page.getByRole("button", { name: "Save flow", exact: true }).click();
    await page.getByText("Flow saved, including copy and artwork.", { exact: true }).waitFor();
    let saved = await page.evaluate(() => JSON.parse(localStorage.getItem("threeStepSaved")));
    assert.deepEqual(saved.data.steps.map(step => step.subject), ["Custom first subject", "Custom 10% subject", "Custom 15% subject"]);
    assert.deepEqual(saved.data.steps.map(step => step.minutes), [180, 300, 1500]);
    assert.equal(saved.data.cart.recoveryVersion, 2);
    assert.equal(saved.data.cart.couponHours, 192);
    assert.equal(saved.data.cart.sendStartHour, 0); assert.equal(saved.data.cart.sendEndHour, 24);
    assert.equal(saved.data.steps[1].content.hero, saved.data.steps[2].content.hero, "The final email retains the saved offer artwork");
    assert.ok(saved.data.steps[2].content.bodyHtml.includes("15%"));
    assert.equal(saved.enabled, false, "Editor tests do not turn sending on");
    await page.reload();
    await map.getByText("Custom 15% subject", { exact: true }).waitFor();
    await map.getByText("Wait 5 hours", { exact: true }).waitFor();
    await map.getByText("Wait 25 hours", { exact: true }).waitFor();
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 1100 });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Three-step map has no overflow at " + width);
      const file = path.join(output, `cart-three-step-customized-${width}.png`); await map.screenshot({ path: file }); screenshots.push(file);
    }
    saved = await page.evaluate(() => JSON.parse(localStorage.getItem("threeStepSaved")));
    assert.equal(saved.data.steps.length, 3);
    assert.deepEqual(errors, []); assert.deepEqual(apiRequests, [], "No API or email requests were made");
    const result = { result: "PASS", screenshots, savedWaits: saved.data.steps.map(step => step.minutes), couponDays: saved.data.cart.couponHours / 24 };
    await fs.writeFile(path.join(output, "cart-three-step-browser.json"), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result, null, 2));
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
