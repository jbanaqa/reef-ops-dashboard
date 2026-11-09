/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { build } = require("esbuild");
const { chromium } = require("playwright");

(async () => {
  const bundleOutput = await fs.mkdtemp(path.join(os.tmpdir(), "reef-campaign-archive-"));
  const output = process.env.MARKETING_ARCHIVE_TEST_OUTPUT || "C:/Users/GuestUser/.codex/artifacts/campaign-archive-2026-11-09";
  await fs.mkdir(output, { recursive: true });
  const bundle = await build({
    entryPoints: ["scripts/marketing-brands.browser.fixture.tsx"], bundle: true, write: false,
    outdir: bundleOutput, platform: "browser", jsx: "automatic", tsconfig: "scripts/tsconfig.marketing-tests.json",
    define: { "process.env.NODE_ENV": '"development"', "process.env": "{}" },
  });
  const server = http.createServer((req, res) => {
    if (["/app.js", "/app.css"].includes(req.url)) {
      const file = bundle.outputFiles.find(item => item.path.endsWith(req.url === "/app.js" ? ".js" : ".css"));
      res.setHeader("Content-Type", req.url === "/app.js" ? "text/javascript" : "text/css");
      res.end(file.contents);
    } else res.end('<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"><style>:root{--surface:#fff;--surface-muted:#f5f7f8;--border:#d6e0e6;--text-main:#172f3c;--text-muted:#5a6b75;--danger:#a22;--danger-soft:#fff1f1;--success:#277a57}*{box-sizing:border-box}body{font-family:Arial,sans-serif;margin:0;background:#f2f5f7;padding:20px}button,input,textarea,select{font:inherit}</style></head><body><div id="root"></div><script src="/app.js"></script></body></html>');
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true, executablePath: process.env.MARKETING_TEST_BROWSER || "C:/Program Files/Google/Chrome/Application/chrome.exe" });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
    const errors = [], external = [], writes = [], requests = [], screenshots = [];
    page.on("pageerror", error => errors.push(error.message));
    const brands = ["corals-anonymous", "macroalgae-farms"];
    const brandName = brand => brand === brands[0] ? "Corals Anonymous" : "Macroalgae Farms";
    const content = brand => ({ heading: "A campaign to keep", body: "Saved email content", button: "Shop now", url: brand === brands[0] ? "https://coralsanonymous.com" : "https://macroalgaefarms.com" });
    const datasets = Object.fromEntries(brands.map(brand => [brand, {
      campaigns: ["DRAFT", "SENT", "SCHEDULED"].map((status, index) => ({
        id: brand + "-" + status.toLowerCase(), name: brandName(brand) + " " + status.toLowerCase(),
        subject: "Preserved " + status.toLowerCase() + " subject", content: content(brand), status, archivedAt: null,
        scheduledAt: status === "SCHEDULED" ? "2027-01-02T20:00:00Z" : null,
        createdAt: "2026-11-09T12:00:00Z", audience: { version: 2, includeKeys: ["mailable"], excludeKeys: [] },
        smartSendingHours: 16, recipientMode: "SEND_TIME", _count: { messages: index === 0 ? 0 : 15 },
      })),
      profiles: [], campaignTests: [], resources: [{ id: brand + "-mailable", key: "mailable", kind: "SEGMENT", name: "Mailable Subscribers", data: { masterMarketing: true } }],
      settings: { organizationName: brandName(brand), postalAddress: "123 Ocean Avenue, CA 90001, USA", attribution: { emailClickDays: 5, emailOpenDays: 1 }, operations: {}, sender: { name: brandName(brand), email: "hello@example.com", replyTo: "" } },
      setup: { sendingEnabled: false, emailReady: true, migrationConfirmed: false },
      counts: { profiles: 0, mailable: 0, suppressions: 0 }, eventCounts: [], messageCounts: [],
      health: { unresolved: 0, skippedOrderUpdates: 0, inbox: [], lastProcessed: null, oldestPending: null },
    }]));
    const original = structuredClone(datasets);
    let failNextArchive = false;
    let holdNextArchivedRead = false;
    let releaseRead;
    let readHeld;
    await page.route("**/*", async route => {
      const req = route.request(), url = new URL(req.url());
      if (url.hostname !== "127.0.0.1") { external.push(req.url()); return route.abort(); }
      if (url.pathname !== "/api/marketing") return route.continue();
      const brand = url.searchParams.get("brand");
      assert.ok(brands.includes(brand), "All campaign requests carry their brand");
      requests.push({ brand, method: req.method(), visibility: url.searchParams.get("campaignVisibility") });
      const data = datasets[brand];
      if (req.method() === "POST") {
        const body = req.postDataJSON();
        writes.push({ brand, ...body });
        assert.ok(["archive-campaign", "restore-campaign"].includes(body.action), "Archive testing must not invoke sending, consent or campaign cancellation");
        if (body.action === "archive-campaign" && failNextArchive) {
          failNextArchive = false;
          return route.fulfill({ status: 503, json: { error: "Archive is temporarily unavailable. Please try again." } });
        }
        const campaign = data.campaigns.find(item => item.id === body.id);
        assert.ok(campaign, "A campaign action must stay within its selected brand");
        campaign.archivedAt = body.action === "archive-campaign" ? "2026-11-09T20:00:00.000Z" : null;
        return route.fulfill({ json: { ok: true } });
      }
      const visibility = url.searchParams.get("campaignVisibility") === "archived" ? "archived" : "current";
      if (visibility === "archived" && holdNextArchivedRead) {
        holdNextArchivedRead = false;
        await new Promise(resolve => { releaseRead = resolve; readHeld(); });
      }
      return route.fulfill({ json: {
        ...data,
        campaigns: data.campaigns.filter(item => visibility === "archived" ? !!item.archivedAt : !item.archivedAt),
        campaignVisibility: visibility,
        archivedCampaignCount: data.campaigns.filter(item => !!item.archivedAt).length,
      } });
    });
    const base = `http://127.0.0.1:${server.address().port}`;
    const card = (brand, status) => page.locator(".mk-campaign-card").filter({ has: page.getByRole("heading", { name: brandName(brand) + " " + status.toLowerCase(), exact: true }) });
    const view = name => page.getByRole("group", { name: "Campaign view", exact: true }).getByRole("button", { name });
    const current = () => view("Current");
    const archived = () => view(/^Archived \(\d+\)$/);
    const assertCount = async (count, message) => {
      await page.waitForFunction(expected => document.querySelectorAll(".mk-campaign-card").length === expected, count);
      assert.equal(await page.locator(".mk-campaign-card").count(), count, message);
    };
    const screenshot = async name => { const file = path.join(output, name + ".png"); await page.screenshot({ path: file, fullPage: true }); screenshots.push(file); };

    for (const brand of brands) {
      await page.setViewportSize({ width: 1440, height: 1100 });
      await page.goto(base + "/our-klaviyo/campaigns?brand=" + brand);
      await assertCount(3, "All current campaign statuses are initially visible");
      assert.equal(await current().getAttribute("aria-pressed"), "true");
      assert.equal(await archived().textContent(), "Archived (0)", "Archive state is isolated from the other brand");
      await card(brand, "DRAFT").getByRole("button", { name: "Archive", exact: true }).click();
      await assertCount(2);
      assert.equal(await archived().textContent(), "Archived (1)");
      await archived().click();
      await assertCount(1);
      assert.equal(await archived().getAttribute("aria-pressed"), "true");
      assert.equal(await card(brand, "DRAFT").getByRole("button", { name: "Edit", exact: true }).count(), 0);
      assert.equal(await card(brand, "DRAFT").getByRole("button", { name: "Send test", exact: true }).count(), 0);
      assert.equal(await card(brand, "DRAFT").getByRole("button", { name: "View email", exact: true }).count(), 1);
      assert.equal(await card(brand, "DRAFT").getByRole("button", { name: "Duplicate", exact: true }).count(), 1);
      await screenshot(brand + "-archive-desktop");
      await page.reload();
      await current().waitFor();
      await archived().click();
      await assertCount(1, "The archived campaign remains archived after reopening the page");
      await card(brand, "DRAFT").getByRole("button", { name: "Restore", exact: true }).click();
      await page.getByText("No archived campaigns", { exact: true }).waitFor();
      await assertCount(0);
      await current().click();
      await assertCount(3);
      assert.equal(await card(brand, "DRAFT").getByRole("button", { name: "Edit", exact: true }).count(), 1, "Restoring a draft brings back editing");

      await card(brand, "SENT").getByRole("button", { name: "Archive", exact: true }).click();
      await assertCount(2);
      await card(brand, "SCHEDULED").getByRole("button", { name: "Archive", exact: true }).click();
      await assertCount(1);
      assert.match(await page.locator(".marketing").innerText(), /(?:send|delivery|sending).*continue|continue.*(?:send|delivery|sending)/i, "Archiving an active campaign explicitly says delivery continues");
      await archived().click();
      await assertCount(2);
      assert.equal(await card(brand, "SCHEDULED").getByRole("button", { name: "Cancel", exact: true }).count(), 1, "An archived scheduled campaign can still be cancelled");
      assert.equal(await card(brand, "SENT").getByRole("button", { name: "View results", exact: true }).count(), 1, "Completed campaign reporting is still reachable");
      for (const width of [390, 320]) {
        await page.setViewportSize({ width, height: 1100 });
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "No archive layout overflow for " + brand + " at " + width);
        await screenshot(brand + "-archive-" + width);
      }
      await page.getByLabel("Search campaigns", { exact: true }).fill("No matching subject in this workspace");
      await page.getByText("No matching campaigns", { exact: true }).waitFor();
      await assertCount(0);
      await page.getByLabel("Search campaigns", { exact: true }).fill("");
      await assertCount(2);
      await current().click();
      await assertCount(1);
      await card(brand, "DRAFT").getByRole("button", { name: "Archive", exact: true }).click();
      await page.getByText("No current campaigns", { exact: true }).waitFor();
      await assertCount(0);
      await archived().click();
      await assertCount(3);
      for (const status of ["DRAFT", "SENT", "SCHEDULED"]) {
        await card(brand, status).getByRole("button", { name: "Restore", exact: true }).click();
        await card(brand, status).waitFor({ state: "hidden" });
      }
      await page.getByText("No archived campaigns", { exact: true }).waitFor();
      await current().click();
      await assertCount(3);

      if (brand === brands[0]) {
        failNextArchive = true;
        await card(brand, "DRAFT").getByRole("button", { name: "Archive", exact: true }).click();
        await page.getByText("Archive is temporarily unavailable. Please try again.", { exact: true }).waitFor();
        await assertCount(3, "A failed archive leaves the campaign visible");
        const held = new Promise(resolve => { readHeld = resolve; });
        holdNextArchivedRead = true;
        await archived().click();
        await held;
        assert.equal(await page.locator(".mk-campaign-card").count(), 0, "Changing list view must hide stale campaign action buttons while loading");
        releaseRead();
        await page.getByText("No archived campaigns", { exact: true }).waitFor();
        await current().click();
        await assertCount(3);
        await card(brand, "DRAFT").getByRole("button", { name: "Archive", exact: true }).click();
        await assertCount(2);
      }
    }
    for (const brand of brands) {
      for (let index = 0; index < datasets[brand].campaigns.length; index++) {
        const { archivedAt, ...after } = datasets[brand].campaigns[index];
        const { archivedAt: oldArchived, ...before } = original[brand].campaigns[index];
        assert.deepEqual(after, before, "Visual archiving preserves status, message counts and all saved campaign data");
        void archivedAt; void oldArchived;
      }
    }
    assert.deepEqual(errors, []);
    assert.deepEqual(external, [], "No Shopify, provider or live API requests");
    const result = { result: "PASS", screenshots, writes, requests: requests.length };
    await fs.writeFile(path.join(output, "browser-verification.json"), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result, null, 2));
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
