import test from "node:test";
import assert from "node:assert/strict";
import {
  content,
  defaultContent,
  eligible,
  email,
  marketingSettings,
  matches,
  phone,
  render,
  safeUrl,
  segment,
  textBody,
  withCoupon,
  personalize,
} from "../lib/marketing/rules";
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
    { ...defaultContent, heading: '<script>alert("x")</script>' },
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
      },
    },
    "Address",
    "Company",
  );
  assert.match(payload.html, /src="cid:marketing-logo"/);
  assert.ok(!payload.html.includes("data:image"));
  assert.equal(payload.attachments?.[0].content, "YWJj");
});
