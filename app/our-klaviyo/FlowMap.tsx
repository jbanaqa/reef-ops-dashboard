"use client";
import {
  FlowConfig,
  FlowTarget,
  flowSequence,
} from "@/lib/marketing/flow-config";
type Resource = {
  key: string;
  name: string;
  enabled: boolean;
  data: Record<string, unknown>;
};
export type Node = {
  id: string;
  kind: "trigger" | "condition" | "wait" | "email" | "sms" | "end";
  label: string;
  detail?: string;
  target: FlowTarget;
};
export function flowNodes(resource: Resource): Node[] {
  const key = resource.key,
    f = resource.data as unknown as FlowConfig;
  const triggers: Record<string, string> = {
    "b2b-welcome": "Shopify B2B tag added",
    welcome: "Email signup confirmed",
    "abandoned-cart": "Identified checkout started",
    "low-stock": "Inventory crosses threshold",
    "delivery-upsell": "Trusted delivery date received",
  };
  const nodes: Node[] = [
    {
      id: "trigger",
      kind: "trigger",
      label: triggers[key] || key,
      target: { kind: "info" },
      detail:
        key === "b2b-welcome"
          ? "One welcome email per profile. Imports do not enroll. Current email consent and B2B tag are required at send time."
          : "New events enroll only while this flow is reviewed and enabled.",
    },
  ];
  for (const s of flowSequence(key, f)) {
    const timing =
      s.target.kind === "sms"
        ? "smsMinutes"
        : s.target.kind === "branch"
          ? "branchMinutes"
          : undefined;
    nodes.push({
      id: "wait:" + s.id,
      kind: "wait",
      label:
        key === "delivery-upsell"
          ? "24 hours before expected delivery"
          : s.minutes + " minutes after trigger",
      detail: "Delays are measured from the trigger, not the previous message.",
      target:
        key === "delivery-upsell"
          ? { kind: "info" }
          : { kind: "wait", index: s.target.index, timing },
    });
    if (key === "abandoned-cart")
      nodes.push({
        id: "purchase:" + s.id,
        kind: "condition",
        label: "Stop if purchased or checkout older than 3 days",
        target: { kind: "info" },
      });
    nodes.push({
      id: "message:" + s.id,
      kind: s.channel === "EMAIL" ? "email" : "sms",
      label: s.subject || "Untitled message",
      detail: s.channel,
      target: s.target,
    });
  }
  nodes.push({
    id: "end",
    kind: "end",
    label: "End",
    target: { kind: "info" },
  });
  return nodes;
}
const icon = {
  trigger: "⚡",
  condition: "⑂",
  wait: "◷",
  email: "✉",
  sms: "▣",
  end: "•",
};
export function FlowMap({
  resource,
  onNodeClick,
  nodes: suppliedNodes,
}: {
  resource: Resource;
  nodes?: Node[];
  onNodeClick?: (node: Node) => void;
}) {
  const nodes = suppliedNodes || flowNodes(resource);
  return (
    <div className="mk-flow-map" aria-label={resource.name + " automation map"}>
      {nodes.map((n, i) => {
        const body = (
          <>
            <span className="mk-flow-icon">{icon[n.kind]}</span>
            <div>
              <strong>{n.label}</strong>
              {n.detail && <small>{n.detail}</small>}
            </div>
            {i < nodes.length - 1 && (
              <span className="mk-flow-line" aria-hidden="true" />
            )}
          </>
        );
        return onNodeClick ? (
          <button
            type="button"
            className={"mk-flow-node mk-flow-" + n.kind}
            key={n.id}
            onClick={() => onNodeClick(n)}
          >
            {body}
          </button>
        ) : (
          <div className={"mk-flow-node mk-flow-" + n.kind} key={n.id}>
            {body}
          </div>
        );
      })}
    </div>
  );
}
