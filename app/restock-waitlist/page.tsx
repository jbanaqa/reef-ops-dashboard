import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

function formatDate(date: Date | null) {
  if (!date) {
    return "Not yet";
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export default async function RestockWaitlistPage() {
  const [totalCount, waitingCount, notifiedCount, unsubscribedCount, recent] =
    await Promise.all([
      prisma.productRestockWaitlist.count(),
      prisma.productRestockWaitlist.count({
        where: {
          status: "Waiting",
        },
      }),
      prisma.productRestockWaitlist.count({
        where: {
          status: "Notified",
        },
      }),
      prisma.productRestockWaitlist.count({
        where: {
          status: "Unsubscribed",
        },
      }),
      prisma.productRestockWaitlist.findMany({
        orderBy: {
          subscribedAt: "desc",
        },
        take: 50,
      }),
    ]);

  return (
    <div className="page-stack">
      <section>
        <p className="page-header-eyebrow">
          Product Demand
        </p>

        <h2 className="page-title">
          Restock Waitlist
        </h2>

        <p className="page-description">
          Product-level customer email alerts for out-of-stock Shopify products.
          Customers are notified when total product inventory becomes available
          again across any variant.
        </p>
      </section>

      <section className="stats-grid">
        <div className="card stat-card">
          <p className="stat-label">
            Total Signups
          </p>
          <p className="stat-value">
            {totalCount}
          </p>
          <p className="stat-description">
            All restock waitlist records.
          </p>
        </div>

        <div className="card stat-card">
          <p className="stat-label">
            Waiting
          </p>
          <p className="stat-value">
            {waitingCount}
          </p>
          <p className="stat-description">
            Customers still waiting for restock.
          </p>
        </div>

        <div className="card stat-card">
          <p className="stat-label">
            Notified
          </p>
          <p className="stat-value">
            {notifiedCount}
          </p>
          <p className="stat-description">
            Alerts sent after product restock.
          </p>
        </div>

        <div className="card stat-card">
          <p className="stat-label">
            Unsubscribed
          </p>
          <p className="stat-value">
            {unsubscribedCount}
          </p>
          <p className="stat-description">
            Customers who opted out.
          </p>
        </div>
      </section>

      <section className="card feedback-table-card">
        <div className="feedback-table-header">
          <div>
            <h3 className="card-title">
              Recent Signups
            </h3>
            <p className="card-description">
              Showing the latest 50 product-level waitlist entries.
            </p>
          </div>
        </div>

        {recent.length === 0 ? (
          <div className="empty-state">
            <h4 className="empty-state-title">
              No waitlist signups yet
            </h4>
            <p className="empty-state-text">
              Customer submissions from the Shopify product form will appear
              here.
            </p>
          </div>
        ) : (
          <div className="feedback-table-wrap">
            <table className="feedback-table">
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Email</th>
                  <th>Status</th>
                  <th>Subscribed</th>
                  <th>Notified</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((entry) => (
                  <tr key={entry.id}>
                    <td className="feedback-summary-cell">
                      <p className="feedback-summary">
                        {entry.productTitle || "Untitled product"}
                      </p>
                      <p className="feedback-original-preview">
                        {entry.productHandle
                          ? `/${entry.productHandle}`
                          : entry.productId}
                      </p>
                    </td>
                    <td>{entry.email}</td>
                    <td>
                      <span className="badge badge-status">
                        {entry.status}
                      </span>
                    </td>
                    <td>{formatDate(entry.subscribedAt)}</td>
                    <td>{formatDate(entry.notifiedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
