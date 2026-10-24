import assert from "node:assert/strict";

export function paymentFixture(amount: unknown, currency: unknown = "USD") {
  const checkedAt = new Date().toISOString();
  return { amount: String(amount ?? ""), currency: typeof currency === "string" ? currency : null, sourceUpdatedAt: checkedAt, checkedAt };
}

/** Existing attribution fixtures represent verified payments, separately from original order totals. */
export function paidOrderFixture<T extends Record<string, unknown>>(payload: T) {
  return { ...payload, payment: "payment" in payload
    ? payload.payment as ReturnType<typeof paymentFixture> | null : paymentFixture(payload.revenue, payload.currency) };
}
type SourcePayment = {
  amount: string;
  currency?: string;
  updatedAt?: string;
  financialStatus?: string;
  cancelledAt?: string | null;
  test?: boolean;
};

/** Reporting fixtures permit only the explicit read of Shopify payment evidence. */
export function mockOrderPaymentSource(source: Record<string, SourcePayment | null>) {
  const requests: string[][] = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.includes("/oauth/access_token")) return Response.json({ access_token: "mock-payment" });
    assert.ok(url.includes("/graphql.json"), "Reporting cannot send an email or contact an unrelated service: " + url);
    const body = JSON.parse(String(init?.body));
    assert.match(body.query, /query MarketingOrderPayments\(/);
    const ids = body.variables.ids as string[];
    requests.push(ids);
    return Response.json({ data: { nodes: ids.map(gid => {
      const id = gid.replace(/^gid:\/\/shopify\/Order\//, "");
      assert.ok(Object.hasOwn(source, id), "Missing explicit payment fixture for " + id);
      const payment = source[id];
      return payment && { id: gid, updatedAt: payment.updatedAt || new Date().toISOString(),
        netPaymentSet: { shopMoney: { amount: payment.amount, currencyCode: payment.currency || "USD" } },
        ...(payment.financialStatus !== undefined ? { displayFinancialStatus: payment.financialStatus } : {}),
        ...(payment.cancelledAt !== undefined ? { cancelledAt: payment.cancelledAt } : {}),
        ...(payment.test !== undefined ? { test: payment.test } : {}),
      };
    }) } });
  };
  return requests;
}
