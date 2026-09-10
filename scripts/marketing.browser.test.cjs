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
  const output = await fs.mkdtemp(path.join(os.tmpdir(), "reef-email-editor-"));
  const bundle = await build({
    entryPoints: ["scripts/marketing.browser.fixture.tsx"],
    bundle: true,
    write: false,
    platform: "browser",
    jsx: "automatic",
    tsconfig: "scripts/tsconfig.marketing-tests.json",
    define: { "process.env.NODE_ENV": '"development"' },
  });
  const css = await fs.readFile("app/our-klaviyo/marketing.css");
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
    page.on("pageerror", (error) => errors.push(error.message));
    // Only local fixture requests are allowed. Tests never contact production.
    await page.route("**/*", (route) =>
      route.request().url().startsWith("http://127.0.0.1:") ||
      route.request().url().startsWith("data:")
        ? route.continue()
        : route.abort(),
    );
    await page.goto("http://127.0.0.1:" + server.address().port);
    await page.getByText("Welcome to wholesale", { exact: true }).click();
    await page.getByRole("dialog").waitFor();
    await page.screenshot({ path: path.join(output, "desktop.png") });
    const dimensions = async () =>
      page.locator("iframe").evaluate((el) => ({
        width: el.contentDocument.documentElement.clientWidth,
        scroll: el.contentDocument.documentElement.scrollWidth,
        height: el.clientHeight,
        bodyHeight: el.contentDocument.body.scrollHeight,
        images: Array.from(el.contentDocument.images).map(
          (image) => image.getBoundingClientRect().right,
        ),
      }));
    await page.getByRole("button", { name: "Mobile", exact: true }).click();
    for (const width of [320, 375, 414]) {
      await page.getByLabel("Mobile preview width").selectOption(String(width));
      await page.waitForFunction((width) => {
        const frame = document.querySelector("iframe");
        return (
          frame?.contentDocument?.documentElement.clientWidth === width &&
          frame.clientHeight >= frame.contentDocument.body.scrollHeight
        );
      }, width);
      const size = await dimensions();
      assert.equal(size.width, width);
      assert.equal(size.scroll, width);
      assert.ok(
        size.images.every((right) => right <= width),
        "Artwork stays inside phone viewport",
      );
    }
    console.log(
      "PASS: mobile 320/375/414 px, oversized artwork, complete document height",
    );
    await page.getByLabel("Mobile preview width").selectOption("375");
    await page.screenshot({ path: path.join(output, "mobile.png") });
    await page.getByText("Edit HTML", { exact: true }).click();
    await page
      .getByLabel("Message HTML", { exact: true })
      .fill(
        '<h1 style="width:800px">A long wholesale heading</h1><p style="width:700px">' +
          "long-unbroken-content".repeat(15) +
          "</p>",
      );
    await page.getByLabel("Mobile preview width").selectOption("320");
    await page.waitForFunction(() =>
      document
        .querySelector("iframe")
        ?.contentDocument?.body.textContent.includes("long-unbroken-content"),
    );
    assert.equal((await dimensions()).scroll, 320);
    await page
      .getByLabel("Message HTML", { exact: true })
      .fill("<p>Original copy</p>");
    await page.getByText("Visual editor", { exact: true }).click();
    await page
      .getByRole("textbox", { name: "Message", exact: true })
      .fill("My wholesale email");
    await page
      .getByRole("textbox", { name: "Message", exact: true })
      .press("ControlOrMeta+A");
    await page.getByRole("button", { name: "Bold", exact: true }).click();
    await page.getByText("Edit HTML", { exact: true }).click();
    assert.match(
      await page.getByLabel("Message HTML", { exact: true }).inputValue(),
      /<(b|strong)>My wholesale email/,
    );
    await page.getByText("Visual editor", { exact: true }).click();
    await page
      .getByRole("textbox", { name: "Message", exact: true })
      .press("ControlOrMeta+A");
    await page.getByRole("button", { name: "Link", exact: true }).click();
    await page
      .getByLabel("Link URL", { exact: true })
      .fill("javascript:alert(1)");
    await page.getByRole("button", { name: "Apply link", exact: true }).click();
    await page.getByText("Enter a full HTTPS link.", { exact: true }).waitFor();
    await page
      .getByLabel("Link URL", { exact: true })
      .fill("https://example.com/wholesale");
    await page.getByRole("button", { name: "Apply link", exact: true }).click();
    await page.getByText("Edit HTML", { exact: true }).click();
    assert.match(
      await page.getByLabel("Message HTML", { exact: true }).inputValue(),
      /href="https:\/\/example.com\/wholesale"/,
    );
    console.log(
      "PASS: custom HTML reflows; visual formatting and safe links update HTML",
    );
    await page
      .getByLabel("Subject", { exact: true })
      .fill("Recovered wholesale draft");
    await page.getByRole("button", { name: "Artwork", exact: true }).click();
    assert.equal(await page.locator(".mk-art-thumbnail img").count(), 2);
    await page.getByLabel("Logo size", { exact: true }).focus();
    await page.getByLabel("Logo size", { exact: true }).press("Home");
    for (let i = 0; i < 20; i++)
      await page.getByLabel("Logo size", { exact: true }).press("ArrowRight");
    await page.waitForFunction(async () => {
      const db = await new Promise((resolve) => {
        const request = indexedDB.open("reef-marketing-drafts", 1);
        request.onsuccess = () => resolve(request.result);
      });
      const draft = await new Promise((resolve) => {
        const request = db
          .transaction("flows")
          .objectStore("flows")
          .get("browser-b2b");
        request.onsuccess = () => resolve(request.result);
      });
      db.close();
      return draft?.flow.steps[0].content.logoScale === 1.25;
    });
    await page.reload();
    await page.getByText("Recovered wholesale draft", { exact: true }).click();
    await page.getByRole("button", { name: "Artwork", exact: true }).click();
    assert.equal(
      await page.getByLabel("Logo size", { exact: true }).inputValue(),
      "1.25",
    );
    assert.equal(await page.locator(".mk-art-thumbnail img").count(), 2);
    await page.evaluate(() => localStorage.setItem("fixture.failSave", "1"));
    await page.getByRole("button", { name: "Save email", exact: true }).click();
    await page.getByText(/Save failed. Your draft is still here/).waitFor();
    await page.evaluate(() => localStorage.removeItem("fixture.failSave"));
    await page.getByRole("button", { name: "Save email", exact: true }).click();
    await page.getByText("Email saved", { exact: true }).waitFor();
    assert.equal(
      await page.evaluate(
        () =>
          JSON.parse(localStorage.getItem("fixture.saved")).data.steps[0]
            .content.logoScale,
      ),
      1.25,
    );
    console.log(
      "PASS: draft reload, artwork recovery, save failure feedback, successful save",
    );
    await page.getByRole("button", { name: "Send test", exact: true }).click();
    await page
      .getByLabel("Internal test recipient", { exact: true })
      .fill("tester@example.com");
    await page
      .getByRole("button", { name: "Send test email", exact: true })
      .click();
    await page
      .getByText("Test email sent. Check your inbox.", { exact: true })
      .waitFor();
    await page.getByRole("button", { name: "Artwork", exact: true }).click();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: path.join(output, "narrow-editor.png") });
    assert.ok(
      await page
        .getByRole("dialog")
        .evaluate((el) => el.scrollWidth <= el.clientWidth),
    );
    await page
      .getByRole("button", { name: "Save email", exact: true })
      .scrollIntoViewIfNeeded();
    assert.ok(
      await page
        .getByRole("button", { name: "Save email", exact: true })
        .isVisible(),
    );
    await page.keyboard.press("Escape");
    assert.equal(await page.getByRole("dialog").count(), 0);
    assert.deepEqual(errors, []);
    console.log("PASS: narrow editor, Escape dismissal, no browser errors");
    console.log("Screenshots: " + output);
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
