import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { content, render, defaultContent, type Content } from "../lib/marketing/rules";
import { emailBody } from "../lib/marketing/delivery";
import { applyCoralsReefDesign } from "../lib/marketing/corals-reef";
import { isolated, type Context } from "./cart-launch.integration";
import { threeStepCartDraft } from "../lib/marketing/cart-config";

const unsubscribe = "https://dashboard.example/api/marketing/unsubscribe?token=real-recipient-token";
const checkout = "https://coralsanonymous.com/checkouts/live-checkout-token?key=keep-me&locale=en";
const expires = "2030-11-22T18:30:00.000Z";
const products = [
  { title: "LIVE RECORD CORAL A", image: "https://images.example/live-coral-a.jpg", url: "https://coralsanonymous.com/products/live-a?variant=101", price: "$125.50", compareAtPrice: "$150.00" },
  { title: "LIVE RECORD CORAL B", image: "https://images.example/live-coral-b.jpg", url: "https://coralsanonymous.com/products/live-b?variant=202", price: "$84.00", compareAtPrice: "$100.00" },
  { title: "LIVE RECORD CORAL C", image: "https://images.example/live-coral-c.jpg", url: "https://coralsanonymous.com/products/live-c?variant=303", price: "$115.75", compareAtPrice: "$130.00" },
];
function source(): Content {
  return content({ ...defaultContent, template: "cart-recovery", layout: "cart-recovery",
    heading: "Saved heading for {{ first_name|default:'Friend' }}", body: "Saved body and {{ coupon_expires }}.",
    bodyHtml: "<p>Saved <strong>rich reef copy</strong> for {{ first_name|default:'Friend' }}.</p><p>Expires {{ coupon_expires }}.</p>",
    button: "Resume THIS checkout", url: checkout, couponCode: "LIVE-CART-CODE-77", couponExpiresAt: expires,
    couponLabel: "Use your assigned code", couponTerms: "One use. Cannot combine with other discounts.",
    products, showPostalAddress: true, showFooterSocial: false, footerTitle: "", footerText: "Saved footer copy" });
}
function delivered(c: Content, branding?: Parameters<typeof emailBody>[0]["branding"]) {
  return emailBody({ id: "reef-preview", to: "staff@example.com", channel: "EMAIL", subject: "Read-only preview", content: c,
    unsubscribe, profileName: "Avery Reef", organizationName: "Corals Anonymous", branding },
  "4471 Prospect Ave\nYorba Linda, CA", "Corals Anonymous");
}

