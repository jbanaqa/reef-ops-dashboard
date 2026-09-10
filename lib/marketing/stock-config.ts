import { email, phone, content, defaultContent, Content } from "./rules";
export type StockConfig = {
  collectionId: string;
  threshold: number;
  recipientEmail: string;
  recipientPhone: string;
  timezone: string;
  emailEnabled: boolean;
  smsEnabled: boolean;
  smsConsentConfirmed: boolean;
  emailSubject: string;
  emailBody: string;
  emailContent?: Content;
  smsBody: string;
};
export const defaultStockConfig: StockConfig = {
  collectionId: "488202338530",
  threshold: 5,
  recipientEmail: "russellvinson7@gmail.com",
  recipientPhone: "+16573450924",
  timezone: "America/Los_Angeles",
  emailEnabled: true,
  smsEnabled: true,
  smsConsentConfirmed: false,
  emailSubject: "URGENT — Low Stock Alert: {{ ProductTitle }}",
  emailBody:
    "Low stock alert for the T5 Tank collection.\n\nProduct: {{ ProductTitle }}\nVariant: {{ VariantTitle }}\nCurrent inventory: {{ InventoryQuantity }} units\n\nPlease restock soon.",
  smsBody:
    "URGENT — Low stock: {{ ProductTitle }} ({{ VariantTitle }}) is down to {{ InventoryQuantity }} units. Restock needed!",
};
export const stockTokens = [
  "ProductTitle",
  "VariantTitle",
  "InventoryQuantity",
  "ProductURL",
] as const;
export function validateStock(value: unknown, ready = false): StockConfig {
  if (!value || typeof value !== "object")
    throw new Error(
      "Review the new stock alert settings before enabling this flow.",
    );
  const s = value as StockConfig;
  const collectionId = String(s.collectionId || "")
    .replace(/^gid:\/\/shopify\/Collection\//, "")
    .trim();
  if (!/^\d+$/.test(collectionId))
    throw new Error("Enter a Shopify collection ID.");
  if (
    !Number.isInteger(s.threshold) ||
    s.threshold < 1 ||
    s.threshold > 1000000
  )
    throw new Error(
      "Stock threshold must be a whole number from 1 to 1,000,000.",
    );
  const recipientEmail = email(s.recipientEmail);
  const recipientPhone = s.recipientPhone ? phone(s.recipientPhone) : "";
  const timezone = String(s.timezone || "").trim();
  if (timezone) {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format();
    } catch {
      throw new Error("Choose a valid recipient timezone.");
    }
  }
  const copy = (v: unknown, max: number, label: string) => {
    if (typeof v !== "string" || !v.trim() || v.length > max)
      throw new Error(label + " is required (maximum " + max + " characters).");
    for (const match of v.matchAll(/{{\s*([^{}]+?)\s*}}/g))
      if (!(stockTokens as readonly string[]).includes(match[1].trim()))
        throw new Error("Unknown stock field: " + match[1]);
    return v.trim();
  };
  const result = {
    collectionId,
    threshold: s.threshold,
    recipientEmail,
    recipientPhone,
    timezone,
    emailEnabled: s.emailEnabled === true,
    smsEnabled: s.smsEnabled === true,
    smsConsentConfirmed: s.smsConsentConfirmed === true,
    emailContent: s.emailContent ? content(s.emailContent) : undefined,
    emailSubject: copy(s.emailSubject, 200, "Email subject"),
    emailBody: copy(s.emailBody, 5000, "Email message"),
    smsBody: copy(s.smsBody, 1000, "Text message"),
  };
  if (/[\r\n]/.test(result.emailSubject))
    throw new Error("Email subject must be one line.");
  if (!result.emailEnabled && !result.smsEnabled)
    throw new Error("Choose email, text, or both.");
  if (
    ready &&
    result.smsEnabled &&
    (!recipientPhone || !timezone || !result.smsConsentConfirmed)
  )
    throw new Error(
      "Add the recipient’s phone number, timezone, and permission for staff texts, or turn off text alerts for now.",
    );
  return result;
}
export function stockCopy(
  template: string,
  values: Record<(typeof stockTokens)[number], string>,
) {
  return template.replace(
    /{{\s*(ProductTitle|VariantTitle|InventoryQuantity|ProductURL)\s*}}/g,
    (_, key: (typeof stockTokens)[number]) => values[key],
  );
}
export function stockQuietHours(timezone: string, at = new Date()) {
  const hour = Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "numeric",
      hourCycle: "h23",
    }).format(at),
  );
  return hour < 11 || hour >= 20;
}

export function stockMessageContent(
  s: StockConfig,
  channel: string,
  values: Record<(typeof stockTokens)[number], string>,
) {
  return content({
    ...defaultContent,
    ...(channel === "EMAIL" ? s.emailContent : {}),
    heading: "Low stock alert",
    preview: "Internal inventory alert",
    body: stockCopy(channel === "EMAIL" ? s.emailBody : s.smsBody, values),
    bodyHtml: undefined,
    url: values.ProductURL,
    button: "View product",
  });
}
