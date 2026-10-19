/* eslint-disable @typescript-eslint/no-require-imports -- Standalone local browser runner. */
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { build } = require("esbuild");
const { chromium } = require("playwright");

(async () => {
  const output = await fs.mkdtemp(path.join(os.tmpdir(), "reef-flow-results-"));
  const bundle = await build({ entryPoints: ["scripts/flow-results.browser.fixture.tsx"], bundle: true,
    write: false, platform: "browser", jsx: "automatic", tsconfig: "scripts/tsconfig.marketing-tests.json",
    define: { "process.env.NODE_ENV": '"development"', "process.env": "{}" },
  });
  const css = (await Promise.all(["marketing.css", "flows.css", "flow-results.css"].map(file => fs.readFile("app/our-klaviyo/" + file, "utf8")))).join("\n") +
    ":root{--surface:#fff;--surface-muted:#f5f8f7;--border:#dce5e3;--text-main:#203e38;--text-muted:#627872;--brand-soft:#e4f2ef}*{box-sizing:border-box}body{font-family:Arial,sans-serif}";
  const server = http.createServer((request, response) => {
    if (request.url === "/app.js") { response.setHeader("content-type", "text/javascript"); response.end(bundle.outputFiles[0].contents); }
    else if (request.url === "/style.css") { response.setHeader("content-type", "text/css"); response.end(css); }
    else response.end('<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body style="margin:0;background:#e8efef"><div id="root"></div><script src="/app.js"></script></body></html>');
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true, ...(process.env.MARKETING_TEST_BROWSER ? { executablePath: process.env.MARKETING_TEST_BROWSER }
      : process.platform === "win32" ? { executablePath: path.join(process.env.ProgramFiles || "C:/Program Files", "Google/Chrome/Application/chrome.exe") }
      : { channel: "chrome" }) });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.setDefaultTimeout(10000);
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/*", route => route.request().url().startsWith("http://127.0.0.1:") ? route.continue() : route.abort());
    await page.goto("http://127.0.0.1:" + server.address().port);
    const welcomeTrigger = page.getByRole("region", { name: "Welcome results", exact: true }).getByRole("button", { name: "View flow results" });
    await welcomeTrigger.click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("heading", { name: "Welcome", exact: true }).waitFor();
    await dialog.getByText("USD 1,234.56", { exact: true }).first().waitFor();
    assert.match(await dialog.locator(".mk-fr-summary").innerText(), /10\.0%[\s\S]*8 buyers \/ 80 email recipients/);
    assert.equal(await dialog.locator(".mk-fr-orders > li").count(), 2);
    assert.equal(await dialog.locator(".mk-fr-badges").getByText("Same checkout", { exact: true }).count(), 0, "Welcome does not imply checkout recovery");
    await dialog.getByText("Results by email", { exact: true }).waitFor();
    await dialog.locator(".mk-fr-steps summary").click();
    assert.match(await dialog.locator(".mk-fr-step-body").innerText(), /60\.0% of sent/);
    await dialog.locator(".mk-fr-steps summary").click();
    await page.screenshot({ path: path.join(output, "welcome-desktop.png") });
    await dialog.getByRole("button", { name: "Next orders", exact: true }).click();
    await dialog.getByRole("link", { name: "Open order #1003 in Shopify" }).waitFor();
    assert.equal(await dialog.locator(".mk-fr-orders > li").count(), 1);
    assert.match(await dialog.locator(".mk-fr-pagination").innerText(), /Page 2 of 2/);
    await dialog.getByLabel("Reporting period").selectOption("7");
    await dialog.getByText("No orders attributed to these emails yet.", { exact: true }).waitFor();
    const lastRequest = await page.evaluate(() => window.__flowRequests.at(-1));
    assert.match(lastRequest, /days=7&ordersPage=1/);
    await dialog.getByLabel("Reporting period").selectOption("30");
    await dialog.getByRole("link", { name: "Open order #1001 in Shopify" }).waitFor();
    await page.evaluate(() => { window.__flowFailure = true; });
    await dialog.getByRole("button", { name: "Refresh results" }).click();
    await dialog.getByRole("alert").waitFor();
    assert.equal(await dialog.locator(".mk-fr-summary").count(), 0, "Failed refresh cannot leave stale sales visible");
    assert.equal(await dialog.locator(".mk-fr-orders").count(), 0);
    await page.evaluate(() => { window.__flowFailure = false; });
    await dialog.getByRole("button", { name: "Try again" }).click();
    await dialog.getByRole("link", { name: "Open order #1001 in Shopify" }).waitFor();
    assert.equal(await dialog.getByRole("alert").count(), 0);
    await dialog.getByLabel("Reporting period").selectOption("90");
    await dialog.getByLabel("Reporting period").selectOption("365");
    await dialog.getByRole("button", { name: "Refresh results" }).waitFor();
    await page.waitForTimeout(550);
    assert.equal(await dialog.getByLabel("Reporting period").inputValue(), "365");
    assert.match(await page.evaluate(() => window.__flowRequests.at(-1)), /days=365/);
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "hidden" });
    assert.equal(await welcomeTrigger.evaluate(element => document.activeElement === element), true, "Closing restores trigger focus");
    assert.equal(await page.evaluate(() => document.body.style.overflow), "");

    await page.getByRole("region", { name: "Cart results", exact: true }).getByRole("button", { name: "View flow results" }).click();
    await dialog.getByRole("heading", { name: "Abandoned Cart", exact: true }).waitFor();
    await dialog.getByRole("link", { name: "Open order #1001 in Shopify" }).waitFor();
    assert.equal(await dialog.locator(".mk-fr-badges").getByText("Same checkout", { exact: true }).count(), 1);
    assert.equal(await dialog.locator(".mk-fr-badges").getByText("Different checkout", { exact: true }).count(), 1);
    assert.equal(await dialog.locator(".mk-fr-badges").getByText("Flow code used", { exact: true }).count(), 1);
    await dialog.getByText("Flow discount code", { exact: true }).click();
    await dialog.getByText("FLOW-TEST-CODE", { exact: true }).waitFor();
    await dialog.getByText("How sales are credited", { exact: true }).click();
    await dialog.getByText(/Click tracking is deferred/).waitFor();
    await dialog.getByText("How sales are credited", { exact: true }).click();
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
      await dialog.evaluate(element => { element.scrollTop = 0; });
      const overflow = await page.evaluate(() => ({
        page: document.documentElement.scrollWidth > innerWidth,
        dialog: document.querySelector("dialog").scrollWidth > document.querySelector("dialog").clientWidth,
      }));
      assert.deepEqual(overflow, { page: false, dialog: false }, `No horizontal overflow at ${width}px`);
      await page.screenshot({ path: path.join(output, `cart-${width}.png`) });
      await dialog.getByRole("heading", { name: /Attributed orders/ }).scrollIntoViewIfNeeded();
      await page.waitForTimeout(80);
      assert.equal(await dialog.getByRole("button", { name: "Close", exact: true }).isVisible(), true);
      await page.screenshot({ path: path.join(output, `cart-orders-${width}.png`) });
    }
    await dialog.getByRole("button", { name: "Next orders" }).click();
    await dialog.getByText("Checkout details unavailable", { exact: true }).waitFor();
    await dialog.getByText("Amount unavailable", { exact: true }).waitFor();
    await dialog.getByText("Recent messages · latest 25", { exact: true }).click();
    await dialog.getByText("queued@example.test", { exact: true }).waitFor();
    await dialog.getByText("Why messages are waiting or stopped", { exact: true }).click();
    assert.equal(await dialog.getByText("Waiting for email sending hours", { exact: true }).count(), 2);
    await page.keyboard.press("Escape");
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.getByRole("button", { name: "Show analytics", exact: true }).click();
    await page.getByRole("heading", { name: "Revenue and engagement" }).waitFor();
    await page.locator(".mk-analytics-summary").getByText("10.0%", { exact: true }).waitFor();
    await page.getByLabel("Reporting period").selectOption("90");
    await page.getByRole("heading", { name: "Automated flows" }).waitFor();
    await page.locator(".mk-analytics-table").getByRole("button", { name: "View results", exact: true }).first().click();
    await dialog.getByRole("link", { name: "Open order #1001 in Shopify" }).waitFor();
    assert.equal(await dialog.getByLabel("Reporting period").inputValue(), "90", "Analytics opens the same report with its selected period");
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    await dialog.waitFor({ state: "hidden" });
    assert.deepEqual(errors, []);
    console.log("Flow results browser checks passed. Screenshots: " + output);
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
