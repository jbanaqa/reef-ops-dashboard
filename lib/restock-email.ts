type SendRestockEmailInput = {
  subscriptionId: string;
  to: string;
  productTitle: string;
  productUrl: string | null;
  unsubscribeUrl: string;
};

function getEmailConfig() {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL;
  const appBaseUrl = process.env.APP_BASE_URL;

  if (!apiKey || !from || !appBaseUrl) {
    return null;
  }

  return {
    apiKey,
    from,
    appBaseUrl,
  };
}

export function isRestockEmailConfigured() {
  return Boolean(getEmailConfig());
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export async function sendRestockEmail(input: SendRestockEmailInput) {
  const config = getEmailConfig();

  if (!config) {
    return {
      sent: false,
      skippedReason: "restock_email_not_configured",
    };
  }

  const safeProductTitle = escapeHtml(input.productTitle);
  const productLinkHtml = input.productUrl
    ? `<p><a href="${escapeHtml(input.productUrl)}">View it on the store</a></p>`
    : "";

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
      "Idempotency-Key": `restock-${input.subscriptionId}`,
    },
    body: JSON.stringify({
      from: config.from,
      to: input.to,
      subject: `${input.productTitle} is available again`,
      text: [
        `Good news: ${input.productTitle} is available again.`,
        "",
        "Available options may vary, so please check the product page for current inventory.",
        input.productUrl ? `View it here: ${input.productUrl}` : "",
        "",
        `Unsubscribe from this alert: ${input.unsubscribeUrl}`,
      ]
        .filter(Boolean)
        .join("\n"),
      html: `
        <div style="font-family: Arial, sans-serif; color: #0f172a; line-height: 1.6;">
          <p>Good news: <strong>${safeProductTitle}</strong> is available again.</p>
          <p>Available options may vary, so please check the product page for current inventory.</p>
          ${productLinkHtml}
          <p style="font-size: 13px; color: #64748b;">
            You asked us to notify you when this product came back.
            <a href="${escapeHtml(input.unsubscribeUrl)}">Unsubscribe from this alert</a>.
          </p>
        </div>
      `,
    }),
  });

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    console.error("Resend restock email error:", data);
    throw new Error("Failed to send restock email.");
  }

  return {
    sent: true,
    data,
  };
}
