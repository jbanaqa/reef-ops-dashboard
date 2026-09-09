import crypto from "node:crypto";
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
