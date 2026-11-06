import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { content, render, defaultContent, withBranding, sharedEmailFooter } from "../lib/marketing/rules";
import { emailBody } from "../lib/marketing/delivery";
import { macroNewsletterContent, macroNewsletterDefinitions, macroNewsletterTemplates, newsletterLink, newsletterSectionHtml, newsletterSectionRemoved } from "../lib/marketing/macro-newsletters";
import { resolveCampaignProductFeeds, manualNewsletterProducts } from "../lib/marketing/campaign-product-feed";
import { runWithMarketingBrand } from "../lib/marketing/context";
import { newsletterTextDocument, newsletterPlainText, normalizeNewsletterText, newsletterFormattedText, type NewsletterTextNode } from "../lib/marketing/newsletter-rich-text";

test("nitrate feature switches to one column in the delivered markup without relying on mobile styles", () => {
  const value = macroNewsletterContent("nitrate");
  const original = render(value, "https://app.example/unsubscribe", "");
  value.macroNewsletter!.text["text-2"] = "Long staff article. ".repeat(100);
  value.macroNewsletter!.richText = { "text-2": newsletterTextDocument(value.macroNewsletter!.text["text-2"]) };
  const before = structuredClone(value.macroNewsletter!);
  value.macroNewsletter!.featuredLayout = "stacked";
  const saved = content(JSON.parse(JSON.stringify(value)));
  assert.equal(saved.macroNewsletter!.featuredLayout, "stacked");
  assert.deepEqual(saved.macroNewsletter!.text, before.text);
  assert.deepEqual(saved.macroNewsletter!.richText, before.richText);
  assert.deepEqual(saved.macroNewsletter!.images, before.images);
  assert.deepEqual(saved.macroNewsletter!.products, before.products);
  const result = emailBody({ id: "stacked-feature-preview", to: "staff@example.com", channel: "EMAIL", subject: "Preview", content: saved, unsubscribe: "https://app.example/unsubscribe" }, "", "Macroalgae Farms");
  const doc = new JSDOM(result.html.replace(/<style>[\s\S]*?<\/style>/g, "")).window.document;
  const rows = doc.querySelectorAll(".nl-feature-stacked > tbody > tr");
  assert.equal(rows.length, 2);
  for (const row of rows) {
    assert.equal(row.children.length, 1);
    assert.equal((row.firstElementChild as HTMLElement).style.width, "100%");
    assert.equal(row.firstElementChild!.getAttribute("width"), "100%");
  }
  assert.ok(rows[0].querySelector(".mw-feature-image"));
  assert.ok(rows[1].querySelector(".mw-feature-details"));
  const image = rows[0].querySelector("img")!;
  assert.equal(image.getAttribute("width"), "200");
  assert.equal(image.getAttribute("height"), null);
  assert.equal(image.style.height, "auto");
  assert.equal(image.style.objectFit, "contain");
  assert.match(rows[1].textContent!, /Long staff article/);
  assert.match(result.text, /Long staff article/);
  assert.ok(doc.querySelector('a[href="https://app.example/unsubscribe"]'));
  saved.macroNewsletter!.hiddenSections = ["feature"];
  assert.equal(new JSDOM(render(saved, "#unsubscribe", "")).window.document.querySelector(".mw-feature-section"), null);
  saved.macroNewsletter!.hiddenSections = [];
  assert.match(render(saved, "#unsubscribe", ""), /nl-feature-stacked/);
  const unchanged = macroNewsletterContent("nitrate");
  unchanged.macroNewsletter!.featuredLayout = "columns";
  assert.equal(render(content(unchanged), "https://app.example/unsubscribe", ""), original);
  (unchanged.macroNewsletter as unknown as { featuredLayout: string }).featuredLayout = "invalid";
  assert.equal(content(unchanged).macroNewsletter!.featuredLayout, undefined);
  for (const design of ["habitat", "field-guide"] as const) {
    const other = macroNewsletterContent(design);
    other.macroNewsletter!.featuredLayout = "stacked";
    assert.equal(content(other).macroNewsletter!.featuredLayout, undefined);
  }
});

