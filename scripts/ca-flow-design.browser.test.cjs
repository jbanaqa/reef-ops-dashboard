/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const http = require("node:http");
const { build } = require("esbuild");
const { chromium } = require("playwright");

(async () => {
  const output = process.env.MARKETING_REEF_DESIGN_OUTPUT || "C:/Users/GuestUser/.codex/artifacts/ca-flow-design-2026-11-15";
  await fs.mkdir(output, { recursive: true });
  const bundle = await build({ entryPoints: ["scripts/ca-flow-design.browser.fixture.tsx"], bundle: true, write: false, outdir: output,
    platform: "browser", jsx: "automatic", tsconfig: "scripts/tsconfig.marketing-tests.json", define: { "process.env.NODE_ENV": '"development"', "process.env": "{}" } });
  const appCss = (await Promise.all(["marketing.css", "flows.css", "stock.css", "flow-results.css"].map(file => fs.readFile("app/our-klaviyo/" + file, "utf8")))).join("\n");
  const server = http.createServer((req, res) => {
    if (req.url === "/app.js") { res.setHeader("Content-Type", "text/javascript"); res.end(bundle.outputFiles.find(file => file.path.endsWith(".js")).contents); }
    else if (req.url === "/style.css") { res.setHeader("Content-Type", "text/css"); res.end(appCss); }
    else res.end('<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><style>:root{--surface:#fff;--surface-muted:#f5f8f7;--border:#dce5e3;--text-main:#203e38;--text-muted:#627872}*{box-sizing:border-box}html,body{margin:0;font-family:Arial,sans-serif}iframe{display:block;border:0}dialog{margin:0}</style></head><body><div id="root"></div><script src="/app.js"></script></body></html>');
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true, executablePath: process.env.MARKETING_TEST_BROWSER || "C:/Program Files/Google/Chrome/Application/chrome.exe" });
    const page = await browser.newPage({ viewport: { width: 600, height: 1100 } });
    const errors = [], apiRequests = [], unexpected = [], screenshots = [], checks = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/*", async route => {
      const url = new URL(route.request().url());
      if (url.pathname.startsWith("/api/marketing")) { apiRequests.push(route.request().url()); return route.abort(); }
      const asset = url.pathname.match(/\/(ca-reef-(?:logo|gift|header-waves|footer-waves)-v1\.png)$/)?.[1];
      if (asset) return route.fulfill({ contentType: "image/png", body: await fs.readFile(path.join("public", asset)) });
      if (url.hostname === "fixture.example") {
        const shape = Number(url.searchParams.get("shape") || 0), width = [400, 300, 420][shape], height = [300, 420, 260][shape];
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="${["#c7e4e7", "#b6d6c7", "#d7c8e4"][shape]}"/><circle cx="50%" cy="50%" r="25%" fill="#317e83"/><path d="M${width / 2},${height * 0.8} v-${height * 0.55} M${width / 2},${height / 2} l-${width / 4},-${height / 4} M${width / 2},${height / 2} l${width / 4},-${height / 5}" stroke="#e98f74" stroke-width="18" fill="none"/></svg>`;
        return route.fulfill({ contentType: "image/svg+xml", body: svg });
      }
      if (url.hostname === "127.0.0.1" || url.protocol === "data:") return route.continue();
      unexpected.push(route.request().url()); return route.abort();
    });
    const base = `http://127.0.0.1:${server.address().port}`;
    const open = query => page.goto(base + "/?" + new URLSearchParams(query));
    const shot = async name => { const file = path.join(output, name + ".png"); await page.locator('iframe[title="Email preview"]').screenshot({ path: file }); screenshots.push(file); };
    await open({ case: "cart-first", mode: "render", width: "600" });
    const metadata = JSON.parse(await page.locator("#fixture-meta").textContent());
    assert.equal(metadata.cases.length, 9);
    for (const item of metadata.cases) for (const [width, stripped] of [[600, false], [390, false], [320, false], [320, true], [600, true]]) {
      await page.setViewportSize({ width, height: 1100 });
      await open({ case: item.id, mode: "render", width: String(width), ...(stripped ? { stripped: "1" } : {}) });
      const preview = page.locator('iframe[title="Email preview"]');
      await preview.waitFor();
      const frame = page.frameLocator('iframe[title="Email preview"]');
      await frame.getByText("Happy Reefing!", { exact: true }).waitFor();
      await page.waitForFunction(() => [...document.querySelector('iframe')?.contentDocument?.images || []].every(image => image.complete));
      const details = await preview.evaluate(element => {
        const doc = element.contentDocument;
        const images = [...doc.querySelectorAll('.cr-product img')];
        return { overflow: doc.documentElement.scrollWidth > element.clientWidth + 1,
          source: doc.documentElement.outerHTML, text: doc.body.textContent,
          products: doc.querySelectorAll('.cr-product').length,
          imageRatios: images.map(image => ({ width: image.getBoundingClientRect().width, height: image.getBoundingClientRect().height,
            naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight, fit: getComputedStyle(image).objectFit })),
          cardPositions: [...doc.querySelectorAll('.cr-product')].map(card => ({ x: card.getBoundingClientRect().x, y: card.getBoundingClientRect().y })),
          links: [...doc.querySelectorAll('a')].map(link => link.href) };
      });
      assert.equal(details.overflow, false, item.id + " fits " + width + (stripped ? " without head styles" : ""));
      assert.ok(details.source.includes("ca-reef-logo-v1.png"));
      assert.ok(details.links.includes("https://unsubscribe.coralsanonymous.com/api/marketing/unsubscribe?token=fixture-token"));
      if (item.variant === "gift") {
        assert.ok(details.text.includes(item.offerPercent + "% OFF"));
        assert.ok(details.text.includes(item.flowKey === "welcome" ? "WELCOME10-PREVIEW" : "AC300-PREVIEW"));
        assert.ok(details.source.includes("ca-reef-gift-v1.png"));
        if (item.flowKey === "welcome") assert.ok(!details.text.includes("15% OFF"));
      } else {
        assert.ok(!details.text.includes("AC300-PREVIEW") && !details.text.includes("WELCOME10-PREVIEW"));
        assert.ok(!details.source.includes("ca-reef-gift-v1.png"), "Non-offer flow emails do not invent a gift");
      }
      const hasProducts = item.flowKey === "abandoned-cart" || item.id === "welcome-social";
      assert.equal(details.products, hasProducts ? 6 : 0);
      if (hasProducts) {
        assert.ok(details.text.includes("Blueberry Gorgonian") && details.text.includes("$15.00") && details.text.includes("$29.99"));
        assert.ok(details.links.includes("https://coralsanonymous.com/products/fixture-1"));
        const [a, b] = details.cardPositions;
        if (width >= 600) assert.ok(Math.abs(a.y - b.y) <= 2, "Two desktop product columns survive stripped styles");
        else assert.ok(b.y > a.y + 100, "Phone product cards stack without media queries");
        for (const image of details.imageRatios) {
          assert.ok(image.naturalWidth && image.naturalHeight);
          assert.ok(Math.abs(image.width / image.height - image.naturalWidth / image.naturalHeight) < 0.02, "Products retain natural image proportions");
          assert.notEqual(image.fit, "cover");
        }
      }
      checks.push({ id: item.id, width, stripped, products: details.products });
      if (!stripped && (["cart-first", "cart-ten", "cart-fifteen"].includes(item.id) || width === 390)) await shot(item.id + "-" + width);
    }
    for (const count of [0, 1, 3, 6]) for (const width of [600, 320]) {
      await page.setViewportSize({ width, height: 1100 });
      await open({ case: "cart-ten", mode: "render", width: String(width), stripped: "1", products: String(count) });
      const preview = page.locator('iframe[title="Email preview"]');
      await page.frameLocator('iframe').getByText("Happy Reefing!", { exact: true }).waitFor();
      assert.equal(await page.frameLocator('iframe').locator('.cr-product').count(), count);
      assert.ok(await preview.evaluate(element => element.contentDocument.documentElement.scrollWidth <= element.clientWidth + 1));
    }

    await page.setViewportSize({ width: 1440, height: 1100 });
    await open({ case: "cart-ten", mode: "editor" });
    await page.getByText("Email #2 · 10% offer", { exact: true }).click();
    await page.getByRole("button", { name: "Layout", exact: true }).click();
    await page.getByText("Email layout", { exact: true }).click();
    await page.getByLabel("Visual preset", { exact: true }).selectOption("standard");
    await page.getByLabel("Visual preset", { exact: true }).selectOption("corals-reef");
    await page.getByText("Flow design", { exact: true }).click();
    await page.getByLabel("Flow accent color", { exact: true }).fill("#ee7755");
    await page.getByLabel("Flow background color", { exact: true }).fill("#e6f5fa");
    await page.getByLabel("Flow heading size", { exact: true }).fill("42");
    await page.getByRole("button", { name: "Content", exact: true }).click();
    await page.getByText("Flow design", { exact: true }).click();
    await page.getByLabel("Offer heading", { exact: true }).fill("A gift for your reef");
    await page.getByLabel("Offer subtitle", { exact: true }).fill("Your next coral order");
    await page.getByLabel("Product section heading", { exact: true }).fill("Your saved reef picks");
    await page.getByLabel("Closing line", { exact: true }).fill("Happy reefing, Jamie!");
    await page.getByLabel("Team signature", { exact: true }).fill("Your saved coral team");
    await page.getByLabel("Heading", { exact: true }).fill("Your next reef starts here");
    await page.getByRole("button", { name: "Edit HTML", exact: true }).click();
    await page.getByLabel("Message HTML", { exact: true }).fill('<p><strong>Saved authored copy</strong> with <a href="https://coralsanonymous.com/pages/care">coral care</a>.</p>');
    await page.getByLabel("Button text", { exact: true }).fill("Return to my cart");
    assert.equal(await page.getByLabel("Customer checkout link").getAttribute("readonly"), "");
    await page.getByRole("button", { name: "Artwork", exact: true }).click();
    assert.equal(await page.getByLabel("Footer image", { exact: true }).count(), 0, "Legacy shared footer artwork is not offered for a design that does not render it");
    await page.getByRole("button", { name: "Remove flow logo", exact: true }).click();
    assert.ok(!(await page.getByTitle("Email preview").getAttribute("srcdoc")).includes("ca-reef-logo-v1.png"));
    await page.getByRole("button", { name: "Use default flow logo", exact: true }).click();
    await page.getByLabel("Flow logo size", { exact: true }).press("ArrowRight");
    await page.getByRole("button", { name: "Footer", exact: true }).click();
    assert.equal(await page.getByLabel("Footer background color", { exact: true }).count(), 0);
    assert.equal(await page.getByLabel("Footer text color", { exact: true }).count(), 0);
    assert.equal(await page.getByLabel("Footer heading", { exact: true }).count(), 0);
    assert.equal(await page.getByLabel("Social heading", { exact: true }).count(), 0);
    assert.equal(await page.getByLabel("Instagram icon image", { exact: true }).count(), 0);
    assert.equal(await page.getByLabel("Footer message", { exact: true }).count(), 1);
    await page.getByText(/Footer details use this brand's shared settings/).waitFor();
    await page.getByRole("button", { name: "Save email", exact: true }).click();
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("reef-design-saved:abandoned-cart")));
    assert.equal(saved.enabled, false); assert.equal(saved.data.reviewed, false);
    assert.deepEqual(saved.data.steps.map(step => step.minutes), [180, 240, 1440]);
    assert.equal(saved.data.cart.couponHours, 168); assert.equal(saved.data.cart.minimumSubtotal, 100);
    assert.equal(saved.data.steps[1].content.template, "cart-recovery");
    assert.equal(saved.data.steps[1].content.reefDesign.offerPercent, 10);
    assert.equal(saved.data.steps[1].content.reefDesign.logoScale, 1.05);
    assert.equal(saved.data.steps[1].content.reefDesign.closing, "Happy reefing, Jamie!");
    assert.equal(saved.data.steps[1].content.reefDesign.accentColor, "#ee7755");
    assert.ok(saved.data.steps[1].content.bodyHtml.includes("Saved authored copy"));
    assert.equal(saved.data.steps[1].content.footerTitle, "Saved legacy footer title");
    assert.equal(saved.data.steps[1].content.footerImage, "https://fixture.example/legacy-footer.png");
    assert.equal(saved.data.steps[1].content.footerScale, 1.2);
    assert.equal(saved.data.steps[1].content.footerBackgroundColor, "#123456");
    assert.deepEqual(JSON.parse(await page.evaluate(() => localStorage.getItem("reef-design-branding"))), metadata.sharedBranding, "Flow logo/style changes cannot change shared campaign branding");
    await page.getByLabel("Back to flow", { exact: true }).click();
    await page.reload();
    await page.getByText("Email #2 · 10% offer", { exact: true }).click();
    const reopened = await page.getByTitle("Email preview").getAttribute("srcdoc");
    assert.ok(reopened.includes("A gift for your reef") && reopened.includes("Saved authored copy") && reopened.includes("Return to my cart"));
    await page.getByRole("button", { name: "Content", exact: true }).click();
    await page.getByText("Flow design", { exact: true }).click();
    assert.equal(await page.getByLabel("Closing line", { exact: true }).inputValue(), "Happy reefing, Jamie!");
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 1100 });
      assert.ok(await page.getByRole("dialog").evaluate(dialog => dialog.scrollWidth <= dialog.clientWidth + 1));
      const file = path.join(output, "flow-editor-" + width + ".png"); await page.screenshot({ path: file }); screenshots.push(file);
    }
    for (const brand of ["corals-anonymous", "macroalgae-farms"]) {
      await page.setViewportSize({ width: 1440, height: 1100 });
      await open({ mode: "campaign", brand });
      await page.getByRole("button", { name: "Layout", exact: true }).click();
      await page.getByText("Email layout", { exact: true }).click();
      assert.equal(await page.getByLabel("Visual preset", { exact: true }).locator('option[value="corals-reef"]').count(), 0, "The flow preset is not offered for " + brand + " campaigns");
      assert.equal(await page.getByText("Flow design", { exact: true }).count(), 0);
    }
    await open({ mode: "campaign", brand: "corals-anonymous", source: "flow", case: "cart-ten" });
    await page.getByRole("button", { name: "Layout", exact: true }).click();
    await page.getByText("Email layout", { exact: true }).click();
    assert.equal(await page.getByLabel("Visual preset", { exact: true }).inputValue(), "corals-reef", "An explicitly copied flow template keeps its selected preset visible");
    assert.equal(await page.getByLabel("Visual preset", { exact: true }).locator('option[value="corals-reef"]').count(), 1);
    assert.deepEqual(errors, []); assert.deepEqual(apiRequests, [], "No API/customer email actions"); assert.deepEqual(unexpected, [], "Every image and resource stayed in the isolated fixture");
    const result = { result: "PASS", checks, screenshots };
    await fs.writeFile(path.join(output, "browser-verification.json"), JSON.stringify(result, null, 2));
    console.log(JSON.stringify({ result: result.result, renderChecks: checks.length, screenshots }, null, 2));
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
