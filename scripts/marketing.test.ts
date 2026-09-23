import test from "node:test";
import assert from "node:assert/strict";
import { flowEmailTemplates } from "../lib/marketing/flow-email-templates";
import { cartEmail } from "../lib/marketing/cart-config";
import {
  welcomeDraft,
  welcomeSteps,
  defaultWelcome,
  upgradeWelcomeStep,
} from "../lib/marketing/welcome-config";

test("templates show each saved flow email without replacing saved copy", () => {
  const custom = {
    ...welcomeSteps[0],
    subject: "Our saved welcome subject",
    content: { ...welcomeSteps[0].content, hero: "data:image/png;base64,art" },
  };
  const resources = [
    { id: "welcome", key: "welcome", kind: "FLOW", data: { steps: [custom, ...welcomeSteps.slice(1)] } },
    { id: "cart", key: "abandoned-cart", kind: "FLOW", data: { steps: [{ ...custom }], orderBranch: { yes: { subject: "Past buyer", content: custom.content }, no: { subject: "Offer", content: custom.content } } } },
    { id: "stock", key: "low-stock", kind: "FLOW", data: { steps: [custom] } },
  ];
  const templates = flowEmailTemplates(resources);
  assert.equal(templates.length, 7);
  assert.equal(templates[0].subject, "Our saved welcome subject");
  assert.equal(templates[0].data.hero, custom.content.hero);
  assert.deepEqual(templates.slice(-2).map((template) => template.subject), ["Past buyer", "Offer"]);
  assert.ok(templates.every((template) => template.sourceFlow !== "low-stock"));
});
import {
  content,
  couponTimeLeft,
  defaultCampaignContent,
  defaultContent,
  defaultProductGridStyle,
  eligible,
  email,
  marketingSettings,
  matches,
  phone,
  render,
  safeUrl,
  segment,
  sharedEmailFooter,
  textBody,
  withCoupon,
  personalize,
} from "../lib/marketing/rules";

