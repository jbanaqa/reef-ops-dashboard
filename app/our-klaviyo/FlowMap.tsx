"use client";
import {
  FlowConfig,
  FlowTarget,
  flowSequence,
} from "@/lib/marketing/flow-config";
import { welcomeLabels } from "@/lib/marketing/welcome-config";
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
    welcome: "Joins Mailable Subscribers",
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
  if (key === "welcome" && f.welcome) {
    nodes[0].detail =
      "Reef Ops popup · single opt-in · once per subscriber. Imports do not enroll.";
    nodes[0].target = { kind: "info", section: "welcome-settings" };
    f.steps.forEach((s, i) => {
      if (i)
        nodes.push({
          id: "welcome-wait:" + i,
          kind: "wait",
          label:
            "Day " +
            s.minutes / 1440 +
            (i === 3
              ? " · " +
                String(f.welcome!.socialHour).padStart(2, "0") +
                ":00 local time"
              : ""),
          detail:
            i === 3
              ? "After the offer expires. Purchasers also reach this step."
              : i === 2
                ? (s.minutes - f.steps[1].minutes) / 1440 +
                  " days after the first reminder's scheduled time."
                : "After the welcome offer starts.",
          target: { kind: "info", section: "welcome-settings" },
        });
      if (i === 1 || i === 2)
        nodes.push({
          id: "welcome-purchase:" + i,
          kind: "condition",
          label: "Has the customer ever ordered?",
          detail:
            "Lifetime purchase history is checked before this reminder. An unavailable check waits and retries.",
          target: { kind: "info", section: "welcome-settings" },
        });
      nodes.push({
        id: "welcome-email:" + i,
        kind: "email",
        label: welcomeLabels[i],
        detail: (i === 0 ? "Immediately · " : "") + s.subject,
        target: { kind: "step", index: i },
      });
      if (i === 2)
        nodes.push({
          id: "welcome-expiry",
          kind: "condition",
          label: "Day " + f.welcome!.couponDays + " · discount expires",
          detail:
            "Same personal code in all three emails. Its expiration never resets.",
          target: { kind: "info", section: "welcome-settings" },
        });
    });
    nodes.push({
      id: "end",
      kind: "end",
      label: "End · no re-entry",
      detail: "Consent and recent email checks apply before sending.",
      target: { kind: "info" },
    });
    return nodes;
  }
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
  if (!suppliedNodes && resource.key === "welcome" && resource.data.welcome)
    return (
      <WelcomeMap resource={resource} nodes={nodes} onNodeClick={onNodeClick} />
    );
  if (
    !suppliedNodes &&
    resource.key === "abandoned-cart" &&
    (resource.data as unknown as FlowConfig).cart
  )
    return <CartMap resource={resource} onNodeClick={onNodeClick} />;
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

function WelcomeMap({
  resource,
  nodes,
  onNodeClick,
}: {
  resource: Resource;
  nodes: Node[];
  onNodeClick?: (node: Node) => void;
}) {
  const draw = (n: Node) => {
    const body = (
      <>
        <span className="mk-flow-icon">{icon[n.kind]}</span>
        <div>
          <strong>{n.label}</strong>
          {n.detail && <small>{n.detail}</small>}
        </div>
      </>
    );
    return onNodeClick ? (
      <button
        type="button"
        className={"mk-flow-node mk-flow-" + n.kind}
        data-node-id={n.id}
        onClick={() => onNodeClick(n)}
      >
        {body}
      </button>
    ) : (
      <div className={"mk-flow-node mk-flow-" + n.kind} data-node-id={n.id}>
        {body}
      </div>
    );
  };
  const node = (id: string) => draw(nodes.find((n) => n.id === id)!);
  const line = (
    <span className="mk-cart-connector" aria-hidden="true">
      ↓
    </span>
  );
  return (
    <div
      className="mk-cart-map mk-welcome-map"
      aria-label={resource.name + " automation map"}
    >
      {node("trigger")}
      {line}
      {node("welcome-email:0")}
      {line}
      <p className="mk-welcome-note">
        Discount reminders require the welcome email to have been sent and the
        code to remain valid. Consent and recent-email checks apply to every
        email; a skipped email does not guarantee a later send.
      </p>
      {[1, 2].map((i) => (
        <section
          className="mk-welcome-stage"
          key={i}
          aria-label={
            i === 1 ? "First reminder decision" : "Final reminder decision"
          }
        >
          {node("welcome-wait:" + i)}
          {line}
          {node("welcome-purchase:" + i)}
          <div className="mk-cart-fork mk-welcome-fork">
            <div aria-label="No orders path">
              <span className="mk-cart-path">No · never ordered</span>
              {node("welcome-email:" + i)}
            </div>
            <div aria-label="Has ordered path">
              <span className="mk-cart-path">Yes · has ordered</span>
              {draw({
                id: "welcome-skip:" + i,
                kind: "end",
                label: "Skip this reminder",
                detail:
                  i === 1
                    ? "Continue to the next scheduled check. Purchase history will be checked again."
                    : "Continue to the social email schedule.",
                target: { kind: "info", section: "welcome-settings" },
              })}
            </div>
          </div>
          <span className="mk-welcome-merge">Both paths continue</span>
          {line}
        </section>
      ))}
      {node("welcome-wait:3")}
      {line}
      {node("welcome-email:3")}
      {line}
      {node("end")}
      <aside
        className="mk-welcome-offer"
        aria-label="Offer expiration settings"
      >
        <span>Offer rule · applies across the flow</span>
        {node("welcome-expiry")}
      </aside>
    </div>
  );
}

