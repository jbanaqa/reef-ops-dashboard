import crypto from "node:crypto";

type EmailSuppression = {
  status: string;
  suppressed: boolean;
  source: string;
  reason: string | null;
};

/** Only an explicit customer opt-out can be reversed through email ownership confirmation. */
export function canConfirmEmailResubscription(
  consent: EmailSuppression | null | undefined,
) {
  return (
    consent?.status === "UNSUBSCRIBED" &&
    consent.suppressed &&
    !consent.reason &&
    ["unsubscribe-link", "shopify"].includes(consent.source)
  );
}

export function newConfirmation() {
  const token = crypto.randomBytes(32).toString("hex");
  return { token, hash: confirmationHash(token) };
}
export function confirmationHash(token: string) {
  if (!/^[a-f0-9]{64}$/.test(token))
    throw new Error(
      "Invalid or expired confirmation link. Request a new signup email.",
    );
  return crypto.createHash("sha256").update(token).digest("hex");
}