test("removed newsletter sections collapse completely, preserve their content and restore exactly in every layout", () => {
  for (const definition of macroNewsletterDefinitions) {
    const original = macroNewsletterContent(definition.design);
    const initial = render(original, "https://app.example/unsubscribe", "123 Ocean Ave");
    for (const section of definition.sections) {
      const edited = structuredClone(original);
      edited.macroNewsletter!.hiddenSections = [section.id, section.id, "unknown-section"];
      const saved = content(JSON.parse(JSON.stringify(edited)));
      assert.deepEqual(saved.macroNewsletter!.hiddenSections, [section.id]);
      assert.deepEqual(saved.macroNewsletter!.text, original.macroNewsletter!.text);
      assert.deepEqual(saved.macroNewsletter!.products, original.macroNewsletter!.products);
      assert.equal(newsletterSectionRemoved(saved.macroNewsletter!, section.id), true);
      const structure = newsletterSectionHtml(saved.macroNewsletter!);
      for (const key of section.fields) assert.ok(!structure.includes(`:${key}]]`), `${definition.design}/${section.id} removes the entire ${key} container`);
      const html = render(saved, "https://app.example/unsubscribe", "123 Ocean Ave");
      const doc = new JSDOM(html).window.document;
      assert.ok(doc.querySelector('a[href="https://app.example/unsubscribe"]'));
      assert.equal(doc.querySelectorAll("tr:empty,table:empty").length, 0);
      assert.ok(!html.includes("NL:section:"));
      saved.macroNewsletter!.hiddenSections = [];
      assert.equal(render(saved, "https://app.example/unsubscribe", "123 Ocean Ave"), initial, "Restore returns to the approved arrangement and content");
    }
  }
});

test("removing an article column expands its sibling; removing all child rows leaves no empty article table", () => {
  for (const design of ["habitat", "field-guide"] as const) {
    for (const removed of ["article-left", "article-right"]) {
      const value = macroNewsletterContent(design);
      value.macroNewsletter!.hiddenSections = [removed];
      const html = render(content(value), "https://app.example/unsubscribe", "");
      const doc = new JSDOM(html).window.document;
      const table = doc.querySelector(design === "habitat" ? ".mc-article" : ".mf-article")!;
      const cells = table.querySelectorAll("tr:first-child > .nl-col");
      assert.equal(cells.length, 1);
      const cell = cells[0] as HTMLElement;
      assert.equal(cell.style.width, "100%");
      assert.equal(cell.style.paddingLeft, "0px");
      assert.equal(cell.style.paddingRight, "0px");
      assert.equal(cell.style.borderLeftWidth, "0px");
    }
    const value = macroNewsletterContent(design);
    value.macroNewsletter!.hiddenSections = ["article-left", "article-right", "reading", ...(design === "habitat" ? ["field-note"] : [])];
    const doc = new JSDOM(render(content(value), "#unsubscribe", "")).window.document;
    assert.equal(doc.querySelector(design === "habitat" ? ".mc-article" : ".mf-article"), null);
  }
});

test("removed content is excluded from both delivery formats and inline attachments", () => {
  const value = macroNewsletterContent("nitrate");
  value.heading = "REMOVED OPENING";
  value.body = "REMOVED INTRODUCTION";
  value.macroNewsletter!.text["text-2"] = "REMOVED FEATURE COPY";
  value.macroNewsletter!.richText = { "text-2": { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "REMOVED FEATURE COPY", marks: [{ type: "link", attrs: { href: "https://www.macroalgaefarms.com/pages/removed-rich-link" } }] }] }] } };
  value.macroNewsletter!.images["image-1"].src = "data:image/png;base64,AQID";
  value.macroNewsletter!.products[0].title = "REMOVED PRODUCT";
  value.macroNewsletter!.hiddenSections = ["opening", "feature", "products"];
  const result = emailBody({ id: "removed-section-preview", to: "staff@example.com", channel: "EMAIL", subject: "Preview", content: content(value), unsubscribe: "https://app.example/unsubscribe" }, "123 Ocean Ave", "Macroalgae Farms");
  for (const text of [result.html, result.text]) assert.doesNotMatch(text, /REMOVED|removed-rich-link/);
  assert.ok(!result.attachments?.some(item => item.content === "AQID"));
  assert.match(result.html, /What to watch as it grows/);
  assert.match(result.text, /What to watch as it grows/);
  assert.match(result.html, /Unsubscribe/);
});

