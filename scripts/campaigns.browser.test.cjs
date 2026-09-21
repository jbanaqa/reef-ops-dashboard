/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { build } = require("esbuild");
const { chromium } = require("playwright");
(async () => {
  const output = await fs.mkdtemp(path.join(os.tmpdir(), "reef-shared-email-"));
  const bundle = await build({
    entryPoints: ["scripts/campaigns.browser.fixture.tsx"],
    bundle: true,
    write: false,
    outdir: output,
    platform: "browser",
    jsx: "automatic",
    tsconfig: "scripts/tsconfig.marketing-tests.json",
    define: { "process.env.NODE_ENV": '"development"', "process.env": "{}" },
  });
  const server = http.createServer((req, res) => {
    const file = bundle.outputFiles.find((f) =>
      f.path.endsWith(req.url === "/app.js" ? ".js" : ".css"),
    );
    if (req.url === "/app.js" || req.url === "/app.css") {
      res.setHeader(
        "Content-Type",
        req.url.endsWith(".js") ? "text/javascript" : "text/css",
      );
      res.end(file.contents);
    } else
      res.end(
        '<html><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>',
      );
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      executablePath:
        process.env.MARKETING_TEST_BROWSER ||
        "C:/Program Files/Google/Chrome/Application/chrome.exe",
    });
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1000 },
    });
    const errors = [];
    page.on("pageerror", (e) => {
      errors.push(e.message);
      console.log(e.message);
    });
    const content = {
      heading: "Campaign heading",
      body: "Saved campaign message",
      button: "Shop",
      url: "https://coralsanonymous.com",
      template: "cart-recovery",
      footerText: "Existing footer",
      products: [],
    };
    const data = {
      profiles: [],
      campaigns: [
        {
          id: "draft",
          name: "Test campaign",
          subject: "Test subject",
          content,
          audience: { openedDays: 365 },
          smartSendingHours: 16,
          recipientMode: "SEND_TIME",
          status: "DRAFT",
          _count: { messages: 0 },
        },
      ],
      resources: [
        { id: "flow", kind: "FLOW", key: "welcome", data: {} },
        {
          id: "template",
          kind: "TEMPLATE",
          name: "Saved template",
          data: content,
        },
        {
          id: "mailable",
          kind: "SEGMENT",
          key: "mailable",
          name: "2025 Mailable Subscribers",
          data: { openedDays: 365 },
        },
        {
          id: "list",
          kind: "SEGMENT",
          key: "klaviyo-list-newsletter",
          name: "Newsletter",
          data: { list: "Newsletter" },
        },
      ],
      settings: {
        organizationName: "Corals Anonymous",
        postalAddress: "123 Ocean Avenue",
        operations: {},
      },
      setup: { sendingEnabled: false },
      counts: { profiles: 0, mailable: 0, suppressions: 0 },
      revenue: {},
      eventCounts: [],
      messageCounts: [],
    };
    const writes = [];
    await page.route("**/api/marketing**", async (route) => {
      const req = route.request();
      const url = new URL(req.url());
      if (req.method() === "POST") {
        const body = req.postDataJSON();
        writes.push(body);
        if (body.action === "save-campaign")
          data.campaigns[0] = { ...data.campaigns[0], ...body };
        if (body.action === "save-resource")
          data.resources[1] = { ...data.resources[1], ...body };
        await route.fulfill({ json: { id: body.id || "draft", ok: true } });
      } else if (url.searchParams.get("view") === "analytics")
        await route.fulfill({
          json: {
            days: Number(url.searchParams.get("days") || 30),
            since: "2026-08-22T00:00:00Z",
            totals: {
              messages: 120,
              sent: 100,
              delivered: 96,
              opened: 50,
              clicked: 20,
              orders: 8,
              trackedOrders: 40,
              revenue: { USD: 821.5 },
              storeRevenue: { USD: 5000 },
            },
            rows: [
              {
                key: "welcome",
                kind: "FLOW",
                name: "Welcome Series",
                messages: 60,
                sent: 50,
                delivered: 48,
                opened: 30,
                clicked: 12,
                orders: 5,
                revenue: { USD: 500 },
              },
              {
                key: "campaign-sale",
                kind: "CAMPAIGN",
                name: "Weekend coral sale",
                messages: 60,
                sent: 50,
                delivered: 48,
                opened: 20,
                clicked: 8,
                orders: 3,
                revenue: { USD: 321.5 },
              },
            ],
          },
        });
      else await route.fulfill({ json: data });
    });
    await page.goto("http://127.0.0.1:" + server.address().port);
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    assert.equal(await page.getByText("Dynamic segments", { exact: true }).count(), 1);
    assert.equal(
      await page
        .getByRole("checkbox", {
          name: "2025 Mailable Subscribers",
          exact: true,
        })
        .first()
        .isChecked(),
      true,
    );
    assert.equal(await page.getByText("Lists", { exact: true }).count(), 1);
    assert.equal(await page.getByText("Newsletter", { exact: true }).count(), 1);
    await page.getByRole("button", { name: "Continue to email" }).click();
    await page.getByRole("button", { name: "Edit email and preview" }).click();
    await page.getByRole("dialog").waitFor();
    await page.getByRole("button", { name: "Footer", exact: true }).click();
    const toggle = page.getByLabel("Show business address in this email");
    assert.equal(await toggle.isChecked(), false);
    assert.ok(
      !(await page.getByTitle("Email preview").getAttribute("srcdoc")).includes(
        "123 Ocean Avenue",
      ),
    );
    await toggle.check();
    assert.ok(
      (await page.getByTitle("Email preview").getAttribute("srcdoc")).includes(
        "123 Ocean Avenue",
      ),
    );
    await page.getByRole("button", { name: "Save email", exact: true }).click();
    await page.waitForFunction(() =>
      document.body.textContent.includes("Email saved"),
    );
    assert.equal(writes.at(-1).action, "save-campaign");
    assert.equal(writes.at(-1).content.showPostalAddress, true);
    await page.getByLabel("Back to campaign").click();
    await page.getByRole("button", { name: "3. Review & schedule" }).click();
    assert.equal(await page.getByLabel("16-hour Smart Sending").isChecked(), true);
    assert.equal(await page.getByRole("button", { name: "Send now" }).count(), 1);
    assert.equal(
      await page.getByText("Determine recipients at send time", { exact: true }).count(),
      1,
    );
    await page.goto(
      "http://127.0.0.1:" + server.address().port + "?tab=templates",
    );
    await page.getByRole("button", { name: "Review and edit" }).click();
    await page.getByRole("button", { name: "Footer", exact: true }).click();
    await page.getByLabel("Show business address in this email").check();
    await page.getByRole("button", { name: "Save email", exact: true }).click();
    await page.waitForFunction(() =>
      document.body.textContent.includes("Email saved"),
    );
    assert.equal(writes.at(-1).action, "save-resource");
    assert.equal(writes.at(-1).data.showPostalAddress, true);
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      assert.ok(
        await page
          .getByRole("dialog")
          .evaluate((el) => el.scrollWidth <= el.clientWidth),
      );
      await page.screenshot({ path: path.join(output, width + ".png") });
    }
    await page.keyboard.press("Escape");
    assert.equal(await page.getByRole("dialog").count(), 0);
    await page.goto(
      "http://127.0.0.1:" + server.address().port + "?tab=analytics",
    );
    await page.getByText("USD 821.50", { exact: true }).waitFor();
    await page.getByText("Welcome Series", { exact: true }).waitFor();
    await page.getByText("Weekend coral sale", { exact: true }).waitFor();
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.screenshot({ path: path.join(output, "analytics-desktop.png") });
    await page.setViewportSize({ width: 320, height: 900 });
    assert.ok(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      "Analytics page fits at 320px",
    );
    await page.screenshot({
      path: path.join(output, "analytics-mobile-320.png"),
      fullPage: true,
    });
    assert.deepEqual(errors, []);
    console.log(
      "PASS: campaigns/templates share the editor and analytics reports flow/campaign revenue at desktop/mobile. Screenshots: " +
        output,
    );
  } finally {
    await browser?.close();
    await new Promise((r) => server.close(r));
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
