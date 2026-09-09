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
  const output = await fs.mkdtemp(path.join(os.tmpdir(), "reef-audiences-"));
  const bundle = await build({
    entryPoints: ["scripts/audiences.browser.fixture.tsx"],
    bundle: true,
    write: false,
    platform: "browser",
    jsx: "automatic",
    tsconfig: "scripts/tsconfig.marketing-tests.json",
    define: { "process.env.NODE_ENV": '"development"', "process.env": "{}" },
  });
  const css =
    (await fs.readFile("app/our-klaviyo/marketing.css", "utf8")) +
    (await fs.readFile("app/our-klaviyo/audiences.css", "utf8")) +
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

    const profiles = Array.from({ length: 32 }, (_, i) => ({
      id: String(i),
      name: i === 0 ? "Jaden Banawa" : "Customer " + String(i).padStart(2, "0"),
      email: i === 0 ? "jaden@example.com" : "customer" + i + "@example.com",
      phone: null,
      tags: i % 2 === 0 ? ["b2b", "shop", "repeat customer"] : [],
      lists: [],
      createdAt: "2026-09-09T12:00:00Z",
      lastOpenedAt: null,
      lastOrderAt: null,
      consents: [
        {
          channel: "EMAIL",
          status: i === 1 ? "UNSUBSCRIBED" : "SUBSCRIBED",
          suppressed: i === 1,
          source: "shopify",
          occurredAt: "2026-09-08T12:00:00Z",
        },
      ],
    }));
    let groups = [
      { id: "g1", key: "b2b", name: "B2B customers", data: { tag: "b2b" } },
      {
        id: "g2",
        key: "engaged",
        name: "Recently engaged subscribers",
        data: { openedDays: 365 },
      },
    ];
    let failSave = false;
    let blocks = 0;
    await page.route("**/api/marketing**", async (route) => {
      const req = route.request();
      const url = new URL(req.url());
      if (req.method() === "POST") {
        const body = req.postDataJSON();
        if (body.action === "save-resource") {
          if (failSave)
            return route.fulfill({
              status: 400,
              json: { error: "Save failed. Please try again." },
            });
          groups = [
            ...groups.filter((g) => g.key !== body.key),
            { id: body.key, key: body.key, name: body.name, data: body.data },
          ];
          return route.fulfill({ json: groups[groups.length - 1] });
        }
        if (body.action === "suppress") {
          blocks++;
          profiles.find((p) => p.id === body.id).consents[0].suppressed = true;
          return route.fulfill({ json: { ok: true } });
        }
        throw Error("Unexpected write " + body.action);
      }
      if (url.searchParams.get("view") === "contact")
        return route.fulfill({
          json: {
            profile: {
              ...profiles.find((p) => p.id === url.searchParams.get("id")),
              messages: [
                {
                  id: "m1",
                  subject: "Welcome to wholesale",
                  status: "PENDING",
                  channel: "EMAIL",
                  flowKey: "b2b-welcome",
                  createdAt: "2026-09-09T12:00:00Z",
                  dueAt: "2026-09-09T12:00:00Z",
                  sentAt: null,
                  error: null,
                },
              ],
              events: [
                {
                  id: "e1",
                  type: "customer.tags_added",
                  occurredAt: "2026-09-09T12:00:00Z",
                  payload: { tags: ["b2b"] },
                },
              ],
            },
          },
        });
      let rows = profiles.filter((p) =>
        (p.name + p.email)
          .toLowerCase()
          .includes((url.searchParams.get("q") || "").toLowerCase()),
      );
      if (
        url.searchParams.get("b2b") === "true" ||
        url.searchParams.get("group") === "b2b"
      )
        rows = rows.filter((p) => p.tags.includes("b2b"));
      if (url.searchParams.get("status") === "unsubscribed")
        rows = rows.filter((p) => p.consents[0].status === "UNSUBSCRIBED");
      const total = rows.length;
      const cursor = url.searchParams.get("cursor");
      if (cursor) rows = rows.slice(rows.findIndex((p) => p.id === cursor) + 1);
      await route.fulfill({
        json: {
          profiles: rows.slice(0, 25),
          total,
          nextCursor: rows.length > 25 ? rows[24].id : null,
          groups,
        },
      });
    });
    await page.goto("http://127.0.0.1:" + server.address().port);
    await page
      .getByText("32 matching contacts")
      .waitFor()
      .catch(async (e) => {
        console.log(await page.locator("body").innerText());
        throw e;
      });
    await page.screenshot({ path: path.join(output, "contacts-desktop.png") });
    assert.equal(await page.locator("tbody tr").count(), 25);
    await page.getByRole("button", { name: "Next →", exact: true }).click();
    await page.getByText("Showing 26–32 of 32").waitFor();
    assert.equal(await page.locator("tbody tr").count(), 7);
    await page.getByRole("button", { name: "← Previous", exact: true }).click();
    await page.getByText("Showing 1–25 of 32").waitFor();
    await page
      .getByRole("button", { name: "View Jaden Banawa", exact: true })
      .click();
    await page
      .getByRole("dialog")
      .getByText("Marketing preferences", { exact: true })
      .waitFor();
    await page.screenshot({
      path: path.join(output, "contact-detail-desktop.png"),
    });
    assert.equal(await page.locator("dialog pre").count(), 0);
    await page.getByRole("button", { name: "Messages", exact: true }).click();
    await page.getByText("Welcome to wholesale", { exact: true }).waitFor();
    await page.getByText("Scheduled", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Activity", exact: true }).click();
    await page.getByText("Tags added: b2b", { exact: true }).waitFor();
    await page.keyboard.press("Escape");
    assert.equal(await page.getByRole("dialog").count(), 0);
    assert.equal(
      await page.evaluate(() =>
        document.activeElement.getAttribute("aria-label"),
      ),
      "View Jaden Banawa",
    );
    await page.getByLabel("Search contacts", { exact: true }).fill("Jaden");
    await page.getByText("1 matching contacts").waitFor();
    await page.getByLabel("Search contacts", { exact: true }).fill("Nobody");
    await page
      .getByText("No contacts match these filters", { exact: true })
      .waitFor();
    await page
      .getByRole("button", { name: "Clear filters", exact: true })
      .first()
      .click();
    await page.getByText("32 matching contacts").waitFor();
    await page
      .getByRole("button", { name: "Saved audiences", exact: true })
      .click();
    await page.screenshot({ path: path.join(output, "saved-audiences.png") });
    await page
      .getByRole("button", { name: "Edit B2B customers", exact: true })
      .click();
    await page
      .getByLabel("Audience name", { exact: true })
      .fill("Wholesale partners");
    await page.keyboard.press("Escape");
    await page
      .getByText("Discard your unsaved audience changes?", { exact: true })
      .waitFor();
    await page
      .getByRole("button", { name: "Continue editing", exact: true })
      .click();
    failSave = true;
    await page
      .getByRole("button", { name: "Save audience", exact: true })
      .click();
    await page.getByText("Save failed. Please try again.").waitFor();
    assert.equal(
      await page.getByLabel("Audience name").inputValue(),
      "Wholesale partners",
    );
    failSave = false;
    await page
      .getByRole("button", { name: "Save audience", exact: true })
      .click();
    await page
      .getByRole("heading", { name: "Wholesale partners", exact: true })
      .waitFor();
    await page
      .locator(".aw-group-card")
      .filter({
        has: page.getByRole("heading", {
          name: "Wholesale partners",
          exact: true,
        }),
      })
      .getByRole("button", { name: "View contacts", exact: true })
      .click();
    await page.getByText("16 matching contacts").waitFor();
    await page
      .getByRole("button", { name: "Clear filters", exact: true })
      .click();
    await page.getByText("32 matching contacts").waitFor();
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      await page.screenshot({
        path: path.join(output, "contacts-mobile-" + width + ".png"),
      });
      assert.ok(
        await page
          .locator(".aw-list")
          .evaluate((el) => el.scrollWidth <= el.clientWidth),
        "No horizontal contact-list overflow at " + width,
      );
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        "No horizontal page overflow at " + width,
      );
      await page
        .getByRole("button", { name: "View Jaden Banawa", exact: true })
        .click();
      await page
        .getByRole("dialog")
        .getByText("Marketing preferences", { exact: true })
        .waitFor();
      assert.ok(
        await page
          .locator("dialog")
          .evaluate((el) => el.scrollWidth <= el.clientWidth),
        "No drawer overflow at " + width,
      );
      assert.ok(
        await page
          .locator("dialog .aw-tabs")
          .evaluate((el) =>
            Array.from(el.querySelectorAll("button")).every(
              (b) =>
                b.getBoundingClientRect().right <=
                el.getBoundingClientRect().right,
            ),
          ),
        "All contact tabs fit at " + width,
      );
      await page.screenshot({
        path: path.join(output, "contact-mobile-" + width + ".png"),
      });
      await page.keyboard.press("Escape");
    }
    assert.equal(blocks, 0, "Browsing and group edits never change consent");
    assert.deepEqual(errors, []);
    console.log(
      "PASS: pagination, search, empty states, profile drawer, focus restoration, messages/activity, saved group editing, failed save recovery, membership view, mobile 320/390, no consent writes",
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
