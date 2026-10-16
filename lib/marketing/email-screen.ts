import { Resolver } from "node:dns/promises";
import { normalizeEmail } from "./email-address";

export type EmailScreen = { status: "allowed" | "invalid" | "temporary"; reason: string };
type MailDNS = {
  resolveMx(domain: string): Promise<{ priority: number; exchange: string }[]>;
  resolve4(domain: string): Promise<string[]>;
  resolve6(domain: string): Promise<string[]>;
  cancel(): void;
};
const code = (e: unknown) => (e as { code?: string })?.code;
const absent = (e: unknown) => ["ENODATA", "ENOTFOUND"].includes(code(e) || "");

// Cache domains, never large per-profile records. Coalesce concurrent requests and
// bound both memory and wall time, including when the DNS server is unavailable.
export function createEmailScreen(makeResolver: () => MailDNS = () => new Resolver({ timeout: 1500, tries: 1 }), now = Date.now) {
  const cache = new Map<string, { expires: number; result: Promise<EmailScreen> }>();
  async function lookup(domain: string): Promise<EmailScreen> {
    const dns = makeResolver();
    let timer: ReturnType<typeof setTimeout>;
    const query = async (): Promise<EmailScreen> => {
      let mx: { priority: number; exchange: string }[];
      try { mx = await dns.resolveMx(domain); }
      catch (e) {
        if (code(e) === "ENOTFOUND") return { status: "invalid", reason: "Email domain does not exist." };
        if (!absent(e)) return { status: "temporary", reason: "Email domain check temporarily unavailable; delivery will retry." };
        mx = [];
      }
      if (mx.some(record => record.exchange && record.exchange !== "."))
        return { status: "allowed", reason: "Email domain accepts mail; mailbox existence is unverified." };
      // RFC 7505 null MX explicitly declares that a domain accepts no mail.
      if (mx.length === 1 && mx[0].priority === 0 && ["", "."].includes(mx[0].exchange))
        return { status: "invalid", reason: "Email domain does not accept email (null MX)." };
      if (mx.length) return { status: "temporary", reason: "Email domain has an unclear mail configuration; delivery will retry." };
      // RFC 5321 implicit MX: lack of MX alone is not evidence of an invalid domain.
      const addresses = await Promise.allSettled([dns.resolve4(domain), dns.resolve6(domain)]);
      if (addresses.some(result => result.status === "fulfilled" && result.value.length))
        return { status: "allowed", reason: "Email domain has fallback mail routing; mailbox existence is unverified." };
      if (addresses.some(result => result.status === "rejected" && !absent(result.reason)))
        return { status: "temporary", reason: "Email domain check temporarily unavailable; delivery will retry." };
      return { status: "invalid", reason: "Email domain has no mail routing." };
    };
    try {
      return await Promise.race([query(), new Promise<EmailScreen>(resolve => {
        timer = setTimeout(() => { resolve({ status: "temporary", reason: "Email domain check timed out; delivery will retry." }); dns.cancel(); }, 4000);
      })]);
    } catch {
      return { status: "temporary", reason: "Email domain check temporarily unavailable; delivery will retry." };
    } finally { clearTimeout(timer!); }
  }
  return async (value: unknown): Promise<EmailScreen> => {
    let address: string;
    try { address = normalizeEmail(value); }
    catch { return { status: "invalid", reason: "Invalid email address format." }; }
    const domain = address.slice(address.lastIndexOf("@") + 1);
    const saved = cache.get(domain);
    if (saved && saved.expires > now()) return saved.result;
    if (cache.size >= 2000) cache.delete(cache.keys().next().value!);
    const entry = { expires: now() + 60000, result: lookup(domain) };
    cache.set(domain, entry);
    const result = await entry.result;
    entry.expires = now() + (result.status === "allowed" ? 3600000 : result.status === "invalid" ? 300000 : 30000);
    return result;
  };
}
export const screenEmail = createEmailScreen();
