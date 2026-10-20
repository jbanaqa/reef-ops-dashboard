import { atomic, shop } from "./store";
import { eligible, marketingSettings } from "./rules";
import { setup } from "./delivery";
import { customerMarketingFlows, masterAudienceAllows } from "./master-audience";
import { campaignConsentEligible, resolveCampaignAudience, resolvedAudienceMatches } from "./campaign-audience";
import { cancelCart, currentCart, cartDependency, cartRunKey, cartSequenceStop, advanceCart, type CartRun } from "./cart";
import { cartTestBlock } from "./cart-config";
import { cartEmailNextAllowed } from "./cart-schedule";
import { validateFlow } from "./flow-config";

type Handoff = {
  id: string;
  attemptedAt: Date | null;
  recipient: string;
  cartRun: CartRun | null;
};

/** Final authorization uses only fresh local state. No remote preparation follows it. */
export async function authorizeDelivery(handoff: Handoff): Promise<boolean> {
  return atomic(async tx => {
    const m = await tx.marketingMessage.findFirst({
      where: { id: handoff.id, shop: shop() },
      include: { profile: { include: { consents: true } }, campaign: true },
    });
    // Another worker or an explicit cancellation owns this message now.
    if (!m || m.status !== "SENDING" || !m.attemptedAt || !handoff.attemptedAt ||
      +m.attemptedAt !== +handoff.attemptedAt) return false;
    const cart = handoff.cartRun;
    const stop = async (reason: string, terminal = true, until = new Date(Date.now() + 900000)) => {
      if (terminal && cart && m.channel === "EMAIL") await cancelCart(tx, cartRunKey(m.key), reason);
      await tx.marketingMessage.update({ where: { id: m.id }, data: {
        status: terminal ? "CANCELLED" : "PENDING", error: reason, ...(terminal ? {} : { dueAt: until }),
      } });
      if (terminal) await advanceCart(tx, m);
      return false;
    };
    const recipient = m.channel === "EMAIL" ? m.profile.email : m.profile.phone;
    if (!recipient || recipient !== handoff.recipient) return stop("Recipient identity changed during preparation");
    const verification = m.flowKey === "email-confirmation", staff = m.flowKey === "low-stock";
    const consent = m.profile.consents.find(c => c.channel === m.channel);
    if (!verification && (consent?.suppressed || consent?.status === "UNSUBSCRIBED"))
      return stop("Customer opted out or is suppressed");
    const audience = m.campaign ? await resolveCampaignAudience(tx, m.campaign.audience) : null;
    if (!verification && !staff && !(audience ? campaignConsentEligible(m.profile, audience, m.channel) : eligible(consent)))
      return stop(cart ? "Waiting for marketing consent and audience eligibility" : "Not eligible for this channel", !cart);
    if (m.flowKey && customerMarketingFlows.has(m.flowKey) && !(await masterAudienceAllows(tx, shop(), m.profileId)))
      return stop("Not in 2025 Mailable Subscribers", !cart);
    const settings = await tx.marketingResource.findUnique({ where: {
      shop_kind_key: { shop: shop(), kind: "SETTINGS", key: "global" },
    } });
    const saved = marketingSettings(settings?.data), gates = setup(saved.operations, saved.postalAddress);
    if (!gates.sendingEnabled || !gates.migrationConfirmed || !gates.emailReady ||
      (m.channel !== "EMAIL" && !gates.smsReady) ||
      (m.flowKey && customerMarketingFlows.has(m.flowKey) && !gates.ingestEnabled))
      return stop("Sending paused during preparation", false);
    if (await tx.marketingWebhookInbox.count({ where: { shop: shop(), status: { not: "DONE" } } }))
      return stop("Waiting for Shopify events before sending", false);
    const flow = m.flowKey && !verification ? await tx.marketingResource.findUnique({ where: {
      shop_kind_key: { shop: shop(), kind: "FLOW", key: m.flowKey },
    } }) : null;
    if (m.flowKey && !verification && (!flow?.enabled || !(flow.data as { reviewed?: boolean }).reviewed))
      return stop("Flow paused during preparation", false);
    if (m.campaign) {
      if (!["SENDING", "SCHEDULED"].includes(m.campaign.status)) return stop("Campaign cancelled");
      if (m.campaign.recipientMode === "SEND_TIME" && !resolvedAudienceMatches(m.profile, audience!))
        return stop("No longer in the campaign audience");
    }
    if (m.flowKey === "b2b-welcome" && (!m.profile.tags.includes("b2b") ||
      ((flow?.data as { testEmail?: string })?.testEmail && (flow!.data as { testEmail: string }).testEmail !== m.profile.email)))
      return stop("B2B audience changed during preparation");
    if (cart) {
      const live = validateFlow("abandoned-cart", flow!.data);
      const latest = await currentCart(tx, m.key, { ...cart, config: { ...cart.config, cart: live.cart } });
      const reason = latest.stop || cartTestBlock(live.cart, latest, m.profile.email, m.channel) ||
        await cartSequenceStop(tx, m.key, m.flowCondition) ||
        (m.profile.lastOrderAt && m.triggerAt && m.profile.lastOrderAt >= m.triggerAt ? "Customer purchased after checkout" : null);
      if (reason) return stop(reason);
      if (latest.observedAt !== cart.observedAt) return stop("Checkout changed during preparation", false);
      const dependency = await cartDependency(tx, m, latest);
      const quietUntil = m.channel === "EMAIL" ? cartEmailNextAllowed(live.cart!, (m.profile.properties as { timezone?: string })?.timezone) : null;
      if (dependency || quietUntil) return stop("Waiting for the abandonment delay or cart email sending hours", false,
        new Date(Math.max(+(dependency || 0), +(quietUntil || 0))));
    }
    return true;
  });
}
