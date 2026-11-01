import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { content, render, defaultContent } from "../lib/marketing/rules";
import { emailBody } from "../lib/marketing/delivery";
import { macroNewsletterContent, macroNewsletterDefinitions, macroNewsletterTemplates, newsletterLink } from "../lib/marketing/macro-newsletters";
import { resolveCampaignProductFeeds, manualNewsletterProducts } from "../lib/marketing/campaign-product-feed";

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
