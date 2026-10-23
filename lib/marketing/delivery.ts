import {
  Content,
  MarketingOperations,
  content,
  render,
  textBody,
  withBranding,
  footerTitle,
  footerCopyright,
  defaultGeneratedEmailCopy,
  personalize,
} from "./rules";
import { screenEmail } from "./email-screen";
import { currentMarketingBrand, marketingEnv } from "./context";
import { marketingBrand } from "./brands";

export type DeliverySender = { name?: string; email?: string; replyTo?: string };

function senderMailbox(sender?: DeliverySender) {
  const configured = sender?.email?.trim() || marketingEnv("RESEND_FROM_EMAIL") || "";
  return (configured.match(/<([^<>]+)>\s*$/)?.[1] || configured).trim();
}

function senderFrom(sender?: DeliverySender) {
  const configured = sender?.email?.trim() || marketingEnv("RESEND_FROM_EMAIL") || "";
  const name = sender?.name?.replace(/[\r\n<>"]/g, " ").trim();
  if (!name || !configured) return configured;
  return `${name} <${senderMailbox(sender)}>`;
}

export type Delivery = {
  id: string;
  internalPreview?: boolean;
  to: string;
  channel: string;
  subject: string;
  content: Content;
  unsubscribe: string;
  profileName?: string;
  address?: string;
  organizationName?: string;
  branding?: import("./rules").EmailBranding;
  sender?: DeliverySender;
  /** Invoked after asynchronous preparation, immediately before contacting the provider. */
  beforeSend?: () => Promise<void>;
};
export function emailBody(
  m: Delivery,
  address: string,
  organizationName: string,
) {
  const effectiveContent = content(withBranding(m.content, m.branding));
  let html = render(
    effectiveContent,
    m.unsubscribe,
    address,
    m.profileName,
    organizationName,
    m.branding,
  );
  const attachments: {
    filename: string;
    content: string;
    content_id: string;
  }[] = [];
  for (const field of [
    "logo",
    "footerImage",
    "hero",
    "welcomeFeatureImage",
    "instagramIcon",
    "facebookIcon",
  ] as const) {
    const image = effectiveContent[field];
    const match = image?.match(
      /^data:image\/(png|jpeg|webp|gif);base64,([a-zA-Z0-9+/=]+)$/,
    );
    if (match) {
      const id = "marketing-" + field;
      attachments.push({
        filename: field + "." + match[1],
        content: match[2],
        content_id: id,
      });
      html = html.replaceAll(image!, "cid:" + id);
    }
  }
  return {
    html,
    attachments: attachments.length ? attachments : undefined,
    text: [
      effectiveContent.heading,
      textBody(effectiveContent, m.profileName),
      effectiveContent.couponCode
        ? (effectiveContent.couponLabel ||
            defaultGeneratedEmailCopy.genericCouponLabel) +
          " " +
          effectiveContent.couponCode +
          (effectiveContent.couponTerms === ""
            ? ""
            : " (" +
              (effectiveContent.couponTerms ||
                defaultGeneratedEmailCopy.welcomeCouponTerms) +
              ")")
        : undefined,
      effectiveContent.couponExpiresAt
        ? (effectiveContent.couponExpiryText ||
            defaultGeneratedEmailCopy.couponExpiry
          ).replace(
            "{{ coupon_expires }}",
            effectiveContent.couponExpiresAt,
          )
        : undefined,
      (effectiveContent.products || [])
        .map((p) =>
          [
            p.title,
            p.price,
            p.compareAtPrice ? "Was " + p.compareAtPrice : "",
            p.url,
          ]
            .filter(Boolean)
            .join(" · "),
        )
        .join("\n"),
      effectiveContent.campaignLayout?.sections
        .flatMap((section) =>
          section.type === "products"
            ? section.products.map((product) =>
                [
                  product.title,
                  product.showSalePrice === false ? "" : product.salePrice,
                  product.showCompareAtPrice === false
                    ? ""
                    : product.compareAtPrice
                      ? "Was " + product.compareAtPrice
                      : "",
                  product.url,
                ]
                  .filter(Boolean)
                  .join(" · "),
              )
            : section.type === "cta"
              ? [section.label + ": " + section.url]
              : [[section.text, section.accent].filter(Boolean).join(" ") + ": " + section.url],
        )
        .join("\n"),
      effectiveContent.url,
      footerTitle(effectiveContent),
      effectiveContent.footerText,
      organizationName,
      effectiveContent.showPostalAddress === true ? address : "",
      effectiveContent.footerUnsubscribeText,
      "Unsubscribe: " + m.unsubscribe,
      footerCopyright(effectiveContent, organizationName),
      effectiveContent.instagramUrl
        ? "Instagram: " + effectiveContent.instagramUrl
        : "",
      effectiveContent.facebookUrl
        ? "Facebook: " + effectiveContent.facebookUrl
        : "",
    ]
      .filter(Boolean)
      .join("\n\n"),
  };
}
export interface DeliveryProvider {
  send(message: Delivery): Promise<string>;
}
export class DeliveryError extends Error {
  constructor(
    message: string,
    public uncertain = false,
    public retryable = false,
    public retryAfterMs = 0,
    public addressCheck = false,
  ) {
    super(message);
  }
}
/** The worker has already persisted a stop/deferral; no provider request was made. */
export class DeliveryStopped extends Error {}
export async function checkEmailBeforeSending(address: string) {
  const result = await screenEmail(address);
  if (result.status !== "allowed")
    throw new DeliveryError("Email check: " + result.reason, false, result.status === "temporary", 300000, true);
}
export const resendProvider: DeliveryProvider = {
  async send(m) {
    await checkEmailBeforeSending(m.to);
    const key = marketingEnv("RESEND_API_KEY"),
      from = senderFrom(m.sender),
      address = m.address || marketingEnv("MARKETING_POSTAL_ADDRESS"),
      organizationName = m.organizationName || marketingBrand(currentMarketingBrand()).name;
    if (!key || !from || !address)
      throw new DeliveryError(
        "Email sender and postal address are not configured.",
      );
    const body = JSON.stringify({
      from,
      ...(m.sender?.replyTo ? { reply_to: m.sender.replyTo } : {}),
      to: [m.to],
      subject: personalize(m.subject, m.profileName),
      ...emailBody(m, address, organizationName),
      headers: m.internalPreview ? undefined : {
        "List-Unsubscribe": `<${m.unsubscribe}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
      tags: [{ name: "marketing_message", value: m.id }, { name: "marketing_brand", value: currentMarketingBrand() }],
    });
    // Keep this outside the network-error catch: stopping here is a known non-send.
    await m.beforeSend?.();
    let response: Response;
    try {
      response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        signal: AbortSignal.timeout(20000),
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          "Idempotency-Key": `marketing-${m.id}`,
        },
        body,
      });
    } catch {
      throw new DeliveryError(
        "Email delivery outcome unknown; reconcile with provider before retrying.",
        true,
      );
    }
    if (!response.ok)
      throw new DeliveryError(
        `Email provider returned ${response.status}`,
        response.status >= 500,
        response.status === 429,
        Math.max(
          0,
          Math.min(
            3600000,
            (Number(response.headers.get("retry-after")) || 0) * 1000,
          ),
        ),
      );
    const data = await response.json();
    if (!data.id)
      throw new DeliveryError(
        "Provider accepted request without a message ID.",
        true,
      );
    return String(data.id);
  },
};
// The gateway contract deliberately requires durable idempotency and opt-out enforcement.
// A carrier adapter must implement this contract before SMS can be enabled.
export const smsProvider: DeliveryProvider = {
  async send(m) {
    const endpoint = marketingEnv("MARKETING_SMS_GATEWAY_URL"),
      key = marketingEnv("MARKETING_SMS_GATEWAY_KEY");
    if (!endpoint || !key || !endpoint.startsWith("https://"))
      throw new DeliveryError("SMS gateway is not configured.");
    const body = JSON.stringify({
      id: m.id, to: m.to, channel: m.channel,
      text: `Corals Anonymous: ${textBody(m.content, m.profileName)} ${m.content.url}${m.channel === "SMS_MARKETING" ? " Reply STOP to opt out." : ""}`,
    });
    await m.beforeSend?.();
    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: "POST",
        signal: AbortSignal.timeout(20000),
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          "Idempotency-Key": m.id,
        },
        body,
      });
    } catch {
      throw new DeliveryError(
        "SMS outcome unknown; reconcile with gateway.",
        true,
      );
    }
    if (!response.ok)
      throw new DeliveryError(
        `SMS gateway returned ${response.status}`,
        response.status >= 500,
        response.status === 429,
        Math.max(
          0,
          Math.min(
            3600000,
            (Number(response.headers.get("retry-after")) || 0) * 1000,
          ),
        ),
      );
    const data = await response.json();
    if (!data.id)
      throw new DeliveryError("SMS gateway returned no message ID.", true);
    return `sms:${data.id}`;
  },
};

export function setup(
  operations?: MarketingOperations,
  postalAddress = marketingEnv("MARKETING_POSTAL_ADDRESS") || "",
  sender?: DeliverySender,
) {
  // Deployment capability alone must never activate a newly selected store.
  operations ||= currentMarketingBrand() === "macroalgae-farms"
    ? { sendingEnabled: false, migrationConfirmed: false, ingestEnabled: false, formEnabled: false }
    : undefined;
  const env = {
    sendingEnabled: marketingEnv("MARKETING_SEND_ENABLED") === "true",
    migrationConfirmed: marketingEnv("MARKETING_MIGRATION_CONFIRMED") === "true",
    ingestEnabled: marketingEnv("MARKETING_INGEST_ENABLED") === "true",
    formEnabled: marketingEnv("MARKETING_FORM_ENABLED") === "true",
  };
  return {
    deployment: env,
    senderEmail: senderMailbox(sender),
    senderName: sender?.name?.trim() || marketingEnv("RESEND_FROM_EMAIL")?.match(/^\s*([^<>]*)<[^<>]+>\s*$/)?.[1]?.trim().replace(/^"|"$/g, "") || "",
    sendingEnabled:
      env.sendingEnabled && (operations?.sendingEnabled ?? env.sendingEnabled),
    emailReady: !!(
      marketingEnv("RESEND_API_KEY") &&
      senderFrom(sender) &&
      postalAddress.trim() &&
      marketingEnv("APP_BASE_URL") &&
      marketingEnv("RESEND_WEBHOOK_SECRET")
    ),
    smsReady: !!(
      marketingEnv("MARKETING_SMS_GATEWAY_URL") &&
      marketingEnv("MARKETING_SMS_GATEWAY_KEY") &&
      marketingEnv("MARKETING_SMS_WEBHOOK_SECRET")
    ),
    migrationConfirmed:
      env.migrationConfirmed &&
      (operations?.migrationConfirmed ?? env.migrationConfirmed),
    ingestEnabled:
      env.ingestEnabled && (operations?.ingestEnabled ?? env.ingestEnabled),
    formEnabled:
      env.formEnabled && (operations?.formEnabled ?? env.formEnabled),
    couponReady: !!marketingEnv("MARKETING_WELCOME_COUPON"),
    storefrontOrigin: marketingEnv("MARKETING_STOREFRONT_ORIGIN") || "",
    attribution:
      "Klaviyo-style email last touch. One message per order; currencies remain separate.",
  };
}