test("campaign sale layouts round-trip and render responsive email-safe sections", () => {
  const draft = structuredClone(defaultCampaignContent);
  draft.hero = "https://coralsanonymous.com/cdn/shop/files/sale.jpg";
  const first = draft.campaignLayout!.sections[0];
  assert.equal(first.type, "products");
  if (first.type !== "products") throw new Error("Expected product section");
  first.products.push({
    id: "preview-product",
    url: "https://coralsanonymous.com/products/red-white-coco-worm",
    image: "https://coralsanonymous.com/cdn/shop/files/coral.jpg",
    title: "Red and White Coco Worm",
    salePrice: "$40.00",
    compareAtPrice: "$79.99",
    imageWidth: 160,
  });
  const newest = draft.campaignLayout!.sections[3];
  if (newest.type !== "products") throw new Error("Expected newest product section");
  newest.products.push({
    id: "newest-preview-product",
    url: "https://coralsanonymous.com/products/newest-coral",
    image: "https://coralsanonymous.com/cdn/shop/files/newest-coral.jpg",
    title: "Newest grid marker",
    salePrice: "$25.00",
  });
  const saved = content(draft);
  assert.equal(saved.template, "campaign-sale");
  assert.equal(saved.campaignLayout?.sections.length, 6);
  assert.deepEqual(
    saved.campaignLayout?.sections.map((section) => section.id),
    [
      "sale-products",
      "new-discount-products",
      "shop-cta",
      "newest-products",
      "shop-app-banner",
      "shop-pay-banner",
    ],
  );
  assert.deepEqual(
    saved.campaignLayout?.sections
      .filter((section) => section.type === "products")
      .map((section) => section.feed && [
        section.feed.key,
        section.feed.tags,
        section.feed.order,
        section.feed.limit,
      ]),
    [
      ["anniversarysalesale", ["A50", "A55", "A60", "A65"], "random", 6],
      ["newnewdiscount", ["AW50", "AW55", "AW60", "AW65"], "newest", 12],
      ["newnew1", [], "newest", 12],
    ],
  );
  const html = render(saved, "https://example.com/unsubscribe", "123 Ocean Ave");
  assert.match(html, /reef-campaign-product/);
  assert.match(html, /Red and White Coco Worm/);
  assert.match(html, /text-decoration:line-through/);
  assert.match(html, /SHOP NOW!/);
  assert.match(html, /TAP\. SHOP\. DONE\./);
  assert.match(html, /Buy now, pay later with/);
  assert.ok(html.indexOf("SHOP NOW!") < html.indexOf("Newest grid marker"));
  assert.ok(html.indexOf("Newest grid marker") < html.indexOf("TAP. SHOP. DONE."));
  assert.match(html, /max-width:480px/);
  assert.match(
    html,
    /reef-campaign-product\{display:block!important;width:100%!important/,
  );
  assert.doesNotMatch(html, /reef-campaign-product img\{width:auto!important/);
  assert.match(html, /width:140px;max-width:100%/);
  assert.match(html, /123 Ocean Ave/);
});
test("campaign product grids preserve custom product counts and sort choices", () => {
  const draft = structuredClone(defaultCampaignContent);
  const section = draft.campaignLayout!.sections[0];
  if (section.type !== "products" || !section.feed)
    throw new Error("Expected a dynamic product grid");
  section.feed.limit = 18;
  section.feed.order = "best-selling";
  const saved = content(draft);
  const savedSection = saved.campaignLayout!.sections[0];
  assert.equal(savedSection.type, "products");
  if (savedSection.type !== "products") throw new Error("Expected product grid");
  assert.equal(savedSection.feed?.limit, 18);
  assert.equal(savedSection.feed?.order, "best-selling");
});
test("visual layouts can change without changing flow behavior or dynamic data", () => {
  const campaignLayout = structuredClone(defaultCampaignContent.campaignLayout!);
  campaignLayout.sections = [];
  const welcome = content({
    ...welcomeSteps[0].content,
    layout: "campaign-sale",
    campaignLayout,
    couponCode: "WELCOME-PERSONAL",
  });
  assert.equal(welcome.template, "welcome");
  assert.equal(welcome.layout, "campaign-sale");
  const saleHtml = render(welcome, "https://example.com/u", "123 Ocean Ave");
  assert.match(saleHtml, /WELCOME-PERSONAL/);
  assert.match(saleHtml, new RegExp(welcome.heading));

  const cartAsWelcome = content({
    ...defaultContent,
    template: "cart-recovery",
    layout: "welcome",
    products: [
      {
        title: "Customer cart coral",
        url: "https://coralsanonymous.com/cart",
        price: "$29.99",
      },
    ],
  });
  const welcomeHtml = render(
    cartAsWelcome,
    "https://example.com/u",
    "123 Ocean Ave",
  );
  assert.match(welcomeHtml, /Customer cart coral/);
  assert.equal(cartAsWelcome.template, "cart-recovery");
  assert.equal(cartAsWelcome.layout, "welcome");
});
import {
  defaultDeliveryUpsell,
  deliveryUpsellContent,
  deliveryDateFromTags,
  deliveryUpsellDueAt,
  deliveryUpsellDraft,
} from "../lib/marketing/delivery-upsell-config";
import {
  campaignAudience,
  resolvedAudienceMatches,
} from "../lib/marketing/campaign-audience";

test("campaign audiences combine included lists and segments with exclusions", () => {
  assert.deepEqual(
    campaignAudience({
      version: 2,
      includeKeys: ["mailable", "mailable", "klaviyo-list-vip"],
      excludeKeys: ["b2b", "mailable"],
    }),
    {
      version: 2,
      includeKeys: ["mailable", "klaviyo-list-vip"],
      excludeKeys: ["b2b"],
    },
  );
  const profile = {
    tags: ["customer"],
    lists: ["VIP"],
    lastOpenedAt: null,
    lastOrderAt: null,
  };
  assert.equal(
    resolvedAudienceMatches(profile, {
      config: { version: 2, includeKeys: ["vip"], excludeKeys: ["b2b"] },
      includes: [{ list: "VIP" }],
      excludes: [{ tag: "b2b" }],
      missingKeys: [],
    }),
    true,
  );
  assert.equal(
    resolvedAudienceMatches({ ...profile, tags: ["b2b"] }, {
      config: { version: 2, includeKeys: ["vip"], excludeKeys: ["b2b"] },
      includes: [{ list: "VIP" }],
      excludes: [{ tag: "b2b" }],
      missingKeys: [],
    }),
    false,
  );
});

test("delivery upsell accepts Shopify month tags and schedules across DST", () => {
  assert.deepEqual(deliveryDateFromTags(["VIP", "September 18 2026"]), {
    year: 2026,
    month: 9,
    day: 18,
  });
  assert.deepEqual(deliveryDateFromTags("Shipping 2026-11-03, wholesale"), {
    year: 2026,
    month: 11,
    day: 3,
  });
  assert.equal(
    deliveryDateFromTags(["September sale", "Ship February 30 2027"]),
    null,
  );
  assert.equal(
    deliveryUpsellDueAt(
      { year: 2026, month: 11, day: 3 },
      defaultDeliveryUpsell,
    ).toISOString(),
    "2026-11-01T16:00:00.000Z",
  );
});

test("delivery upsell upgrades only untouched scaffold copy", () => {
  const upgraded = deliveryUpsellDraft({
    reviewed: true,
    steps: [
      {
        minutes: 0,
        channel: "EMAIL",
        subject: "24 Hour Notice | Upsell",
        content: defaultContent,
      },
    ],
  });
  assert.equal(upgraded.reviewed, false);
  assert.equal(upgraded.delivery?.daysBefore, 2);
  assert.match(upgraded.steps[0].subject, /Last Chance/);
  assert.equal(
    upgraded.steps[0].content.url,
    "https://coralsanonymous.com/collections/new-arrivals",
  );
  const existing = deliveryUpsellDraft({
    reviewed: true,
    delivery: defaultDeliveryUpsell,
    steps: [
      {
        minutes: 0,
        channel: "EMAIL",
        subject: "Notice",
        content: {
          ...deliveryUpsellContent,
          heading: "Corals, you have 24 hours to add-on to your order.",
        },
      },
    ],
  });
  assert.equal(
    existing.steps[0].content.heading,
    '{{ first_name|default:"Aloha" }}, you have 24 hours to add-on to your order.',
  );
  assert.equal(existing.steps[0].content.introText, "");
  const personalized = render(
    existing.steps[0].content,
    "https://example.com/unsubscribe",
    "123 Valid Street",
    "Jaden Banawa",
  );
  assert.match(
    personalized,
    /Jaden, you have 24 hours/,
  );
  assert.equal(
    (personalized.match(/Your order is shipping out tomorrow at 8AM PST!/g) || [])
      .length,
    1,
  );
  assert.match(
    render(
      existing.steps[0].content,
      "https://example.com/unsubscribe",
      "123 Valid Street",
    ),
    /Aloha, you have 24 hours/,
  );
  const customized = structuredClone(existing);
  customized.steps[0].content.heading = "My custom notice";
  assert.equal(
    deliveryUpsellDraft(customized).steps[0].content.heading,
    "My custom notice",
  );
});

test("welcome schedule rejects offers after expiry and preserves customized drafts", async () => {
  const { validateFlow } = await import("../lib/marketing/flow-config");
  const f = { reviewed: false, steps: welcomeSteps, welcome: defaultWelcome };
  assert.equal(validateFlow("welcome", f).steps.length, 4);
  assert.throws(() =>
    validateFlow("welcome", {
      ...f,
      welcome: { ...defaultWelcome, couponDays: 10 },
    }),
  );
  assert.throws(() =>
    validateFlow("welcome", {
      ...f,
      steps: f.steps.map((s, i) => (i === 2 ? { ...s, minutes: 1440 } : s)),
    }),
  );
  assert.throws(() =>
    validateFlow("welcome", {
      ...f,
      welcome: { ...defaultWelcome, fallbackTimezone: "" },
    }),
  );
  assert.throws(() =>
    validateFlow("welcome", {
      ...f,
      welcome: { ...defaultWelcome, testEmail: "invalid" },
    }),
  );
  const old = {
    reviewed: true,
    steps: [
      {
        ...welcomeSteps[0],
        content: {
          ...defaultContent,
          body: "Keep my copy",
          hero: "https://example.com/hero.png",
        },
      },
    ],
  };
  const upgrade = welcomeDraft(old);
  assert.equal(upgrade.reviewed, false);
  assert.equal(upgrade.steps[0].content.body, "Keep my copy");
  assert.equal(upgrade.steps[0].content.hero, "https://example.com/hero.png");
  assert.equal(upgrade.steps.length, 4);
  const scaffold = welcomeDraft({ reviewed: false, steps: [{ minutes: 0, channel: "EMAIL", subject: "Welcome Series 08.2025", content: defaultContent }] });
  assert.equal(scaffold.steps[0].content.heading, "Thanks for signing up!");
  assert.equal(scaffold.steps[0].content.offerAboveBody, true);
  assert.equal(scaffold.steps[0].subject, welcomeSteps[0].subject);
});
test("welcome templates render the assigned offer, shared branding, date, and social links", () => {
  const c = {
    ...welcomeSteps[0].content,
    couponCode: "WELCOME10-EXAMPLE",
    couponExpiresAt: "2026-10-01T19:00:00Z",
  };
  const html = render(
    c,
    "https://example.com/unsubscribe",
    "Hidden address",
    "Jane Doe",
    "Corals Anonymous",
    { logo: "https://example.com/logo.png" },
  );
  assert.match(html, /welcome-hero-crisp.png/);
  assert.doesNotMatch(html, /example.com\/logo.png/);
  assert.match(html, /Aloha Jane/);
  assert.match(html, /<strong>Corals Anonymous!<\/strong>/);
  assert.match(html, /<strong>reefing\.<\/strong>/);
  assert.match(html, /WELCOME10-EXAMPLE/);
  assert.ok(
    html.indexOf("WELCOME10-EXAMPLE") < html.indexOf("Our story started"),
  );
  assert.doesNotMatch(html, /Hidden address/);
  const reminder = render(
    {
      ...welcomeSteps[2].content,
      couponCode: "WELCOME10-EXAMPLE",
      couponExpiresAt: c.couponExpiresAt,
    },
    "#unsubscribe",
    "",
  );
  assert.doesNotMatch(reminder, /\{\{ coupon_expires \}\}/);
  assert.match(reminder, /expire in \d+ days/);
  const social = render(welcomeSteps[3].content, "#unsubscribe", "");
  assert.match(social, /INSTAGRAM/);
  assert.match(social, /FACEBOOK/);
  assert.doesNotMatch(social, /Discount Code:/);
});
test("first welcome illustration is optional and the shared blue footer stays intact", () => {
  const branding = {
    footerConfigured: true,
    footerBackgroundColor: "#244b7b",
    footerTitle: "Thank you for your business ❤️",
  };
  const first = render(welcomeSteps[0].content, "#unsubscribe", "", undefined, "Corals Anonymous", branding);
  assert.match(first, /welcome-hero-crisp.png/);
  assert.match(first, /background:#244b7b/);
  assert.match(first, /Thank you for your business/);
  const plain = render({ ...welcomeSteps[0].content, showWelcomeIllustration: false }, "#unsubscribe", "");
  assert.doesNotMatch(plain, /welcome-hero-crisp.png/);
  const custom = render({ ...welcomeSteps[0].content, hero: "https://example.com/custom-hero.jpg" }, "#unsubscribe", "");
  assert.match(custom, /custom-hero.jpg/);
  assert.doesNotMatch(custom, /welcome-hero-crisp.png/);
});
test("welcome reminders match the compact banner and preserve personal offer details", () => {
  const branding = { footerConfigured: true, footerBackgroundColor: "#244b7b", footerTitle: "Thank you for your business ❤️" };
  const code = "NEWSLETTER10-TEST";
  const reminder = render({ ...welcomeSteps[1].content, couponCode: code }, "#unsubscribe", "", undefined, "Corals Anonymous", branding);
  assert.match(reminder, /welcome-reminder-banner.png/);
  assert.match(reminder, /Claim Your 10% OFF Discount Now!/);
  assert.match(reminder, /Discount Code:/);
  assert.match(reminder, /NEWSLETTER10-TEST/);
  assert.match(reminder, /welcome-image-placeholder.png/);
  assert.match(reminder, /Use my 10% OFF code now!/);
  assert.match(reminder, /Thank you for your business/);
  assert.doesNotMatch(reminder, /Your first order is waiting/);

  assert.equal(couponTimeLeft("2026-10-01T12:00:00Z", new Date("2026-09-24T12:00:00Z")), "7 days");
  assert.equal(couponTimeLeft("2026-10-01T12:00:00Z", new Date("2026-09-30T12:00:00Z")), "1 day");
  const final = render({ ...welcomeSteps[2].content, couponCode: code, couponExpiresAt: new Date(Date.now() + 4 * 86400000).toISOString() }, "#unsubscribe", "", undefined, "Corals Anonymous", branding);
  assert.match(final, /expire in 4 days/);
  assert.match(final, /color:#d64f23/);
  assert.doesNotMatch(final, /welcome-image-placeholder.png/);
  assert.match(final, /background:#244b7b/);

  const saved = upgradeWelcomeStep({ ...welcomeSteps[1].content, body: "My custom reminder", welcomeVariant: undefined }, 1);
  assert.equal(saved.body, "My custom reminder");
  assert.equal(saved.welcomeVariant, "reminder");
  const customized = render({ ...saved, couponCode: code, welcomeHeroText: "My custom banner", showWelcomeFeaturePanel: false }, "#unsubscribe", "");
  assert.match(customized, /My custom banner/);
  assert.match(customized, /My custom reminder/);
  assert.doesNotMatch(customized, /welcome-image-placeholder.png/);
  const artwork = render({ ...saved, couponCode: code, hero: "https://example.com/my-banner.png", welcomeFeatureImage: "https://example.com/my-offer.png" }, "#unsubscribe", "");
  assert.match(artwork, /my-banner.png/);
  assert.match(artwork, /my-offer.png/);
  assert.match(artwork, /reef-reminder-offer/);
});
test("suppression always overrides subscribed status", () => {
  assert.equal(eligible({ status: "SUBSCRIBED", suppressed: true }), false);
  assert.equal(eligible({ status: "SUBSCRIBED", suppressed: false }), true);
  assert.equal(
    eligible({ status: "NEVER_SUBSCRIBED", suppressed: false }),
    false,
  );
  assert.equal(eligible(null), false);
});
test("audited mailable segment has exact 365-day boundary and rejects future opens", () => {
  const now = new Date("2026-09-07T12:00:00Z"),
    boundary = new Date(+now - 365 * 86400000);
  const p = { tags: [], lists: [], lastOpenedAt: boundary, lastOrderAt: null };
  assert.equal(matches(p, { openedDays: 365 }, now), true);
  assert.equal(
    matches(
      { ...p, lastOpenedAt: new Date(+boundary - 1) },
      { openedDays: 365 },
      now,
    ),
    false,
  );
  assert.equal(
    matches({ ...p, lastOpenedAt: null }, { openedDays: 365 }, now),
    false,
  );
  assert.equal(
    matches(
      { ...p, lastOpenedAt: new Date(+now + 1) },
      { openedDays: 365 },
      now,
    ),
    false,
  );
});
test("audiences intersect list/tag filters and exclude recent purchases", () => {
  const now = new Date(),
    p = { tags: ["b2b"], lists: ["VIP"], lastOpenedAt: now, lastOrderAt: now };
  assert.equal(matches(p, { tag: "b2b", list: "VIP" }, now), true);
  assert.equal(matches(p, { tag: "b2b", excludePurchasedDays: 7 }, now), false);
  assert.equal(
    matches({ ...p, lastOrderAt: null }, { excludePurchasedDays: 7 }, now),
    true,
  );
});
test("normalization preserves phone country codes and rejects malformed identities", () => {
  assert.equal(email(" Person@Example.com "), "person@example.com");
  assert.equal(phone("+1 (555) 123-4567"), "+15551234567");
  assert.throws(() => phone("5551234567"));
  assert.throws(() => email("x\n@example.com"));
});
test("templates escape hostile content and reject unsafe link schemes", () => {
  const html = render(
    {
      ...defaultContent,
      showPostalAddress: true,
      heading: '<script>alert("x")</script>',
    },
    "https://example.com/unsubscribe",
    "123 Main Street",
  );
  assert.ok(!html.includes("<script>"));
  assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(html.includes("123 Main Street"));
  assert.ok(html.includes("unsubscribe"));
  assert.throws(() => safeUrl("javascript:alert(1)"));
  assert.throws(() => safeUrl("https://user:password@example.com"));
  assert.throws(() =>
    content({ ...defaultContent, hero: "data:image/svg+xml,xxx" }),
  );
});
test("cart recovery renders adjustable campaign-style product cards", () => {
  const html = render(
    content({
      ...defaultContent,
      template: "cart-recovery",
      heading: "Aloha Friend",
      body: "Your corals are waiting.",
      hero: "https://cdn.example.com/cart-art.jpg",
      productGridStyle: {
        ...defaultProductGridStyle,
        productImageWidth: 105,
        buttonLabel: "View coral",
      },
      products: [
        {
          title: "Blue coral",
          url: "https://coralsanonymous.com/products/blue",
          image: "https://cdn.example.com/blue.jpg",
          price: "USD 24.00",
          compareAtPrice: "USD 48.00",
        },
        {
          title: "Red coral",
          url: "https://coralsanonymous.com/products/red",
          image: "https://cdn.example.com/red.jpg",
          price: "USD 18.00",
        },
        {
          title: "Green coral",
          url: "https://coralsanonymous.com/products/green",
          price: "USD 12.00",
        },
      ],
    }),
    "https://coralsanonymous.com/unsubscribe",
    "",
  );
  assert.match(html, /class="reef-cart-products"/);
  assert.match(html, /class="reef-product-card reef-cart-product"/);
  assert.match(html, /reef-cart-product\{display:block!important;width:100%!important/);
  assert.equal((html.match(/width="50%"/g) || []).length, 4);
  assert.match(html, /width="105"/);
  assert.match(html, />View coral<\/a>/);
  assert.match(html, /text-decoration:line-through">USD 48\.00/);
  assert.match(html, /background="https:\/\/cdn\.example\.com\/cart-art\.jpg"/);
  assert.match(html, /Blue coral/);
  assert.doesNotMatch(html, /Product image/);
});
test("shared branding fills missing email artwork and footer metadata", () => {
  const html = render(
    content({
      ...defaultContent,
      template: "cart-recovery",
      products: [],
    }),
    "https://coralsanonymous.com/unsubscribe",
    "",
    undefined,
    "Example Co",
    {
      logo: "https://cdn.example.com/logo.png",
      instagramUrl: "https://instagram.com/example",
      facebookUrl: "https://facebook.com/example",
      instagramIcon: "https://cdn.example.com/instagram.png",
      facebookIcon: "https://cdn.example.com/facebook.png",
    },
  );
  assert.match(html, /cdn\.example\.com\/logo\.png/);
  assert.match(html, /Follow Us/);
  assert.match(html, /instagram\.com\/example/);
  assert.match(html, /facebook\.com\/example/);
  assert.match(html, /cdn\.example\.com\/instagram\.png/);
  assert.match(html, /cdn\.example\.com\/facebook\.png/);
  assert.match(html, /All rights reserved/);
});
test("segment window validation rejects NaN, fractions, and negative windows", () => {
  for (const v of [NaN, 0, -1, 2.5, Infinity, 3651])
    assert.throws(() => segment({ openedDays: v }));
  assert.deepEqual(segment({ tag: "B2B", openedDays: 365 }), {
    tag: "b2b",
    openedDays: 365,
  });
});
test("B2B HTML copy is sanitized and preserves explicit HTTPS links", () => {
  const c = content({
    ...defaultContent,
    template: "b2b-wholesale",
    body: 'Hi {{ first_name|default:"Friend!" }}!\n\nCopy',
    bodyHtml:
      '<p><strong>Sale</strong> {{ first_name|default:"Friend!" }} <a href="https://coralsanonymous.com/sale">shop</a><script>alert(1)</script><a href="javascript:bad">bad</a></p>',
    logo: "data:image/png;base64,abc",
    logoScale: 1.5,
    footerImage: "data:image/png;base64,abc",
    footerScale: 0.9,
  });
  assert.ok(c.bodyHtml?.includes("<strong>Sale</strong>"));
  assert.ok(!c.bodyHtml?.includes("script"));
  assert.ok(!c.bodyHtml?.includes("javascript"));
  const html = render(
    c,
    "https://example.com/unsubscribe",
    "123 Main Street",
    "Jane Doe",
    "Example Co",
  );
  assert.ok(html.includes("width:390px"));
  assert.ok(html.includes("width:504px"));
  assert.ok(html.includes('href="https://coralsanonymous.com/sale"'));
  assert.ok(html.includes('href="https://example.com/unsubscribe"'));
  assert.ok(html.includes("Jane"));
});
test("B2B welcome compacts rich-editor paragraphs without changing authored spacing", () => {
  const html = render(
    {
      ...defaultContent,
      template: "b2b-wholesale",
      body: "Hi Friend!\n\nWelcome",
      bodyHtml:
        '<p>Welcome to wholesale.</p><p><br></p><p>- First benefit</p><p>- Second benefit</p><p style="margin:24px 0">Custom spacing</p>',
    },
    "https://example.com/unsubscribe",
    "",
  );
  assert.match(html, /<p style="margin:0 0 10px;line-height:1\.45">- First benefit<\/p>/);
  assert.match(html, /<p style="margin:0 0 10px;line-height:1\.45">- Second benefit<\/p>/);
  assert.doesNotMatch(html, /<p><br><\/p>/);
  assert.match(html, /<p style="margin:24px 0;?">Custom spacing<\/p>/);
});
test("B2B full-layout HTML does not duplicate the heading or greeting", () => {
  const c = content({
    ...defaultContent,
    template: "b2b-wholesale",
    body: 'Hi {{ first_name|default:"Friend!" }}!\n\nCopy',
    bodyHtml:
      '<h1>Welcome to Corals Anonymous<br>Wholesale!</h1><p>Hi {{ first_name|default:"Friend!" }}!</p><p>Copy</p>',
  });
  const html = render(c, "https://example.com/unsubscribe", "", "Jane Doe");
  assert.equal((html.match(/Welcome to Corals Anonymous/g) || []).length, 1);
  assert.equal((html.match(/Hi Jane/g) || []).length, 1);
});
test("B2B styled h1 HTML survives sanitization and rendering", () => {
  const headingStyle =
    "margin:0 0 45px;text-align:center;font-size:27px;line-height:1.15;";
  const c = content({
    ...defaultContent,
    template: "b2b-wholesale",
    body: 'Hi {{ first_name|default:"Friend!" }}!\n\nCopy',
    bodyHtml: `<h1 style="${headingStyle}">Welcome to Corals Anonymous<br>Wholesale!</h1><p>Copy</p>`,
  });
  assert.match(
    c.bodyHtml || "",
    /<h1 style="[^"]*margin:\s*0 0 45px;[^"]*text-align:\s*center;/,
  );
  const html = render(c, "https://example.com/unsubscribe", "");
  assert.match(html, /<h1 style="[^"]*font-size:\s*27px;/);
});
test("marketing settings preserve database operational controls", () => {
  const settings = marketingSettings({
    postalAddress: "123 Main Street",
    organizationName: "Corals Anonymous",
    operations: {
      sendingEnabled: false,
      migrationConfirmed: true,
      ingestEnabled: false,
      formEnabled: true,
    },
  });
  assert.deepEqual(settings.operations, {
    sendingEnabled: false,
    migrationConfirmed: true,
    ingestEnabled: false,
    formEnabled: true,
  });
  assert.equal(settings.popupDismissalDays, 7);
  assert.equal(settings.popupDelaySeconds, 10);
  assert.equal(marketingSettings({ popupDismissalDays: 0 }).popupDismissalDays, 0);
  assert.equal(marketingSettings({ popupDismissalDays: 31 }).popupDismissalDays, 7);
  assert.equal(marketingSettings({ popupDelaySeconds: 0 }).popupDelaySeconds, 0);
  assert.equal(marketingSettings({ popupDelaySeconds: 45 }).popupDelaySeconds, 45);
  assert.equal(marketingSettings({ popupDelaySeconds: 301 }).popupDelaySeconds, 10);
});

import { validateFlow, flowSequence } from "../lib/marketing/flow-config";
import {
  confirmationHash,
  newConfirmation,
} from "../lib/marketing/confirmation";
test("public-looking session IDs are not email secrets", () => {
  assert.throws(() => confirmationHash("10000000-0000-4000-8000-000000000001"));
  const proof = newConfirmation();
  assert.equal(proof.hash, confirmationHash(proof.token));
  assert.notEqual(proof.hash, proof.token);
});
test("HTML coupon and product content reaches both output formats", () => {
  const c = withCoupon(
    {
      ...defaultContent,
      bodyHtml: "<p>Edited copy</p>",
      products: [
        {
          title: "Unique coral",
          url: "https://example.com/coral",
          price: "29 USD",
        },
      ],
    },
    "FIRST10",
  );
  const html = render(c, "https://example.com/u", "Address");
  assert.match(html, /FIRST10/);
  assert.match(html, /Unique coral/);
  assert.match(textBody(c), /Edited copy[\s\S]*FIRST10/);
});
test("personalization stays text even with HTML and replacement metacharacters", () => {
  const c = content({
    ...defaultContent,
    template: "b2b-wholesale",
    bodyHtml: '<p>Hi {{ first_name|default:"Friend" }}</p>',
  });
  const html = render(
    c,
    "https://example.com/u",
    "Address",
    "<img/src=x/onerror=alert(1)>",
  );
  assert.ok(!html.includes("<img/src=x"));
  assert.match(html, /&lt;img/);
  assert.equal(personalize('{{ first_name|default:"Friend" }}', "$&"), "$&");
});
test("all branch content is validated and only the no-purchase branch is executable", () => {
  const step = {
    minutes: 180,
    subject: "First",
    channel: "EMAIL",
    content: defaultContent,
  };
  assert.throws(() =>
    validateFlow("abandoned-cart", {
      steps: [step],
      orderBranch: {
        yes: {
          subject: "Yes",
          content: { ...defaultContent, url: "javascript:bad" },
        },
        no: { subject: "No", content: defaultContent },
      },
    }),
  );
  const f = validateFlow("abandoned-cart", {
    steps: [step],
    smsContent: defaultContent,
    orderBranch: {
      yes: { subject: "Unused", content: defaultContent },
      no: { subject: "Offer", content: defaultContent },
    },
  });
  assert.deepEqual(
    flowSequence("abandoned-cart", f).map((s) => s.minutes),
    [30, 180, 1440],
  );
  assert.ok(
    !flowSequence("abandoned-cart", f).some((s) => s.subject === "Unused"),
  );
});
test("encoded unsafe links and executable styles are stripped", () => {
  const c = content({
    ...defaultContent,
    bodyHtml:
      '<p onclick="bad()" style="background:url(javascript:bad)"><a href="jav&#x61;script:bad">X</a><script>bad()</script></p>',
  });
  assert.ok(!c.bodyHtml?.includes("javascript:"));
  assert.ok(!c.bodyHtml?.includes("onclick"));
  assert.ok(!c.bodyHtml?.includes("<script"));
});

import { emailBody } from "../lib/marketing/delivery";
test("campaign sale plain-text fallback includes products and section links", () => {
  const campaign = structuredClone(defaultCampaignContent);
  const section = campaign.campaignLayout!.sections[0];
  if (section.type !== "products") throw new Error("Expected product section");
  section.products.push({
    id: "featured",
    title: "Featured coral",
    url: "https://coralsanonymous.com/products/featured",
    salePrice: "$0.00",
    compareAtPrice: "$0.00",
  });
  const payload = emailBody(
    {
      id: "campaign",
      channel: "EMAIL",
      subject: "Sale",
      to: "test@example.com",
      unsubscribe: "https://example.com/u",
      content: campaign,
    },
    "123 Ocean Ave",
    "Corals Anonymous",
  );
  assert.match(payload.text, /Featured coral · \$0\.00 · Was \$0\.00/);
  assert.match(payload.text, /SHOP NOW!: https:\/\/coralsanonymous\.com/);
});
test("cart recovery uses the editable ocean hero and a separate aqua button band", () => {
  const first = cartEmail("first").content;
  const html = render(first, "https://example.com/unsubscribe", "");
  assert.match(html, /background="https:\/\/reef-ops-dashboard-production\.up\.railway\.app\/cart-ocean-texture\.jpg"/);
  assert.match(html, /width="400" style="width:100%;max-width:400px/);
  assert.match(html, /reef-cart-message/);
  assert.match(html, /padding:9px 20px 43px;background:#95dce5/);
  assert.match(html, /width:234px;background:#ffffff;border-radius:28px/);

  const customized = render(
    { ...first, hero: "https://cdn.example.com/custom-ocean.jpg", cartHeroTextSize: 36,
      cartHeroBandColor: "#76c9dd", cartHeroButtonWidth: 280 },
    "https://example.com/unsubscribe",
    "",
  );
  assert.match(customized, /background="https:\/\/cdn\.example\.com\/custom-ocean\.jpg"/);
  assert.match(customized, /font-size:36px/);
  assert.match(customized, /padding:9px 20px 43px;background:#76c9dd/);
  assert.match(customized, /width:280px;background:#ffffff/);
  const plain = render(
    { ...first, showCartOceanTexture: false },
    "https://example.com/unsubscribe",
    "",
  );
  assert.doesNotMatch(plain, /cart-ocean-texture\.jpg/);
});
test("uploaded artwork becomes inline email attachments", () => {
  const payload = emailBody(
    {
      id: "test",
      channel: "EMAIL",
      subject: "Subject",
      to: "test@example.com",
      unsubscribe: "https://example.com/u",
      content: {
        ...defaultContent,
        template: "b2b-wholesale",
        logo: "data:image/png;base64,YWJj",
        instagramUrl: "https://instagram.com/example",
        instagramIcon: "data:image/png;base64,ZGVm",
      },
    },
    "Address",
    "Company",
  );
  assert.match(payload.html, /src="cid:marketing-logo"/);
  assert.match(payload.html, /src="cid:marketing-instagramIcon"/);
  assert.ok(!payload.html.includes("data:image"));
  assert.equal(payload.attachments?.[0].content, "YWJj");
  assert.equal(payload.attachments?.[1].content, "ZGVm");
  const reminder = emailBody(
    {
      id: "welcome-artwork",
      channel: "EMAIL",
      subject: "Reminder",
      to: "test@example.com",
      unsubscribe: "https://example.com/u",
      content: { ...welcomeSteps[1].content, couponCode: "CODE", welcomeFeatureImage: "data:image/png;base64,YWJj" },
    },
    "Address",
    "Company",
  );
  assert.match(reminder.html, /src="cid:marketing-welcomeFeatureImage"/);
  assert.equal(reminder.attachments?.[0].content, "YWJj");
});

test("clearing HTML copy does not resurrect the previous plain-text message", () => {
  for (const template of ["standard", "b2b-wholesale"] as const) {
    const cleared = content({
      ...defaultContent,
      template,
      body: "Greeting\n\nOLD_COPY_MUST_NOT_RETURN",
      bodyHtml: "",
    });
    assert.equal(cleared.bodyHtml, "");
    assert.equal(textBody(cleared), "");
    assert.doesNotMatch(
      render(cleared, "https://example.com/unsubscribe", "Address"),
      /OLD_COPY_MUST_NOT_RETURN/,
    );
  }
});

test("custom footer survives normalization and renders safely in both email formats", () => {
  for (const template of ["b2b-wholesale", "standard"] as const) {
    const c = content({
      ...defaultContent,
      template,
      showPostalAddress: true,
      footerTitle: "Thanks <team>",
      footerText: "Contact our wholesale team.\nWe are here to help.",
      footerUnsubscribeText: "Change your email preferences:",
      footerImage: "data:image/png;base64,YWJj",
    });
    const result = emailBody(
      {
        id: "footer-test",
        to: "test@example.com",
        channel: "EMAIL",
        subject: "Test",
        content: c,
        unsubscribe: "https://example.com/unsubscribe?token=test",
      },
      "123 Valid Street",
      "Company Name",
    );
    assert.match(result.html, /Thanks &lt;team&gt;/);
    assert.match(
      result.html,
      /Contact our wholesale team\.<br>We are here to help\./,
    );
    assert.match(result.text, /Thanks <team>/);
    assert.match(result.text, /We are here to help/);
    assert.match(result.html, /Change your email preferences:/);
    assert.match(result.html, /123 Valid Street/);
    assert.match(
      result.html,
      /href="https:\/\/example.com\/unsubscribe\?token=test"/,
    );
  }
});
test("every email layout uses the editable copyright footer controls", () => {
  const layouts = [
    content({
      ...defaultContent,
      template: "standard",
      footerCopyrightText: "© {{ year }} {{ organization }} · Reef Team",
    }),
    content({
      ...defaultContent,
      template: "b2b-wholesale",
      footerCopyrightText: "© {{ year }} {{ organization }} · Reef Team",
    }),
    content({
      ...defaultContent,
      template: "cart-recovery",
      footerCopyrightText: "© {{ year }} {{ organization }} · Reef Team",
    }),
    content({
      ...defaultContent,
      template: "welcome",
      footerCopyrightText: "© {{ year }} {{ organization }} · Reef Team",
    }),
    content({
      ...defaultCampaignContent,
      footerTitle: "Campaign footer",
      footerCopyrightText: "© {{ year }} {{ organization }} · Reef Team",
    }),
  ];
  for (const c of layouts) {
    const html = render(
      c,
      "https://example.com/unsubscribe",
      "123 Valid Street",
      undefined,
      "Company Name",
    );
    assert.match(
      html,
      new RegExp(`© ${new Date().getFullYear()} Company Name · Reef Team`),
    );
  }
  assert.match(
    render(
      layouts.at(-1)!,
      "https://example.com/unsubscribe",
      "123 Valid Street",
      undefined,
      "Company Name",
    ),
    /Campaign footer/,
  );
  const hidden = render(
    content({
      ...defaultCampaignContent,
      showFooterCopyright: false,
    }),
    "https://example.com/unsubscribe",
    "123 Valid Street",
    undefined,
    "Company Name",
  );
  assert.doesNotMatch(hidden, /All rights reserved/);
});
test("every email layout uses the universal editable footer background", () => {
  const layouts = [
    [content({ ...defaultContent, template: "standard" }), "#ffffff"],
    [content({ ...defaultContent, template: "b2b-wholesale" }), "#244b7b"],
    [content({ ...defaultContent, template: "cart-recovery" }), "#8bd8e2"],
    [content({ ...welcomeSteps[0].content }), "#f7f7f7"],
    [content({ ...welcomeSteps[3].content }), "#f7f7f7"],
    [content({ ...defaultCampaignContent }), "#050505"],
  ] as const;
  for (const [item, expected] of layouts)
    assert.match(
      render(item, "https://example.com/unsubscribe", ""),
      new RegExp(`background:${expected}`),
    );
  for (const [item] of layouts) {
    const customized = content({
      ...item,
      footerBackgroundColor: "#123456",
    });
    assert.equal(customized.footerBackgroundColor, "#123456");
    assert.match(
      render(customized, "https://example.com/unsubscribe", ""),
      /background:#123456/,
    );
  }
});
test("one shared footer overrides every email layout consistently", () => {
  const branding = sharedEmailFooter({
    ...defaultContent,
    template: "b2b-wholesale",
    footerBackgroundColor: "#123456",
    footerTextColor: "#fefefe",
    footerTitle: "One footer everywhere",
    footerText: "Shared customer support message",
    footerSocialHeading: "Follow the reef",
    footerUnsubscribeText: "Change your preferences?",
    footerUnsubscribeLinkText: "Manage email",
    footerCopyrightText: "© {{ year }} {{ organization }}",
    showPostalAddress: true,
    showFooterSocial: false,
  });
  const layouts = [
    content({ ...defaultContent, template: "standard", footerTitle: "Old standard" }),
    content({ ...defaultContent, template: "welcome", footerTitle: "Old welcome" }),
    content({ ...defaultContent, template: "cart-recovery", footerTitle: "Old cart" }),
    content({ ...defaultContent, template: "b2b-wholesale", footerTitle: "Old B2B" }),
    content({
      ...defaultCampaignContent,
      footerTitle: "Old campaign",
    }),
  ];
  const footers = layouts.map((layout) => {
    const html = render(
      layout,
      "https://example.com/unsubscribe",
      "123 Reef Lane",
      undefined,
      "Corals Anonymous",
      branding,
    );
    const footer = html.match(
      /<tr><td class="reef-email-footer"[\s\S]*?<\/td><\/tr>/,
    )?.[0];
    assert.ok(footer);
    assert.match(footer, /One footer everywhere/);
    assert.doesNotMatch(footer, /Old standard|Old welcome|Old cart|Old B2B|Old campaign/);
    return footer;
  });
  assert.equal(new Set(footers).size, 1);
});
test("social media can be hidden from every footer without deleting its settings", () => {
  const layouts = [
    content({ ...defaultContent, template: "standard" }),
    content({ ...defaultContent, template: "b2b-wholesale" }),
    content({ ...defaultContent, template: "cart-recovery" }),
    content({ ...welcomeSteps[0].content }),
    content({ ...welcomeSteps[3].content }),
    content({ ...defaultCampaignContent }),
  ];
  for (const layout of layouts) {
    const hidden = content({
      ...layout,
      showFooterSocial: false,
      footerSocialHeading: "Footer links sentinel",
      instagramUrl: "https://www.instagram.com/coralsanonymous/",
      facebookUrl: "https://www.facebook.com/coralsanonymousshop/",
    });
    assert.equal(hidden.showFooterSocial, false);
    assert.equal(
      hidden.instagramUrl,
      "https://www.instagram.com/coralsanonymous/",
    );
    const html = render(hidden, "https://example.com/unsubscribe", "");
    assert.doesNotMatch(html, /Footer links sentinel/);
    assert.doesNotMatch(html, /aria-label="(?:Instagram|Facebook)"/);
  }
});
test("generated welcome, coupon, social, and unsubscribe copy is editable", () => {
  const offer = render(
    content({
      ...welcomeSteps[0].content,
      couponCode: "TEST10",
      couponExpiresAt: "2026-10-01T19:00:00.000Z",
      couponLabel: "Your reef offer",
      couponTerms: "Custom offer terms",
      couponExpiryText: "Use it before {{ coupon_expires }}",
      welcomeHeroGreeting: '{{ first_name|default:"Aloha" }}!',
      welcomeHeroText: "Custom welcome banner",
      footerUnsubscribeLinkText: "Manage email preferences",
    }),
    "https://example.com/unsubscribe",
    "123 Valid Street",
    "Jaden Banawa",
  );
  assert.match(offer, /Your reef offer/);
  assert.match(offer, /Custom offer terms/);
  assert.match(offer, /Use it before/);
  assert.match(offer, /Jaden!/);
  assert.match(offer, /Custom welcome banner/);
  assert.match(offer, /Manage email preferences/);

  const social = render(
    content({
      ...welcomeSteps[3].content,
      socialFollowText: "Find us here",
      instagramHeading: "Photo reef",
      instagramHandle: "@customreef",
      instagramText: "Custom Instagram copy",
      facebookHeading: "Reef community",
      facebookHandle: "@customcommunity",
      facebookText: "Custom Facebook copy",
    }),
    "https://example.com/unsubscribe",
    "123 Valid Street",
  );
  for (const expected of [
    "Find us here",
    "Photo reef",
    "@customreef",
    "Custom Instagram copy",
    "Reef community",
    "@customcommunity",
    "Custom Facebook copy",
  ])
    assert.match(social, new RegExp(expected));
});
test("rendered layouts do not reintroduce hidden or duplicated customer copy", () => {
  const unsubscribe = "https://example.com/unsubscribe";
  const organization = "Reef Operations";
  const shared = {
    footerSocialHeading: "Connect with Reef Operations",
    footerUnsubscribeText: "Custom preference introduction",
    instagramUrl: "https://www.instagram.com/coralsanonymous/",
  };
  const layouts = [
    content({ ...defaultContent, ...shared, template: "standard" }),
    content({
      ...defaultContent,
      ...shared,
      template: "b2b-wholesale",
      introText: "Custom introduction",
    }),
    content({ ...defaultContent, ...shared, template: "cart-recovery" }),
    content({ ...welcomeSteps[0].content, ...shared }),
    content({ ...welcomeSteps[3].content, ...shared }),
    content({
      ...defaultCampaignContent,
      ...shared,
      footerSocialHeading: "Campaign connections",
    }),
  ];
  for (const item of layouts) {
    const html = render(
      item,
      unsubscribe,
      "123 Valid Street",
      "Jaden Banawa",
      organization,
    );
    assert.match(html, /Custom preference introduction/);
    assert.doesNotMatch(html, /No longer want to receive these emails\?/);
  }
  for (const item of layouts.slice(0, 5))
    assert.match(
      render(item, unsubscribe, "", undefined, organization),
      /Connect with Reef Operations/,
    );
  assert.match(
    render(layouts[5], unsubscribe, "", undefined, organization),
    /Campaign connections/,
  );
  const standard = render(layouts[0], unsubscribe, "", undefined, organization);
  assert.match(standard, />REEF OPERATIONS<\/td>/);
  assert.doesNotMatch(standard, />CORALS ANONYMOUS<\/td>/);

  const blank = content({
    ...welcomeSteps[0].content,
    button: "",
    welcomeHeroGreeting: "",
    welcomeHeroText: "",
    footerSocialHeading: "",
    footerUnsubscribeText: "",
  });
  const blankHtml = render(blank, unsubscribe, "", "Jaden Banawa");
  assert.equal(blank.button, "");
  assert.doesNotMatch(blankHtml, /Thank you for subscribing|Save 10% off|Follow Us|No longer want/);

  const cart = render(
    content({
      ...defaultContent,
      template: "cart-recovery",
      products: [
        { title: "One visible coral title", url: "https://example.com/coral" },
      ],
    }),
    unsubscribe,
    "",
  );
  assert.equal((cart.match(/One visible coral title/g) || []).length, 1);

  const campaign = structuredClone(defaultCampaignContent);
  const productSection = campaign.campaignLayout!.sections.find(
    (section) => section.type === "products",
  );
  if (!productSection || productSection.type !== "products")
    throw new Error("Expected campaign product grid");
  productSection.products = [
    {
      id: "single-title",
      title: "One campaign coral title",
      url: "https://example.com/campaign-coral",
    },
  ];
  const campaignHtml = render(content(campaign), unsubscribe, "");
  assert.equal((campaignHtml.match(/One campaign coral title/g) || []).length, 1);
});
test("cleared footer copy keeps the unsubscribe link and mailing address", () => {
  const html = render(
    content({
      ...defaultContent,
      template: "b2b-wholesale",
      showPostalAddress: true,
      footerTitle: "",
      footerText: "",
      footerUnsubscribeText: "",
    }),
    "https://example.com/unsubscribe",
    "123 Valid Street",
  );
  assert.doesNotMatch(html, /Thank you for your business/);
  assert.match(html, /Unsubscribe<\/a>/);
  assert.match(html, /123 Valid Street/);
});

import {
  defaultStockConfig,
  stockCopy,
  stockMessageContent,
  stockQuietHours,
  validateStock,
} from "../lib/marketing/stock-config";

test("stock config validates recipient, threshold, channels, templates and quiet hours", () => {
  const s = { ...defaultStockConfig, smsConsentConfirmed: true };
  assert.equal(validateStock(s, true).recipientPhone, "+16573450924");
  assert.throws(() => validateStock({ ...s, threshold: 0 }));
  assert.throws(() => validateStock({ ...s, threshold: 4.5 }));
  assert.throws(
    () => validateStock({ ...s, smsConsentConfirmed: false }, true),
    /permission/,
  );
  assert.throws(
    () => validateStock({ ...s, timezone: "unknown" }, true),
    /timezone/,
  );
  assert.throws(
    () => validateStock({ ...s, collectionId: "5 OR product:*" }),
    /collection/,
  );
  assert.throws(
    () => validateStock({ ...s, smsBody: "{{ unknown }}" }),
    /Unknown/,
  );
  const flow = validateFlow("low-stock", { reviewed: true, stock: s });
  assert.deepEqual(
    flow.steps.map((x) => x.channel),
    ["EMAIL", "SMS_TRANSACTIONAL"],
  );
  assert.equal(
    stockCopy("{{ ProductTitle }} has {{ InventoryQuantity }}", {
      ProductTitle: "A & B",
      VariantTitle: "Small",
      InventoryQuantity: "4",
      ProductURL: "https://example.com",
    }),
    "A & B has 4",
  );
  assert.equal(
    stockQuietHours("America/Los_Angeles", new Date("2026-09-09T17:59:00Z")),
    true,
  );
  assert.equal(
    stockQuietHours("America/Los_Angeles", new Date("2026-09-09T18:00:00Z")),
    false,
  );
  assert.equal(
    stockQuietHours("America/Los_Angeles", new Date("2026-09-10T03:00:00Z")),
    true,
  );
  assert.equal(
    stockQuietHours("America/Los_Angeles", new Date("2026-12-09T19:00:00Z")),
    false,
  );
});

test("address visibility defaults off and round trips across every template and email format", () => {
  for (const template of [
    "standard",
    "b2b-wholesale",
    "cart-recovery",
  ] as const) {
    for (const showPostalAddress of [undefined, false, true]) {
      const c = content(
        JSON.parse(
          JSON.stringify({ ...defaultContent, template, showPostalAddress }),
        ),
      );
      assert.equal(c.showPostalAddress, showPostalAddress === true);
      const message = emailBody(
        {
          id: "address-test",
          to: "test@example.com",
          channel: "EMAIL",
          subject: "Test",
          content: c,
          unsubscribe: "https://example.com/unsubscribe",
        },
        "123 Valid Street",
        "Company",
      );
      for (const output of [message.html, message.text]) {
        assert.equal(
          output.includes("123 Valid Street"),
          showPostalAddress === true,
        );
        assert.match(output, /Unsubscribe/);
        assert.match(output, /Company/);
      }
    }
  }
});

test("stock emails preserve shared footer settings without changing stock tokens", () => {
  const saved = validateStock({
    ...defaultStockConfig,
    emailContent: {
      ...defaultContent,
      showPostalAddress: true,
      footerText: "Staff only",
    },
  });
  const c = stockMessageContent(saved, "EMAIL", {
    ProductTitle: "Test coral",
    VariantTitle: "Small",
    InventoryQuantity: "4",
    ProductURL: "https://example.com/product",
  });
  assert.equal(c.showPostalAddress, true);
  assert.equal(c.footerText, "Staff only");
  assert.match(c.body, /Test coral/);
  assert.equal(
    stockMessageContent(saved, "SMS_TRANSACTIONAL", {
      ProductTitle: "Test coral",
      VariantTitle: "Small",
      InventoryQuantity: "4",
      ProductURL: "https://example.com/product",
    }).showPostalAddress,
    false,
  );
});

import { flowProgress } from "../lib/marketing/flow-progress";
test("profile flow progress distinguishes waiting, paused, sending, uncertain, skipped and completed runs", () => {
  const now = new Date("2026-09-10T12:00:00Z");
  const first = {
    id: "first",
    key: "cart-v1:run:first",
    flowKey: "abandoned-cart",
    flowCondition: "cart-v1:first",
    subject: "Reminder",
    status: "SENT",
    dueAt: now,
    createdAt: now,
    sentAt: now,
    error: null,
  };
  const final = {
    ...first,
    id: "final",
    key: "cart-v1:run:final",
    flowCondition: "cart-v1:final",
    status: "PENDING",
    sentAt: null,
    dueAt: new Date(+now + 86400000),
  };
  const flows = [
    { key: "abandoned-cart", name: "Abandoned Cart", enabled: true },
  ];
  let progress = flowProgress([first, final], flows, now)[0];
  assert.equal(progress.lastSent?.label, "First reminder");
  assert.equal(progress.next?.branchPending, true);
  assert.equal(progress.state, "Waiting for next step");
  assert.equal(
    flowProgress([first, final], [{ ...flows[0], enabled: false }], now)[0]
      .state,
    "Flow paused",
  );
  assert.equal(
    flowProgress([{ ...final, dueAt: now }], flows, now)[0].state,
    "Awaiting send checks",
  );
  assert.equal(
    flowProgress([{ ...final, status: "SENDING" }], flows, now)[0].state,
    "Sending",
  );
  assert.equal(
    flowProgress([{ ...final, status: "UNKNOWN" }], flows, now)[0].state,
    "Delivery needs review",
  );
  progress = flowProgress(
    [
      first,
      {
        ...final,
        status: "CANCELLED",
        error: "Skipped: recently received email (16 hours)",
      },
    ],
    flows,
    now,
  )[0];
  assert.equal(progress.active, false);
  assert.equal(progress.skippedCount, 1);
  assert.match(progress.reasons[0], /16 hours/);
  assert.equal(
    flowProgress(
      [
        {
          ...final,
          status: "CANCELLED",
          error: "Customer purchased after checkout",
        },
      ],
      flows,
      now,
    )[0].state,
    "Stopped after purchase",
  );
  assert.equal(
    flowProgress(
      [first, { ...final, status: "SENT", sentAt: now }],
      flows,
      now,
    )[0].state,
    "Scheduled steps completed",
  );
  assert.equal(
    flowProgress(
      [{ ...final, status: "FAILED", error: "Provider rejected" }],
      flows,
      now,
    )[0].state,
    "Finished with errors",
  );
  const runs = flowProgress(
    [first, { ...final, key: "cart-v1:another:final" }],
    flows,
    now,
  );
  assert.equal(runs.length, 2);
  assert.equal(runs[0].active, true);
});
