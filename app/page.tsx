import Link from "next/link";

const stats = [
  {
    label: "Needs Attention",
    value: "0",
    description: "Urgent or high-severity feedback.",
  },
  {
    label: "Needs Investigation",
    value: "0",
    description: "Items requiring order or staff review.",
  },
  {
    label: "Needs Response",
    value: "0",
    description: "Feedback that may need a reply.",
  },
  {
    label: "Resolved",
    value: "0",
    description: "Items closed by staff.",
  },
];

export default function DashboardPage() {
  return (
    <div className="page-stack">
      <section>
        <p className="page-header-eyebrow">Dashboard</p>
        <h2 className="page-title">Reef Ops Dashboard</h2>
        <p className="page-description">
          A centralized internal dashboard for customer feedback, reputation
          intelligence, inventory workflows, shipments, and operational decisions.
        </p>
      </section>

      <section className="stats-grid">
        {stats.map((stat) => (
          <div key={stat.label} className="card stat-card">
            <p className="stat-label">{stat.label}</p>
            <p className="stat-value">{stat.value}</p>
            <p className="stat-description">{stat.description}</p>
          </div>
        ))}
      </section>

      <section className="card card-padded">
        <h3 className="card-title">Feedback Intelligence</h3>
        <p className="card-description">
          Start by manually entering a review, forum post, customer complaint,
          or staff observation. The AI will turn messy feedback into structured
          operational insight.
        </p>

        <div className="action-row">
          <Link href="/feedback/new" className="button button-primary">
            Add Feedback
          </Link>
          <Link href="/feedback" className="button button-secondary">
            View Feedback Inbox
          </Link>
        </div>
      </section>
    </div>
  );
}