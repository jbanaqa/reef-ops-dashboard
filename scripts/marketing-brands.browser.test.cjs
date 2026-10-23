/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { build } = require("esbuild");
const { chromium } = require("playwright");

(async () => {
  const output = await fs.mkdtemp(path.join(os.tmpdir(), "reef-marketing-brands-"));
  const bundle = await build({ entryPoints: ["scripts/marketing-brands.browser.fixture.tsx"], bundle: true, write: false, outdir: output, platform: "browser", jsx: "automatic", tsconfig: "scripts/tsconfig.marketing-tests.json", define: { "process.env.NODE_ENV": '"development"', "process.env": "{}" } });
  const server = http.createServer((req, res) => {
    if (["/app.js", "/app.css"].includes(req.url)) {
      const file = bundle.outputFiles.find((item) => item.path.endsWith(req.url === "/app.js" ? ".js" : ".css"));
      res.setHeader("Content-Type", req.url === "/app.js" ? "text/javascript" : "text/css"); res.end(file.contents);
    } else res.end('<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/app.css"><style>:root{--surface:#fff;--surface-muted:#f5f7f8;--border:#d6e0e6;--text-main:#172f3c;--text-muted:#5a6b75;--danger:#a22;--danger-soft:#fff1f1;--success:#277a57}*{box-sizing:border-box}body{font-family:Arial,sans-serif;margin:0;background:#f2f5f7;padding:20px}button,input,textarea,select{font:inherit}</style></head><body><div id="root"></div><script src="/app.js"></script></body></html>');
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true, executablePath: process.env.MARKETING_TEST_BROWSER || "C:/Program Files/Google/Chrome/Application/chrome.exe" });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [], requests = [], writes = [], external = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const brands = ["corals-anonymous", "macroalgae-farms"];
    const brandName = (brand) => brand === brands[0] ? "Corals Anonymous" : "Macroalgae Farms";
    const datasets = Object.fromEntries(brands.map((brand) => [brand, {
      profiles: [], campaigns: [], campaignTests: [], resources: [{ id: brand + "-mailable", key: "mailable", kind: "SEGMENT", name: brand === brands[0] ? "2025 Mailable Subscribers" : "Mailable Subscribers", data: { masterMarketing: true } }],
      settings: { organizationName: brandName(brand), postalAddress: "123 Ocean Ave, CA 90001, USA", attribution: { emailClickDays: 5, emailOpenDays: 1 }, operations: { sendingEnabled: false, ingestEnabled: false, formEnabled: false, migrationConfirmed: false }, sender: { name: brandName(brand), email: brand === brands[0] ? "hello@coralsanonymous.com" : "hello@macroalgaefarms.com", replyTo: "" } },
      setup: { sendingEnabled: false, ingestEnabled: false, emailReady: true, migrationConfirmed: false }, counts: { profiles: 0, mailable: 0, suppressions: 0 }, eventCounts: [], messageCounts: [], health: { unresolved: 0, skippedOrderUpdates: 0, inbox: [], lastProcessed: null, oldestPending: null },
    }]));
    const sync = { configured: true, running: false, phase: "not-started", checked: 0, imported: 0, updated: 0, suppressed: 0, skipped: 0, errors: 0, issues: [] };
    await page.route("**/*", async (route) => {
      const req = route.request(), url = new URL(req.url());
      if (url.hostname !== "127.0.0.1" && url.protocol !== "about:") { external.push(req.url()); return route.abort(); }
      if (url.pathname !== "/api/marketing") return route.continue();
      const brand = url.searchParams.get("brand");
      assert.ok(brands.includes(brand), "Every marketing request must have an explicit valid brand");
      requests.push({ brand, view: url.searchParams.get("view"), method: req.method() });
      const data = datasets[brand]; let result = data;
      if (req.method() === "POST") {
        const body = req.postDataJSON(); writes.push({ brand, body });
        assert.ok(!["test-email", "run-delivery", "run-campaign-test"].includes(body.action), "No real email actions in this test");
        if (body.action === "save-campaign") {
          const item = { ...body, id: body.id || brand + "-draft", status: "DRAFT", _count: { messages: 0 }, smartSendingHours: 16, scheduledAt: null };
          data.campaigns = [item]; result = item;
        } else if (body.action === "save-settings") {
          data.settings = { ...data.settings, ...body.settings, operations: { ...data.settings.operations, ...body.settings.operations } }; result = { settings: data.settings };
        } else if (body.action === "sync-shopify-subscribers") { sync.running = true; sync.phase = "customers"; result = sync; }
        else if (body.action === "pause-shopify-subscribers") { sync.running = false; result = sync; }
        else if (body.action === "register-shopify-webhooks") result = { results: [] };
        else throw Error("Unexpected action " + body.action);
      } else if (url.searchParams.get("view") === "shopify-subscribers") result = sync;
      await route.fulfill({ contentType: "application/json", body: JSON.stringify(result) });
    });
    const base = `http://127.0.0.1:${server.address().port}`;
    await page.addInitScript(() => { if (!sessionStorage.getItem("brands-fixture-seeded")) { localStorage.setItem("reef-marketing-brand", "macroalgae-farms"); sessionStorage.setItem("brands-fixture-seeded", "true"); } });
    await page.goto(base + "/our-klaviyo/campaigns?brand=corals-anonymous");
    await page.getByRole("button", { name: "Create campaign", exact: true }).waitFor();
    assert.equal(requests[0].brand, brands[0], "Explicit URL overrides saved selection before requests");
    assert.equal(await page.getByRole("button", { name: "Corals Anonymous", exact: true }).getAttribute("aria-pressed"), "true");
    await page.getByRole("button", { name: "Create campaign", exact: true }).click();
    await page.getByLabel("Campaign name", { exact: true }).fill("Unsaved Corals draft");
    page.once("dialog", (dialog) => dialog.dismiss());
    await page.getByRole("button", { name: "Macroalgae Farms", exact: true }).click();
    assert.equal(await page.getByLabel("Campaign name", { exact: true }).inputValue(), "Unsaved Corals draft");
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Macroalgae Farms", exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.marketing-brand-workspace')?.dataset.brand === "macroalgae-farms");
    await page.getByRole("button", { name: "Create campaign", exact: true }).waitFor();
    assert.equal(await page.getByLabel("Campaign name", { exact: true }).count(), 0, "Switch closes the previous brand's draft");
    assert.equal(await page.getByRole("link", { name: "Flows", exact: true }).count(), 0);
    await page.getByRole("button", { name: "Create campaign", exact: true }).click();
    await page.getByLabel("Campaign name", { exact: true }).fill("Macro launch");
    await page.getByRole("button", { name: "2. Email", exact: true }).click();
    await page.getByLabel("Subject line", { exact: true }).fill("Fresh macroalgae");
    await page.getByRole("button", { name: "Edit email and preview", exact: true }).click();
    const preview = await page.getByTitle("Email preview").getAttribute("srcdoc");
    assert.ok(preview.includes("macroalgaefarms.com")); assert.ok(!preview.includes("coralsanonymous.com"));
    await page.getByLabel("Back to campaign", { exact: true }).click();
    await page.getByRole("button", { name: "Save draft", exact: true }).click();
    await page.getByText("Draft saved", { exact: true }).waitFor();
    const saved = writes.find((item) => item.body.action === "save-campaign");
    assert.equal(saved.brand, brands[1]); assert.equal(saved.body.name, "Macro launch");
    assert.equal(saved.body.content.campaignLayout.sections.length, 2);
    assert.deepEqual(saved.body.content.campaignLayout.sections[0].feed.tags, []);
    assert.ok(!JSON.stringify(saved.body.content).match(/coralsanonymous|A50|AW50/i));
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Corals Anonymous", exact: true }).click();
    await page.getByRole("button", { name: "Create campaign", exact: true }).waitFor();
    await page.getByRole("button", { name: "Create campaign", exact: true }).click();
    assert.equal(await page.getByLabel("Campaign name", { exact: true }).inputValue(), "");
    await page.getByLabel("Campaign name", { exact: true }).fill("Corals campaign");
    await page.getByRole("button", { name: "2. Email", exact: true }).click();
    await page.getByLabel("Subject line", { exact: true }).fill("Corals subject");
    await page.getByRole("button", { name: "Save draft", exact: true }).click();
    await page.getByText("Draft saved", { exact: true }).waitFor();
    const savedCorals = writes.find((item) => item.brand === brands[0] && item.body.action === "save-campaign");
    assert.equal(savedCorals.body.name, "Corals campaign");
    assert.ok(JSON.stringify(savedCorals.body.content).includes("coralsanonymous.com"));
    assert.ok(savedCorals.body.content.campaignLayout.sections.length > 2);
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Macroalgae Farms", exact: true }).click();
    await page.getByRole("heading", { name: "Macro launch", exact: true }).waitFor();
    const snapshots = [];
    for (const width of [1440, 360]) {
      await page.setViewportSize({ width, height: 1000 });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "No horizontal overflow at " + width);
      const screenshot = path.join(output, `macro-campaigns-${width}.png`); await page.screenshot({ path: screenshot, fullPage: true }); snapshots.push(screenshot);
    }
    requests.length = 0;
    await page.goto(base + "/our-klaviyo/settings");
    await page.getByRole("heading", { name: "Shopify email subscribers", exact: true }).waitFor();
    assert.ok(requests.every((item) => item.brand === brands[1]), "Unscoped navigation restores selected brand before fetch");
    assert.equal(new URL(page.url()).searchParams.get("brand"), brands[1]);
    assert.equal(await page.getByText("Bring over the Klaviyo audience", { exact: true }).count(), 0);
    assert.equal(await page.getByLabel("Sender name", { exact: true }).inputValue(), "Macroalgae Farms");
    await page.getByLabel("Sender name", { exact: true }).fill("Macroalgae Farms Team");
    await page.getByRole("button", { name: "Save email sender", exact: true }).click();
    await page.getByText("Email sender saved.", { exact: true }).waitFor();
    assert.equal(writes.at(-1).brand, brands[1]); assert.equal(writes.at(-1).body.settings.sender.name, "Macroalgae Farms Team");
    await page.getByRole("button", { name: "Sync Shopify subscribers", exact: true }).click();
    await page.getByRole("button", { name: "Pause sync", exact: true }).waitFor();
    assert.equal(writes.at(-1).body.action, "sync-shopify-subscribers"); assert.equal(writes.at(-1).brand, brands[1]);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    const settingsShot = path.join(output, "macro-settings-360.png"); await page.screenshot({ path: settingsShot, fullPage: true }); snapshots.push(settingsShot);
    for (const href of await page.locator(".mk-brand-tabs a").evaluateAll((links) => links.map((link) => link.getAttribute("href")))) assert.equal(new URL(href, base).searchParams.get("brand"), brands[1]);
    await page.goto(base + "/our-klaviyo/flows?brand=macroalgae-farms");
    await page.getByRole("heading", { name: "Campaigns for Macroalgae Farms", exact: true }).waitFor();
    assert.equal(await page.getByRole("button", { name: "Enable this flow", exact: true }).count(), 0);
    assert.deepEqual(errors, []); assert.deepEqual(external, [], "No Shopify/provider/network email requests");
    console.log(JSON.stringify({ result: "PASS", screenshots: snapshots, writes: writes.map(({ brand, body }) => ({ brand, action: body.action })) }, null, 2));
  } finally { await browser?.close(); await new Promise((resolve) => server.close(resolve)); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
