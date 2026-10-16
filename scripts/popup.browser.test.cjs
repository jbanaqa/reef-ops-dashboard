/* eslint-disable @typescript-eslint/no-require-imports -- Standalone browser test runner. */
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const http = require("node:http");
const path = require("node:path");
const os = require("node:os");
const { chromium } = require("playwright");

(async () => {
  const script = await fs.readFile("public/reef-marketing.js");
  const artwork = await fs.readFile("public/welcome-popup-art.png");
  const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><main><h1>Storefront</h1></main><script>const realTimeout=window.setTimeout.bind(window);window.testTimeoutDelays=[];window.setTimeout=(fn,delay)=>{window.testTimeoutDelays.push(delay);return realTimeout(fn,0)};const realFetch=window.fetch;window.fetch=async(url,init)=>{if(String(url).endsWith('/api')){const body=JSON.parse(init.body);return Response.json(body.action==='config'?{enabled:true,singleOptIn:true,couponDays:14,dismissalDays:window.testDismissalDays??7,delaySeconds:window.testDelaySeconds??10}:{ok:true,completed:true,message:'Offer queued.'})}return realFetch(url,init)}</script><script src="/reef-marketing.js" data-endpoint="/api"></script></body></html>`;
  const server = http.createServer((request, response) => {
    if (request.url === "/reef-marketing.js") {
      response.writeHead(200, { "content-type": "application/javascript" });
      return response.end(script);
    }
    if (request.url === "/welcome-popup-art.png") {
      response.writeHead(200, { "content-type": "image/png" });
      return response.end(artwork);
    }
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    const mode = new URL(request.url, "http://localhost").searchParams.get("customer");
    response.end(html.replace('data-endpoint="/api"', `data-endpoint="/api"${mode ? ` data-known-customer="true" data-email-subscriber="${mode === "subscribed"}"` : ""}`));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  let browser;
  try {
    const screenshots = process.env.MARKETING_POPUP_SCREENSHOTS || await fs.mkdtemp(path.join(os.tmpdir(), "reef-popup-"));
    await fs.mkdir(screenshots, { recursive: true });
    browser = await chromium.launch({
      headless: true,
      ...(process.env.MARKETING_TEST_BROWSER
        ? { executablePath: process.env.MARKETING_TEST_BROWSER }
        : process.platform === "win32"
          ? {
              executablePath: path.join(
                process.env.ProgramFiles || "C:/Program Files",
                "Google/Chrome/Application/chrome.exe",
              ),
            }
          : { channel: "chrome" }),
    });
    const address = server.address();
    const url = `http://127.0.0.1:${address.port}`;
    for (const viewport of [
      { width: 1280, height: 800, mobile: false },
      { width: 390, height: 844, mobile: true },
      { width: 375, height: 667, mobile: true },
      { width: 375, height: 568, mobile: true },
      { width: 320, height: 700, mobile: true },
    ]) {
      const page = await browser.newPage({
        viewport: { width: viewport.width, height: viewport.height },
      });
      await page.goto(url);
      const dialog = page.locator("dialog.reef-signup-dialog");
      await dialog.waitFor();
      const layout = await page.evaluate(() => {
        const box = (selector) => {
          const rect = document.querySelector(selector).getBoundingClientRect();
          return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, right: rect.right, bottom: rect.bottom };
        };
        return {
          dialog: box("dialog"),
          copy: box(".reef-signup-copy"),
          art: box(".reef-signup-art"),
          close: box(".reef-signup-close"),
          scrollWidth: document.documentElement.scrollWidth,
          dialogScrollWidth: document.querySelector("dialog").scrollWidth,
          dialogClientWidth: document.querySelector("dialog").clientWidth,
          consentFont: parseFloat(getComputedStyle(document.querySelector(".reef-signup-consent")).fontSize),
        };
      });
      assert.ok(layout.dialog.x >= 0 && layout.dialog.right <= viewport.width);
      assert.ok(layout.dialog.y >= 0 && layout.dialog.bottom <= viewport.height);
      assert.ok(layout.close.width >= 40 && layout.close.height >= 40);
      assert.equal(layout.scrollWidth, viewport.width);
      assert.ok(layout.dialogScrollWidth <= layout.dialogClientWidth, "the popup never scrolls sideways");
      if (viewport.mobile) {
        assert.ok(layout.art.y < layout.copy.y, "mobile artwork should stack above the form");
        assert.ok(layout.consentFont >= 12, "mobile consent stays readable");
      } else {
        assert.ok(layout.art.x > layout.copy.x, "desktop artwork should sit beside the form");
      }
      await page.screenshot({ path: path.join(screenshots, `popup-${viewport.width}x${viewport.height}.png`) });
      // Short screens may scroll vertically; the submit control must remain reachable.
      await page.locator(".reef-signup-submit").scrollIntoViewIfNeeded();
      assert.ok(await page.locator(".reef-signup-submit").isVisible());
      await dialog.evaluate((element) => { element.scrollTop = 0; });
      await page.getByRole("button", { name: "Close signup form", exact: true }).click();
      const launcher = page.getByRole("button", { name: "Open email signup — get 10% off", exact: true });
      assert.ok(await launcher.isVisible());
      const tab = await launcher.boundingBox();
      assert.ok(tab.x >= 0 && tab.x + tab.width <= viewport.width);
      assert.ok(tab.y >= 0 && tab.y + tab.height <= viewport.height);
      assert.ok(tab.height >= 44, "reopen tab remains easy to tap");
      await launcher.click();
      assert.ok(await dialog.isVisible());
      assert.equal(await launcher.isVisible(), false);
      await page.close();
    }
    const paused = await browser.newPage();
    await paused.addInitScript(() => {
      localStorage.setItem("reef-marketing-dismissed", String(Date.now()));
      window.testDismissalDays = 7;
    });
    await paused.goto(url);
    await paused.waitForTimeout(100);
    assert.equal(await paused.locator("dialog.reef-signup-dialog[open]").count(), 0);
    assert.ok(await paused.locator(".reef-signup-launcher").isVisible());
    await paused.locator(".reef-signup-launcher").click();
    assert.ok(await paused.locator("dialog.reef-signup-dialog").isVisible(), "manual reopen bypasses the seven-day automatic pause");
    await paused.close();

    const repeat = await browser.newPage();
    await repeat.addInitScript(() => {
      localStorage.setItem("reef-marketing-dismissed", String(Date.now()));
      window.testDismissalDays = 0;
      window.testDelaySeconds = 25;
    });
    await repeat.goto(url);
    await repeat.locator("dialog.reef-signup-dialog").waitFor();
    assert.ok(await repeat.evaluate(() => window.testTimeoutDelays.includes(25000)));
    await repeat.close();
    for (const mode of ["subscribed", "not-subscribed"]) {
      const page = await browser.newPage();
      await page.goto(url + "?customer=" + mode);
      await page.waitForTimeout(100);
      assert.equal(await page.locator("dialog.reef-signup-dialog, .reef-signup-launcher").count(), 0, "all signed-in customers stay hidden");
      await page.close();
    }
    const returning = await browser.newPage();
    await returning.goto(url);
    await returning.locator(".reef-signup-close").click();
    await returning.reload();
    await returning.waitForTimeout(100);
    assert.equal(await returning.locator("dialog.reef-signup-dialog[open]").count(), 0, "dismissal survives navigation");
    assert.ok(await returning.locator(".reef-signup-launcher").isVisible());
    await returning.evaluate(() => {
      localStorage.setItem("reef-marketing-dismissed", String(Date.now() - 8 * 86400000));
    });
    await returning.reload();
    await returning.locator("dialog.reef-signup-dialog").waitFor();
    await returning.locator('[name="email"]').fill("popup-test@example.com");
    await returning.locator('[name="consent"]').check();
    await returning.locator('[type="submit"]').click();
    await returning.getByText("Thanks for joining our reefing community!").waitFor();
    await returning.reload();
    await returning.waitForTimeout(100);
    assert.equal(await returning.locator("dialog.reef-signup-dialog").count(), 0, "completed signup stays hidden");
    assert.equal(await returning.locator(".reef-signup-launcher").count(), 0, "completed signup hides the corner tab too");
    await returning.close();
    const pending = await browser.newPage();
    await pending.addInitScript(() => {
      localStorage.setItem("reef-marketing-session", "test-pending-session");
      localStorage.setItem("reef-marketing-session-at", String(Date.now()));
      localStorage.setItem("reef-marketing-dismissed", String(Date.now()));
    });
    await pending.goto(url);
    await pending.waitForTimeout(100);
    assert.equal(await pending.locator("dialog.reef-signup-dialog[open]").count(), 0, "pending confirmation respects dismissal");
    assert.ok(await pending.locator(".reef-signup-launcher").isVisible());
    await pending.close();
    const cookies = await browser.newPage();
    await cookies.addInitScript(() => {
      Object.defineProperty(window, "localStorage", { get() { throw Error("Storage disabled"); } });
    });
    await cookies.goto(url);
    await cookies.locator(".reef-signup-close").click();
    await cookies.reload();
    await cookies.waitForTimeout(100);
    assert.equal(await cookies.locator("dialog.reef-signup-dialog[open]").count(), 0, "cookie fallback remembers dismissal");
    assert.ok(await cookies.locator(".reef-signup-launcher").isVisible());
    await cookies.close();
    console.log("Popup browser checks passed at desktop, 390, 375 (including short screens), and 320 pixels.");
    console.log("Screenshots:", screenshots);
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
