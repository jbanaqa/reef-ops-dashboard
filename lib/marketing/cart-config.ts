import { Content, defaultContent, defaultGeneratedEmailCopy, email } from "./rules";
import type { FlowConfig } from "./flow-config";

export const CART_EXPIRY_MINUTES = 3 * 24 * 60;
export const CART_UNAVAILABLE_REASON = "No purchasable items remain in this checkout";

export type CartConfig = {
  version: 1;
  recoveryVersion?: 2;
  couponHours?: number;
  productCount: number;
  minimumSubtotal?: number;
  sendStartHour?: number;
  sendEndHour?: number;
  testEmail?: string;
  bypassRecentEmailSuppression?: boolean;
};
export const defaultCartConfig: CartConfig = { version: 1, productCount: 6, minimumSubtotal: 100 };
export function validateCart(value: unknown): CartConfig {
  const c = value as CartConfig;
  if (
    !c ||
    c.version !== 1 ||
    (c.recoveryVersion !== undefined && c.recoveryVersion !== 2) ||
    !Number.isInteger(c.productCount) ||
    c.productCount < 0 ||
    c.productCount > 12
  )
    throw new Error("Choose 0–12 products for cart emails.");
  const sendStartHour = c.recoveryVersion === 2 ? 0 : c.sendStartHour ?? 9,
    sendEndHour = c.recoveryVersion === 2 ? 24 : c.sendEndHour ?? 20;
  const couponHours = c.couponHours ?? 168;
  if (!Number.isInteger(couponHours) || couponHours < 1 || couponHours > 8760)
    throw new Error("Choose a cart offer lifetime of 1–8760 hours.");
  const minimumSubtotal = c.minimumSubtotal ?? 100;
  if (typeof minimumSubtotal !== "number" || !Number.isFinite(minimumSubtotal) ||
    minimumSubtotal < 0 || minimumSubtotal > 1000000 ||
    Math.abs(minimumSubtotal * 100 - Math.round(minimumSubtotal * 100)) > 0.000001)
    throw new Error("Enter a minimum merchandise subtotal from $0 to $1,000,000, with up to two decimals.");
  if (!Number.isInteger(sendStartHour) || !Number.isInteger(sendEndHour) ||
    sendStartHour < 0 || sendEndHour > 24 || sendStartHour >= sendEndHour)
    throw new Error("Choose a cart email window with an end later than its start.");
  return {
    version: 1,
    ...(c.recoveryVersion === 2 ? { recoveryVersion: 2, couponHours } : {}),
    productCount: c.productCount,
    minimumSubtotal,
    sendStartHour,
    sendEndHour,
    ...(c.testEmail !== undefined ? { testEmail: email(c.testEmail) } : {}),
    ...(c.bypassRecentEmailSuppression === true
      ? {
          bypassRecentEmailSuppression: (() => {
            if (c.testEmail === undefined || !String(c.testEmail).trim())
              throw new Error(
                "Recent-email bypass requires a specific test email.",
              );
            return true;
          })(),
        }
      : {}),
  };
}
export const cartEmail = (
  kind: "first" | "yes" | "no",
): { subject: string; content: Content } => ({
  subject:
    kind === "first"
      ? "🌊 🐚 Claim Your Corals Before They’re Gone! 🐚 🌊"
      : kind === "yes"
        ? "🐚 Hurry! Your Corals Are Waiting... Don’t Miss Out! 🌊"
        : "🌊 🐚 Bonus 10% OFF on your corals before they’re gone! 🐠",
  content: {
    ...defaultContent,
    template: "cart-recovery",
    heading:
      kind === "no"
        ? "Your favorite corals are still waiting!"
        : "Aloha Friend,",
    body:
      kind === "first"
        ? "Looks like you left some corals in your cart!"
        : kind === "yes"
          ? "Your corals are still waiting!\n\nGrab them now before they swim away..."
          : "Grab them now and enjoy 10% OFF\n\n— but hurry, they’re going fast!",
    preview:
      kind === "first"
        ? "🤙 Aloha Friend, your reef favorites are almost gone—grab them before they’re gone for good!"
        : kind === "yes"
          ? "🤙 Aloha Friend, your corals are still in your cart—but they won’t wait forever!"
          : "🤙 Your reef picks are waiting—and with 10% off, they won’t last long",
    button: "SHOPPING CART",
    url: "https://coralsanonymous.com/cart",
  },
});
/** Upgrade the editor draft only. Saved copy/artwork is never overwritten. */
export function cartDraft(f: FlowConfig): FlowConfig {
  if (f.cart)
    return f.cart.productCount === 4
      ? { ...f, cart: { ...f.cart, productCount: 6 } }
      : f;
  const starter = (c: Content) =>
    c.body === defaultContent.body ||
    [
      "Your order is not complete yet, but your cart is still saved.",
      "Complete your order and enjoy 10% off your corals.",
    ].includes(c.body);
  const first = cartEmail("first");
  const branch = (k: "yes" | "no") => {
    const old = f.orderBranch?.[k];
    return old && !starter(old.content)
      ? old
      : {
          ...cartEmail(k),
          content: { ...old?.content, ...cartEmail(k).content },
        };
  };
  return {
    ...f,
    reviewed: false,
    cart: defaultCartConfig,
    description:
      "Recover an unfinished checkout with a text and two emails. Stop automatically after a purchase.",
    steps: [
      {
        ...(f.steps[0] && !starter(f.steps[0].content)
          ? f.steps[0]
          : {
              ...first,
              content: { ...f.steps[0]?.content, ...first.content },
              channel: "EMAIL",
            }),
        minutes: 180,
      },
    ],
    smsMinutes: 30,
    branchMinutes: 1440,
    smsContent:
      f.smsContent &&
      f.smsContent.body !== "Your cart is waiting for you at Corals Anonymous."
        ? f.smsContent
        : {
            ...defaultContent,
            heading: "Still thinking about those corals?",
            body: "👀 Still thinking about those corals?\n\nThey’re super limited, and we can’t guarantee they’ll be there much longer. Grab your cart before it’s gone",
            url: "https://coralsanonymous.com/cart",
          },
    orderBranch: { yes: branch("yes"), no: branch("no") },
  };
}

