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
          audience: {},
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
    await page.route("**/api/marketing", async (route) => {
      const req = route.request();
      if (req.method() === "POST") {
        const body = req.postDataJSON();
        writes.push(body);
        if (body.action === "save-campaign")
          data.campaigns[0] = { ...data.campaigns[0], ...body };
        if (body.action === "save-resource")
          data.resources[1] = { ...data.resources[1], ...body };
        await route.fulfill({ json: { id: body.id || "draft", ok: true } });
      } else await route.fulfill({ json: data });
    });
    await page.goto("http://127.0.0.1:" + server.address().port);
    await page.getByRole("button", { name: "Edit", exact: true }).click();
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
    assert.deepEqual(errors, []);
    console.log(
      "PASS: campaigns and templates share editor, address preview and save; desktop/mobile dialogs. Screenshots: " +
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
