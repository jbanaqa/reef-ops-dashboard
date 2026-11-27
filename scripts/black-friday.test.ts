import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { blackFridayCampaignTemplate, blackFridayTodayCampaignTemplate, BLACK_FRIDAY_TODAY_DEADLINE, validateBlackFridayCampaign } from "../lib/marketing/black-friday";
import { MACRO_BLACK_FRIDAY_URL, macroBlackFridayCampaignTemplate } from "../lib/marketing/macro-black-friday";
import { runWithMarketingBrand } from "../lib/marketing/context";
import { emailBody } from "../lib/marketing/delivery";
import { content, extractEmailBranding, render } from "../lib/marketing/rules";

const unsubscribe = "https://unsubscribe.example/u";
const template = () => content(structuredClone(blackFridayCampaignTemplate.content));

test("Black Friday Today delivers the approved design, discounts, fixed timer and recipient unsubscribe", (t) => {
  const previous = process.env.APP_BASE_URL;
  process.env.APP_BASE_URL = "https://dashboard.example";
  t.after(() => {
    if (previous === undefined) delete process.env.APP_BASE_URL;
    else process.env.APP_BASE_URL = previous;
  });
  const source = content(structuredClone(blackFridayTodayCampaignTemplate.content));
  const original = source.blackFriday!.sections[0].products;
  const saved = content(JSON.parse(JSON.stringify({
    ...source,
    blackFriday: {
      ...source.blackFriday,
      sections: [{ ...source.blackFriday!.sections[0], products: [original[2], original[0], original[1]] }],
    },
  })));
  validateBlackFridayCampaign(saved);
  const message = emailBody({
    id: "test", to: "staff@example.com", channel: "EMAIL", subject: blackFridayTodayCampaignTemplate.subject,
    content: saved, unsubscribe: unsubscribe + "?token=recipient&other=1",
  }, "123 Reef Street", "Corals Anonymous");
  const document = new JSDOM(message.html).window.document;
  assert.equal(document.querySelector(".offer-mark")?.getAttribute("alt"), "Black Friday is today!");
  assert.equal(document.querySelector('meta[name="color-scheme"]')?.getAttribute("content"), "light only");
  assert.deepEqual(Array.from(document.querySelectorAll(".today-badge"), node => node.textContent), ["53% OFF", "80% OFF", "65% OFF"]);
  assert.deepEqual(Array.from(document.querySelectorAll(".pick-flag"), node => node.textContent), ["75% OFF", "85% OFF", "45% OFF"]);
  assert.deepEqual(Array.from(document.querySelectorAll(".pick-name"), node => node.textContent), [original[2].title, original[0].title, original[1].title]);
  assert.match(document.querySelector(".offer-mark")?.getAttribute("src") ?? "", /^https:\/\/.*\/today-headline-v1\.png$/);
  const timer = new URL(document.querySelector(".clock-img")!.getAttribute("src")!);
  assert.equal(timer.searchParams.get("deadline"), BLACK_FRIDAY_TODAY_DEADLINE);
  assert.equal(document.querySelector('a[href^="https://unsubscribe.example"]')?.getAttribute("href"), unsubscribe + "?token=recipient&other=1");
  assert.ok(message.text.includes("Unsubscribe: " + unsubscribe + "?token=recipient&other=1"));
  assert.ok(message.text.includes("123 Reef Street"));
  assert.match(document.querySelector(".stage")?.getAttribute("style") ?? "", /today-sunset-reef-v1\.jpg/);
  assert.ok(!document.querySelector(`a[href="${original[3].url}"]`));
});

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
    assert.match(dailyPrices[0], /\$8\.99\s+\$34\.99/);
    const blueberryPhoto = document.querySelector('img.bf-daily-image[alt="Blueberry Gorgonian"]');
    assert.equal(blueberryPhoto?.closest("a")?.querySelector(".bf-deal-badge")?.textContent, "74% OFF");
    assert.equal(new URL(blueberryPhoto?.closest("a")?.href ?? "").searchParams.get("variant"), "36321092993184");
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

test("Macroalgae Farms Black Friday keeps approved artwork and colors while publishing edited copy and product picks", () => {
  const source = structuredClone(macroBlackFridayCampaignTemplate.content);
  assert.equal(source.macroBlackFriday.featuredProducts.length, 2);
  assert.equal(source.macroBlackFriday.gridProducts.length, 8);
  source.macroBlackFriday.featuredProducts.reverse();
  source.macroBlackFriday.gridProducts.pop();
  const removed = macroBlackFridayCampaignTemplate.content.macroBlackFriday.gridProducts.at(-1)!;
  source.body = "Up to 50% OFF on qualifying orders. Try a coral & new macroalgae.";
  const saved = content(JSON.parse(JSON.stringify({
    ...source,
    heading: "Injected title",
    url: "https://example.com/other-sale",
    bodyHtml: "<em>Ignored rich-text override</em>",
  })));
  assert.equal(saved.heading, "Black Friday Sale");
  assert.equal(saved.url, MACRO_BLACK_FRIDAY_URL);
  assert.equal(saved.bodyHtml, undefined);
  const delivery = { id: "test", to: "staff@example.com", channel: "EMAIL", subject: "Preview", content: saved, unsubscribe };
  const previous = process.env.MACROALGAE_APP_BASE_URL;
  process.env.MACROALGAE_APP_BASE_URL = "https://dashboard.example";
  try {
    assert.throws(() => emailBody(delivery, "", "Corals Anonymous"), /for Macroalgae Farms/);
    const result = runWithMarketingBrand("macroalgae-farms", () => emailBody({
      ...delivery, branding: { showPostalAddress: true },
    }, "123 Reef Street", "Macroalgae Farms"));
    const document = new JSDOM(result.html).window.document;
    assert.equal(document.querySelector('meta[name="color-scheme"]')?.getAttribute("content"), "light only");
    assert.match(result.html, /https:\/\/dashboard\.example\/api\/marketing\/black-friday-assets\/macro-hero-v1\.jpg/);
    assert.match(result.html, /macro-headline-v1\.png/);
    assert.match(document.body.textContent || "", /Try a coral & new macroalgae\./);
    assert.match(result.text, /Try a coral & new macroalgae\./);
    assert.doesNotMatch(result.html, /example\.com\/other-sale|data:image|Ignored rich-text override/);
    assert.equal(document.querySelectorAll(`a[href="${MACRO_BLACK_FRIDAY_URL}"]`).length, 2);
    assert.ok(document.querySelector(`a[href="${unsubscribe}"]`));
    assert.ok(!Array.from(document.links).some(link => link.href === removed.url));
    assert.match(result.text, /123 Reef Street/);
    assert.equal(result.attachments, undefined);
    assert.ok(result.text.indexOf("Pink Rose Frogspawn") < result.text.indexOf("Cardinal Feather Macroalgae"));
  } finally {
    if (previous === undefined) delete process.env.MACROALGAE_APP_BASE_URL;
    else process.env.MACROALGAE_APP_BASE_URL = previous;
  }
});
