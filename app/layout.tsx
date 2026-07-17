import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Reef Ops Dashboard",
  description:
    "Internal operations dashboard for reef e-commerce workflows.",
};

const navItems = [
  { label: "Dashboard", href: "/" },
  {
    label: "Feedback Intelligence",
    href: "/feedback",
  },
  { label: "Add Feedback", href: "/feedback/new" },
  { label: "Monitoring", href: "/monitoring" },
  { label: "Shipments", href: "#" },
  { label: "Inventory", href: "#" },
  {
    label: "Inventory Monitor",
    href: "/inventory-monitor",
  },
  {
    label: "Restock Waitlist",
    href: "/restock-waitlist",
  },
  {
    label: "Reorder Planner",
    href: "/reorder-planner",
  },
  {
    label: "Collection Rotation",
    href: "/collection-rotation",
  },
  { label: "Reports", href: "#" },
  { label: "Settings", href: "#" },
];

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <div className="app-shell">
          <aside className="sidebar">
            <p className="sidebar-brand-label">
              Corals Anonymous
            </p>

            <h1 className="sidebar-title">
              Reef Ops
            </h1>

            <p className="sidebar-description">
              Internal tools for feedback, inventory,
              shipments, and operations.
            </p>

            <nav className="sidebar-nav">
              {navItems.map((item) => (
                <Link
                  key={item.label}
                  href={item.href}
                  className="sidebar-link"
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </aside>

          <main className="main-area">
            <div className="topbar">
              <p className="topbar-text">
                Internal Operations Platform
              </p>
            </div>

            <div className="page-container">
              {children}
            </div>
          </main>
        </div>
      </body>
    </html>
  );
}
