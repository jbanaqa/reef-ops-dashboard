import { Content, defaultContent, email } from "./rules";
import type { FlowConfig } from "./flow-config";

export type CartConfig = {
  version: 1;
  productCount: number;
  testEmail?: string;
  bypassRecentEmailSuppression?: boolean;
};
export const defaultCartConfig: CartConfig = { version: 1, productCount: 6 };
export function validateCart(value: unknown): CartConfig {
  const c = value as CartConfig;
  if (
    !c ||
    c.version !== 1 ||
    !Number.isInteger(c.productCount) ||
    c.productCount < 0 ||
    c.productCount > 12
  )
    throw new Error("Choose 0–12 products for cart emails.");
  return {
    version: 1,
    productCount: c.productCount,
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
        ? "Looks like you left some corals in your cart!\n\nWe’re holding them, but they won’t stay forever..."
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
