import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { ReefIcon } from "./ReefIcon";
export const dynamic = "force-dynamic";
const tools = [
  { title: "Inventory monitor", description: "Review unexplained stock changes and resolve inventory exceptions.", href: "/inventory-monitor", icon: "inventory" },
  { title: "Restock alerts", description: "See who’s waiting and manage customer restock notifications.", href: "/restock-waitlist", icon: "restock" },
  { title: "Reorder planner", description: "Match supplier inventory to Shopify and prepare your next order.", href: "/reorder-planner", icon: "reorder" },
  { title: "Collection rotation", description: "Arrange storefront products and manage automatic rotation.", href: "/collection-rotation", icon: "rotation" },
  { title: "Species library", description: "Review species information, product matches, and approved cards.", href: "/species-library", icon: "species" },
  { title: "Customer intelligence", description: "Review feedback and keep track of customer conversations.", href: "/feedback", icon: "intelligence" },
  { title: "Our Klaviyo", description: "Manage campaigns, customer journeys, audiences, and email design.", href: "/our-klaviyo/overview", icon: "mail" },
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
    { label: "Inventory to review", value: inventoryReview, hint: "Unexplained stock changes", href: "/inventory-monitor" },
    { label: "Customers waiting", value: waitingAlerts, hint: "Active restock requests", href: "/restock-waitlist" },
    { label: "Active mappings", value: activeMappings, hint: "Supplier-to-Shopify matches", href: "/reorder-planner/mappings" },
    { label: "New customer signals", value: newFeedback + newMonitoring, hint: "Feedback and brand mentions", href: "/feedback" },
  ];
  return <div className="ops-home">
    <header className="ops-heading"><div><p className="ops-eyebrow">OPERATIONS WORKSPACE</p><h1>Your store, at a glance</h1><p>Review what needs attention, then pick up where you left off.</p></div><Link className="button button-primary" href="/reorder-planner/upload"><ReefIcon name="upload" size={17} />&nbsp; Upload supplier inventory</Link></header>
    <section className="ops-metrics" aria-label="Operational summary">{metrics.map(metric=><Link key={metric.href} href={metric.href} className={`ops-metric ${metric.value ? "attention" : ""}`}><span>{metric.label}</span><strong>{metric.value}</strong><small>{metric.hint}</small></Link>)}</section>
    <div className="ops-workspace-grid"><section className="ops-panel"><header><h2>Your workspace</h2><span>{tools.length} connected workflows</span></header>{tools.map(tool=><Link href={tool.href} className="ops-tool" key={tool.href}><span className="ops-tool-icon"><ReefIcon name={tool.icon} size={22} /></span><div><strong>{tool.title}</strong><p>{tool.description}</p></div><ReefIcon name="arrow" size={17} /></Link>)}</section><aside className="ops-side"><section className="ops-panel ops-quick"><h2>Pick up a task</h2><Link href="/inventory-monitor">Review inventory changes<small>Investigate unexplained decreases.</small></Link><Link href="/feedback/new">Add a customer signal<small>Capture feedback while it’s fresh.</small></Link><Link href="/reorder-planner/mappings">Manage product matches<small>Keep supplier codes connected.</small></Link><Link href="/our-klaviyo/flows">Review customer journeys<small>Open your saved marketing flows.</small></Link></section><section className="ops-note"><ReefIcon name="rotation" size={23}/><h2>{enabledRotations} collection {enabledRotations === 1 ? "rotation" : "rotations"} enabled</h2><p>Review featured products and upcoming rotations in your merchandising workspace.</p></section></aside></div>
  </div>;
}