/** Deliberate editor upgrade only; existing saved enrollments retain their captured sequence. */
export function threeStepCartDraft(value: FlowConfig): FlowConfig {
  if (value.cart?.recoveryVersion === 2) return value;
  const f = cartDraft(value), offer = f.orderBranch!.no;
  const replaceRate = (text: string | undefined) => text?.replace(/\b10\s*%/g, "15%");
  const finalContent = { ...offer.content };
  for (const field of ["heading", "body", "bodyHtml", "preview", "button", "couponLabel", "couponTerms", "couponExpiryText"] as const) {
    const text = finalContent[field];
    if (typeof text === "string") finalContent[field] = text.replace(/\b10\s*%/g, "15%");
  }
  finalContent.couponLabel ??= defaultGeneratedEmailCopy.cartCouponLabel;
  finalContent.couponTerms ??= defaultGeneratedEmailCopy.cartCouponTerms.replace(/\b10\s*%/g, "15%");
  const defaultOffer = cartEmail("no");
  if (offer.content.body === defaultOffer.content.body && !offer.content.bodyHtml?.trim())
    finalContent.body = "Your cart code has been upgraded to 15% OFF!\n\nUse the same code for your final offer. Its original expiration date still applies.";
  if (offer.content.preview === defaultOffer.content.preview)
    finalContent.preview = "Your existing cart code now saves 15%. Its original expiration date is unchanged.";
  const finalSubject = offer.subject === defaultOffer.subject
    ? "Final reminder: your cart code is now 15% off"
    : replaceRate(offer.subject) || "Final reminder: 15% off your cart";
  return {
    ...f,
    description: f.description === undefined || f.description === "Recover an unfinished checkout with a text and two emails. Stop automatically after a purchase."
      ? "Recover an unfinished checkout with three emails. Stop automatically after a purchase."
      : f.description,
    cart: { ...f.cart!, recoveryVersion: 2, couponHours: 168, sendStartHour: 0, sendEndHour: 24 },
    steps: [f.steps[0],
      { ...offer, channel: "EMAIL", minutes: 240 },
      { subject: finalSubject, content: finalContent, channel: "EMAIL", minutes: 1440 }],
  };
}

/** Test runs never become customer runs when the saved audience changes. */
export function cartTestBlock(
  live: CartConfig | undefined,
  run: { testEmail?: string } | null,
  address: string | null,
  channel: string,
): string | null {
  if (live?.testEmail !== undefined) {
    if (
      !live.testEmail ||
      address?.toLowerCase() !== live.testEmail.toLowerCase()
    )
      return "Outside the cart test account";
    if (channel !== "EMAIL") return "Cart test mode sends email only";
    if (!run || run.testEmail !== live.testEmail)
      return "Start a new checkout after saving test mode";
  }
  if (run?.testEmail && run.testEmail !== live?.testEmail)
    return "Cart test ended or test account changed";
  return null;
}
