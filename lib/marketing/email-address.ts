// Synchronous address validation, separate from consent/identity ingestion.
export function normalizeEmail(value: unknown) {
  const address = String(value || "").trim().toLowerCase();
  const at = address.lastIndexOf("@");
  const local = address.slice(0, at);
  const domain = address.slice(at + 1);
  let ascii = "";
  try { ascii = new URL(`http://${domain}`).hostname; } catch {}
  const dotAtom = /^[a-z0-9!#$%&'*+\-/=?^_`{|}~]+(?:\.[a-z0-9!#$%&'*+\-/=?^_`{|}~]+)*$/i;
  const quoted = /^"(?:[\x20-\x21\x23-\x5b\x5d-\x7e]|\\[\x20-\x7e])*"$/;
  if (at < 1 || local.length > 64 || `${local}@${ascii}`.length > 254 ||
    (!dotAtom.test(local) && !quoted.test(local)) ||
    /[\s/@:#?\\]/.test(domain) || !ascii.includes(".") || ascii.length > 253 ||
    !ascii.split(".").every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label)))
    throw new Error("Enter a valid email address.");
  return `${local}@${ascii}`;
}

// Suggestions only: these domains can exist and must never be silently replaced.
const typos: Record<string, string> = {
  "gmial.com": "gmail.com", "gamil.com": "gmail.com", "gmai.com": "gmail.com",
  "gmail.con": "gmail.com", "gmail.co": "gmail.com",
  "hotmial.com": "hotmail.com", "hotmai.com": "hotmail.com",
  "outlok.com": "outlook.com", "outlook.con": "outlook.com",
  "yahoo.con": "yahoo.com", "yaho.com": "yahoo.com",
};
export function emailSuggestion(address: string) {
  const at = address.lastIndexOf("@");
  const replacement = typos[address.slice(at + 1)];
  return replacement ? address.slice(0, at + 1) + replacement : null;
}
