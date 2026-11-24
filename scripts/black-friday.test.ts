import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { blackFridayCampaignTemplate, validateBlackFridayCampaign } from "../lib/marketing/black-friday";
import { runWithMarketingBrand } from "../lib/marketing/context";
import { emailBody } from "../lib/marketing/delivery";
import { content, extractEmailBranding, render } from "../lib/marketing/rules";

const unsubscribe = "https://unsubscribe.example/u";
const template = () => content(structuredClone(blackFridayCampaignTemplate.content));

test("Black Friday keeps manual picks and collection links through save, reorder, and render", () => {
  const source = template();
  const design = source.blackFriday!;
  assert.equal(design.dailyProducts.length, 3);
  assert.deepEqual(design.sections.map(section => [section.title, section.products.length]), [
    ["Anemones", 4], ["Corals", 4], ["Mysterious Creatures", 4],
  ]);
  const anemones = design.sections[0];
  const corals = design.sections[1];
  design.sections = [
    { ...corals, title: "Torch picks", products: corals.products.slice(0, 1), linkLabel: "See torch corals",
      linkUrl: "https://www.coralsanonymous.com/collections/torch-corals" },
    { ...anemones, id: "add-one", title: 'New <reef> section', products: [anemones.products[2]], linkLabel: "", linkUrl: "" },
  ];
  const saved = content(JSON.parse(JSON.stringify(source)));
  validateBlackFridayCampaign(saved);
  assert.deepEqual(saved.blackFriday, design);
  const document = new JSDOM(render(saved, unsubscribe, "")).window.document;
  assert.match(document.body.textContent || "", /New <reef> section/);
  assert.doesNotMatch(document.body.textContent || "", /Mysterious Creatures/);
  assert.ok(document.querySelector('a[href="https://www.coralsanonymous.com/collections/torch-corals"]'));
  assert.ok(document.querySelector(`a[href="${anemones.products[2].url}"]`));
  assert.ok(!document.querySelector(`a[href="${anemones.products[0].url}"]`));
  assert.equal(document.querySelectorAll('a[href="https://coralsanonymous.com/collections/sale"]').length, 2);
  assert.ok(document.querySelector('img[src="/api/marketing/daily-deals-countdown"]'));
  assert.equal(template().blackFriday?.sections.length, 3);
});

test("Black Friday rejects invalid storefront links and incomplete sends", () => {
  const source = template();
  const section = source.blackFriday!.sections[0];
  section.linkUrl = "https://macroalgaefarms.com/collections/anemones";
  assert.throws(() => content(source), /Corals Anonymous collection URL/);
  section.linkUrl = "javascript:alert(1)";
  assert.throws(() => content(source), /Corals Anonymous collection URL/);
  section.linkUrl = "";
  assert.throws(() => validateBlackFridayCampaign(content(source)), /link text and collection URL/);
  source.blackFriday!.dailyProducts.pop();
  assert.throws(() => validateBlackFridayCampaign(content(source)), /Choose three products/);
});

test("Black Friday delivery uses public Reef Ops assets, real unsubscribe, and scoped brand settings", () => {
  const previous = process.env.APP_BASE_URL;
  process.env.APP_BASE_URL = "https://dashboard.example";
  try {
    const source = template();
    const delivery = { id: "test", to: "staff@example.com", channel: "EMAIL", subject: "Preview", content: source, unsubscribe };
    const result = emailBody(delivery, "123 Reef Street", "Corals Anonymous");
    const document = new JSDOM(result.html).window.document;
    assert.ok(document.querySelector('img[src="https://dashboard.example/api/marketing/daily-deals-countdown"]'));
    assert.ok(document.querySelector('img[src^="https://dashboard.example/api/marketing/black-friday-assets/"]'));
    const unsubscribeLink = document.querySelector(`a[href="${unsubscribe}"]`);
    assert.ok(unsubscribeLink);
    assert.doesNotMatch(unsubscribeLink.closest("td")?.textContent ?? "", /on select items/i);
    const hero = document.querySelector('img[src$="/hero-v1.jpg"]');
    assert.match(hero?.closest("tr")?.nextElementSibling?.textContent ?? "", /\*On select items\./);
    const dailyPrices = Array.from(document.querySelectorAll(".bf-daily-prices"), (price) => price.textContent ?? "");
    assert.equal(dailyPrices.length, 3);
    assert.match(dailyPrices[1], /\$4\.99\s+\$29\.99/);
    for (const price of dailyPrices) assert.doesNotMatch(price, /\bfrom\b/i);
    const collectionText = Array.from(document.querySelectorAll(".bf-collection-item"), (card) => card.textContent).join(" ");
    assert.match(collectionText, /\$39\.99/);
    assert.doesNotMatch(collectionText, /\bfrom\s+\$/i);
    assert.doesNotMatch(result.text, /\bfrom\s+\$/i);
    assert.match(result.text, /Shop anemones: https:\/\/coralsanonymous\.com\/collections\/anemones/);
    assert.match(result.text, /midnight Pacific/);
    assert.doesNotMatch(result.text, /123 Reef Street/);
    const withAddress = emailBody({ ...delivery, content: { ...source, showPostalAddress: true } }, "123 Reef Street", "Corals Anonymous");
    assert.match(withAddress.html, /123 Reef Street/);
    assert.match(withAddress.text, /123 Reef Street/);
    assert.equal(result.attachments, undefined);
    assert.doesNotMatch(result.html, /data:image/);
    assert.equal(extractEmailBranding({ blackFriday: { logo: "ignore" } }).logo, undefined);
    assert.throws(() => runWithMarketingBrand("macroalgae-farms", () => emailBody(delivery, "", "Macroalgae Farms")), /for Corals Anonymous/);
  } finally {
    if (previous === undefined) delete process.env.APP_BASE_URL;
    else process.env.APP_BASE_URL = previous;
  }
});