export function registerCoralsReefTests(context: () => Context) {
  test("Corals reef presentation preserves semantic templates, authored copy and prepared recipient values", () => {
    for (const [flow, template, index] of [
      ["abandoned-cart", "cart-recovery", 0], ["abandoned-cart", "cart-recovery", 1], ["abandoned-cart", "cart-recovery", 2],
      ["welcome", "welcome", 0], ["welcome", "welcome", 1], ["welcome", "welcome", 2], ["welcome", "welcome-social", 3],
      ["b2b-welcome", "b2b-wholesale", 0], ["delivery-upsell", "b2b-wholesale", 0],
    ] as const) {
      const original = content({ ...source(), template }), before = structuredClone(original);
      const design = applyCoralsReefDesign(original, flow, index), roundTrip = content(JSON.parse(JSON.stringify(design)));
      assert.equal(roundTrip.layout, "corals-reef"); assert.equal(roundTrip.reefDesign?.version, 1);
      assert.equal(roundTrip.template, template);
      for (const field of ["heading", "body", "bodyHtml", "button", "url", "couponCode", "couponExpiresAt", "products"] as const)
        assert.deepEqual(roundTrip[field], original[field], `${flow}/${index} retains ${field}`);
      assert.deepEqual(original, before, "choosing a visual design never mutates the source");
    }
  });

  test("Corals reef delivery uses actual products, recipient coupon, expiry and checkout URL in HTML and text", () => {
    const design = applyCoralsReefDesign(source(), "abandoned-cart", 2), payload = delivered(design);
    const doc = new JSDOM(payload.html).window.document, text = doc.body.textContent || "";
    assert.equal(text.split("LIVE-CART-CODE-77").length - 1, 1, "the assigned coupon is displayed once");
    assert.match(text, /15\s*%/); assert.ok(text.includes("rich reef copy")); assert.ok(text.includes("Avery"));
    assert.ok(doc.querySelector("strong"));
    assert.ok([...doc.querySelectorAll("a")].some(link => link.getAttribute("href") === checkout));
    assert.ok([...doc.querySelectorAll("a")].some(link => link.getAttribute("href") === unsubscribe));
    for (const product of products) {
      assert.ok(text.includes(product.title)); assert.ok(text.includes(product.price));
      assert.ok([...doc.querySelectorAll("a")].some(link => link.getAttribute("href") === product.url));
      assert.ok(payload.text.includes(product.title)); assert.ok(payload.text.includes(product.url));
    }
    for (const required of ["LIVE-CART-CODE-77", checkout, unsubscribe, "2030", "4471 Prospect Ave"])
      assert.ok(payload.text.includes(required), `plain text keeps ${required}`);
    assert.doesNotMatch(payload.html + payload.text, /\{\{\s*(?:coupon_expires|coupon_time_left|first_name)/);
    assert.doesNotMatch(text, /Product name|\$X\.XX|AC300-PREVIEW/);
    assert.equal(design.reefDesign?.offerPercent, 15);
  });

  test("Corals reef meaningful design copy is represented in plain text and absent offers stay absent", () => {
    const design = content({ ...applyCoralsReefDesign(source(), "abandoned-cart", 1), reefDesign: {
      version: 1, variant: "gift", offerPercent: 10, eyebrow: "A reef note for {{ first_name|default:'Friend' }}",
      offerTitle: "Your private gift", offerScope: "On the eligible order", productsTitle: "Your reef picks",
      closing: "See you soon, {{ first_name|default:'Friend' }}", signature: "The Corals Anonymous crew",
    } });
    const payload = delivered(design);
    const htmlText = new JSDOM(payload.html).window.document.body.textContent || "";
    for (const required of ["A reef note for Avery", "Your private gift", "On the eligible order", "Your reef picks", "See you soon, Avery", "The Corals Anonymous crew"])
      assert.ok(payload.text.includes(required) && htmlText.includes(required), `both email versions keep ${required}`);
    const without = delivered(content({ ...design, couponCode: undefined, couponExpiresAt: undefined, products: [] }));
    const noOfferText = new JSDOM(without.html).window.document.body.textContent || "";
    for (const absent of ["Your private gift", "On the eligible order", "Your reef picks", "LIVE-CART-CODE-77"])
      assert.ok(!noOfferText.includes(absent) && !without.text.includes(absent));
  });

  test("Corals reef final offer never inherits old 10 percent terms and retains an authored introduction", () => {
    const design = content({ ...applyCoralsReefDesign(source(), "abandoned-cart", 2), couponTerms: undefined,
      introText: "A saved introduction for {{ first_name|default:'Friend' }}" });
    const payload = delivered(design), bodyText = new JSDOM(payload.html).window.document.body.textContent || "";
    for (const text of [bodyText, payload.text]) {
      assert.ok(text.includes("15% OFF")); assert.ok(!text.includes("10%"));
      assert.ok(text.includes("A saved introduction for Avery"));
    }
  });

  test("Corals reef social presentation retains prepared social links and products", () => {
    const social = content({ ...source(), template: "welcome-social", couponCode: undefined, couponExpiresAt: undefined,
      socialNavigation: [{ label: "My new arrivals", url: "https://coralsanonymous.com/collections/real-arrivals" }],
      socialFollowText: "Follow the actual reef", instagramHeading: "Actual Instagram", instagramHandle: "@actual-reef",
      instagramText: "Actual Instagram copy", facebookHeading: "Actual Facebook", facebookText: "Actual Facebook copy",
      instagramUrl: "https://www.instagram.com/coralsanonymous/", facebookUrl: "https://www.facebook.com/coralsanonymousshop/" });
    const payload = delivered(applyCoralsReefDesign(social, "welcome", 3));
    const links = [...new JSDOM(payload.html).window.document.querySelectorAll("a")].map(link => link.getAttribute("href"));
    for (const required of [social.instagramUrl!, social.facebookUrl!, social.socialNavigation![0].url, ...products.map(product => product.url)])
      assert.ok(links.includes(required), `social layout keeps ${required}`);
    for (const required of [social.instagramUrl!, social.facebookUrl!, social.socialNavigation![0].url, "Follow the actual reef", "Actual Instagram copy", "Actual Facebook copy"])
      assert.ok(payload.text.includes(required), `plain text keeps ${required}`);
  });

  test("Corals reef nested logo attachments reflect rendered images and omit unused old-layout artwork", () => {
    const current = "data:image/png;base64,AQID", old = "data:image/png;base64,BAUG";
    const design = content({ ...applyCoralsReefDesign(source(), "abandoned-cart", 1), logo: old,
      reefDesign: { version: 1, variant: "gift", offerPercent: 10, logo: current, logoScale: 1 } });
    const payload = delivered(design);
    assert.ok(payload.attachments?.some(attachment => attachment.content === "AQID"));
    assert.ok(!payload.attachments?.some(attachment => attachment.content === "BAUG"));
    assert.doesNotMatch(payload.html, /data:image\//);
    for (const attachment of payload.attachments || []) assert.ok(payload.html.includes("cid:" + attachment.content_id));
    const sharedLogo = delivered(content({ ...design, logo: current }));
    assert.equal(sharedLogo.attachments?.filter(attachment => attachment.content === "AQID").length, 1,
      "the same data image used by shared and local branding is attached only once");
  });

  test("Corals reef text and functional links remain intact without head styles or loaded artwork", () => {
    const original = render(applyCoralsReefDesign(source(), "abandoned-cart", 2), unsubscribe, "Mailing address", "Avery Reef");
    const before = new JSDOM(original).window.document;
    const stripped = new JSDOM(original.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")).window.document;
    stripped.querySelectorAll("img").forEach(image => image.remove());
    for (const text of ["Saved heading for Avery", "rich reef copy", "LIVE-CART-CODE-77", "Resume THIS checkout", ...products.map(product => product.title)])
      assert.ok((stripped.body.textContent || "").includes(text), `live HTML keeps ${text} when images/styles are unavailable`);
    assert.deepEqual([...stripped.querySelectorAll("a")].map(link => link.getAttribute("href")),
      [...before.querySelectorAll("a")].map(link => link.getAttribute("href")));
  });

  test("Corals reef authored full B2B copy does not duplicate a generated heading or greeting", () => {
    const sourceContent = content({ ...defaultContent, template: "b2b-wholesale", heading: "GENERATED HEADING TO OMIT",
      introText: "GENERATED GREETING TO OMIT", body: "Body fallback", bodyHtml: "<h1>AUTHORED WHOLESALE TITLE</h1><p>Hi {{ first_name|default:'Friend' }}</p><p>Exact authored copy.</p>" });
    const payload = delivered(applyCoralsReefDesign(sourceContent, "b2b-welcome", 0));
    const text = new JSDOM(payload.html).window.document.body.textContent || "";
    assert.equal(text.split("AUTHORED WHOLESALE TITLE").length - 1, 1);
    assert.ok(!text.includes("GENERATED HEADING TO OMIT")); assert.ok(!text.includes("GENERATED GREETING TO OMIT"));
    assert.ok(text.includes("Exact authored copy."));
    assert.ok(!payload.text.includes("GENERATED HEADING TO OMIT")); assert.ok(!payload.text.includes("GENERATED GREETING TO OMIT"));
    assert.ok(payload.text.includes("AUTHORED WHOLESALE TITLE")); assert.ok(payload.text.includes("Hi Avery"));
  });

  test("Corals reef respects effective address visibility and escapes personal content", () => {
    const design = applyCoralsReefDesign(source(), "abandoned-cart", 1);
    const payload = delivered(design, { footerConfigured: true, showPostalAddress: false, footerText: "Preserved shared footer" });
    assert.ok(!payload.html.includes("4471 Prospect Ave")); assert.ok(!payload.text.includes("4471 Prospect Ave"));
    const html = render(design, unsubscribe, "", '<img src=x onerror="alert(1)"> Reef');
    assert.equal(new JSDOM(html).window.document.querySelectorAll("[onerror],script").length, 0);
  });

  test("Corals reef cart storage shares design and nested artwork while recipient values remain compact", async () => isolated(context(), "reef-storage", async h => {
    const { saveCartContent, resolveCartContent } = await import("../lib/marketing/cart-storage");
    const design = content({ ...applyCoralsReefDesign(source(), "abandoned-cart", 1),
      reefDesign: { version: 1, variant: "gift", offerPercent: 10, logo: "data:image/png;base64,AQID" } });
    const beforeContent = await h.prisma.marketingResource.count({ where: { shop: h.shop, kind: "CART_CONTENT" } });
    const beforeAssets = await h.prisma.marketingResource.count({ where: { shop: h.shop, kind: "CART_ASSET" } });
    const refs = [];
    for (let index = 0; index < 8; index++) refs.push(await saveCartContent(h.prisma, h.shop,
      { ...design, couponCode: "RECIPIENT-" + index, url: checkout + "&recipient=" + index }));
    assert.equal(new Set(refs.map(ref => (ref as { cartContentRef: string }).cartContentRef)).size, 1);
    assert.equal(await h.prisma.marketingResource.count({ where: { shop: h.shop, kind: "CART_CONTENT" } }), beforeContent + 1);
    assert.equal(await h.prisma.marketingResource.count({ where: { shop: h.shop, kind: "CART_ASSET" } }), beforeAssets + 1);
    for (let index = 0; index < refs.length; index++) {
      assert.doesNotMatch(JSON.stringify(refs[index]), /data:image|reefDesign|Saved heading/);
      const resolved = await resolveCartContent(h.prisma, h.shop, refs[index]);
      assert.equal(resolved.couponCode, "RECIPIENT-" + index); assert.equal(resolved.url, checkout + "&recipient=" + index);
      assert.equal(resolved.reefDesign?.logo, design.reefDesign?.logo); assert.equal(resolved.layout, "corals-reef");
    }
  }));

  test("Corals reef flow save retains scheduling, eligibility, consent switches and subjects", async () => isolated(context(), "reef-save", async h => {
    const priorAuth = process.env.DASHBOARD_AUTH_DISABLED;
    process.env.DASHBOARD_AUTH_DISABLED = "true";
    try {
      const api = await import("../app/api/marketing/route"), original = threeStepCartDraft(h.f);
      const updated = { ...original, steps: original.steps.map((step, index) => ({ ...step,
        content: applyCoralsReefDesign(step.content, "abandoned-cart", index) })) };
      const response = await api.POST(new Request("https://dashboard.example/api/marketing?brand=corals-anonymous", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
          action: "save-resource", kind: "FLOW", key: "abandoned-cart", name: "Abandoned Cart", enabled: true, data: updated,
        }),
      }));
      assert.equal(response.status, 200, JSON.stringify(await response.json()));
      const row = await h.prisma.marketingResource.findUniqueOrThrow({ where: { id: h.flowId } });
      const saved = row.data as typeof original;
      assert.equal(row.enabled, true); assert.equal(saved.reviewed, original.reviewed); assert.deepEqual(saved.cart, original.cart);
      const scheduling = (steps: typeof original.steps) => steps.map(step => ({
        minutes: step.minutes, subject: step.subject, channel: step.channel,
      }));
      assert.deepEqual(scheduling(saved.steps), scheduling(original.steps));
      assert.deepEqual(saved.steps.map(step => step.content.template), original.steps.map(step => step.content.template));
      assert.deepEqual(saved.steps.map(step => step.content.bodyHtml), original.steps.map(step => step.content.bodyHtml));
      assert.ok(saved.steps.every(step => step.content.layout === "corals-reef"));
      assert.equal(h.emails.length, 0);
    } finally {
      if (priorAuth === undefined) delete process.env.DASHBOARD_AUTH_DISABLED; else process.env.DASHBOARD_AUTH_DISABLED = priorAuth;
    }
  }));
}
