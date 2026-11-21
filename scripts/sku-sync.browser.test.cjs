/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { build } = require("esbuild");
const { chromium } = require("playwright");

(async () => {
  const output = await fs.mkdtemp(path.join(os.tmpdir(), "reef-sku-sync-"));
  const bundle = await build({
    entryPoints: ["scripts/sku-sync.browser.fixture.tsx"],
    bundle: true, write: false, outdir: output, platform: "browser", jsx: "automatic",
    tsconfig: "tsconfig.json",
    define: { "process.env.NODE_ENV": '"development"' },
  });
  const globals = (await fs.readFile("app/globals.css", "utf8")).replace(/^@import[^;]+;\s*/gm, "");
  const server = http.createServer((request, response) => {
    if (request.url === "/app.js" || request.url === "/app.css") {
      const suffix = request.url.endsWith(".js") ? ".js" : ".css";
      response.setHeader("Content-Type", suffix === ".js" ? "text/javascript" : "text/css");
      response.end((suffix === ".css" ? globals : "") + bundle.outputFiles.find(file => file.path.endsWith(suffix)).text);
    } else {
      response.setHeader("Content-Type", "text/html");
      response.end('<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/app.css"></head><body><main class="reef-content"><div id="root"></div></main><script src="/app.js"></script></body></html>');
    }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      executablePath: process.env.SKU_SYNC_TEST_BROWSER || "C:/Program Files/Google/Chrome/Application/chrome.exe",
    });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const pageErrors = [];
    page.on("pageerror", error => pageErrors.push(error.message));
    const variant = (id, title, sku) => ({ variantId: id, productId: `product-${id}`, title, variantTitle: "Small", sku, url: "https://admin.shopify.com/store/example/products/1" });
    const pair = (id, name, skuA, skuB, status, extra = {}) => ({
      id, name, category: "fish", active: true, canResolve: status !== "matching", status,
      storeA: variant(`A-${id}`, name, skuA), storeB: variant(`B-${id}`, name, skuB),
      error: null, checkedAt: "2026-11-20T17:00:00.000Z", ...extra,
    });
    const initial = () => ({
      configured: true, checkedAt: "2026-11-20T17:00:00.000Z", lastAutomaticCheckAt: null, busy: false,
      mappings: [
        pair("1", "Clownfish", " CA-001 ", "MA-002", "different"),
        pair("2", "Matching fish", "FISH-2", "FISH-2", "matching", { canResolve: false }),
        pair("3", "Blank SKU", "", "FISH-3", "missing"),
        pair("4", "Both edited", "CA-4", "MA-4", "conflict"),
        pair("5", "Unavailable variant", null, "FISH-5", "error", { canResolve: false, error: "One variant could not be checked." }),
        pair("6", "Inactive pair", "CA-6", "MA-6", "inactive", { active: false, canResolve: false }),
        pair("7", "Ambiguous pair", "CA-7", "MA-7", "conflict", { canResolve: false, error: "This variant belongs to more than one pair." }),
        pair("8", "Long product name that should wrap neatly on a narrow phone without hiding either store", "LONG-SKU-".repeat(35), "OTHER-SKU", "different"),
        pair("9", "Automatic update failed", "CA-9", "MA-9", "sync-error", { error: "The SKU could not be updated in Macroalgae Farms." }),
      ],
    });
    let state = initial();
    let getCount = 0;
    const posts = [];
    let conflictNext = false;
    let conflictRecovery = null;
    let nonJsonNext = false;
    await page.route("**/api/sku-sync", async route => {
      if (route.request().method() === "GET") {
        getCount++;
        if (nonJsonNext) {
          nonJsonNext = false;
          return route.fulfill({ status: 503, contentType: "text/html", body: "Temporarily unavailable" });
        }
        return route.fulfill({ json: state });
      }
      assert.equal(route.request().method(), "POST");
      const body = route.request().postDataJSON();
      posts.push(body);
      if (conflictNext) {
        conflictNext = false;
        state.mappings[0].storeB.sku = "CHANGED-IN-SHOPIFY";
        state.mappings[0].storeB.variantId = "B-replaced-1";
        if (conflictRecovery === "error") state.error = "The comparison could not be refreshed; showing saved values.";
        if (conflictRecovery === "busy") state.busy = true;
        conflictRecovery = null;
        return route.fulfill({ status: 409, json: { error: "This product pair changed while you were reviewing it." } });
      }
      const mapping = state.mappings.find(item => item.id === body.mappingId);
      assert.equal(body.expectedVariantAId, mapping.storeA.variantId);
      assert.equal(body.expectedVariantBId, mapping.storeB.variantId);
      assert.equal(body.expectedSkuA, mapping.storeA.sku);
      assert.equal(body.expectedSkuB, mapping.storeB.sku);
      const sku = body.source === "A" ? mapping.storeA.sku : mapping.storeB.sku;
      mapping.storeA.sku = mapping.storeB.sku = sku;
      mapping.status = "matching";
      mapping.canResolve = false;
      return route.fulfill({ json: state });
    });
    const row = name => page.locator(".sku-sync__pair").filter({ has: page.getByRole("heading", { name, exact: true }) });
    const choose = (name, store) => row(name).getByRole("button", { name: `Use ${store} SKU for ${name}`, exact: true });
    const refresh = async () => {
      await page.getByRole("button", { name: "Refresh", exact: true }).click();
      await page.getByRole("button", { name: "Refresh", exact: true }).waitFor();
    };
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await row("Clownfish").waitFor();
    assert.equal(posts.length, 0, "Opening the workspace must never choose a SKU");
    assert.equal(await row("Matching fish").getByRole("button").count(), 0);
    assert.equal(await row("Blank SKU").getByText("No SKU", { exact: true }).count(), 1);
    assert.equal(await row("Unavailable variant").getByText("Unavailable", { exact: true }).count(), 1);
    assert.equal(await choose("Unavailable variant", "Corals Anonymous").isDisabled(), true);
    assert.equal(await choose("Ambiguous pair", "Corals Anonymous").isDisabled(), true);
    assert.equal(await choose("Both edited", "Corals Anonymous").isEnabled(), true);
    assert.equal(await row("Inactive pair").getByRole("button").count(), 0);
    await page.getByText("No automatic check yet", { exact: true }).waitFor();
    assert.equal(await page.locator("#sku-sync-refresh-help").innerText(), "Reloads comparison only.");
    await row("Automatic update failed").getByText("Needs attention", { exact: true }).waitFor();
    assert.match(await row("Automatic update failed").innerText(), /could not be updated in Macroalgae Farms/);
    assert.equal(await row("Automatic update failed").locator(".sku-sync__pair-action-note").count(), 0, "Provider recovery guidance must not be duplicated or contradicted");
    assert.equal(await choose("Automatic update failed", "Corals Anonymous").isEnabled(), true);
    await page.getByText("1 needs attention", { exact: true }).waitFor();

    state.checkedAt = "2026-11-20T18:00:00.000Z";
    await refresh();
    await page.getByText("No automatic check yet", { exact: true }).waitFor();
    assert.equal(posts.length, 0, "Refreshing the comparison must not start an automatic check or write SKUs");
    state.lastAutomaticCheckAt = "2026-11-20T16:55:00.000Z";
    await refresh();
    const automaticCheck = page.locator(".sku-sync__automatic time");
    assert.equal(await automaticCheck.getAttribute("datetime"), state.lastAutomaticCheckAt);
    const automaticLabel = await page.locator(".sku-sync__automatic-time").innerText();
    const comparisonLabel = await page.locator(".sku-sync__list-meta").innerText();
    state.checkedAt = "2026-11-20T18:05:00.000Z";
    await refresh();
    assert.equal(await page.locator(".sku-sync__automatic-time").innerText(), automaticLabel);
    assert.notEqual(await page.locator(".sku-sync__list-meta").innerText(), comparisonLabel);
    await page.reload();
    await row("Clownfish").waitFor();
    assert.equal(await page.locator(".sku-sync__automatic-time").innerText(), automaticLabel, "Page reload must not impersonate an automatic check");
    assert.equal(posts.length, 0);
    state.mappings.find(mapping => mapping.id === "9").error = null;
    await refresh();
    assert.match(await row("Automatic update failed").innerText(), /The SKU update could not be completed/);
    assert.match(await row("Automatic update failed").innerText(), /Review both SKUs and choose which one to keep/);
    state.mappings.find(mapping => mapping.id === "9").canResolve = false;
    await refresh();
    assert.equal(await choose("Automatic update failed", "Corals Anonymous").isDisabled(), true);
    assert.match(await row("Automatic update failed").innerText(), /Refresh the comparison to check this pair again/);

    await choose("Clownfish", "Corals Anonymous").click();
    await page.getByRole("dialog").waitFor();
    assert.equal(await page.getByRole("button", { name: "Cancel", exact: true }).evaluate(button => document.activeElement === button), true);
    assert.match(await page.getByRole("dialog").innerText(), /replace the SKU in Macroalgae Farms/);
    assert.equal(posts.length, 0, "Opening confirmation must not write");
    await page.keyboard.press("Escape");
    await page.getByRole("dialog").waitFor({ state: "hidden" });
    assert.equal(await choose("Clownfish", "Corals Anonymous").evaluate(button => document.activeElement === button), true);
    assert.equal(posts.length, 0);

    await choose("Clownfish", "Corals Anonymous").click();
    await page.getByRole("button", { name: "Confirm SKU change", exact: true }).click();
    await page.getByRole("status").filter({ hasText: "Applied the Corals Anonymous SKU" }).waitFor();
    assert.deepEqual(posts[0], {
      mappingId: "1", source: "A", expectedSkuA: " CA-001 ", expectedSkuB: "MA-002",
      expectedVariantAId: "A-1", expectedVariantBId: "B-1",
    });
    assert.equal(await row("Clownfish").getByRole("button").count(), 0);
    const readsAfterSuccess = getCount;
    await page.waitForTimeout(200);
    assert.equal(getCount, readsAfterSuccess, "Successful choice must not start polling or clear its confirmation");

    await choose("Blank SKU", "Corals Anonymous").click();
    assert.match(await page.getByRole("dialog").innerText(), /This will clear the SKU in Macroalgae Farms/);
    await page.getByRole("button", { name: "Clear SKU", exact: true }).click();
    await page.getByRole("status").filter({ hasText: "Cleared the SKU" }).waitFor();
    assert.equal(posts[1].expectedSkuA, "");
    assert.equal(await row("Blank SKU").getByText("No SKU", { exact: true }).count(), 2);

    state = initial();
    await refresh();
    conflictNext = true;
    await choose("Clownfish", "Corals Anonymous").click();
    await page.getByRole("button", { name: "Confirm SKU change", exact: true }).click();
    await page.getByRole("alert").filter({ hasText: "latest SKUs are shown below" }).waitFor();
    assert.equal(await row("Clownfish").getByText("CHANGED-IN-SHOPIFY", { exact: true }).count(), 1);
    const writesAfterConflict = posts.length;
    await page.waitForTimeout(150);
    assert.equal(posts.length, writesAfterConflict, "A conflict must not retry the write automatically");
    await choose("Clownfish", "Macroalgae Farms").click();
    await page.getByRole("button", { name: "Confirm SKU change", exact: true }).click();
    await page.getByRole("status").filter({ hasText: "Applied the Macroalgae Farms SKU" }).waitFor();
    assert.equal(posts.at(-1).source, "B");
    assert.equal(posts.at(-1).expectedVariantBId, "B-replaced-1", "A new choice must use the refreshed variant identity");
    assert.equal(posts.at(-1).expectedSkuB, "CHANGED-IN-SHOPIFY");

    for (const recovery of ["error", "busy"]) {
      state = initial();
      await refresh();
      conflictNext = true;
      conflictRecovery = recovery;
      await choose("Clownfish", "Corals Anonymous").click();
      await page.getByRole("button", { name: "Confirm SKU change", exact: true }).click();
      await page.getByRole("alert").filter({ hasText: "Refresh to check the latest SKUs before trying again" }).waitFor();
      assert.equal(await page.getByRole("alert").filter({ hasText: "latest SKUs are shown below" }).count(), 0, `Cached ${recovery} response must not be called latest`);
      assert.equal(await choose("Clownfish", "Corals Anonymous").isDisabled(), true, `Cached ${recovery} response must not enable stale choices`);
      const writesAfterCachedRecovery = posts.length;
      await page.waitForTimeout(100);
      assert.equal(posts.length, writesAfterCachedRecovery, "Cached conflict recovery must not retry a write");
    }
    state = initial();
    await refresh();

    nonJsonNext = true;
    await refresh();
    await page.getByRole("alert").filter({ hasText: "could not complete the request" }).waitFor();
    assert.equal(await choose("Clownfish", "Corals Anonymous").isDisabled(), true, "A failed refresh must disable stale actions");
    await refresh();
    assert.equal(await choose("Clownfish", "Corals Anonymous").isEnabled(), true);

    state.busy = true;
    await refresh();
    assert.equal(await choose("Clownfish", "Corals Anonymous").isDisabled(), true);
    await page.getByRole("status").filter({ hasText: "sync check is in progress" }).waitFor();
    state.busy = false;
    await refresh();
    await page.getByRole("searchbox", { name: "Search products or SKUs" }).fill("CA-4");
    assert.equal(await page.locator(".sku-sync__pair").count(), 1);
    await row("Both edited").waitFor();
    await page.getByRole("searchbox", { name: "Search products or SKUs" }).fill("not-a-product");
    await page.getByRole("heading", { name: "No matching product pairs" }).waitFor();
    await page.getByRole("searchbox", { name: "Search products or SKUs" }).fill("");

    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.evaluate(() => window.scrollTo(0, 0));
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, `Page overflow at ${width}px`);
      await choose("Clownfish", "Corals Anonymous").click();
      const bounds = await page.getByRole("dialog").boundingBox();
      assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width, `Dialog overflow at ${width}px`);
      await page.keyboard.press("Escape");
      await page.screenshot({ path: path.join(output, `sku-sync-${width}.png`) });
    }

    state = { configured: false, error: "Inventory-sync connection is not configured.", checkedAt: null, lastAutomaticCheckAt: null, mappings: [] };
    await refresh();
    await page.getByRole("heading", { name: "SKU Sync is not connected yet" }).waitFor();
    assert.equal(await page.locator(".sku-sync__choose").count(), 0);
    assert.deepEqual(pageErrors, []);
    console.log(JSON.stringify({ result: "passed", checks: ["read-only opening", "automatic timestamp distinct from comparison and page refresh", "automatic failure badge, details and authoritative actions", "matching/inactive/error/ambiguous states", "conflict resolution available", "accessible confirmation and Escape", "both manual directions", "untrimmed SKUs and expected variant IDs", "intentional blank SKU", "409 reload without retry and refreshed variant identity", "cached error/busy 409 recovery stays stale", "non-JSON failure and stale-state protection", "busy state", "search", "1440/390/320 responsive layouts", "unconfigured state"], screenshots: output }));
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
