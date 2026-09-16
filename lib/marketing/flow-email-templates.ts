import type { FlowConfig } from "./flow-config";
import type { Content } from "./rules";

type FlowResource = { id: string; key: string; kind: string; data: unknown };

export type FlowEmailTemplate = {
  id: string;
  key: string;
  kind: "TEMPLATE";
  name: string;
  subject: string;
  sourceFlow: string;
  enabled: false;
  data: Content;
};

const names: Record<string, string[]> = {
  welcome: ["Welcome offer", "First reminder", "Final reminder", "Social media"],
  "b2b-welcome": ["B2B welcome"],
  "delivery-upsell": ["24-hour add-on notice"],
  "abandoned-cart": ["Cart reminder"],
};

/** Read-only views of saved flow emails. The flow remains the source of truth. */
export function flowEmailTemplates(resources: FlowResource[]): FlowEmailTemplate[] {
  const templates: FlowEmailTemplate[] = [];
  for (const resource of resources) {
    const labels = names[resource.key];
    if (resource.kind !== "FLOW" || !labels) continue;
    const flow = resource.data as Partial<FlowConfig>;
    for (const [index, label] of labels.entries()) {
      const step = flow.steps?.[index];
      if (step?.channel !== "EMAIL" || !step.content || !step.subject) continue;
      templates.push({
        id: `flow-email:${resource.key}:${index}`,
        key: `flow-email:${resource.key}:${index}`,
        kind: "TEMPLATE",
        name: label,
        subject: step.subject,
        sourceFlow: resource.key,
        enabled: false,
        data: step.content,
      });
    }
    if (resource.key === "abandoned-cart" && flow.orderBranch)
      for (const branch of ["yes", "no"] as const) {
        const email = flow.orderBranch[branch];
        if (!email?.subject || !email.content) continue;
        templates.push({
          id: `flow-email:abandoned-cart:${branch}`,
          key: `flow-email:abandoned-cart:${branch}`,
          kind: "TEMPLATE",
          name:
            branch === "yes"
              ? "Cart follow-up · past purchaser"
              : "Cart follow-up · discount offer",
          subject: email.subject,
          sourceFlow: resource.key,
          enabled: false,
          data: email.content,
        });
      }
  }
  return templates;
}