test("newsletter rich text survives save/reopen and reaches preview, delivery and readable plain text in all three layouts", () => {
  const doc: NewsletterTextNode = { type: "doc", content: [
    { type: "paragraph", attrs: { indent: 2, textAlign: "right" }, content: [{ type: "text", text: 'Hi {{ first_name|default:"reef keeper" }} <script>', marks: [{ type: "bold" }, { type: "underline" }, { type: "textStyle", attrs: { color: "#284b88", fontFamily: "Georgia", fontSize: "18px", lineHeight: "1.75" } }] }] },
    { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "A useful habitat" }] }] }] },
    { type: "paragraph", content: [{ type: "text", text: "Species library", marks: [{ type: "link", attrs: { href: "https://www.macroalgaefarms.com/pages/species-library" } }] }] },
  ] };
  for (const definition of macroNewsletterDefinitions) {
    const value = macroNewsletterContent(definition.design);
    value.body = newsletterPlainText(doc);
    value.macroNewsletter!.richText = { body: doc, heading: newsletterTextDocument(value.heading) };
    const field = definition.fields.find(field => field.type === "text")!;
    value.macroNewsletter!.text[field.key] = "Editable caption";
    value.macroNewsletter!.richText[field.key] = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Editable caption", marks: [{ type: "italic" }] }] }] };
    value.macroNewsletter!.products[0].title = "Formatted product";
    value.macroNewsletter!.products[0].richText = { title: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Formatted product", marks: [{ type: "underline" }] }] }] } };
    const saved = content(JSON.parse(JSON.stringify(value)));
    assert.deepEqual(saved.macroNewsletter!.richText?.body, normalizeNewsletterText(doc));
    const html = render(saved, "https://app.example/unsubscribe", "", "Alex Keeper", "Macroalgae Farms");
    const parsed = new JSDOM(html).window.document;
    assert.equal(parsed.querySelectorAll("script,p p,a a").length, 0);
    assert.match(html, /margin-left:40px/);
    assert.match(html, /text-align:right/);
    assert.match(html, /font-size:18px/);
    assert.ok(parsed.querySelector('span[role="list"]'));
    assert.match(html, /<u><strong>|<strong>/);
    assert.match(parsed.body.textContent!, /Hi Alex <script>/);
    assert.equal(parsed.querySelector("h3 u")?.textContent, "Formatted product");
    const delivered = emailBody({ id: "rich-preview", to: "staff@example.com", channel: "EMAIL", subject: "Rich preview", content: saved, profileName: "Alex Keeper", unsubscribe: "https://app.example/unsubscribe" }, "", "Macroalgae Farms");
    assert.match(delivered.html, /margin-left:40px/);
    assert.match(delivered.text, /Hi Alex <script>/);
    assert.match(delivered.text, /A useful habitat/);
    assert.doesNotMatch(delivered.text, /<strong>|<span|\[object Object\]/);
    const olderEdit = { ...saved, body: "Later plain-text change" };
    assert.match(render(olderEdit, "#unsubscribe", ""), /Later plain-text change/);
    assert.doesNotMatch(render(olderEdit, "#unsubscribe", ""), /Hi Alex/);
  }
});

