import Link from "next/link";
import { prisma } from "@/lib/prisma";
export const dynamic = "force-dynamic";

function parseJsonArray(value: string | null | undefined): string[] {
  if (!value) return [];

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function formatDate(date: Date) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

export default async function FeedbackInboxPage() {
  const feedbackItems = await prisma.feedbackItem.findMany({
    orderBy: {
      createdAt: "desc",
    },
  });

  return (
    <div className="page-stack">
      <section>
        <p className="page-header-eyebrow">Feedback Intelligence</p>
        <h2 className="page-title">Feedback Inbox</h2>
        <p className="page-description">
          Review customer feedback, AI analysis, staff decisions, and follow-up status.
        </p>

        <div className="action-row">
          <Link href="/feedback/new" className="button button-primary">
            Add Feedback
          </Link>
        </div>
      </section>

      {feedbackItems.length === 0 ? (
        <section className="card empty-state">
          <h3 className="empty-state-title">No feedback items yet</h3>
          <p className="empty-state-text">
            Once you add and save feedback, it will appear here for review and tracking.
          </p>
        </section>
      ) : (
        <section className="card feedback-table-card">
          <div className="feedback-table-header">
            <div>
              <h3 className="card-title">Saved Feedback</h3>
              <p className="card-description">
                These are feedback items that have been analyzed and saved.
              </p>
            </div>

            <p className="feedback-count">
              {feedbackItems.length} item{feedbackItems.length === 1 ? "" : "s"}
            </p>
          </div>

          <div className="feedback-table-wrap">
            <table className="feedback-table">
              <thead>
                <tr>
                  <th>Summary</th>
                  <th>Source</th>
                  <th>Issue Type</th>
                  <th>Severity</th>
                  <th>Status</th>
                  <th>Created</th>
                </tr>
              </thead>

              <tbody>
                {feedbackItems.map((item) => {
                  const issueTypes = parseJsonArray(item.aiIssueTypes);

                  return (
                    <tr key={item.id}>
                      <td>
                        <div className="feedback-summary-cell">
                          <p className="feedback-summary">{item.aiSummary}</p>
                          <p className="feedback-original-preview">
                            {item.feedbackText}
                          </p>
                        </div>
                      </td>

                      <td>{item.source}</td>

                      <td>
                        {issueTypes.length > 0
                          ? issueTypes.join(", ")
                          : "Uncategorized"}
                      </td>

                      <td>
                        <span className={`badge badge-${item.aiSeverity.toLowerCase()}`}>
                          {item.aiSeverity}
                        </span>
                      </td>

                      <td>
                        <span className="badge badge-status">{item.status}</span>
                      </td>

                      <td>{formatDate(item.createdAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}