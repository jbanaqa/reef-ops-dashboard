export type CampaignReport = {
  campaign: { id: string; name: string; status: string; scheduledAt: string | null };
  totals: {
    messages: number; queued: number; sent: number; delivered: number; opened: number;
    clicked: number; ordered: number; skipped: number; failed: number; needsAttention: number;
    revenue: Record<string, number>;
  };
  reasons: { reason: string; count: number }[];
  orders: {
    id: string; orderId: string | null; label: string; placedAt: string;
    amount: number | null; currency: string | null;
    interaction: "CLICKED" | "OPENED" | "COUPON"; interactedAt: string;
    customer: { id: string; name: string; email: string | null } | null;
    shopifyUrl: string | null;
  }[];
  ordersPage: { page: number; pageSize: number; total: number; pages: number };
};
