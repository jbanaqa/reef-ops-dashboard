import crypto from "node:crypto";
import { atomic, record, shop } from "./store";
import { enroll } from "./flows";
import { validateFlow } from "./flow-config";
import { eligible } from "./rules";

export async function removeProfileFromList(profileId: string, list: string) {
  if (!profileId || !list || list.length > 200)
    throw new Error("Choose a contact and one of their lists.");
  return atomic(async (tx) => {
    const profile = await tx.marketingProfile.findFirst({
      where: { id: profileId, shop: shop() },
      select: { lists: true },
    });
    if (!profile) throw new Error("Contact not found.");
    if (!profile.lists.includes(list))
      throw new Error("This contact is no longer in that list. Refresh the profile.");
    await tx.marketingProfile.update({
      where: { id: profileId },
      data: { lists: profile.lists.filter((item) => item !== list) },
    });
    await record(tx, {
      key: `staff:${crypto.randomUUID()}`,
      type: "PROFILE_LIST_REMOVED",
      profileId,
      payload: { list },
    });
    return { lists: profile.lists.filter((item) => item !== list) };
  });
}

/** Staff-only enrollment for an existing subscriber in a restricted Welcome test. */
export async function enrollExistingWelcomeTest(profileId: string) {
  if (!profileId) throw new Error("Choose a contact first.");
  return atomic(async (tx) => {
    const profile = await tx.marketingProfile.findFirst({
      where: { id: profileId, shop: shop() },
      include: { consents: true },
    });
    if (!profile?.email) throw new Error("This contact has no email address.");
    if (!eligible(profile.consents.find((item) => item.channel === "EMAIL")))
      throw new Error("This contact is not subscribed to email marketing.");
    const resource = await tx.marketingResource.findUnique({
      where: { shop_kind_key: { shop: shop(), kind: "FLOW", key: "welcome" } },
    });
    if (!resource?.enabled) throw new Error("Enable the Welcome flow first.");
    const flow = validateFlow("welcome", resource.data);
    if (!flow.reviewed) throw new Error("Review the Welcome flow first.");
    if (!flow.welcome?.testEmail || flow.welcome.testEmail !== profile.email)
      throw new Error(`Set the Welcome test audience to ${profile.email} first.`);
    const alreadyEntered = await tx.marketingResource.findUnique({
      where: { shop_kind_key: { shop: shop(), kind: "WELCOME_RUN", key: profileId } },
    });
    const priorMessage = await tx.marketingMessage.findFirst({
      where: { shop: shop(), profileId, flowKey: "welcome" },
      select: { id: true },
    });
    if (alreadyEntered || priorMessage)
      throw new Error("This contact already entered Welcome. A list change cannot reset a previous run.");
    await enroll(tx, "welcome", profileId, `staff-test:${crypto.randomUUID()}`, new Date());
    return { enrolled: true };
  });
}