test("newsletter rich text rejects executable content, external links, illegal structures and unbounded input", () => {
  const node = (mark: { type: string; attrs?: Record<string, string> }) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Safe", marks: [mark] }] }] });
  for (const href of ["javascript:alert(1)", "https://evil.example/", "https://macroalgaefarms.com.evil.example/", "https://user:password@macroalgaefarms.com/"]) assert.throws(() => normalizeNewsletterText(node({ type: "link", attrs: { href } })));
  assert.throws(() => normalizeNewsletterText({ type: "doc", content: [{ type: "iframe" }] }));
  assert.throws(() => normalizeNewsletterText({ type: "doc", content: [{ type: "text", text: "Invalid child" }] }));
  assert.throws(() => normalizeNewsletterText(newsletterTextDocument("x".repeat(20001))));
  const stripped = normalizeNewsletterText(node({ type: "textStyle", attrs: { color: "red;background:url(javascript:alert(1))", fontFamily: "Evil;display:none", fontSize: "999px" } }));
  assert.equal(newsletterFormattedText("Safe", stripped), "Safe");
  const stale = newsletterTextDocument("Old copy");
  assert.equal(newsletterFormattedText("<b>New plain copy</b>", stale), "&lt;b&gt;New plain copy&lt;/b&gt;");
});

test("manual newsletter search matches partial names and imports available Macroalgae Farms products", async () => {
  const keys = ["SPECIES_LIBRARY_SHOP_DOMAIN", "MACROALGAE_SHOPIFY_CLIENT_ID", "MACROALGAE_SHOPIFY_CLIENT_SECRET"];
  const previous = keys.map(key => process.env[key]), oldFetch = globalThis.fetch;
  Object.assign(process.env, { SPECIES_LIBRARY_SHOP_DOMAIN: "macroalgaefarms-newsletter-fixture.myshopify.com", MACROALGAE_SHOPIFY_CLIENT_ID: "fixture", MACROALGAE_SHOPIFY_CLIENT_SECRET: "fixture-secret" });
  const queries: string[] = [];
  globalThis.fetch = async (input, init) => {
    assert.equal(new URL(String(input)).hostname, "macroalgaefarms-newsletter-fixture.myshopify.com");
    if (String(input).includes("/oauth/")) return Response.json({ access_token: "fixture-token", expires_in: 3600 });
    const request = JSON.parse(String(init?.body));
    queries.push(request.variables.query);
    const product = { id: "gid://shopify/Product/1", title: "Chaetomorpha Refugium Macroalgae", handle: "chaeto", onlineStoreUrl: "https://www.macroalgaefarms.com/products/chaeto", featuredImage: { url: "https://cdn.shopify.com/chaeto.jpg" }, variants: { nodes: [ { id: "variant-1", availableForSale: true, price: "7.59", compareAtPrice: null, image: null } ] } };
    return Response.json({ data: { products: { nodes: [product, { ...product, id: "unpublished", onlineStoreUrl: null }, { ...product, id: "unavailable", variants: { nodes: [{ ...product.variants.nodes[0], availableForSale: false }] } }], pageInfo: { hasNextPage: false, endCursor: null } } } });
  };
  try {
    await runWithMarketingBrand("macroalgae-farms", async () => {
      const products = await manualNewsletterProducts("Chaeto Refug");
      assert.equal(queries[0], "status:active AND title:Chaeto* AND title:Refug*");
      assert.equal(products.length, 1);
      assert.equal(products[0].salePrice, "$7.59");
      assert.equal(products[0].image, "https://cdn.shopify.com/chaeto.jpg");
      assert.equal(products[0].url, "https://www.macroalgaefarms.com/products/chaeto");
      await manualNewsletterProducts('Chaeto\") OR status:draft');
      assert.equal(queries[1], "status:active AND title:Chaeto* AND title:OR* AND title:status* AND title:draft*");
      assert.deepEqual(await manualNewsletterProducts("*:()"), []);
      assert.equal(queries.length, 2);
    });
  } finally {
    globalThis.fetch = oldFetch;
    keys.forEach((key, index) => { if (previous[index] === undefined) delete process.env[key]; else process.env[key] = previous[index]; });
  }
});

