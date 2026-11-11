import test from "node:test";
import assert from "node:assert/strict";
import { isolated, type Context } from "./cart-launch.integration";
import { threeStepCartDraft } from "../lib/marketing/cart-config";
import { defaultMarketingSettings, type EmailBranding } from "../lib/marketing/rules";

const post = (body: unknown) => new Request("https://dashboard.example/api/marketing?brand=corals-anonymous", {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
});

export function registerFlowBrandingTests(context: () => Context) {
  for (const mode of ["existing", "empty", "explicit"] as const) {
    test(`flow branding: ${mode} shared header is handled without changing saved step artwork`, async () => isolated(context(), "branding-" + mode, async h => {
      const previousAuth = process.env.DASHBOARD_AUTH_DISABLED;
      process.env.DASHBOARD_AUTH_DISABLED = "true";
      try {
        const api = await import("../app/api/marketing/route");
        const globalLogo = "https://images.example/shared-original.png", globalScale = 1.8;
        const branding: EmailBranding = { footerConfigured: true, footerText: "Saved shared footer",
          ...(mode !== "empty" ? { logo: globalLogo, logoScale: globalScale } : {}) };
        const settingsWhere = { shop_kind_key: { shop: h.shop, kind: "SETTINGS", key: "global" } };
        await h.prisma.marketingResource.upsert({ where: settingsWhere,
          create: { ...settingsWhere.shop_kind_key, name: "Marketing settings", data: h.store.json({ ...defaultMarketingSettings, branding }) },
          update: { data: h.store.json({ ...defaultMarketingSettings, branding }) } });
        const flow = threeStepCartDraft(h.f);
        flow.steps = flow.steps.map((step, index) => ({ ...step, content: { ...step.content,
          logo: `https://images.example/cart-step-${index}.png`, logoScale: 1 + index * 0.1 } }));
        const explicit = { ...flow.steps[0].content, logo: "https://images.example/explicit-shared.png", logoScale: 1.4 };
        const response = await api.POST(post({ action: "save-resource", kind: "FLOW", key: "abandoned-cart", name: "Abandoned Cart",
          enabled: true, data: flow, ...(mode === "explicit" ? { brandingSource: explicit } : {}) }));
        assert.equal(response.status, 200, JSON.stringify(await response.json()));
        const savedSettings = await h.prisma.marketingResource.findUniqueOrThrow({ where: settingsWhere });
        const savedBranding = (savedSettings.data as { branding: EmailBranding }).branding;
        if (mode === "existing") {
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
      } finally {
        if (previousAuth === undefined) delete process.env.DASHBOARD_AUTH_DISABLED;
        else process.env.DASHBOARD_AUTH_DISABLED = previousAuth;
      }
    }));
  }
}
