/* eslint-disable @typescript-eslint/no-require-imports -- Standalone browser test runner. */
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const http = require("node:http");
const path = require("node:path");
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
    response.end(html);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  let browser;
  try {
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
        };
      });
      assert.ok(layout.dialog.x >= 0 && layout.dialog.right <= viewport.width);
      assert.ok(layout.dialog.y >= 0 && layout.dialog.bottom <= viewport.height);
      assert.ok(layout.close.width >= 40 && layout.close.height >= 40);
      assert.equal(layout.scrollWidth, viewport.width);
      if (viewport.mobile) {
        assert.ok(layout.art.y < layout.copy.y, "mobile artwork should stack above the form");
      } else {
        assert.ok(layout.art.x > layout.copy.x, "desktop artwork should sit beside the form");
      }
      await page.close();
    }
    const paused = await browser.newPage();
    await paused.addInitScript(() => {
      localStorage.setItem("reef-marketing-dismissed", String(Date.now()));
      window.testDismissalDays = 7;
    });
    await paused.goto(url);
    await paused.waitForTimeout(100);
    assert.equal(await paused.locator("dialog.reef-signup-dialog").count(), 0);
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
    console.log("Popup browser checks passed at 1280, 390, and 320 pixels.");
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
