import { StockConfig, validateStock } from "./stock-config";
import { defaultContent } from "./rules";
import { channels, content, Content, flowDefaults } from "./rules";

export type FlowStep = {
  minutes: number;
  subject: string;
  channel: string;
  content: Content;
};
export type Branch = { subject: string; content: Content };
export type FlowConfig = {
  reviewed: boolean;
  description?: string;
  trigger?: string;
  steps: FlowStep[];
  smsContent?: Content;
  smsMinutes?: number;
  branchMinutes?: number;
  orderBranch?: { yes: Branch; no: Branch };
  internalProfileIds?: string[];
  threshold?: number;
  stock?: StockConfig;
};
export type FlowTarget = {
  kind: "step" | "sms" | "branch" | "wait" | "info";
  index?: number;
  branch?: "yes" | "no";
  timing?: "smsMinutes" | "branchMinutes";
};
export type PlannedStep = FlowStep & { id: string; target: FlowTarget };
const minutes = (v: unknown, fallback: number) => {
  const n = v ?? fallback;
  if (typeof n !== "number" || !Number.isInteger(n) || n < 0 || n > 525600)
    throw new Error("Delay must be 0–525600 minutes.");
  return n;
};
const subject = (v: unknown) => {
  if (typeof v !== "string" || !v.trim() || v.length > 200 || /[\r\n]/.test(v))
    throw new Error("Add a subject of 1–200 characters.");
  return v.trim();
};
export function validateFlow(key: string, value: unknown): FlowConfig {
  if (!flowDefaults.some((f) => f.key === key))
    throw new Error("Unknown flow.");
  if (!value || typeof value !== "object")
    throw new Error("Flow configuration required.");
  const f = { ...(value as FlowConfig) };
  const stock =
    key === "low-stock" && f.stock ? validateStock(f.stock) : undefined;
  if (stock)
    f.steps = [
      ...(stock.emailEnabled
        ? [
            {
              minutes: 0,
              subject: stock.emailSubject,
              channel: "EMAIL",
              content: {
                ...defaultContent,
                heading: "Low stock alert",
                body: stock.emailBody,
              },
            },
          ]
        : []),
      ...(stock.smsEnabled
        ? [
            {
              minutes: 0,
              subject: "Stock alert",
              channel: "SMS_TRANSACTIONAL",
              content: { ...defaultContent, body: stock.smsBody },
            },
          ]
        : []),
    ];
  if (!Array.isArray(f.steps) || !f.steps.length || f.steps.length > 10)
    throw new Error("Use 1–10 flow steps.");
  const steps = f.steps.map((s) => {
    if (!s || !channels.includes(s.channel as (typeof channels)[number]))
      throw new Error("Invalid channel.");
    if (key === "b2b-welcome" && s.channel !== "EMAIL")
      throw new Error("B2B welcome uses email.");
    if (
      key === "low-stock" &&
      s.channel !== "SMS_TRANSACTIONAL" &&
      !(stock && s.channel === "EMAIL")
    )
      throw new Error("Internal stock alerts use transactional SMS.");
    if (key !== "low-stock" && s.channel === "SMS_TRANSACTIONAL")
      throw new Error("Marketing flows cannot use transactional SMS.");
    return {
      minutes: minutes(s.minutes, 0),
      subject: subject(s.subject),
      channel: s.channel,
      content: content(s.content),
    };
  });
  if (key === "b2b-welcome" && steps.length !== 1)
    throw new Error("B2B welcome sends one email per profile.");
  const branch = (b: Branch) => {
    if (!b) throw new Error("Both legacy branch objects are required.");
    return { subject: subject(b.subject), content: content(b.content) };
  };
  if (
    f.internalProfileIds &&
    (!Array.isArray(f.internalProfileIds) ||
      f.internalProfileIds.length > 50 ||
      f.internalProfileIds.some((id) => typeof id !== "string" || !id.trim()))
  )
    throw new Error("Use up to 50 internal profile IDs.");
  if (
    f.threshold != null &&
    (!Number.isInteger(f.threshold) || f.threshold < 0 || f.threshold > 1000000)
  )
    throw new Error("Invalid inventory threshold.");
  return {
    ...(stock ? { stock } : {}),
    reviewed: f.reviewed === true,
    description: String(f.description || "").slice(0, 1000),
    trigger: flowDefaults.find((f) => f.key === key)!.trigger,
    steps,
    ...(f.smsContent
      ? {
          smsContent: content(f.smsContent),
          smsMinutes: minutes(f.smsMinutes, 30),
        }
      : {}),
    ...(f.orderBranch
      ? {
          orderBranch: {
            yes: branch(f.orderBranch.yes),
            no: branch(f.orderBranch.no),
          },
          branchMinutes: minutes(f.branchMinutes, 1440),
        }
      : {}),
    ...(f.internalProfileIds
      ? { internalProfileIds: [...new Set(f.internalProfileIds)] }
      : {}),
    ...(f.threshold != null ? { threshold: f.threshold } : {}),
  };
}
/** Shared by enrollment and the editor map. Delays are measured from the trigger. */
export function flowSequence(key: string, f: FlowConfig): PlannedStep[] {
  const steps = (
    key === "abandoned-cart" && f.orderBranch ? f.steps.slice(0, 1) : f.steps
  ).map((s, index) => ({
    ...s,
    id: String(index),
    target: { kind: "step", index } as FlowTarget,
  }));
  if (key === "abandoned-cart" && f.smsContent)
    steps.push({
      minutes: f.smsMinutes ?? 30,
      subject: "Your cart",
      channel: "SMS_MARKETING",
      content: f.smsContent,
      id: String(steps.length),
      target: { kind: "sms" },
    });
  if (key === "abandoned-cart" && f.orderBranch)
    steps.push({
      ...f.orderBranch.no,
      minutes: f.branchMinutes ?? 1440,
      channel: "EMAIL",
      id: "order-branch",
      target: { kind: "branch", branch: "no" },
    });
  return steps.sort((a, b) => a.minutes - b.minutes);
}
