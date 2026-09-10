import {
  Content,
  MarketingOperations,
  content,
  render,
  textBody,
  withBranding,
  footerTitle,
} from "./rules";

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
  for (const field of ["logo", "footerImage"] as const) {
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
        ? "Your 10% discount code: " +
          effectiveContent.couponCode +
          " (one use; cannot combine with other discounts)"
        : undefined,
      (effectiveContent.products || [])
        .map((p) => [p.title, p.price, p.url].filter(Boolean).join(" · "))
        .join("\n"),
      effectiveContent.url,
      footerTitle(effectiveContent),
      effectiveContent.footerText,
      organizationName,
      effectiveContent.showPostalAddress === true ? address : "",
      effectiveContent.footerUnsubscribeText,
      "Unsubscribe: " + m.unsubscribe,
      "© " + new Date().getFullYear() + " " + organizationName + " | All rights reserved.",
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
  ) {
    super(message);
  }
}
export const resendProvider: DeliveryProvider = {
  async send(m) {
    const key = process.env.RESEND_API_KEY,
      from = process.env.RESEND_FROM_EMAIL,
      address = m.address || process.env.MARKETING_POSTAL_ADDRESS,
      organizationName = m.organizationName || "Corals Anonymous";
    if (!key || !from || !address)
      throw new DeliveryError(
        "Email sender and postal address are not configured.",
      );
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
        body: JSON.stringify({
          from,
          to: [m.to],
          subject: m.subject,
          ...emailBody(m, address, organizationName),
          headers: m.internalPreview
            ? undefined
            : {
                "List-Unsubscribe": `<${m.unsubscribe}>`,
                "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
              },
          tags: [{ name: "marketing_message", value: m.id }],
        }),
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
    const endpoint = process.env.MARKETING_SMS_GATEWAY_URL,
      key = process.env.MARKETING_SMS_GATEWAY_KEY;
    if (!endpoint || !key || !endpoint.startsWith("https://"))
      throw new DeliveryError("SMS gateway is not configured.");
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
        body: JSON.stringify({
          id: m.id,
          to: m.to,
          channel: m.channel,
          text: `Corals Anonymous: ${textBody(m.content, m.profileName)} ${m.content.url}${m.channel === "SMS_MARKETING" ? " Reply STOP to opt out." : ""}`,
        }),
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
  postalAddress = process.env.MARKETING_POSTAL_ADDRESS || "",
) {
  const env = {
    sendingEnabled: process.env.MARKETING_SEND_ENABLED === "true",
    migrationConfirmed: process.env.MARKETING_MIGRATION_CONFIRMED === "true",
    ingestEnabled: process.env.MARKETING_INGEST_ENABLED === "true",
    formEnabled: process.env.MARKETING_FORM_ENABLED === "true",
  };
  return {
    deployment: env,
    senderEmail: process.env.RESEND_FROM_EMAIL || "",
    sendingEnabled:
      env.sendingEnabled && (operations?.sendingEnabled ?? env.sendingEnabled),
    emailReady: !!(
      process.env.RESEND_API_KEY &&
      process.env.RESEND_FROM_EMAIL &&
      postalAddress.trim() &&
      process.env.APP_BASE_URL &&
      process.env.RESEND_WEBHOOK_SECRET
    ),
    smsReady: !!(
      process.env.MARKETING_SMS_GATEWAY_URL &&
      process.env.MARKETING_SMS_GATEWAY_KEY &&
      process.env.MARKETING_SMS_WEBHOOK_SECRET
    ),
    migrationConfirmed:
      env.migrationConfirmed &&
      (operations?.migrationConfirmed ?? env.migrationConfirmed),
    ingestEnabled:
      env.ingestEnabled && (operations?.ingestEnabled ?? env.ingestEnabled),
    formEnabled:
      env.formEnabled && (operations?.formEnabled ?? env.formEnabled),
    couponReady: !!process.env.MARKETING_WELCOME_COUPON,
    storefrontOrigin: process.env.MARKETING_STOREFRONT_ORIGIN || "",
    attribution:
      "Last recorded click within 5 days; otherwise open within 1 day. One message per order; currencies remain separate.",
  };
}
