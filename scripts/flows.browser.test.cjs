/* eslint-disable @typescript-eslint/no-require-imports -- Standalone CommonJS test runner. */
// Run with Chrome installed, or set MARKETING_TEST_BROWSER to an executable.
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { build } = require("esbuild");
const { chromium } = require("playwright");
(async () => {
  const output = await fs.mkdtemp(path.join(os.tmpdir(), "reef-flows-"));
  const bundle = await build({
    entryPoints: ["scripts/flows.browser.fixture.tsx"],
    bundle: true,
    write: false,
    platform: "browser",
    jsx: "automatic",
    tsconfig: "scripts/tsconfig.marketing-tests.json",
    define: { "process.env.NODE_ENV": '"development"', "process.env": "{}" },
  });
  const css =
    (await fs.readFile("app/our-klaviyo/marketing.css", "utf8")) +
    (await fs.readFile("app/our-klaviyo/flows.css", "utf8")) +
    (await fs.readFile("app/our-klaviyo/stock.css", "utf8")) +
    ":root{--surface:#fff;--surface-muted:#f5f8f7;--border:#dce5e3;--text-main:#203e38;--text-muted:#627872}*{box-sizing:border-box}dialog{margin:0}body{font-family:Arial,sans-serif}";
  const server = http.createServer((req, res) => {
    if (req.url === "/app.js") {
      res.setHeader("Content-Type", "text/javascript");
      res.end(bundle.outputFiles[0].contents);
    } else if (req.url === "/style.css") {
      res.setHeader("Content-Type", "text/css");
      res.end(css);
    } else
      res.end(
        '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body style="margin:0;background:#e8efef"><div id="root"></div><script src="/app.js"></script></body></html>',
      );
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
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1000 },
    });
    page.setDefaultTimeout(10000);
    page.on("dialog", (dialog) => dialog.accept());
    const errors = [];
    page.on("pageerror", (error) => {
      errors.push(error.message);
      console.log("PAGE ERROR", error.message);
    });
    // Only local fixture requests are allowed. Tests never contact production.
    await page.route("**/*", (route) =>
      route.request().url().startsWith("http://127.0.0.1:") ||
      route.request().url().startsWith("data:")
        ? route.continue()
        : route.abort(),
    );

    await page.goto("http://127.0.0.1:" + server.address().port);
    await page.getByText("5 of 5 workflows", { exact: true }).waitFor();
    await page.screenshot({ path: path.join(output, "flows-desktop.png") });
    assert.equal(await page.locator(".fw-row").count(), 5);
    assert.equal(
      await page.locator(".fw-row").first().getByRole("heading").innerText(),
      "B2B Welcoming Email",
    );
    await page
      .getByText("Customer sending is paused", { exact: true })
      .waitFor();
    const b2b = page.locator(".fw-row").filter({
      has: page.getByRole("heading", {
        name: "B2B Welcoming Email",
        exact: true,
      }),
    });
    assert.deepEqual(await b2b.locator("dd").allTextContents(), ["1", "2"]);
    await page.getByLabel("Status", { exact: true }).selectOption("review");
    await page.getByText("4 of 5 workflows", { exact: true }).waitFor();
    await page.getByLabel("Status", { exact: true }).selectOption("all");
    await page.getByLabel("Find a workflow", { exact: true }).fill("b2b");
    await page.getByText("1 of 5 workflows", { exact: true }).waitFor();
    await page
      .getByRole("button", { name: "Open B2B Welcoming Email", exact: true })
      .click();
    await page
      .getByRole("heading", { name: "Edit B2B Welcoming Email", exact: true })
      .waitFor();
    assert.equal(
      await page.locator(".fw-directory").count(),
      0,
      "The directory does not sit above the open workflow",
    );
    await page.getByText("Welcome to wholesale", { exact: true }).click();
    await page.getByRole("dialog").waitFor();
    await page
      .getByLabel("Subject", { exact: true })
      .fill("Preserved B2B subject");
    await page.getByLabel("Back to flow", { exact: true }).click();
    await page
      .getByRole("button", { name: "← All flows", exact: true })
      .click();
    assert.equal(
      await page.getByLabel("Find a workflow", { exact: true }).inputValue(),
      "b2b",
    );
    assert.equal(
      await page.evaluate(() => document.activeElement.id),
      "flow-open-b2b-welcome",
    );
    await page
      .getByRole("button", { name: "Open B2B Welcoming Email", exact: true })
      .click();
    await page.getByText("Preserved B2B subject", { exact: true }).click();
    assert.equal(
      await page.getByLabel("Subject", { exact: true }).inputValue(),
      "Preserved B2B subject",
    );
    await page.getByRole("button", { name: "Save email", exact: true }).click();
    await page.getByText("Saved to flow", { exact: true }).waitFor();
    assert.equal(
      await page.evaluate(
        () =>
          JSON.parse(localStorage.getItem("savedFlow")).data.steps[0].subject,
      ),
      "Preserved B2B subject",
    );
    await page.getByLabel("Back to flow", { exact: true }).click();
    await page
      .getByRole("button", { name: "← All flows", exact: true })
      .click();
    await page
      .getByLabel("Find a workflow", { exact: true })
      .fill("no such workflow");
    await page.getByText("No workflows match", { exact: true }).waitFor();
    await page
      .getByRole("button", { name: "Clear filters", exact: true })
      .click();
    const cart = page.locator(".fw-row").filter({
      has: page.getByRole("heading", { name: "Abandoned Cart", exact: true }),
    });
    await cart.getByText("3 message steps", { exact: true }).waitFor();
    await cart.getByText("Email + Text", { exact: true }).waitFor();
    await page.getByLabel("Sort by", { exact: true }).selectOption("name");
    assert.equal(
      await page.locator(".fw-row").first().getByRole("heading").innerText(),
      "24 Hour Notice | Upsell",
    );
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        "No horizontal overflow at " + width,
      );
      await page.screenshot({
        path: path.join(output, "flows-mobile-" + width + ".png"),
        fullPage: true,
      });
    }

    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.route("**/api/marketing*", async (route) => {
      const request = route.request();
      if (request.url().includes("view=cart-history"))
        return route.fulfill({
          json: {
            configured: false,
            phase: "not-started",
            imported: 0,
            ignored: 0,
          },
        });
      if (request.url().includes("view=cart-report"))
        return route.fulfill({
          json: {
            rows: [
              {
                key: "first",
                label: "Email #1 · Soft push",
                waiting: 2,
                sent: 4,
                delivered: 4,
                opened: 2,
                clicked: 1,
                orders: 1,
                revenue: { USD: 25 },
                stopped: 0,
                needsAttention: 0,
              },
            ],
            reasons: [],
          },
        });
      if (request.method() === "GET")
        return route.fulfill({ json: { status: null } });
      const body = request.postDataJSON();
      if (body.action === "preview-cart-products")
        return route.fulfill({
          json: {
            products: [
              {
                title: "Customer coral",
                url: "https://coralsanonymous.com/products/test",
                price: "USD 25.00",
              },
            ],
          },
        });
      if (body.action === "preview-stock")
        return route.fulfill({
          json: {
            collection: "T5 Tank",
            checked: 12,
            low: 1,
            at: new Date().toISOString(),
            variants: [
              {
                id: "1",
                product: "Example coral",
                variant: "Small",
                quantity: 4,
              },
            ],
          },
        });
      if (body.action === "check-stock")
        return route.fulfill({
          json: {
            collection: "T5 Tank",
            checked: 12,
            low: 1,
            queued: 0,
            at: new Date().toISOString(),
          },
        });
      throw new Error("Unexpected stock request");
    });
    await page
      .getByRole("button", { name: "Open Low Stock Alert: T5", exact: true })
      .click();

    await page
      .getByRole("heading", { name: "Edit Low Stock Alert: T5", exact: true })
      .waitFor();
    assert.equal(
      await page.getByLabel("Mobile number", { exact: true }).count(),
      0,
      "Settings are hidden until a node is opened",
    );
    const openNode = async (name) =>
      page.locator(".mk-flow-map").getByRole("button", { name }).click();
    const closePanel = async () =>
      page.getByRole("button", { name: /^Back to (stock )?flow$/ }).click();
    await openNode(/Notify the staff recipient/);
    assert.ok(
      await page.getByRole("dialog").evaluate((el) => {
        const r = el.getBoundingClientRect();
        return (
          Math.abs(r.left + r.width / 2 - innerWidth / 2) < 2 &&
          Math.abs(r.top + r.height / 2 - innerHeight / 2) < 2
        );
      }),
      "Stock settings dialog is centered despite global dialog margin reset",
    );
    assert.equal(
      await page.getByLabel("Mobile number", { exact: true }).inputValue(),
      "+16573450924",
    );
    assert.equal(
      await page.getByLabel("Recipient timezone", { exact: true }).inputValue(),
      "America/Los_Angeles",
    );
    await page.keyboard.press("Escape");
    assert.match(
      await page.evaluate(() => document.activeElement.textContent),
      /Notify the staff recipient/,
    );
    await openNode(/Variant stock drops below/);
    await page
      .getByRole("button", { name: "Preview current stock", exact: true })
      .click();
    await page
      .getByText("12 tracked variants · 1 below threshold", { exact: true })
      .waitFor();
    await closePanel();
    await openNode(/Low stock email/);
    await page
      .getByRole("region", { name: "Live email preview", exact: true })
      .waitFor();
    assert.ok(
      await page.getByRole("dialog").evaluate((el) => {
        const r = el.getBoundingClientRect();
        return (
          Math.abs(r.left + r.width / 2 - innerWidth / 2) < 2 &&
          Math.abs(r.top + r.height / 2 - innerHeight / 2) < 2
        );
      }),
      "Stock email designer is centered",
    );
    await page
      .getByLabel("Email message", { exact: true })
      .fill(
        "Please restock {{ ProductTitle }}. Remaining: {{ InventoryQuantity }}.",
      );
    await page
      .frameLocator('iframe[title="Email preview"]')
      .getByText("Please restock Example coral. Remaining: 4.", { exact: true })
      .waitFor();
    await page.getByRole("button", { name: "Mobile", exact: true }).click();
    await page
      .getByLabel("Mobile preview width", { exact: true })
      .selectOption("320");
    await page.waitForFunction(() => {
      const f = document.querySelector('iframe[title="Email preview"]');
      const body = f?.contentDocument?.body;
      return body && body.getBoundingClientRect().bottom <= f.clientHeight;
    });
    await page.screenshot({
      path: path.join(output, "stock-email-preview.png"),
    });
    await closePanel();
    await page
      .getByRole("button", { name: "← All flows", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Open Low Stock Alert: T5", exact: true })
      .click();
    await page
      .getByText("Unfinished changes restored.", { exact: true })
      .waitFor();
    await openNode(/Low stock email/);
    assert.match(
      await page.getByLabel("Email message", { exact: true }).inputValue(),
      /Please restock/,
    );
    await closePanel();
    await page.getByLabel("Enable this stock flow", { exact: true }).check();
    await page
      .getByRole("button", { name: "Save stock flow", exact: true })
      .click();
    await page.getByRole("alert").filter({ hasText: "permission" }).waitFor();
    await openNode(/Notify the staff recipient/);
    await page
      .getByLabel("This staff member has agreed", { exact: false })
      .check();
    await closePanel();
    await page
      .getByLabel("I reviewed the collection", { exact: false })
      .check();
    await page
      .getByRole("button", { name: "Save stock flow", exact: true })
      .click();
    await page
      .getByText("Stock alert settings saved.", { exact: true })
      .waitFor();
    await openNode(/Low stock email/);
    await page.getByRole("button", { name: "Save email", exact: true }).click();
    await page.getByText("Saved to flow", { exact: true }).waitFor();
    await closePanel();
    const savedStock = await page.evaluate(
      () => JSON.parse(localStorage.getItem("savedFlow")).data.stock,
    );
    assert.match(savedStock.emailBody, /Please restock/);
    await page
      .getByRole("button", { name: "Test and check stock", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Check saved flow now", exact: true })
      .click();
    await page
      .getByText(
        "T5 Tank: 12 variants checked · 1 below threshold · 0 messages queued",
        { exact: true },
      )
      .waitFor();
    await closePanel();
    await page.screenshot({
      path: path.join(output, "stock-desktop.png"),
      fullPage: true,
    });
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        "Stock diagram fits at " + width,
      );
      await page.screenshot({
        path: path.join(output, "stock-mobile-" + width + ".png"),
        fullPage: true,
      });
      await openNode(/Low stock email/);
      assert.ok(
        await page
          .getByRole("dialog")
          .evaluate((el) => el.scrollWidth <= el.clientWidth),
        "Stock dialog fits at " + width,
      );
      await page.screenshot({
        path: path.join(output, "stock-dialog-" + width + ".png"),
      });
      await closePanel();
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page
      .getByRole("button", { name: "← All flows", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Open Abandoned Cart", exact: true })
      .click();
    await page.locator(".mk-cart-map").waitFor();
    assert.equal(
      await page.getByLabel("Enable this flow", { exact: true }).isChecked(),
      false,
    );
    await page.screenshot({
      path: path.join(output, "cart-desktop.png"),
      fullPage: true,
    });
    await page
      .locator(".mk-cart-map")
      .getByRole("button", { name: /Product recommendations/ })
      .click();
    assert.ok(
      await page.getByRole("dialog").evaluate((el) => {
        const r = el.getBoundingClientRect();
        return (
          Math.abs(r.left + r.width / 2 - innerWidth / 2) < 2 &&
          Math.abs(r.top + r.height / 2 - innerHeight / 2) < 2
        );
      }),
    );
    await page.getByLabel("Products per email").fill("3");
    await page.keyboard.press("Escape");
    for (const name of [
      "Email #1 · Soft push",
      "Email #2 · Another soft push",
      "Email #2 · Discount offer",
    ]) {
      await page
        .locator(".mk-cart-map")
        .getByRole("button", { name: new RegExp(name) })
        .click();
      await page
        .getByRole("region", { name: "Live email preview", exact: true })
        .waitFor();
      assert.equal(
        await page
          .getByLabel("Customer checkout link")
          .getAttribute("readonly"),
        "",
      );
      const frame = page.frameLocator('iframe[title="Email preview"]');
      await frame
        .getByText("Example coral from your cart", { exact: true })
        .waitFor();
      if (name.includes("Discount"))
        await frame.getByText("AC300-PREVIEW", { exact: true }).waitFor();
      await page.getByRole("button", { name: "Mobile", exact: true }).click();
      await page
        .getByLabel("Mobile preview width", { exact: true })
        .selectOption("320");
      await page.waitForFunction(() => {
        const f = document.querySelector('iframe[title="Email preview"]');
        return (
          f?.contentDocument?.body.getBoundingClientRect().bottom <=
          f.clientHeight
        );
      });
      assert.ok(
        await page
          .locator('iframe[title="Email preview"]')
          .evaluate(
            (f) =>
              f.contentDocument.documentElement.scrollWidth <= f.clientWidth,
          ),
      );
      await page.screenshot({
        path: path.join(
          output,
          "cart-" +
            (name.includes("Discount")
              ? "discount"
              : name.includes("Another")
                ? "followup"
                : "first") +
            ".png",
        ),
      });
      await page.getByLabel("Back to flow", { exact: true }).click();
    }
    await page.getByRole("button", { name: "Save flow", exact: true }).click();
    assert.equal(
      await page.evaluate(
        () =>
          JSON.parse(localStorage.getItem("savedFlow")).data.cart.productCount,
      ),
      3,
    );
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        "Cart map fits at " + width,
      );
      await page.screenshot({
        path: path.join(output, "cart-mobile-" + width + ".png"),
        fullPage: true,
      });
    }
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      await page
        .getByRole("button", { name: "Preview customer products", exact: true })
        .click();
      await page
        .getByLabel("Customer email", { exact: true })
        .fill("test@example.com");
      await page
        .getByRole("button", { name: "Preview products", exact: true })
        .click();
      await page.getByText("Customer coral", { exact: true }).waitFor();
      assert.ok(
        await page
          .getByRole("dialog")
          .evaluate((el) => el.scrollWidth <= el.clientWidth),
      );
      await page.screenshot({
        path: path.join(output, "cart-products-" + width + ".png"),
      });
      await page.keyboard.press("Escape");
      await page
        .getByRole("button", {
          name: "Bring over Klaviyo history",
          exact: true,
        })
        .click();
      await page
        .getByText("One connection step is needed", { exact: true })
        .waitFor();
      await page.keyboard.press("Escape");
      await page
        .getByRole("button", { name: "View flow results", exact: true })
        .click();
      await page
        .getByText("Attributed sales: USD 25.00", { exact: true })
        .waitFor();
      assert.ok(
        await page
          .getByRole("dialog")
          .evaluate((el) => el.scrollWidth <= el.clientWidth),
      );
      await page.screenshot({
        path: path.join(output, "cart-results-" + width + ".png"),
      });
      await page.keyboard.press("Escape");
    }

    await page.setViewportSize({ width: 1440, height: 1000 });
    await page
      .getByLabel("Restrict this flow to one test email", { exact: true })
      .check();
    await page
      .getByLabel("Test account email", { exact: true })
      .fill("test@example.com");
    assert.equal(
      await page.getByLabel("Enable this flow", { exact: true }).isChecked(),
      false,
    );
    await page
      .getByLabel(
        "I reviewed this flow's timing, consent rules, and purchase checks.",
        { exact: true },
      )
      .check();
    await page.getByLabel("Enable this flow", { exact: true }).check();
    await page.getByRole("button", { name: "Save flow", exact: true }).click();
    await page.getByText(/Saved audience: Test email only/).waitFor();
    await page
      .locator(".mk-cart-map")
      .getByRole("button", { name: /Product recommendations/ })
      .click();
    await page.getByLabel("Products per email").fill("2");
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Save flow", exact: true }).click();
    assert.equal(
      await page.evaluate(
        () => JSON.parse(localStorage.getItem("savedFlow")).data.cart.testEmail,
      ),
      "test@example.com",
    );
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      );
    }
    await page
      .getByLabel("Restrict this flow to one test email", { exact: true })
      .uncheck();
    assert.equal(
      await page.getByLabel("Enable this flow", { exact: true }).isChecked(),
      false,
    );
    assert.equal(
      await page
        .getByLabel(
          "I reviewed this flow's timing, consent rules, and purchase checks.",
          { exact: true },
        )
        .isChecked(),
      false,
    );

    assert.deepEqual(errors, []);
    console.log(
      "PASS: flow search/status/sort, real message counts, branch-aware step counts, focused navigation, keyboard focus restoration, preserved email drafts and saves, mobile 320/390",
    );
    console.log("Screenshots: " + output);
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