for (const definition of macroNewsletterDefinitions) {
  test(`${definition.name}: all approved copy, images and six manual products survive save/reopen`, async () => {
    const original = macroNewsletterContent(definition.design);
    const saved = content(JSON.parse(JSON.stringify(original)));
    assert.deepEqual(saved.macroNewsletter, original.macroNewsletter);
    assert.equal(saved.macroNewsletter!.products.length, 6);
    assert.equal(saved.campaignLayout, undefined);
    assert.deepEqual(await resolveCampaignProductFeeds(saved, "manual-only"), saved);
    const html = render(saved, "https://dashboard.example/unsubscribe?token=recipient", "123 Ocean Ave", "Reef Keeper", "Macroalgae Farms");
    const doc = new JSDOM(html).window.document;
    assert.equal(doc.querySelector("h1")?.textContent, original.heading);
    assert.equal(doc.querySelectorAll("h3").length, 6);
    assert.equal(doc.querySelectorAll("script,iframe").length, 0);
    assert.ok(!html.includes("[[NL:"));
    assert.ok(doc.querySelector('a[href="https://dashboard.example/unsubscribe?token=recipient"]'));
    for (const image of doc.querySelectorAll("img")) assert.ok(/^(https:|data:image\/)/.test(image.src));
    for (const link of doc.querySelectorAll("a")) {
      if (link.href.startsWith("mailto:") || link.href.includes("dashboard.example/unsubscribe")) continue;
      assert.ok(["macroalgaefarms.com", "www.macroalgaefarms.com"].includes(new URL(link.href).hostname));
    }
    assert.ok(doc.querySelector('table[role="presentation"]'), "Email layout has table fallbacks");
  });
  test(`${definition.name}: edited copy, cleared fields, reordered products and uploaded artwork reach delivery`, () => {
    const value = macroNewsletterContent(definition.design);
    value.heading = 'For {{ first_name|default:"reef keepers" }} <script>alert(1)</script>';
    value.body = "A revised introduction\nSecond line";
    for (const field of definition.fields) if (field.type === "text") value.macroNewsletter!.text[field.key] = `Edited ${field.key} <b>literal text</b>`;
    const cleared = definition.fields.find(field => field.type === "text")!;
    value.macroNewsletter!.text[cleared.key] = "";
    const image = definition.fields.find(field => field.type === "image")!;
    const dataImage = "data:image/png;base64,AQID";
    value.macroNewsletter!.images[image.key] = { src: dataImage, alt: 'Replacement "artwork"' };
    value.macroNewsletter!.products.reverse();
    value.macroNewsletter!.products[0] = { ...value.macroNewsletter!.products[0], title: "Staff selected product", image: dataImage, portion: "Staff portion", salePrice: "$25.00", button: "View details" };
    value.showPostalAddress = true;
    const saved = content(JSON.parse(JSON.stringify(value)));
    const delivery = emailBody({ id: "preview-only", to: "staff@example.com", channel: "EMAIL", subject: "Review", content: saved, unsubscribe: "https://app.example/unsubscribe", profileName: "Alex Keeper" }, "123 Ocean Ave", "Macroalgae Farms");
    const doc = new JSDOM(delivery.html).window.document;
    assert.match(doc.querySelector("h1")!.textContent!, /For Alex <script>/);
    assert.equal(doc.querySelectorAll("script,b").length, 0);
    assert.equal(doc.querySelector("h3")!.textContent, "Staff selected product");
    assert.match(delivery.html, /Staff portion/);
    assert.match(delivery.html, /123 Ocean Ave/);
    assert.ok(delivery.attachments?.some(attachment => attachment.content === "AQID"));
    assert.equal(delivery.attachments?.filter(attachment => attachment.content === "AQID").length, 1);
    assert.ok(!delivery.html.includes(dataImage));
    assert.ok(doc.querySelector('img[src^="cid:"]'));
    assert.match(delivery.text, /Staff selected product.*Staff portion.*\$25.00/);
    assert.match(delivery.text, /Edited text-/);
    assert.ok(!delivery.text.includes("[[NL:"));
    for (const field of definition.fields.filter(field => field.type === "text" && field.key !== cleared.key)) assert.ok(delivery.html.includes(`Edited ${field.key}`));
  });
}

