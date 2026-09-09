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
    let imports = 0;
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
        if (body.action === "process-inbox") {
          syncRuns++;
          return route.fulfill({ json: { processed: 1, unresolved: 0 } });
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
            unresolved: 0,
            inbox: [],
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
      .getByText("Processed 1 events. 0 unresolved events remain.", {
        exact: true,
      })
      .waitFor();
    assert.equal(syncRuns, 1);
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
