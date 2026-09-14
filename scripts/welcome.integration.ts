import test from "node:test";
import assert from "node:assert/strict";
import type { PrismaClient } from "../app/generated/prisma/client";
import {
  DAY,
  defaultMarketingSettings,
  type Content,
} from "../lib/marketing/rules";
import { welcomeSteps, defaultWelcome } from "../lib/marketing/welcome-config";

export function registerWelcomeTests(
  harness: () => {
    prisma: PrismaClient;
    store: typeof import("../lib/marketing/store");
    worker: typeof import("../lib/marketing/worker");
  },
) {
  test("welcome: single opt-in, durable coupon, accelerated days 0/3/10/15, eligibility and retry checks", async (t) => {
    const { prisma, store, worker } = harness();
    const { POST } = await import("../app/api/marketing/storefront/route");
    const { welcomeLocalHour, welcomeMessageKey, welcomeHasOrderedSince } =
      await import("../lib/marketing/welcome");
    const { enroll } = await import("../lib/marketing/flows");
    const { uniqueDiscount } = await import("../lib/marketing/discounts");
    const { contactDetails } = await import("../lib/marketing/audiences");
    const {
      cancelTestMessage,
      clearUnsentTestMessages,
      sendTestMessageNow,
    } = await import("../lib/marketing/message-test");
    const shop = store.shop(),
      fetchBefore = globalThis.fetch,
      couponEnv = process.env.MARKETING_WELCOME_COUPON;
    const flowWhere = { shop_kind_key: { shop, kind: "FLOW", key: "welcome" } };
    const settingsWhere = {
      shop_kind_key: { shop, kind: "SETTINGS", key: "global" },
    };
    const oldFlow = await prisma.marketingResource.findUniqueOrThrow({
      where: flowWhere,
    });
    const oldSettings = await prisma.marketingResource.findUnique({
      where: settingsWhere,
    });
    const config = {
      reviewed: true,
      welcome: { ...defaultWelcome },
      steps: welcomeSteps,
    };
    const discounts = new Map<
      string,
      { id: string; title: string; input: Record<string, unknown> }
    >();
    const deliveries: { subject: string; html: string }[] = [];
    let ordered = false,
      orderDateOverride: Date | null = null,
      failOrders = false,
      loseCouponResponse = false,
      uncertainSend = false,
      createCount = 0;
    let pauseAfterCoupon = false;
    const start = Date.now();
    t.mock.timers.enable({ apis: ["Date"], now: start });
    const time = (days: number) => t.mock.timers.setTime(start + days * DAY);
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      if (url.includes("/graphql.json")) {
        const b = JSON.parse(String(init?.body));
        if (b.query.includes("WelcomePurchaseCheck")) {
          if (failOrders)
            return Response.json({
              errors: [{ message: "Temporary lookup failure" }],
            });
          const sinceText = String(b.variables.query).match(
            /created_at:>=(\S+)/,
          )?.[1];
          const since = sinceText ? new Date(sinceText) : null;
          const orderAt = ordered ? orderDateOverride || new Date() : null;
          return Response.json({
            data: {
              orders: {
                nodes:
                  orderAt && since && orderAt >= since
                    ? [{ id: "welcome-order", createdAt: orderAt.toISOString() }]
                    : [],
              },
            },
          });
        }
        if (b.query.includes("CartCouponLookup")) {
          const d = discounts.get(b.variables.code);
          return Response.json({
            data: {
              codeDiscountNodeByCode: d
                ? { id: d.id, codeDiscount: { title: d.title } }
                : null,
            },
          });
        }
        if (b.query.includes("CartCouponCreate")) {
          const d = {
            id: "welcome-discount-" + ++createCount,
            title: b.variables.input.title,
            input: b.variables.input,
          };
          discounts.set(b.variables.input.code, d);
          if (pauseAfterCoupon) {
            pauseAfterCoupon = false;
            await prisma.marketingResource.update({ where: flowWhere, data: { enabled: false } });
          }
          if (loseCouponResponse) {
            loseCouponResponse = false;
            throw new Error("Lost response");
          }
          return Response.json({
            data: {
              discountCodeBasicCreate: {
                codeDiscountNode: { id: d.id },
                userErrors: [],
              },
            },
          });
        }
      }
      if (url === "https://api.resend.com/emails") {
        if (uncertainSend) throw new Error("Lost delivery response");
        deliveries.push(JSON.parse(String(init?.body)));
        return Response.json({ id: "welcome-send-" + deliveries.length });
      }
      return fetchBefore(input, init);
    };
    const signup = async (address: string, emailConsent = true) =>
      POST(
        new Request("https://app.example/api/marketing/storefront", {
          method: "POST",
          headers: { origin: "https://store.example" },
          body: JSON.stringify({
            action: "signup",
            email: address,
            emailConsent,
            timezone: "America/New_York",
          }),
        }),
      );
    const profile = (address: string) =>
      prisma.marketingProfile.findUniqueOrThrow({
        where: { shop_email: { shop, email: address } },
      });
    const message = (id: string, step: number) =>
      prisma.marketingMessage.findUniqueOrThrow({
        where: { key: welcomeMessageKey(id, step) },
      });
    const run = async (id: string, step: number) =>
      worker.runMarketing((await message(id, step)).id);
    try {
      delete process.env.MARKETING_WELCOME_COUPON;
      await prisma.marketingResource.update({
        where: flowWhere,
        data: { enabled: true, data: store.json(config) },
      });
      const settings = {
        ...defaultMarketingSettings,
        postalAddress: "123 Test Street",
        operations: {
          sendingEnabled: true,
          ingestEnabled: true,
          migrationConfirmed: true,
          formEnabled: true,
        },
      };
      await prisma.marketingResource.upsert({
        where: settingsWhere,
        create: {
          ...settingsWhere.shop_kind_key,
          name: "Test settings",
          data: store.json(settings),
        },
        update: { data: store.json(settings) },
      });
      await prisma.marketingWebhookInbox.updateMany({
        where: { shop, status: { not: "DONE" } },
        data: { status: "DONE" },
      });
      assert.equal(
        (await signup("no-consent-welcome@example.com", false)).status,
        400,
      );
      const response = await signup("welcome-lifecycle@example.com");
      assert.equal(response.status, 200);
      assert.equal((await response.json()).completed, true);
      const p = await profile("welcome-lifecycle@example.com");
      assert.ok(p.lists.includes("Mailable Subscribers"));
      assert.equal(
        (p.properties as { timezone: string }).timezone,
        "America/New_York",
      );
      await signup(p.email!);
      await store.atomic((tx) =>
        enroll(tx, "welcome", p.id, "duplicate", new Date()),
      );
      assert.equal(
        await prisma.marketingMessage.count({
          where: { profileId: p.id, flowKey: "welcome" },
        }),
        4,
      );
      assert.equal(
        await prisma.marketingMessage.count({
          where: { profileId: p.id, flowKey: "email-confirmation" },
        }),
        0,
      );
      await run(p.id, 0);
      const first = await message(p.id, 0);
      assert.equal(first.status, "SENT");
      const code = (first.content as Content).couponCode!;
      assert.equal(createCount, 1);
      const allocation = discounts.get(code)!.input;
      assert.equal(
        Date.parse(String(allocation.endsAt)) -
          Date.parse(String(allocation.startsAt)),
        14 * DAY,
      );
      assert.equal(allocation.usageLimit, 1);
      assert.deepEqual(allocation.combinesWith, {
        orderDiscounts: false,
        productDiscounts: false,
        shippingDiscounts: false,
      });
      assert.match((first.content as Content).url, /\/discount\/WELCOME10-/);
      assert.equal(+(await message(p.id, 1)).dueAt, start + 3 * DAY);
      assert.equal(+(await message(p.id, 2)).dueAt, start + 10 * DAY);
      time(2);
      await run(p.id, 1);
      assert.equal(deliveries.length, 1);
      time(3);
      await run(p.id, 1);
      assert.equal((await message(p.id, 1)).status, "SENT");
      assert.equal(
        ((await message(p.id, 1)).content as Content).couponCode,
        code,
      );
      time(9);
      await run(p.id, 2);
      assert.equal(deliveries.length, 2);
      time(10);
      await run(p.id, 2);
      assert.equal((await message(p.id, 2)).status, "SENT");
      assert.equal(
        ((await message(p.id, 2)).content as Content).couponCode,
        code,
      );
      assert.equal(createCount, 1);
      assert.doesNotMatch(deliveries[2].html, /\{\{ coupon_expires \}\}/);
      assert.equal(
        +(await message(p.id, 3)).dueAt,
        +welcomeLocalHour(new Date(start + 15 * DAY), "America/New_York", 17),
      );
      t.mock.timers.setTime(+(await message(p.id, 3)).dueAt);
      ordered = true;
      await run(p.id, 3);
      assert.equal(
        (await message(p.id, 3)).status,
        "SENT",
        "purchasers still receive social email",
      );
      assert.equal(
        ((await message(p.id, 3)).content as Content).couponCode,
        undefined,
      );
      ordered = false;

      time(20);
      await signup("welcome-purchase@example.com");
      const buyer = await profile("welcome-purchase@example.com");
      await run(buyer.id, 0);
      time(23);
      ordered = true;
      assert.equal(
        await welcomeHasOrderedSince(
          buyer.email!,
          new Date(start + 20 * DAY),
        ),
        true,
        "an order after enrollment is detected",
      );
      await run(buyer.id, 1);
      assert.equal((await message(buyer.id, 1)).status, "CANCELLED");
      time(30);
      await run(buyer.id, 2);
      assert.equal((await message(buyer.id, 2)).status, "CANCELLED");
      ordered = false;

      time(32);
      await signup("welcome-previous-buyer@example.com");
      const previousBuyer = await profile("welcome-previous-buyer@example.com");
      await prisma.marketingProfile.update({
        where: { id: previousBuyer.id },
        data: { lastOrderAt: new Date(start + 10 * DAY) },
      });
      await run(previousBuyer.id, 0);
      ordered = true;
      orderDateOverride = new Date(start + 10 * DAY);
      time(35);
      assert.equal(
        await welcomeHasOrderedSince(
          previousBuyer.email!,
          new Date(start + 32 * DAY),
        ),
        false,
        "an order before enrollment does not block this Welcome run",
      );
      await run(previousBuyer.id, 1);
      assert.equal((await message(previousBuyer.id, 1)).status, "SENT");
      ordered = false;
      orderDateOverride = null;

      time(40);
      await signup("welcome-errors@example.com");
      const errors = await profile("welcome-errors@example.com");
      await run(errors.id, 0);
      time(43);
      failOrders = true;
      await run(errors.id, 1);
      assert.equal((await message(errors.id, 1)).status, "PENDING");
      assert.match(
        (await message(errors.id, 1)).error!,
        /Waiting for welcome checks/,
      );
      failOrders = false;
      time(55);
      await run(errors.id, 2);
      assert.equal(
        (await message(errors.id, 2)).status,
        "CANCELLED",
        "overdue reminder never advertises an expired code",
      );

      time(60);
      await signup("welcome-unknown@example.com");
      const unknown = await profile("welcome-unknown@example.com");
      uncertainSend = true;
      await run(unknown.id, 0);
      uncertainSend = false;
      assert.equal((await message(unknown.id, 0)).status, "UNKNOWN");
      time(63);
      await run(unknown.id, 1);
      assert.equal((await message(unknown.id, 1)).status, "PENDING");
      assert.match(
        (await message(unknown.id, 1)).error!,
        /Waiting for welcome email/,
      );
      const beforeRetry = createCount;
      time(64);
      await run(unknown.id, 0);
      assert.equal(createCount, beforeRetry);

      time(70);
      const options = {
        kind: "WELCOME_COUPON",
        name: "Welcome10",
        prefix: "WELCOME10-",
        days: 14,
      };
      loseCouponResponse = true;
      await assert.rejects(uniqueDiscount("welcome-lost-response", options));
      const allocated = createCount;
      time(71);
      const recovered = await uniqueDiscount("welcome-lost-response", options);
      assert.equal(createCount, allocated);
      assert.equal(
        Date.parse(recovered.endsAt),
        start + 84 * DAY,
        "lost response cannot extend the deadline",
      );

      time(75);
      const testAddress = "welcome-actions@example.com";
      await prisma.marketingResource.update({
        where: flowWhere,
        data: {
          data: store.json({
            ...config,
            welcome: {
              ...defaultWelcome,
              testEmail: testAddress,
              bypassRecentEmailSuppression: true,
            },
          }),
        },
      });
      await signup(testAddress);
      const actionProfile = await profile(testAddress);
      let actionDetails = await contactDetails(actionProfile.id);
      assert.equal(
        actionDetails!.messages.filter((item) => item.testScoped).length,
        4,
        "all Welcome emails use the shared test-message controls",
      );
      const initial = await message(actionProfile.id, 0);
      assert.equal(
        actionDetails!.messages.find((item) => item.id === initial.id)!
          .testActions?.canSendNow,
        true,
      );
      const deliveriesBeforeActions = deliveries.length;
      assert.equal(
        (await sendTestMessageNow(actionProfile.id, initial.id)).status,
        "SENT",
      );
      const firstReminder = await message(actionProfile.id, 1);
      actionDetails = await contactDetails(actionProfile.id);
      assert.equal(
        actionDetails!.messages.find((item) => item.id === firstReminder.id)!
          .testActions?.canSendNow,
        true,
      );
      assert.equal(
        (await sendTestMessageNow(actionProfile.id, firstReminder.id)).status,
        "SENT",
        "the Welcome test-account bypass permits consecutive test sends",
      );
      assert.equal(deliveries.length, deliveriesBeforeActions + 2);
      const finalReminder = await message(actionProfile.id, 2);
      await cancelTestMessage(actionProfile.id, finalReminder.id);
      assert.equal((await message(actionProfile.id, 2)).status, "CANCELLED");
      assert.equal(
        await clearUnsentTestMessages(actionProfile.id),
        2,
        "cleanup removes cancelled and pending Welcome test messages",
      );
      assert.equal(
        await prisma.marketingMessage.count({
          where: { profileId: actionProfile.id, flowKey: "welcome" },
        }),
        2,
      );
      assert.ok(
        await prisma.marketingResource.findUnique({
          where: {
            shop_kind_key: {
              shop,
              kind: "WELCOME_RUN",
              key: actionProfile.id,
            },
          },
        }),
        "cleanup preserves Welcome's one-entry record",
      );

      time(80);
      await prisma.marketingResource.update({
        where: flowWhere,
        data: {
          data: store.json({
            ...config,
            welcome: {
              ...defaultWelcome,
              testEmail: "welcome-test@example.com",
            },
          }),
        },
      });
      await signup("welcome-outsider@example.com");
      const outsider = await profile("welcome-outsider@example.com");
      assert.equal(
        await prisma.marketingMessage.count({
          where: { profileId: outsider.id },
        }),
        0,
      );
      await signup("welcome-test@example.com");
      const tester = await profile("welcome-test@example.com");
      await prisma.marketingResource.update({
        where: flowWhere,
        data: { data: store.json(config) },
      });
      await run(tester.id, 0);
      assert.equal(
        (await message(tester.id, 0)).status,
        "CANCELLED",
        "a test run cannot become a production run",
      );

      const suppressed = await store.atomic(async (tx) => {
        const p = await store.identify(tx, {
          email: "welcome-suppressed@example.com",
        });
        await store.consent(
          tx,
          p.id,
          "EMAIL",
          "UNSUBSCRIBED",
          "test",
          new Date(),
        );
        return p;
      });
      const suppressedResponse = await signup(suppressed.email!);
      const suppressedBody = await suppressedResponse.json();
      assert.equal(suppressedBody.completed, true);
      assert.equal(
        await prisma.marketingMessage.count({
          where: { profileId: suppressed.id },
        }),
        0,
      );
      assert.equal(
        (
          await prisma.marketingConsent.findUniqueOrThrow({
            where: {
              profileId_channel: { profileId: suppressed.id, channel: "EMAIL" },
            },
          })
        ).suppressed,
        true,
      );

      const voluntary = await store.atomic(async (tx) => {
        const p = await store.identify(tx, {
          email: "welcome-resubscribe@example.com",
        });
        await store.consent(
          tx,
          p.id,
          "EMAIL",
          "UNSUBSCRIBED",
          "unsubscribe-link",
          new Date(),
        );
        return p;
      });
      const resubscribeResponse = await signup(voluntary.email!);
      const resubscribeBody = await resubscribeResponse.json();
      assert.equal(resubscribeBody.completed, true);
      assert.equal(resubscribeBody.resubscribe, undefined);
      assert.equal(
        resubscribeBody.message,
        suppressedBody.message,
        "the public response must not disclose prior subscription state",
      );
      const confirmationMessage =
        await prisma.marketingMessage.findFirstOrThrow({
          where: {
            profileId: voluntary.id,
            flowKey: "email-confirmation",
          },
        });
      await worker.runMarketing(confirmationMessage.id);
      assert.equal(
        (
          await prisma.marketingMessage.findUniqueOrThrow({
            where: { id: confirmationMessage.id },
          })
        ).status,
        "SENT",
        "voluntary opt-outs can receive only the ownership confirmation",
      );
      const confirmationUrl = String(
        (confirmationMessage.content as Content).url,
      );
      const confirmationApi = await import(
        "../app/api/marketing/confirm/route"
      );
      assert.equal(
        (
          await confirmationApi.POST(
            new Request(confirmationUrl, { method: "POST" }),
          )
        ).status,
        200,
      );
      const reactivated =
        await prisma.marketingConsent.findUniqueOrThrow({
          where: {
            profileId_channel: {
              profileId: voluntary.id,
              channel: "EMAIL",
            },
          },
        });
      assert.equal(reactivated.status, "SUBSCRIBED");
      assert.equal(reactivated.suppressed, false);
      assert.equal(
        reactivated.source,
        "storefront-resubscribe-confirmed-v1",
      );
      assert.ok(
        (await profile(voluntary.email!)).lists.includes(
          "Mailable Subscribers",
        ),
      );
      assert.equal(
        await prisma.marketingMessage.count({
          where: { profileId: voluntary.id, flowKey: "welcome" },
        }),
        4,
      );

      const complained = await store.atomic(async (tx) => {
        const p = await store.identify(tx, {
          email: "welcome-complained@example.com",
        });
        await store.consent(
          tx,
          p.id,
          "EMAIL",
          "UNSUBSCRIBED",
          "provider",
          new Date(),
          "COMPLAINED",
        );
        return p;
      });
      const complainedResponse = await signup(complained.email!);
      assert.equal((await complainedResponse.json()).completed, true);
      assert.equal(
        await prisma.marketingMessage.count({
          where: {
            profileId: complained.id,
            flowKey: "email-confirmation",
          },
        }),
        0,
        "complaints must never receive a resubscription email",
      );
      assert.equal(
        +welcomeLocalHour(
          new Date("2026-11-01T05:00:00Z"),
          "America/New_York",
          17,
        ),
        Date.parse("2026-11-01T22:00:00Z"),
        "DST fallback uses local 5 PM",
      );
      time(90);
      await signup("welcome-delayed@example.com");
      const delayed = await profile("welcome-delayed@example.com");
      time(92); await run(delayed.id, 0);
      assert.equal(+(await message(delayed.id, 1)).dueAt, start + 95 * DAY, "delayed first delivery moves the full sequence instead of making reminders immediately due");
      assert.equal(Date.parse(((await message(delayed.id, 0)).content as Content).couponExpiresAt!), start + 106 * DAY);

      time(110); await signup("welcome-recent@example.com");
      const recent = await profile("welcome-recent@example.com");
      await prisma.marketingMessage.create({ data: { shop, key: "welcome-recent-campaign", profileId: recent.id, channel: "EMAIL", subject: "Earlier campaign", content: store.json(welcomeSteps[0].content), dueAt: new Date(), sentAt: new Date(), status: "SENT" } });
      await run(recent.id, 0);
      assert.equal((await message(recent.id, 0)).status, "SENT", "signup response bypasses recent-email spacing");
      time(113);
      await store.atomic((tx) => store.record(tx, { key: "welcome-recent-before-reminder", type: "EXTERNAL_EMAIL_SENT", profileId: recent.id, occurredAt: new Date() }));
      await run(recent.id, 1);
      const postponedReminder = await message(recent.id, 1);
      assert.equal(postponedReminder.status, "PENDING");
      assert.match(postponedReminder.error!, /16-hour email spacing/);
      assert.ok(postponedReminder.dueAt > new Date());
      t.mock.timers.setTime(+postponedReminder.dueAt);
      await run(recent.id, 1);
      assert.equal((await message(recent.id, 1)).status, "SENT", "postponed reminder is reconsidered after spacing");
      assert.equal((await message(recent.id, 3)).status, "PENDING");

      time(120); await signup("welcome-paused@example.com"); const paused = await profile("welcome-paused@example.com");
      const beforePause = deliveries.length;
      pauseAfterCoupon = true; await run(paused.id, 0);
      assert.equal(deliveries.length, beforePause);
      assert.equal((await message(paused.id, 0)).status, "PENDING");
      const prepared = (await message(paused.id, 0)).content as Content;
      await prisma.marketingResource.update({ where: flowWhere, data: { enabled: true, data: store.json({ ...config, steps: config.steps.map((s, i) => i === 0 ? { ...s, subject: "Changed after preparation" } : s) }) } });
      time(121); await run(paused.id, 0);
      assert.equal((await message(paused.id, 0)).status, "SENT");
      assert.equal((await message(paused.id, 0)).subject, config.steps[0].subject, "prepared retry preserves its original subject");
      assert.equal(((await message(paused.id, 0)).content as Content).couponCode, prepared.couponCode);
      assert.equal(((await message(paused.id, 0)).content as Content).couponExpiresAt, prepared.couponExpiresAt);
    } finally {
      t.mock.timers.reset();
      globalThis.fetch = fetchBefore;
      if (couponEnv === undefined) delete process.env.MARKETING_WELCOME_COUPON;
      else process.env.MARKETING_WELCOME_COUPON = couponEnv;
      await prisma.marketingResource.update({
        where: flowWhere,
        data: { enabled: oldFlow.enabled, data: store.json(oldFlow.data) },
      });
      if (oldSettings)
        await prisma.marketingResource.update({
          where: settingsWhere,
          data: { data: store.json(oldSettings.data) },
        });
      else await prisma.marketingResource.delete({ where: settingsWhere });
    }
  });
}
