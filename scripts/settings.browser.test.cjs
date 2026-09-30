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
  const output = await fs.mkdtemp(path.join(os.tmpdir(), "reef-settings-"));
  const bundle = await build({
    entryPoints: ["scripts/settings.browser.fixture.tsx"],
    bundle: true,
    write: false,
    platform: "browser",
    jsx: "automatic",
    tsconfig: "scripts/tsconfig.marketing-tests.json",
    define: { "process.env.NODE_ENV": '"development"', "process.env": "{}" },
  });
  const css =
    (await fs.readFile("app/our-klaviyo/marketing.css", "utf8")) +
    (await fs.readFile("app/our-klaviyo/settings.css", "utf8")) +
    ":root{--surface:#fff;--surface-muted:#f5f8f7;--border:#dce5e3;--text-main:#203e38;--text-muted:#627872}*{box-sizing:border-box}body{font-family:Arial,sans-serif}";
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

    let settings = {
      organizationName: "Corals Anonymous",
      postalAddress: "123 Ocean Avenue, San Diego, CA 92101",
      operations: {
        sendingEnabled: false,
        migrationConfirmed: false,
        ingestEnabled: true,
        formEnabled: false,
      },
    };
    const saves = [];
    let failSave = false;
    let syncRuns = 0;
    let conflictPending = false;
    let taggedConflict = false;
    let expiredConflict = false;
    let skippedCount = 0;
    let conflictRetries = 0;
    let deliveryRuns = 0;
    let imports = 0;
    let engagementRunning = false;
    await page.route("**/api/marketing**", async (route) => {
      const req = route.request();
      if (req.method() === "POST") {
        const body = req.postDataJSON();
        if (body.action === "save-settings") {
          if (failSave)
            return route.fulfill({
              status: 400,
              json: { error: "Save failed. Please retry." },
            });
          saves.push(body.settings);
          settings = {
            ...settings,
            ...body.settings,
            operations: { ...settings.operations, ...body.settings.operations },
          };
          return route.fulfill({ json: { settings } });
        }
        if (body.action === "run-delivery") {
          deliveryRuns++;
          return route.fulfill({ json: { sent: 1, inspected: 1 } });
        }
        if (body.action === "process-inbox") {
          syncRuns++;
          return route.fulfill({ json: { processed: syncRuns === 1 ? 1 : 0, unresolved: 0 } });
        }
        if (body.action === "retry-conflicted-order-updates") {
          conflictRetries++;
          if (expiredConflict) skippedCount++;
          conflictPending = false;
          return route.fulfill({ json: { retried: 1, processed: 1, unresolved: 0 } });
        }
        if (body.action === "inspect-order-identity") {
          return route.fulfill({ json: {
            order: { label: "#1234", orderEmail: "new@example.com", eventCustomerEmail: "new@example.com", customerId: "42", deliveryDateTag: true },
            shopify: { email: "new@example.com", emailMarketingState: "SUBSCRIBED" }, shopifyError: null,
            profiles: [
              { id: "old", name: "Old", email: "old@example.com", shopifyId: "42", matchesOrderEmail: false, matchesShopifyId: true,
                consents: [{ channel: "EMAIL", status: "SUBSCRIBED", suppressed: false, source: "shopify", occurredAt: "2026-09-24T14:01:00Z" }], _count: { events: 3, messages: 1 } },
              { id: "new", name: "New", email: "new@example.com", shopifyId: null, matchesOrderEmail: true, matchesShopifyId: false,
                consents: [{ channel: "EMAIL", status: "UNSUBSCRIBED", suppressed: true, source: "shopify", occurredAt: "2026-09-24T14:01:00Z" }], _count: { events: 1, messages: 0 } },
            ],
          } });
        }
        if (body.action === "start-klaviyo-opens") {
          engagementRunning = true;
          return route.fulfill({
            json: {
              configured: true,
              phase: "events",
              events: 107600,
              profiles: 94749,
              running: true,
            },
          });
        }
        if (body.action === "pause-klaviyo-opens") {
          engagementRunning = false;
          return route.fulfill({
            json: {
              configured: true,
              phase: "events",
              events: 107600,
              profiles: 94749,
              running: false,
            },
          });
        }
        if (body.action === "import") {
          if (!body.dryRun) imports++;
          return route.fulfill({
            json: {
              results: body.rows.map((_, i) => ({
                row: i + 1,
                status: body.dryRun ? "VALID" : "IMPORTED",
              })),
            },
          });
        }
        throw Error("Unexpected settings action: " + body.action);
      }
      if (req.url().includes("view=engagement-backfill"))
        return route.fulfill({
          json: {
            configured: true,
            phase: "not-started",
            events: 0,
            profiles: 0,
            running: false,
          },
        });
      if (req.url().includes("view=audience-backfill"))
        return route.fulfill({
          json: {
            configured: true,
            phase: "complete",
            profiles: 100,
            memberships: 50,
            suppressed: 10,
            ignored: 0,
            errors: 0,
            lists: [],
            issues: [],
          },
        });
      return route.fulfill({
        json: {
          settings,
          setup: {
            ...settings.operations,
            emailReady: true,
            smsReady: false,
            couponReady: true,
            senderEmail: "Corals Anonymous <hello@example.com>",
            deployment: {
              sendingEnabled: true,
              migrationConfirmed: true,
              ingestEnabled: true,
              formEnabled: true,
            },
          },
          health: {
            unresolved: conflictPending ? 1 : 0,
            skippedOrderUpdates: skippedCount,
            skippedOrderReviews: skippedCount ? [{ id: "skipped-1", label: "#1234", reason: "Delivery reminder window passed", createdAt: "2026-09-29T20:15:00Z" }] : [],
            inbox: conflictPending ? [{
              id: "conflict-1", topic: "orders/updated", status: "PENDING", attempts: 7,
              error: "Identity conflict: email and Shopify customer belong to different profiles. No consent was transferred.",
              createdAt: "2026-09-24T14:01:00Z", dueAt: "2026-09-29T20:15:00Z",
              order: { label: "#1234", deliveryDateTag: taggedConflict, skipReason: expiredConflict ? "Delivery reminder window passed" : null },
            }] : [],
            lastProcessed: { processedAt: "2026-09-09T12:00:00Z", topic: "customers/update" },
            oldestPending: { dueAt: "2026-09-09T12:00:00Z", error: null },
          },
          resources: [
            {
              kind: "SYSTEM",
              key: "worker",
              data: { at: "2026-09-09T12:00:00Z", sent: 0 },
            },
          ],
          messageCounts: [{ status: "PENDING", _count: 3 }],
        },
      });
    });
    await page.goto("http://127.0.0.1:" + server.address().port);
    await page
      .getByRole("heading", { name: "Your email workspace", exact: true })
      .waitFor();
    await page.screenshot({ path: path.join(output, "overview-desktop.png") });
    assert.equal(saves.length, 0);
    await page
      .getByRole("button", { name: "Process Shopify events now", exact: true })
      .click();
    await page
      .getByText("Processed 1 event. 0 unresolved remain.", {
        exact: true,
      })
      .waitFor();
    assert.equal(syncRuns, 1);
    await page
      .getByRole("button", { name: "Process Shopify events now", exact: true })
      .click();
    await page.getByText(/No events waiting\. Shopify changes may already have processed automatically/).waitFor();
    assert.equal(syncRuns, 2);
    conflictPending = true;
    await page.getByRole("button", { name: "Refresh status", exact: true }).click();
    await page.getByText("#1234 · No delivery-date tag").waitFor();
    await page.getByText("#1234 · No delivery-date tag").scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(output, "order-identity-conflict.png") });
    await page.getByRole("button", { name: "Recheck order updates", exact: true }).click();
    await page.getByText("Rechecked 1 order update; 1 processed. 0 unresolved remain.").waitFor();
    assert.equal(conflictRetries, 1);
    conflictPending = true;
    taggedConflict = true;
    await page.getByRole("button", { name: "Refresh status", exact: true }).click();
    await page.getByText("#1234 · Delivery-date tag found").waitFor();
    assert.equal(await page.getByRole("button", { name: "Recheck order updates", exact: true }).count(), 0);
    await page.getByRole("button", { name: "Compare profiles", exact: true }).click();
    await page.getByText("Current Shopify email: new@example.com · Email marketing: SUBSCRIBED").waitFor();
    await page.getByText(/new@example.com.*Matches event email.*Different Shopify ID/).waitFor();
    await page.getByLabel("Order identity comparison").scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(output, "tagged-order-identity-review.png") });
    expiredConflict = true;
    await page.getByRole("button", { name: "Refresh status", exact: true }).click();
    await page.getByText("Delivery reminder expired. Use Recheck order updates to clear this event.").waitFor();
    await page.getByRole("button", { name: "Recheck order updates", exact: true }).click();
    await page.getByText("Rechecked 1 order update; 1 processed. 0 unresolved remain.").waitFor();
    await page.getByText("Skipped order updates — profile conflicts retained", { exact: true }).click();
    await page.getByText(/#1234 · Delivery reminder window passed/).waitFor();
    await page.getByText(/#1234 · Delivery reminder window passed/).scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(output, "expired-order-audit.png") });
    assert.equal(conflictRetries, 2);
    assert.equal(saves.length, 0);
    await page.getByRole("button", { name: /Sending & signup/ }).click();
    await page
      .getByRole("switch", { name: "Allow customer sending", exact: true })
      .check();
    await page.getByRole("button", { name: /Business details/ }).click();
    await page
      .getByLabel("Business mailing address", { exact: true })
      .fill("500 New Address, San Diego, CA");
    await page
      .getByRole("button", { name: "Save business details", exact: true })
      .click();
    await page.getByText("Changes saved.", { exact: true }).waitFor();
    assert.deepEqual(saves[0], {
      organizationName: "Corals Anonymous",
      postalAddress: "500 New Address, San Diego, CA",
    });
    assert.equal(settings.operations.sendingEnabled, false);
    await page.getByRole("button", { name: /Sending & signup/ }).click();
    assert.ok(
      await page
        .getByRole("switch", { name: "Allow customer sending", exact: true })
        .isChecked(),
    );
    await page
      .getByRole("button", { name: "Save sending preferences", exact: true })
      .click();
    await page
      .getByRole("heading", { name: "Enable customer sending?", exact: true })
      .waitFor();
    assert.equal(saves.length, 1, "Review alone never enables sending");
    await page.screenshot({ path: path.join(output, "sending-review.png") });
    await page
      .getByRole("button", { name: "Keep reviewing", exact: true })
      .click();
    await page
      .getByRole("switch", { name: "Allow customer sending", exact: true })
      .uncheck();
    await page.getByRole("button", { name: /Business details/ }).click();
    await page
      .getByLabel("Business name", { exact: true })
      .fill("My preserved business name");
    failSave = true;
    await page
      .getByRole("button", { name: "Save business details", exact: true })
      .click();
    await page
      .getByText("Save failed. Please retry.", { exact: true })
      .waitFor();
    assert.equal(
      await page.getByLabel("Business name", { exact: true }).inputValue(),
      "My preserved business name",
    );
    failSave = false;
    await page
      .getByRole("button", { name: "Save business details", exact: true })
      .click();
    await page.getByText("Changes saved.", { exact: true }).waitFor();
    await page.screenshot({ path: path.join(output, "business-details.png") });
    await page.getByRole("button", { name: /Advanced/ }).click();
    assert.equal(await page.locator("pre").count(), 0);
    await page
      .getByRole("button", { name: "Import open history", exact: true })
      .click();
    await page
      .getByText(/Railway will continue it in the background/)
      .waitFor();
    assert.equal(engagementRunning, true);
    await page
      .getByRole("button", { name: "Pause background import", exact: true })
      .click();
    await page
      .getByText(/Completed updates and the saved checkpoint were preserved/)
      .waitFor();
    assert.equal(engagementRunning, false);
    await page.getByText("Import prepared contacts", { exact: true }).click();
    await page
      .getByLabel("Prepared contact data", { exact: true })
      .fill('[{"email":"test@example.com"}]');
    assert.ok(
      await page
        .getByRole("button", {
          name: "2. Import validated contacts",
          exact: true,
        })
        .isDisabled(),
    );
    await page
      .getByRole("button", { name: "1. Validate contacts", exact: true })
      .click();
    await page
      .getByText("Validation passed. No contacts have been imported yet.", {
        exact: true,
      })
      .waitFor();
    assert.ok(
      await page
        .getByRole("button", {
          name: "2. Import validated contacts",
          exact: true,
        })
        .isEnabled(),
    );
    await page
      .getByLabel("Prepared contact data", { exact: true })
      .fill('[{"email":"changed@example.com"}]');
    assert.ok(
      await page
        .getByRole("button", {
          name: "2. Import validated contacts",
          exact: true,
        })
        .isDisabled(),
    );
    assert.equal(imports, 0);
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      for (const label of [
        /Overview/,
        /Sending & signup/,
        /Business details/,
        /Advanced/,
      ]) {
        await page.getByRole("button", { name: label }).first().click();
        assert.ok(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
          "No overflow at " + width + " " + label,
        );
      }
      await page.getByRole("button", { name: /Overview/ }).click();
      await page.screenshot({
        path: path.join(output, "overview-mobile-" + width + ".png"),
        fullPage: true,
      });
    }
    assert.equal(settings.operations.sendingEnabled, false);
    assert.ok(
      await page
        .getByRole("button", { name: "Run delivery now", exact: true })
        .isDisabled(),
    );
    assert.equal(deliveryRuns, 0);
    settings.operations.migrationConfirmed = true;
    await page.getByRole("button", { name: /Sending & signup/ }).click();
    await page
      .getByRole("switch", { name: "Allow customer sending", exact: true })
      .check();
    await page
      .getByRole("button", { name: "Save sending preferences", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Confirm sending preference", exact: true })
      .click();
    await page.getByText("Changes saved.", { exact: true }).waitFor();
    await page.getByRole("button", { name: /Overview/ }).click();
    await page
      .getByRole("button", { name: "Run delivery now", exact: true })
      .click();
    await page
      .getByText(/Delivery run complete. 1 messages sent; 1 checked./)
      .waitFor();
    assert.equal(deliveryRuns, 1);
    assert.deepEqual(errors, []);
    console.log(
      "PASS: manual sync without delivery, section-scoped saves, drafts survive navigation/refresh/save failure, sending review, import validation invalidation, responsive 320/390 layouts",
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
