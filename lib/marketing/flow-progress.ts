import { flowDefaults } from "./rules";
type Message = {
  id: string;
  key: string;
  flowKey: string | null;
  flowCondition: string | null;
  subject: string;
  status: string;
  dueAt: Date;
  createdAt: Date;
  sentAt: Date | null;
  error: string | null;
};
type Flow = { key: string; name: string; enabled: boolean };
export function flowProgress(
  messages: Message[],
  flows: Flow[],
  now = new Date(),
) {
  const groups = new Map<string, Message[]>();
  for (const m of messages) {
    if (!m.flowKey) continue;
    const group =
      m.flowKey === "abandoned-cart" && m.key.startsWith("cart-v1:")
        ? m.key.slice(0, m.key.lastIndexOf(":"))
        : m.flowKey;
    groups.set(group, [...(groups.get(group) || []), m]);
  }
  return [...groups.values()]
    .map((rows) => {
      rows.sort((a, b) => +a.dueAt - +b.dueAt || +a.createdAt - +b.createdAt);
      const flow = flows.find((f) => f.key === rows[0].flowKey);
      const active = rows.filter((m) =>
        ["PENDING", "SENDING", "UNKNOWN"].includes(m.status),
      );
      const sent = rows
        .filter((m) => m.status === "SENT")
        .sort(
          (a, b) => +(b.sentAt || b.createdAt) - +(a.sentAt || a.createdAt),
        );
      const next =
        active.find((m) => m.status === "SENDING") ||
        active.find((m) => m.status === "UNKNOWN") ||
        active[0];
      const failed = rows.filter((m) => m.status === "FAILED");
      const skipped = rows.filter((m) => m.status === "CANCELLED");
      const state =
        next?.status === "UNKNOWN"
          ? "Delivery needs review"
          : next?.status === "SENDING"
            ? "Sending"
            : next && !flow?.enabled
              ? "Flow paused"
              : next
                ? +next.dueAt > +now
                  ? "Waiting for next step"
                  : "Awaiting send checks"
                : failed.length
                  ? "Finished with errors"
                  : skipped.some((m) =>
                        /purchased after checkout/i.test(m.error || ""),
                      )
                    ? "Stopped after purchase"
                    : skipped.length
                      ? "Finished · some messages not sent"
                      : "Scheduled steps completed";
      const step = (m: Message) =>
        m.flowCondition === "cart-v1:first"
          ? "First reminder"
          : m.flowCondition?.startsWith("cart-v1:final")
            ? "Follow-up email"
            : m.subject || "Message";
      return {
        id: rows[0].id,
        flowKey: rows[0].flowKey!,
        name:
          flow?.name ||
          flowDefaults.find((f) => f.key === rows[0].flowKey)?.name ||
          rows[0].flowKey!,
        state,
        active: active.length > 0,
        sentCount: sent.length,
        pendingCount: active.length,
        skippedCount: skipped.length,
        failedCount: failed.length,
        enteredAt: new Date(
          Math.min(...rows.map((m) => +m.createdAt)),
        ).toISOString(),
        lastSent: sent[0]
          ? {
              label: step(sent[0]),
              subject: sent[0].subject,
              at: (sent[0].sentAt || sent[0].createdAt).toISOString(),
            }
          : null,
        next: next
          ? {
              label: step(next),
              at: next.dueAt.toISOString(),
              branchPending: next.flowCondition === "cart-v1:final",
              reason: next.error,
            }
          : null,
        reasons: [
          ...new Set(
            [...failed, ...skipped]
              .map((m) => m.error)
              .filter((s): s is string => !!s),
          ),
        ],
      };
    })
    .sort(
      (a, b) =>
        Number(b.active) - Number(a.active) ||
        Date.parse(b.enteredAt) - Date.parse(a.enteredAt),
    );
}
export type FlowProgress = ReturnType<typeof flowProgress>[number];