function CartMap({
  resource,
  onNodeClick,
}: {
  resource: Resource;
  onNodeClick?: (node: Node) => void;
}) {
  const f = resource.data as unknown as FlowConfig;
  const duration = (n: number) =>
    n && n % 1440 === 0
      ? n / 1440 + " day" + (n === 1440 ? "" : "s")
      : n && n % 60 === 0
        ? n / 60 + " hour" + (n === 60 ? "" : "s")
        : n + " minutes";
  const node = (
    id: string,
    kind: Node["kind"],
    label: string,
    detail: string,
    target: FlowTarget = { kind: "info" },
  ) => {
    const n = { id, kind, label, detail, target };
    return (
      <button
        type="button"
        className={"mk-flow-node mk-flow-" + kind}
        onClick={() => onNodeClick?.(n)}
      >
        <span className="mk-flow-icon">{icon[kind]}</span>
        <div>
          <strong>{label}</strong>
          <small>{detail}</small>
        </div>
      </button>
    );
  };
  const line = (
    <span className="mk-cart-connector" aria-hidden="true">
      ↓
    </span>
  );
  return (
    <div className="mk-cart-map" aria-label={resource.name + " automation map"}>
      {node(
        "trigger",
        "trigger",
        "Checkout started",
        "New checkouts can re-enter. Duplicate updates do not restart the flow.",
      )}
      {line}
      {node(
        "entry",
        "condition",
        "Checkout started within the last 3 days",
        "Older events end here. A new purchase stops every remaining reminder.",
      )}
      {line}
      {node(
        "sms-choice",
        "condition",
        "Can receive marketing texts?",
        "Current text consent is required.",
      )}
      <div className="mk-cart-fork">
        <div>
          <span className="mk-cart-path">Yes · text subscriber</span>
          {node(
            "sms-wait",
            "wait",
            "Wait " + duration(f.smsMinutes ?? 30),
            "Then check quiet hours and recent texts.",
            { kind: "wait", timing: "smsMinutes" },
          )}
          {line}
          {node(
            "sms",
            "sms",
            "Text message #1",
            "Skip if texted in the last 24 hours. Quiet hours: 8 p.m.–11 a.m.",
            { kind: "sms" },
          )}
        </div>
        <div>
          <span className="mk-cart-path">No · continue to email</span>
          {node(
            "sms-bypass",
            "condition",
            "Skip the text",
            "Continue without the 30-minute text delay.",
          )}
        </div>
      </div>
      {line}
      {node(
        "email-wait",
        "wait",
        "Wait " + duration(f.steps[0].minutes),
        "After the text is sent or skipped; immediately begins on the no-text path.",
        { kind: "wait", index: 0 },
      )}
      {line}
      {node("first", "email", "Email #1 · Soft push", f.steps[0].subject, {
        kind: "step",
        index: 0,
      })}
      {line}
      {node(
        "followup-wait",
        "wait",
        "Wait " + duration(f.branchMinutes ?? 1440),
        "After the first email is sent or skipped.",
        { kind: "wait", timing: "branchMinutes" },
      )}
      {line}
      {node(
        "past-order",
        "condition",
        "Purchased in the last 2 weeks?",
        "Only customers who have not purchased since entering this flow reach this decision.",
      )}
      <div className="mk-cart-fork">
        <div>
          <span className="mk-cart-path">Yes · recent customer</span>
          {node(
            "yes",
            "email",
            "Email #2 · Another soft push",
            f.orderBranch!.yes.subject,
            { kind: "branch", branch: "yes" },
          )}
        </div>
        <div>
          <span className="mk-cart-path">No · offer 10% off</span>
          {node(
            "no",
            "email",
            "Email #2 · Discount offer",
            f.orderBranch!.no.subject,
            { kind: "branch", branch: "no" },
          )}
        </div>
      </div>
      {line}
      {node(
        "end",
        "end",
        "End",
        "Each email checks consent and skips customers emailed in the last 16 hours.",
      )}
      <div className="mk-cart-tools">
        {node(
          "products",
          "condition",
          "Product recommendations",
          "Cart items first, then popular products from the last 3 days.",
          { kind: "info", section: "products" },
        )}
        {node(
          "coupon",
          "condition",
          "10% discount",
          "Unique code · no minimum · no combinations · expires after 1 year.",
          { kind: "info", section: "coupon" },
        )}
      </div>
    </div>
  );
}
