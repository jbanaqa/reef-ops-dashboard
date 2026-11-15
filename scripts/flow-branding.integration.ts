import test from "node:test";
import assert from "node:assert/strict";
import { isolated, type Context } from "./cart-launch.integration";
import { threeStepCartDraft } from "../lib/marketing/cart-config";
import { defaultContent, defaultMarketingSettings, type EmailBranding } from "../lib/marketing/rules";
import { applyCoralsReefDesign } from "../lib/marketing/corals-reef";

const post = (body: unknown) => new Request("https://dashboard.example/api/marketing?brand=corals-anonymous", {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
});

export function registerFlowBrandingTests(context: () => Context) {
  for (const mode of ["existing", "empty", "explicit", "independent-existing", "independent-empty"] as const) {
    test(`flow branding: ${mode} shared header is handled without changing saved step artwork`, async () => isolated(context(), "branding-" + mode, async h => {
      const previousAuth = process.env.DASHBOARD_AUTH_DISABLED;
      process.env.DASHBOARD_AUTH_DISABLED = "true";
      try {
        const api = await import("../app/api/marketing/route");
        const globalLogo = "https://images.example/shared-original.png", globalScale = 1.8;
        const branding: EmailBranding = { footerConfigured: true, footerText: "Saved shared footer",
          ...(mode !== "empty" && mode !== "independent-empty" ? { logo: globalLogo, logoScale: globalScale } : {}) };
        const settingsWhere = { shop_kind_key: { shop: h.shop, kind: "SETTINGS", key: "global" } };
        await h.prisma.marketingResource.upsert({ where: settingsWhere,
          create: { ...settingsWhere.shop_kind_key, name: "Marketing settings", data: h.store.json({ ...defaultMarketingSettings, branding }) },
          update: { data: h.store.json({ ...defaultMarketingSettings, branding }) } });
        const flow = threeStepCartDraft(h.f);
        flow.steps = flow.steps.map((step, index) => ({ ...step, content: { ...step.content,
          logo: `https://images.example/cart-step-${index}.png`, logoScale: 1 + index * 0.1 } }));
        const independent = mode.startsWith("independent-");
        if (independent) flow.steps = flow.steps.map((step, index) => ({ ...step, content: applyCoralsReefDesign(step.content, "abandoned-cart", index) }));
        const explicit = independent ? { ...flow.steps[0].content,
          reefDesign: { ...flow.steps[0].content.reefDesign!, logo: "https://images.example/independent-reef.png", logoScale: 2 },
          footerText: "Updated shared compliance copy", showPostalAddress: true }
          : { ...flow.steps[0].content, logo: "https://images.example/explicit-shared.png", logoScale: 1.4 };
        if (independent) flow.steps[0].content = explicit;
        const response = await api.POST(post({ action: "save-resource", kind: "FLOW", key: "abandoned-cart", name: "Abandoned Cart",
          enabled: true, data: flow, ...(mode === "explicit" || independent ? { brandingSource: explicit } : {}) }));
        assert.equal(response.status, 200, JSON.stringify(await response.json()));
        const savedSettings = await h.prisma.marketingResource.findUniqueOrThrow({ where: settingsWhere });
        const savedBranding = (savedSettings.data as { branding: EmailBranding }).branding;
        if (independent) {
          assert.equal(savedBranding.logo, mode === "independent-existing" ? globalLogo : undefined);
          assert.equal(savedBranding.logoScale, mode === "independent-existing" ? globalScale : undefined);
          assert.equal(savedBranding.footerText, "Updated shared compliance copy");
          assert.equal(savedBranding.showPostalAddress, true, "intentional shared footer edits remain available");
        } else if (mode === "existing") {
          assert.equal(savedBranding.logo, globalLogo);
          assert.equal(savedBranding.logoScale, globalScale);
          assert.deepEqual(savedBranding, branding, "main flow save preserves the entire existing shared branding");
        } else {
          assert.equal(savedBranding.logo, mode === "explicit" ? explicit.logo : flow.steps[2].content.logo);
          assert.equal(savedBranding.logoScale, mode === "explicit" ? explicit.logoScale : flow.steps[2].content.logoScale);
        }
        const savedFlow = await h.prisma.marketingResource.findUniqueOrThrow({ where: { id: h.flowId } });
        const savedSteps = (savedFlow.data as { steps: { content: { logo: string; logoScale: number } }[] }).steps;
        assert.deepEqual(savedSteps.map(step => step.content.logo), flow.steps.map(step => step.content.logo));
        assert.deepEqual(savedSteps.map(step => step.content.logoScale), flow.steps.map(step => step.content.logoScale));
        if (independent) assert.equal((savedSteps[0].content as { reefDesign?: { logo?: string } }).reefDesign?.logo, "https://images.example/independent-reef.png");
      } finally {
        if (previousAuth === undefined) delete process.env.DASHBOARD_AUTH_DISABLED;
        else process.env.DASHBOARD_AUTH_DISABLED = previousAuth;
      }
    }));
  }
  test("flow branding: a copied Reef template cannot publish its independent or old raw logo globally", async () => isolated(context(), "branding-reef-template", async h => {
    const previousAuth = process.env.DASHBOARD_AUTH_DISABLED;
    process.env.DASHBOARD_AUTH_DISABLED = "true";
    try {
      const api = await import("../app/api/marketing/route");
      const globalLogo = "https://images.example/shared-template-original.png";
      const settingsWhere = { shop_kind_key: { shop: h.shop, kind: "SETTINGS", key: "global" } };
      await h.prisma.marketingResource.upsert({ where: settingsWhere,
        create: { ...settingsWhere.shop_kind_key, name: "Settings", data: h.store.json({ ...defaultMarketingSettings,
          branding: { footerConfigured: true, logo: globalLogo, logoScale: 1.6 } }) }, update: {} });
      const copied = applyCoralsReefDesign({ ...defaultContent, logo: "https://images.example/old-raw-template.png", logoScale: 1.1 }, "welcome", 0);
      copied.reefDesign = { ...copied.reefDesign!, logo: "https://images.example/copied-reef-logo.png" };
      const response = await api.POST(post({ action: "save-resource", kind: "TEMPLATE", key: "copied-reef", name: "Copied Reef email",
        enabled: false, data: copied, brandingSource: copied }));
      assert.equal(response.status, 200, JSON.stringify(await response.json()));
      const saved = await h.prisma.marketingResource.findUniqueOrThrow({ where: settingsWhere });
      assert.equal((saved.data as { branding: EmailBranding }).branding.logo, globalLogo);
      assert.equal((saved.data as { branding: EmailBranding }).branding.logoScale, 1.6);
      const template = await h.prisma.marketingResource.findUniqueOrThrow({ where: { shop_kind_key: { shop: h.shop, kind: "TEMPLATE", key: "copied-reef" } } });
      assert.equal((template.data as { reefDesign: { logo: string } }).reefDesign.logo, copied.reefDesign.logo);
    } finally {
      if (previousAuth === undefined) delete process.env.DASHBOARD_AUTH_DISABLED;
      else process.env.DASHBOARD_AUTH_DISABLED = previousAuth;
    }
  }));
}
