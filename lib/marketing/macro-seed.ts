import { prisma } from "@/lib/prisma";
import { defaultMacroCampaignContent } from "./brands";
import { currentMarketingBrand } from "./context";
import { macroSubscriberList } from "./macro-subscriber-eligibility";
import { defaultMarketingSettings } from "./rules";
import { json, shop } from "./store";

/** A fresh campaign workspace has no copied profiles, flows, history or artwork. */
export async function seedMacroMarketing() {
  if (currentMarketingBrand() !== "macroalgae-farms") throw Error("Choose Macroalgae Farms for this workspace.");
  const resources = [
    { kind: "SEGMENT", key: "mailable", name: "Macroalgae Farms subscribers", data: { list: macroSubscriberList } },
    { kind: "TEMPLATE", key: "macro-standard", name: "Macroalgae Farms standard", data: defaultMacroCampaignContent },
    { kind: "SETTINGS", key: "global", name: "Macroalgae Farms email settings", data: {
      ...defaultMarketingSettings,
      organizationName: "Macroalgae Farms",
      branding: {},
      operations: { sendingEnabled: false, migrationConfirmed: false, ingestEnabled: false, formEnabled: false },
    } },
  ];
  for (const resource of resources) await prisma.marketingResource.upsert({
    where: { shop_kind_key: { shop: shop(), kind: resource.kind, key: resource.key } },
    create: { shop: shop(), ...resource, data: json(resource.data) },
    update: {},
  });
}
