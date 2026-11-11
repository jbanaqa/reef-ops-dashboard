import type { FlowConfig } from "./flow-config";

export type CartStage = "sms" | "first" | "final" | "final-yes" | "final-no" | "discount10" | "discount15";
export function cartSequenceVersion(run?: { sequenceVersion?: number } | null): 1 | 2 {
  return run?.sequenceVersion === 2 ? 2 : 1;
}
export function cartStage(condition: string | null): CartStage | null {
  const match = condition?.match(/^cart-v([12]):(sms|first|final|final-yes|final-no|discount10|discount15)$/);
  if (!match || (match[1] === "2" ? !["first", "discount10", "discount15"].includes(match[2]) : ["discount10", "discount15"].includes(match[2]))) return null;
  return match[2] as CartStage;
}
export function isCartCondition(condition: string | null): boolean { return cartStage(condition) !== null; }
export function cartPreviousStage(condition: string | null): CartStage | null {
  const stage = cartStage(condition);
  if (condition?.startsWith("cart-v2:"))
    return stage === "discount10" ? "first" : stage === "discount15" ? "discount10" : null;
  return stage === "first" ? "sms" : stage?.startsWith("final") ? "first" : null;
}
export function cartNextStage(condition: string | null): CartStage | null {
  const stage = cartStage(condition);
  if (condition?.startsWith("cart-v2:"))
    return stage === "first" ? "discount10" : stage === "discount10" ? "discount15" : null;
  return stage === "sms" ? "first" : stage === "first" ? "final" : null;
}
export function cartStepIndex(condition: string | null): number | null {
  const stage = cartStage(condition);
  return stage === "first" ? 0 : stage === "discount10" ? 1 : stage === "discount15" ? 2 : null;
}
export function cartStageMinutes(config: FlowConfig, condition: string | null): number {
  const index = cartStepIndex(condition);
  return index !== null ? config.steps[index].minutes : cartStage(condition) === "sms" ? config.smsMinutes ?? 30 : config.branchMinutes ?? 1440;
}
