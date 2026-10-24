/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { build } = require("esbuild");
const { chromium } = require("playwright");
(async () => {
  const productTagsOnly = process.argv.includes("--product-tags-only");
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
        '<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>',
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
      template: "campaign-sale",
      hero: "https://coralsanonymous.com/cdn/shop/files/sale.jpg",
      footerText: "Existing footer",
      campaignLayout: {
        heroLink: "https://coralsanonymous.com/collections/new-arrivals",
        navigation: [
          { label: "New Corals", url: "https://coralsanonymous.com/collections/new-arrivals" },
          { label: "Deal Busters", url: "https://coralsanonymous.com/collections/deal-busters" },
          { label: "Earn Points & Save!", url: "https://coralsanonymous.com/pages/rewards" },
        ],
        sections: [
          {
            id: "products-1",
            type: "products",
            backgroundColor: "#ffffff",
            products: [
              { id: "product-1", title: "Coco Worm", url: "https://coralsanonymous.com/products/coco-worm", image: "https://coralsanonymous.com/cdn/shop/files/coral.jpg", salePrice: "$40.00", compareAtPrice: "$79.99", button: "Shop now" },
              { id: "product-2", title: "Gold Hammer", url: "https://coralsanonymous.com/products/gold-hammer", salePrice: "$39.00", compareAtPrice: "$77.99", button: "Shop now" },
            ],
          },
          { id: "cta-1", type: "cta", label: "SHOP NOW!", url: "https://coralsanonymous.com", backgroundColor: "#3c8429", textColor: "#ffffff" },
        ],
        style: { fontFamily: "Arial", emailBackground: "#fff7f5", contentBackground: "#ffffff", textColor: "#080808", salePriceColor: "#e84218", buttonBackground: "#79e93c", buttonTextColor: "#000000", productAlignment: "center", productGap: 18, sectionPadding: 18, productImageWidth: 140, buttonRadius: 5, titleSize: 18, priceSize: 21 },
      },
    };
    if (productTagsOnly) {
      content.campaignLayout.sections[0].feed = {
        key: "anniversarysalesale", name: "Sale product feed", tags: ["A50", "A55", "A60", "A65"], order: "random", limit: 6,
      };
      content.campaignLayout.sections.splice(1, 0, {
        id: "products-2", type: "products", backgroundColor: "#ffffff",
        feed: { key: "newnewdiscount", name: "New discounts", tags: ["AW50", "AW55", "AW60", "AW65"], order: "newest", limit: 12 },
        products: [{ ...content.campaignLayout.sections[0].products[0], id: "old-discount", title: "Old discount preview" }],
      });
    }
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
          _count: { messages: 26 },
        },
      ],
      campaignTests: [],
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
        attribution: { emailClickDays: 5, emailOpenDays: 5 },
        operations: {},
      },
      setup: { sendingEnabled: true, emailReady: true, migrationConfirmed: true },
      counts: { profiles: 0, mailable: 0, suppressions: 0 },
      eventCounts: [],
      messageCounts: [],
    };
    const writes = [];
    let reportError = false;
    let holdProductPreview = false;
    let releaseProductPreview;
    let onProductPreviewHeld = () => undefined;
    await page.route("**/api/marketing**", async (route) => {
      const req = route.request();
      const url = new URL(req.url());
      if (req.method() === "POST") {
        const body = req.postDataJSON();
        writes.push(body);
        if (productTagsOnly && body.action === "preview-campaign-feeds") {
          if (holdProductPreview) {
            holdProductPreview = false;
            await new Promise(resolve => {
              releaseProductPreview = resolve;
              onProductPreviewHeld();
            });
          }
          const resolved = structuredClone(body.content);
          for (const section of resolved.campaignLayout.sections) {
            if (section.type !== "products" || !section.feed) continue;
            section.feed.tags = section.feed.tags.map(tag => tag.trim()).filter(Boolean);
            section.products = [{
              id: "preview-" + section.id, title: "Preview for " + (section.feed.tags.filter(Boolean).join(" or ") || "all products"),
              url: "https://coralsanonymous.com/products/test-preview", salePrice: "$20.00", button: "Shop now",
            }];
          }
          return route.fulfill({ json: { content: resolved } });
        }
        if (body.action === "save-campaign")
          data.campaigns[0] = { ...data.campaigns[0], ...body };
        if (body.action === "save-resource")
          data.resources[1] = { ...data.resources[1], ...body };
        if (body.action === "save-settings")
          data.settings = { ...data.settings, ...body.settings };
        if (body.action === "run-campaign-test")
          data.campaignTests.unshift({
            ...data.campaigns[0],
            id: `test-run-${data.campaignTests.length + 1}`,
            testOfCampaignId: body.id,
            name: `Test run: ${data.campaigns[0].name}`,
            status: "SCHEDULED",
            scheduledAt: body.at,
            messages: [{ status: "PENDING", error: null, profile: { email: body.to } }],
            _count: { messages: 1 },
          });
        await route.fulfill({
          json: {
            id: body.action === "run-campaign-test" ? data.campaignTests[0].id : body.id || "draft",
            ok: true,
            settings: data.settings,
          },
        });
      } else if (url.searchParams.get("view") === "campaign-report") {
        if (reportError) return route.fulfill({ status: 503, json: { error: "Orders temporarily unavailable" } });
        const testRun = data.campaignTests.find((item) => item.id === url.searchParams.get("id"));
        const orderPage = Number(url.searchParams.get("ordersPage") || 1);
        const orders = Array.from({ length: 26 }, (_, i) => ({ id: `order-${i}`, orderId: String(40026 - i), label: `#${40026 - i}`, placedAt: "2026-10-18T01:00:00Z", amount: 10, currency: "USD", interaction: "CLICKED", interactedAt: "2026-10-17T21:00:00Z", customer: { id: "customer", name: "Coral Customer", email: "coral.customer@example.com" }, shopifyUrl: `https://corals-anonymous.myshopify.com/admin/orders/${40026 - i}` }));
        await route.fulfill({ json: {
          campaign: testRun || data.campaigns[0],
          paymentVerification: { unverifiedOrders: testRun ? 0 : 3, staleOrders: testRun ? 0 : 5 },
          totals: { messages: 26, queued: 0, sent: 26, delivered: 26, opened: 20, clicked: 10, ordered: testRun ? 0 : 26, skipped: 0, failed: 0, needsAttention: 0, revenue: testRun ? {} : { USD: 260 } },
          orders: testRun ? [] : orders.slice((orderPage - 1) * 25, orderPage * 25),
          ordersPage: { page: orderPage, pageSize: 25, total: testRun ? 0 : 26, pages: testRun ? 1 : 2 },
          reasons: [],
        } });
      } else if (url.searchParams.get("view") === "analytics")
        await route.fulfill({
          json: {
            days: Number(url.searchParams.get("days") || 30),
            since: "2026-08-22T00:00:00Z",
            attribution: data.settings.attribution,
            paymentVerification: { unverifiedOrders: 2, staleOrders: 1 },
            totals: {
              messages: 120,
              sent: 100,
              recipients: 80, convertedRecipients: 8,
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
                recipients: 40, convertedRecipients: 4,
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
                recipients: 40, convertedRecipients: 4,
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
    if (productTagsOnly) {
      const openSections = async () => {
        await page.getByRole("button", { name: "Edit email and preview", exact: true }).click();
        await page.getByRole("dialog").waitFor();
        await page.getByRole("button", { name: "Layout", exact: true }).click();
        await page.getByText("Email sections", { exact: true }).click();
        for (const grid of await page.locator("summary").filter({ hasText: "Product grid" }).all()) await grid.click();
      };
      await page.goto("http://127.0.0.1:" + server.address().port);
      await page.getByRole("button", { name: "Edit", exact: true }).click();
      await page.getByRole("button", { name: "Continue to email" }).click();
      await openSections();
      const tags = page.getByLabel("Product tags (match any)");
      assert.equal(await tags.count(), 2);
      assert.equal(await tags.nth(0).inputValue(), "A50\nA55\nA60\nA65");
      assert.equal(await tags.nth(1).inputValue(), "AW50\nAW55\nAW60\nAW65");
      await tags.nth(0).fill("Halloween 2026");
      await tags.nth(0).press("End");
      await tags.nth(0).press("Enter");
      await tags.nth(0).pressSequentially("VIP sale");
      assert.equal(await tags.nth(0).inputValue(), "Halloween 2026\nVIP sale", "Entering a new line remains editable");
      await page.getByLabel("Number of products", { exact: true }).nth(0).fill("9");
      await page.getByLabel("Product order").nth(0).selectOption("price-low");
      assert.equal(await tags.nth(0).inputValue(), "Halloween 2026\nVIP sale");
      assert.equal(await tags.nth(1).inputValue(), "AW50\nAW55\nAW60\nAW65", "Other grids retain their own tags");
      await tags.nth(1).fill("Winter deal\nStaff's picks");
      assert.equal(await page.getByText(/Current preview ·/).count(), 0, "Changing rules clears the old product previews");
      await page.getByRole("button", { name: "Refresh product preview", exact: true }).nth(0).click();
      await page.getByText("Preview for Halloween 2026 or VIP sale", { exact: true }).waitFor({ state: "attached" });
      const previewWrite = writes.findLast(write => write.action === "preview-campaign-feeds");
      assert.deepEqual(previewWrite.content.campaignLayout.sections[0].feed.tags, ["Halloween 2026", "VIP sale"]);
      assert.deepEqual(previewWrite.content.campaignLayout.sections[1].feed.tags, ["Winter deal", "Staff's picks"]);
      assert.equal(previewWrite.content.campaignLayout.sections[0].feed.order, "price-low");
      assert.equal(previewWrite.content.campaignLayout.sections[0].feed.limit, 9);
      const previewHeld = new Promise(resolve => { onProductPreviewHeld = resolve; });
      holdProductPreview = true;
      await page.getByRole("button", { name: "Refresh product preview", exact: true }).nth(0).click();
      await previewHeld;
      await tags.nth(0).fill("Changed during preview");
      releaseProductPreview();
      await page.getByText("The section settings changed. Refresh the product preview again.", { exact: true }).first().waitFor();
      assert.equal(await tags.nth(0).inputValue(), "Changed during preview", "An old preview response never restores old tags");
      await tags.nth(0).fill("Halloween 2026\nVIP sale");
      await page.getByRole("button", { name: "Refresh product preview", exact: true }).nth(0).click();
      await page.getByText("Preview for Halloween 2026 or VIP sale", { exact: true }).waitFor({ state: "attached" });
      await page.getByRole("button", { name: "Save email", exact: true }).click();
      await page.getByText("Email saved", { exact: true }).first().waitFor();
      const saved = writes.findLast(write => write.action === "save-campaign");
      assert.deepEqual(saved.content.campaignLayout.sections[0].feed.tags, ["Halloween 2026", "VIP sale"]);
      assert.deepEqual(saved.content.campaignLayout.sections[1].feed.tags, ["Winter deal", "Staff's picks"]);
      await page.getByLabel("Back to campaign", { exact: true }).click();
      await openSections();
      assert.equal(await tags.nth(0).inputValue(), "Halloween 2026\nVIP sale", "Saved custom tags reopen unchanged");
      assert.equal(await tags.nth(1).inputValue(), "Winter deal\nStaff's picks");
      for (const width of [1440, 390, 320]) {
        await page.setViewportSize({ width, height: 900 });
        await tags.nth(0).scrollIntoViewIfNeeded();
        assert.ok(await page.getByRole("dialog").evaluate(el => el.scrollWidth <= el.clientWidth), `Tag editor fits ${width}px`);
        assert.ok(await tags.nth(0).evaluate(el => el.getBoundingClientRect().right <= innerWidth), `Tag field fits ${width}px`);
        await page.screenshot({ path: path.join(output, `campaign-tags-${width}.png`) });
      }
      await tags.nth(0).fill("");
      await page.getByRole("button", { name: "Refresh product preview", exact: true }).nth(0).click();
      await page.getByText("Preview for all products", { exact: true }).waitFor({ state: "attached" });
      assert.deepEqual(writes.findLast(write => write.action === "preview-campaign-feeds").content.campaignLayout.sections[0].feed.tags.filter(tag => tag.trim()), []);
      assert.equal(await tags.nth(0).inputValue(), "", "An explicitly cleared rule stays empty after preview");
      assert.deepEqual(errors, []);
      console.log("PASS: custom per-grid tag rules survive edits, preview, save/reopen, and clearing at desktop/390/320. Screenshots: " + output);
      return;
    }
    if (process.argv.includes("--overview-only")) {
      data.eventCounts = [{ type: "OPENED", _count: 12 }];
      await page.goto("http://127.0.0.1:" + server.address().port + "/?tab=overview");
      await page.getByRole("heading", { name: "Engagement & attribution", exact: true }).waitFor();
      const panel = page.locator("article").filter({ has: page.getByRole("heading", { name: "Engagement & attribution", exact: true }) });
      assert.equal(await panel.getByRole("link", { name: "View attributed sales →", exact: true }).getAttribute("href"), "/our-klaviyo/analytics");
      assert.match(await panel.innerText(), /OPENED\s+12/);
      assert.equal(await panel.getByText(/Attributed order value|Display limited to 10,000 attributed orders/).count(), 0);
      assert.equal(await panel.getByText(/Last recorded click|last recorded click/).count(), 0, "Overview does not repeat obsolete attribution settings");
      for (const width of [1440, 390, 320]) {
        await page.setViewportSize({ width, height: 900 });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `Overview fits ${width}px`);
        await page.screenshot({ path: path.join(output, `overview-${width}.png`) });
      }
      assert.deepEqual(errors, []);
      console.log("PASS: overview keeps engagement counts and links to canonical attributed sales. Screenshots: " + output);
      return;
    }
    await page.goto("http://127.0.0.1:" + server.address().port);
    await page.getByRole("button", { name: "View results", exact: true }).click();
    const ordersPanel = page.getByRole("region", { name: "Attributed orders", exact: true });
    await ordersPanel.getByRole("link", { name: "Open #40026 in Shopify" }).waitFor();
    assert.equal(await ordersPanel.getByRole("listitem").count(), 25);
    assert.equal(await ordersPanel.getByRole("link").first().getAttribute("href"), "https://corals-anonymous.myshopify.com/admin/orders/40026");
    assert.match(await ordersPanel.textContent(), /Credited after email click/);
    assert.match(await ordersPanel.textContent(), /All times Pacific/);
    assert.match(await ordersPanel.textContent(), /Shopify payments could not be verified for 3 orders\. Revenue and attribution may be incomplete\./);
    assert.match(await ordersPanel.textContent(), /Using last verified Shopify payments for 5 orders; refresh pending\./);
    assert.match(await ordersPanel.textContent(), /Paid revenue is payments received minus refunds, including tax and shipping\. Currencies stay separate\./);
    assert.doesNotMatch(await ordersPanel.textContent(), /before refunds/i);
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await ordersPanel.getByRole("heading", { name: "Attributed orders (26)", exact: true }).scrollIntoViewIfNeeded();
      assert.ok(await page.locator(".mk-campaign-report").evaluate(el => el.scrollWidth <= el.clientWidth));
      await page.screenshot({ path: path.join(output, `campaign-orders-${width}.png`) });
    }
    await ordersPanel.getByRole("button", { name: "Next orders" }).click();
    await ordersPanel.getByText("Page 2 of 2", { exact: true }).waitFor();
    assert.equal(await ordersPanel.getByRole("listitem").count(), 1);
    assert.equal(await ordersPanel.getByRole("button", { name: "Next orders" }).isDisabled(), true);
    reportError = true;
    await ordersPanel.getByRole("button", { name: "Refresh orders" }).click();
    await ordersPanel.getByRole("alert").waitFor();
    assert.equal(await ordersPanel.getByRole("link", { name: "Open #40001 in Shopify" }).count(), 1);
    reportError = false;
    await ordersPanel.getByRole("button", { name: "Try again" }).click();
    await ordersPanel.getByRole("button", { name: "Refresh orders" }).isEnabled();
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.getByRole("button", { name: "Send test", exact: true }).click();
    await page.getByLabel("Test recipient").fill("preview@example.com");
    await page.getByRole("button", { name: "Send test email", exact: true }).click();
    await page.getByText("Campaign status is unchanged.", { exact: false }).waitFor();
    assert.equal(writes.at(-1).action, "test-email");
    assert.equal(writes.at(-1).to, "preview@example.com");
    assert.equal(writes.at(-1).subject, "Test subject");
    assert.equal(data.campaigns[0].status, "DRAFT");
    const runButton = page.getByRole("button", { name: "Schedule campaign test", exact: true });
    assert.equal(await runButton.isDisabled(), true);
    assert.equal(await runButton.evaluate((button) => getComputedStyle(button).cursor), "not-allowed");
    const future = new Date(Date.now() + 60 * 60 * 1000);
    const localFuture = new Date(future.getTime() - future.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
    await page.getByLabel("Campaign test send time", { exact: false }).fill(localFuture);
    assert.equal(await runButton.isEnabled(), true);
    await runButton.click();
    await page.getByText("One-contact campaign test scheduled", { exact: false }).waitFor();
    assert.equal(writes.at(-1).action, "run-campaign-test");
    assert.equal(writes.at(-1).id, "draft");
    assert.equal(writes.at(-1).to, "preview@example.com");
    assert.equal(new Date(writes.at(-1).at).toISOString(), new Date(localFuture).toISOString());
    assert.equal(data.campaigns[0].status, "DRAFT");
    await page.getByRole("button", { name: "View test result" }).click();
    await page.getByText("Test run: Test campaign", { exact: true }).waitFor();
    await page.getByText("No orders have been attributed to this campaign yet.", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Send test", exact: true }).click();
    await page.getByRole("button", { name: "View email", exact: true }).click();
    await page.getByRole("dialog").waitFor();
    assert.equal(await page.getByText("Read-only email", { exact: true }).count(), 1);
    assert.equal(await page.getByRole("button", { name: "Save email", exact: true }).count(), 0);
    assert.ok((await page.getByTitle("Email preview").getAttribute("srcdoc")).includes("Coco Worm"));
    await page.getByLabel("Back to campaigns").click();
    await page.getByRole("button", { name: "Duplicate", exact: true }).click();
    assert.equal(await page.getByLabel("Campaign name").inputValue(), "Test campaign copy");
    await page.getByRole("button", { name: "Back to campaigns", exact: true }).click();
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
    await page.getByRole("button", { name: "Layout", exact: true }).click();
    await page.getByText("Email sections", { exact: true }).click();
    await page.locator("summary").filter({ hasText: "Product grid" }).first().click();
    await page.getByText("Product 1 · Coco Worm", { exact: true }).click();
    await page.getByLabel("Product name").first().fill("Red and White Coco Worm");
    await page.getByRole("button", { name: "Add full-width button" }).click();
    assert.ok((await page.getByTitle("Email preview").getAttribute("srcdoc")).includes("Red and White Coco Worm"));
    assert.equal((await page.getByTitle("Email preview").getAttribute("srcdoc")).match(/SHOP NOW!/g).length, 2);
    await page.screenshot({ path: path.join(output, "campaign-editor-desktop.png") });
    await page.getByRole("button", { name: "Mobile", exact: true }).click();
    await page.screenshot({ path: path.join(output, "campaign-email-mobile-preview.png") });
    await page.setViewportSize({ width: 390, height: 900 });
    assert.ok(await page.getByRole("dialog").evaluate((el) => el.scrollWidth <= el.clientWidth));
    await page.screenshot({ path: path.join(output, "campaign-editor-mobile-390.png"), fullPage: true });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.getByRole("button", { name: "Desktop", exact: true }).click();
    await page.getByRole("button", { name: "Footer", exact: true }).click();
    const toggle = page.getByLabel("Show business address in every email footer");
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
    assert.equal(writes.at(-1).brandingSource.showPostalAddress, true);
    assert.equal(writes.at(-1).content.campaignLayout.sections.length, 3);
    assert.equal(writes.at(-1).content.campaignLayout.sections[0].products[0].title, "Red and White Coco Worm");
    await page.getByLabel("Back to campaign").click();
    await page.getByRole("button", { name: "3. Review & schedule" }).click();
    await page.getByLabel("Test campaign email").getByLabel("Test recipient").fill("review@example.com");
    await page.getByLabel("Test campaign email").getByRole("button", { name: "Send test email" }).click();
    await page.getByText("The campaign is still a draft.", { exact: false }).waitFor();
    assert.equal(writes.at(-1).action, "test-email");
    assert.equal(writes.at(-1).to, "review@example.com");
    assert.equal(writes.at(-1).content.campaignLayout.sections[0].products[0].title, "Red and White Coco Worm");
    assert.equal(data.campaigns[0].status, "DRAFT");
    assert.equal(await page.getByLabel("Test campaign email").getByRole("button", { name: "Schedule campaign test" }).count(), 1);
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
    await page.getByLabel("Show business address in every email footer").check();
    await page.getByRole("button", { name: "Save email", exact: true }).click();
    await page.waitForFunction(() =>
      document.body.textContent.includes("Email saved"),
    );
    assert.equal(writes.at(-1).action, "save-resource");
    assert.equal(writes.at(-1).brandingSource.showPostalAddress, true);
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
    await page.getByText("Shopify payments could not be verified for 2 orders. Revenue and attribution may be incomplete.", { exact: true }).waitFor();
    await page.getByText("Using last verified Shopify payments for 1 order; refresh pending.", { exact: true }).waitFor();
    await page.getByText("Welcome Series", { exact: true }).waitFor();
    await page.getByText("Weekend coral sale", { exact: true }).waitFor();
    await page.getByLabel("Email open attribution days").fill("4");
    await page
      .getByRole("button", { name: "Save attribution settings" })
      .click();
    await page.waitForFunction(() =>
      document.body.textContent.includes("Revenue and engagement"),
    );
    assert.deepEqual(writes.at(-1), {
      action: "save-settings",
      settings: {
        attribution: { emailClickDays: 5, emailOpenDays: 4 },
      },
    });
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
