import test from "node:test";
import assert from "node:assert/strict";
import { normalizeEmail, emailSuggestion } from "../lib/marketing/email-address";
import { createEmailScreen } from "../lib/marketing/email-screen";
const dnsError = (code: string) => Object.assign(new Error(code), { code });

test("email syntax rejects malformed local/domain parts and preserves legitimate plus aliases and international domains", () => {
  for (const address of ["a@@gmail.com", ".a@gmail.com", "a..b@gmail.com", "a@gmail..com", "a@-gmail.com", "a@gmail.com/path", "a@ gmail.com", "a@localhost", "a\r\n@gmail.com", "a".repeat(65) + "@gmail.com"])
    assert.throws(() => normalizeEmail(address), address);
  assert.equal(normalizeEmail(" Reef+Offers@GMAIL.com "), "reef+offers@gmail.com");
  assert.equal(normalizeEmail("reef@bücher.de"), "reef@xn--bcher-kva.de");
  assert.equal(emailSuggestion("reef@gmial.com"), "reef@gmail.com");
  assert.equal(emailSuggestion("reef@privaterelay.appleid.com"), null);
});

test("email DNS screening handles MX, null MX, NXDOMAIN, IPv4/IPv6 fallback, and temporary failures conservatively", async () => {
  let calls = 0;
  const screen = createEmailScreen(() => ({
    resolveMx: async (domain: string) => {
      calls++;
      if (domain === "null.example") return [{ priority: 0, exchange: "" }];
      if (domain === "missing.example") throw dnsError("ENOTFOUND");
      if (domain === "timeout.example") throw dnsError("ETIMEOUT");
      if (["v4.example", "v6.example", "empty.example", "unclear.example"].includes(domain)) throw dnsError("ENODATA");
      return [{ priority: 10, exchange: "mx.example" }];
    },
    resolve4: async (domain: string) => { if (domain === "v4.example") return ["192.0.2.1"]; throw dnsError(domain === "unclear.example" ? "ESERVFAIL" : "ENODATA"); },
    resolve6: async (domain: string) => { if (domain === "v6.example") return ["2001:db8::1"]; throw dnsError("ENODATA"); },
    cancel: () => {},
  }));
  assert.equal((await screen("broken-address")).status, "invalid");
  assert.equal(calls, 0);
  for (const domain of ["gmail.com", "v4.example", "v6.example", "privaterelay.appleid.com"])
    assert.equal((await screen("reef@" + domain)).status, "allowed", domain);
  for (const domain of ["null.example", "missing.example", "empty.example"])
    assert.equal((await screen("reef@" + domain)).status, "invalid", domain);
  for (const domain of ["timeout.example", "unclear.example"])
    assert.equal((await screen("reef@" + domain)).status, "temporary", domain);
  const before = calls;
  await Promise.all([screen("another@gmail.com"), screen("third@gmail.com")]);
  assert.equal(calls, before, "cache is shared by domain, not copied per recipient");
});

test("email DNS cache expires invalid and temporary results and coalesces concurrent domain lookups", async () => {
  let clock = 0, calls = 0, unavailable = true;
  const screen = createEmailScreen(() => ({
    resolveMx: async () => { calls++; if (unavailable) throw dnsError("ESERVFAIL"); return [{ priority: 10, exchange: "mx.example" }]; },
    resolve4: async () => [], resolve6: async () => [], cancel: () => {},
  }), () => clock);
  assert.equal((await screen("one@example.com")).status, "temporary");
  unavailable = false;
  clock = 30001;
  const recovered = await Promise.all([screen("one@example.com"), screen("two@example.com")]);
  assert.ok(recovered.every(result => result.status === "allowed"));
  assert.equal(calls, 2);
});
