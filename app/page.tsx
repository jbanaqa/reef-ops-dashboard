import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { ReefIcon } from "./ReefIcon";

export const dynamic = "force-dynamic";

const tools = [
  { title: "Inventory Monitor", description: "Catch unexplained inventory decreases before they become expensive mysteries.", href: "/inventory-monitor", icon: "inventory", tone: "teal" },
  { title: "Restock Alerts", description: "See customer demand, send notifications, and keep the waitlist clean.", href: "/restock-waitlist", icon: "restock", tone: "coral" },
  { title: "Reorder Planner", description: "Turn supplier files and Shopify inventory into confident buying decisions.", href: "/reorder-planner", icon: "reorder", tone: "blue" },
  { title: "Collection Rotation", description: "Keep storefront collections fresh and give buried livestock another chance.", href: "/collection-rotation", icon: "rotation", tone: "violet" },
  { title: "Customer Intelligence", description: "Bring feedback, reviews, complaints, and brand monitoring into one signal center.", href: "/feedback", icon: "intelligence", tone: "gold" },
];

export default async function DashboardPage() {
  const [inventoryReview, waitingAlerts, activeMappings, enabledRotations, newFeedback, newMonitoring] = await Promise.all([
    prisma.inventoryEvent.count({ where: { eventType: { in: ["UnknownDecrement", "PartialUnknownDecrement"] }, reviewStatus: "Unreviewed" } }),
    prisma.productRestockWaitlist.count({ where: { status: "Waiting" } }),
    prisma.reorderMapping.count({ where: { isActive: true } }),
    prisma.collectionRotation.count({ where: { isEnabled: true } }),
    prisma.feedbackItem.count({ where: { status: "New" } }),
    prisma.scanResult.count({ where: { status: "New" } }),
  ]);

  const metrics = [
    { label: "Inventory to review", value: inventoryReview, hint: "Unexplained decreases", tone: "teal" },
    { label: "Customers waiting", value: waitingAlerts, hint: "Active restock requests", tone: "coral" },
    { label: "Active mappings", value: activeMappings, hint: "Reorder planner links", tone: "blue" },
    { label: "Customer signals", value: newFeedback + newMonitoring, hint: "New feedback and mentions", tone: "gold" },
  ];

  return (
    <div className="dashboard-stack">
      <section className="dashboard-hero">
        <div className="dashboard-hero-copy">
          <p className="dashboard-eyebrow"><span /> Corals Anonymous operations</p>
          <h1>Your reef,<br /><em>under control.</em></h1>
          <p>One current for inventory, customer demand, merchandising, and the signals that keep your store moving.</p>
          <div className="dashboard-hero-actions">
            <Link href="/inventory-monitor" className="dashboard-primary-action">Review operations <ReefIcon name="arrow" size={18} /></Link>
            <span>{enabledRotations} collection {enabledRotations === 1 ? "rotation" : "rotations"} enabled</span>
          </div>
        </div>
        <div className="dashboard-orbit" aria-hidden="true">
          <div className="dashboard-orbit-ring dashboard-orbit-ring-one" />
          <div className="dashboard-orbit-ring dashboard-orbit-ring-two" />
          <div className="dashboard-orbit-core"><span>CA</span><small>REEF OPS</small></div>
          <i className="dashboard-orbit-coral" /><i className="dashboard-orbit-teal" />
        </div>
      </section>

      <section className="dashboard-metrics" aria-label="Operational summary">
        {metrics.map((metric) => (
          <article className={`dashboard-metric dashboard-metric-${metric.tone}`} key={metric.label}>
            <div className="dashboard-metric-top"><span>{metric.label}</span><i /></div>
            <strong>{metric.value}</strong><p>{metric.hint}</p>
          </article>
        ))}
      </section>

      <section className="dashboard-section">
        <div className="dashboard-section-heading"><div><p className="dashboard-eyebrow"><span /> Tool deck</p><h2>Run the store</h2></div><p>Every workflow has one clear home.</p></div>
        <div className="dashboard-tool-grid">
          {tools.map((tool) => (
            <Link href={tool.href} className={`dashboard-tool-card dashboard-tool-card-${tool.tone}`} key={tool.href}>
              <span className="dashboard-tool-icon"><ReefIcon name={tool.icon} size={24} /></span>
              <div><h3>{tool.title}</h3><p>{tool.description}</p></div>
              <span className="dashboard-tool-arrow"><ReefIcon name="arrow" size={18} /></span>
            </Link>
          ))}
        </div>
      </section>

      <section className="dashboard-bottom-grid">
        <article className="dashboard-panel">
          <div className="dashboard-panel-heading"><div><p className="dashboard-eyebrow"><span /> Quick launch</p><h2>Common moves</h2></div></div>
          <div className="dashboard-quick-actions">
            <Link href="/feedback/new"><ReefIcon name="plus" /><span><strong>Add customer signal</strong><small>Record feedback or an observation</small></span><ReefIcon name="arrow" size={16} /></Link>
            <Link href="/reorder-planner/upload"><ReefIcon name="upload" /><span><strong>Upload supplier inventory</strong><small>Refresh the reorder planner</small></span><ReefIcon name="arrow" size={16} /></Link>
            <Link href="/restock-waitlist"><ReefIcon name="restock" /><span><strong>Review restock demand</strong><small>Send or manage customer alerts</small></span><ReefIcon name="arrow" size={16} /></Link>
          </div>
        </article>
        <article className="dashboard-panel dashboard-current-panel">
          <p className="dashboard-eyebrow"><span /> Current conditions</p>
          <h2>The store is listening.</h2>
          <p>Reef Ops is tracking customer interest and operational exceptions across your connected Shopify workflows.</p>
          <div className="dashboard-current-line"><span><i /> Restock waitlist</span><strong>{waitingAlerts} waiting</strong></div>
          <div className="dashboard-current-line"><span><i /> Inventory review</span><strong>{inventoryReview} open</strong></div>
        </article>
      </section>
    </div>
  );
}
