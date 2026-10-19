import test from "node:test";
import assert from "node:assert/strict";
import { validateCart } from "../lib/marketing/cart-config";
import { cartMerchandise, cartMerchandiseBlock, isCartMerchandiseBlock, isCartServiceLine,
  CART_MERCHANDISE_UNKNOWN, CART_NO_MERCHANDISE } from "../lib/marketing/cart-merchandise";

export function registerCartMerchandiseTests() {
  test("cart minimum setting: legacy defaults to $100 and rejects invalid or fractional-cent thresholds", () => {
    assert.equal(validateCart({ version: 1, productCount: 6 }).minimumSubtotal, 100);
    assert.equal(validateCart({ version: 1, productCount: 6, minimumSubtotal: 150.50 }).minimumSubtotal, 150.5);
    for (const minimumSubtotal of [-1, NaN, Infinity, "100", 100.001, 1000001])
      assert.throws(() => validateCart({ version: 1, productCount: 6, minimumSubtotal }), /minimum merchandise subtotal/);
  });
  const coral = (price: string | number, quantity = 1, rest: Record<string, unknown> = {}) =>
    ({ title: "Acropora coral", price, quantity, ...rest });
  const checkout = (subtotal: string, line_items: unknown[], rest: Record<string, unknown> = {}) =>
    ({ currency: "USD", subtotal_price: subtotal, line_items, ...rest });

  test("cart merchandise: exact $100 discounted merchandise boundary excludes shipping, tax and extras", () => {
    const below = cartMerchandise(checkout("124.99", [coral("99.99"),
      { title: "Shipping Box", price: "20.00", quantity: 1 },
      { title: "Shipping Protection", price: "5.00", quantity: 1 }], { total_price: "200.00", total_tax: "20.00" }));
    assert.deepEqual(below, { currency: "USD", subtotalCents: 9999, merchandiseLines: 1 });
    assert.match(cartMerchandiseBlock(below)!, /below \$100\.00 USD/);
    const enough = cartMerchandise(checkout("125.00", [coral("25.00", 4),
      { title: "Shipping Box", price: "20.00", quantity: 1 },
      { title: "Shipping Protection", price: "5.00", quantity: 1 }]));
    assert.deepEqual(enough, { currency: "USD", subtotalCents: 10000, merchandiseLines: 1 });
    assert.equal(cartMerchandiseBlock(enough), null);
    assert.match(cartMerchandiseBlock(enough, 20000)!, /below \$200\.00 USD/);
  });

  test("cart merchandise: shipping/protection-only carts never qualify, even with huge totals", () => {
    for (const title of ["Shipping Box", "Shipping Boxes - Large", "Shipping Protection", "Package Protection", "Order Protection", "Protection", "Checkout Protection"]) {
      const facts = cartMerchandise(checkout("9999.00", [{ title, price: "9999.00", quantity: 1 }]));
      assert.deepEqual(facts, { blocked: CART_NO_MERCHANDISE });
      assert.equal(cartMerchandiseBlock(facts, 0), CART_NO_MERCHANDISE);
    }
    assert.equal(isCartServiceLine({ title: "Yellow Boxfish" }), false);
    assert.equal(isCartServiceLine({ title: "Mystery Coral Fire Box" }), false);
    assert.equal(isCartServiceLine({ title: "Mushroom Mystery Box" }), false);
    assert.equal(isCartServiceLine({ title: "Shipping Protection (safeguarded against potential UPS & FedEx weather delays or damage)" }), true);
    assert.equal(isCartServiceLine({ presentment_title: "Shipping Box Charge (Includes box fee, insulation material, and heat or ice packs)" }), true);
    assert.equal(isCartServiceLine({ title: "Shipping Protection - (safeguarded against potential UPS & FedEx weather delays or damage)" }), true);
    assert.equal(isCartServiceLine({ product_id: 8132094165218, title: "Renamed service" }), true);
    assert.equal(isCartServiceLine({ productId: "8216362287330" }), true);
    assert.equal(isCartServiceLine({ id: "gid://shopify/Product/9275587821794" }), true);
    assert.equal(isCartServiceLine({ handle: "shipping-box" }), true);
    assert.equal(isCartServiceLine({ product_type: "Shipping Protection" }), true);
    assert.deepEqual(cartMerchandise({ line_items: [] }), { blocked: CART_NO_MERCHANDISE });
  });

  test("cart merchandise: allocation discounts and total-discount fallback are counted once", () => {
    const allocations = cartMerchandise(checkout("99.99", [coral("60.00", 2, {
      discount_allocations: [{ amount: "10.00" }, { amount: "10.01" }], total_discount: "20.01",
    })]));
    assert.deepEqual(allocations, { currency: "USD", subtotalCents: 9999, merchandiseLines: 1 });
    assert.notEqual(cartMerchandiseBlock(allocations), null);
    const fallback = cartMerchandise(checkout("100.00", [coral("60.00", 2, {
      discount_allocations: [], total_discount: "20.00",
    })]));
    assert.equal(cartMerchandiseBlock(fallback), null);
    const orderDiscount = cartMerchandise(checkout("110.00", [coral("120.00"),
      { title: "Shipping Box", price: "20.00", quantity: 1 }]));
    assert.deepEqual(orderDiscount, { currency: "USD", subtotalCents: 9000, merchandiseLines: 1 },
      "all unallocated checkout discount is conservatively charged against merchandise");
  });

  test("cart merchandise: incomplete, malformed or non-USD amounts never manufacture eligibility", () => {
    const invalid: unknown[] = [undefined, {}, { currency: "USD", line_items: [coral("100.00")] },
      checkout("100.00", [coral("100.00")], { currency: "CAD" }),
      checkout("100.00", [coral("100.00")], { presentment_currency: "CAD" }),
      checkout("100.00", [coral("100.00")], { taxes_included: true }),
      checkout("100.00", [coral("100.00")], { subtotal_price_set: { shop_money: { currency_code: "EUR", amount: "100.00" } } }),
      checkout("100.01", [coral("100.00")]),
      checkout("100.00", [{ price: "100.00", quantity: 1 }]),
      checkout("100.00", [{ title: "Coral", quantity: 1 }]),
      checkout("100.00", [coral("100.00", 1.5)]),
      checkout("100.00", [coral("100.00", -1)]),
      checkout("100.00", [coral("100.00", 1, { discount_allocations: [{ amount: "bad" }] })]),
      checkout("100.00", [coral("100.00", 1, { discount_allocations: [{ amount: "101.00" }] })]),
      checkout("100.00", [coral("100.00", 1, { discount_allocations: {} })]),
      checkout("100.00", [coral("100.00", 1, { total_discount: "-1" })]),
      checkout("100.00", [coral("100.00", 1, { currency: "EUR" })]),
      checkout("100.00", [coral("100.00", 1, { price_set: { shop_money: { currency_code: "EUR", amount: "100.00" } } })]),
    ];
    for (const amount of ["", "-1", "1e2", "100.001", "NaN", "Infinity", null, {}, Number.MAX_SAFE_INTEGER]) {
      invalid.push(checkout("100.00", [coral(amount as string)]));
      invalid.push(checkout(amount as string, [coral("100.00")]));
    }
    for (const value of invalid) assert.equal(cartMerchandiseBlock(cartMerchandise(value), 0), CART_MERCHANDISE_UNKNOWN);
    for (const facts of [undefined, { currency: "EUR", subtotalCents: 99999, merchandiseLines: 1 },
      { currency: "USD", subtotalCents: 10000.1, merchandiseLines: 1 },
      { currency: "USD", subtotalCents: 10000, merchandiseLines: 0 }]) {
      assert.equal(cartMerchandiseBlock(facts, 0), CART_MERCHANDISE_UNKNOWN);
    }
    assert.equal(isCartMerchandiseBlock(CART_MERCHANDISE_UNKNOWN), true);
    assert.equal(isCartMerchandiseBlock(CART_NO_MERCHANDISE), true);
    assert.equal(isCartMerchandiseBlock(cartMerchandiseBlock({ currency: "USD", subtotalCents: 1, merchandiseLines: 1 })!), true);
    assert.equal(isCartMerchandiseBlock("Checkout completed"), false);
  });

  test("cart merchandise: decimal prices are dollars, zero-quantity lines do not count, facts remain small", () => {
    const facts = cartMerchandise(checkout("100.01", [coral(0.01), coral("100.00"),
      { title: "Shipping Box", quantity: 0 }, { title: "Coral", quantity: 0 }], {
      abandoned_checkout_url: "https://private.example/secret", customer: { email: "private@example.com" },
    }));
    assert.deepEqual(facts, { currency: "USD", subtotalCents: 10001, merchandiseLines: 2 });
    assert.equal(cartMerchandiseBlock(facts), null);
    assert.ok(JSON.stringify(facts).length < 100);
  });
}