test("built-in starters do not replace saved template edits or share mutable state", () => {
  const builtins = macroNewsletterTemplates();
  assert.equal(builtins.length, 3);
  assert.equal(macroNewsletterTemplates([{ kind: "TEMPLATE", key: builtins[0].key }]).length, 2);
  const a = macroNewsletterContent("nitrate"), b = macroNewsletterContent("nitrate");
  a.macroNewsletter!.products[0].title = "Campaign-specific edit";
  assert.notEqual(a.macroNewsletter!.products[0].title, b.macroNewsletter!.products[0].title);
});

test("newsletter address visibility survives save/reopen and overrides shared branding in preview and delivery", () => {
  const address = "123 Newsletter Fixture Ave";
  for (const definition of macroNewsletterDefinitions) {
    for (const visible of [false, true]) {
      const original = macroNewsletterContent(definition.design);
      original.macroNewsletter!.showPostalAddress = visible;
      const saved = content(JSON.parse(JSON.stringify(original)));
      const branding = { footerConfigured: true, showPostalAddress: !visible };
      assert.equal(saved.macroNewsletter!.showPostalAddress, visible);
      assert.equal(withBranding(saved, branding).showPostalAddress, visible);
      assert.equal(withBranding(saved).showPostalAddress, visible);
      assert.equal(sharedEmailFooter(withBranding(saved, branding)).showPostalAddress, undefined, "Saving the footer cannot copy the local address choice into shared branding");
      const html = render(saved, "https://app.example/unsubscribe", address, undefined, "Macroalgae Farms", branding);
      const delivery = emailBody({ id: "address-preview", to: "staff@example.com", channel: "EMAIL", subject: "Preview", content: saved, branding, unsubscribe: "https://app.example/unsubscribe" }, address, "Macroalgae Farms");
      assert.equal(html.includes(address), visible);
      assert.equal(delivery.html.includes(address), visible);
      assert.equal(delivery.text.includes(address), visible);
      assert.equal(branding.showPostalAddress, !visible, "Campaign choice does not mutate the shared footer");
      const other = macroNewsletterContent(definition.design);
      assert.equal(withBranding(other, branding).showPostalAddress, !visible, "Other emails retain their shared setting");
    }
  }
});

test("newsletter fields reject external destinations, executable images and unsupported layouts", async () => {
  for (const link of ["javascript:alert(1)", "https://macroalgaefarms.com.evil.example/", "https://evil.example/", "https://user:password@macroalgaefarms.com/"]) assert.throws(() => newsletterLink(link));
  for (const image of ["javascript:alert(1)", "data:image/svg+xml;base64,AQID"]) {
    const value = macroNewsletterContent("habitat"); value.macroNewsletter!.images["image-0"].src = image;
    assert.throws(() => content(value));
  }
  assert.throws(() => content({ ...defaultContent, layout: "macro-newsletter" }));
  const value = macroNewsletterContent("nitrate");
  assert.throws(() => content({ ...value, macroNewsletter: { ...value.macroNewsletter, design: "unreviewed" } }));
  await assert.rejects(manualNewsletterProducts("Chaeto"), /Choose Macroalgae Farms/);
});

test("clearing newsletter artwork removes the image, while unsubscribing remains recipient-specific", () => {
  const value = macroNewsletterContent("field-guide");
  value.heading = ""; value.body = "";
  for (const image of Object.values(value.macroNewsletter!.images)) image.src = "";
  const html = render(content(value), "https://app.example/recipient-specific", "");
  assert.ok(!html.includes('src=""'));
  assert.ok(html.includes("https://app.example/recipient-specific"));
  assert.ok(!html.includes("Email preferences"));
});
