"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { ReefIcon } from "./ReefIcon";

const navigation = [
  { label: "Overview", items: [{ href: "/", label: "Dashboard", icon: "dashboard" }] },
  { label: "Operations", items: [
    { href: "/inventory-monitor", label: "Inventory Monitor", icon: "inventory" },
    { href: "/restock-waitlist", label: "Restock Alerts", icon: "restock" },
    { href: "/reorder-planner", label: "Reorder Planner", icon: "reorder" },
  ]},
  { label: "Merchandising", items: [{ href: "/collection-rotation", label: "Collection Rotation", icon: "rotation" }] },
  { label: "Insights", items: [{ href: "/feedback", label: "Customer Intelligence", icon: "intelligence" }] },
];

const pageTitles: Record<string, string> = {
  "/": "Dashboard", "/inventory-monitor": "Inventory Monitor", "/restock-waitlist": "Restock Alerts",
  "/reorder-planner": "Reorder Planner", "/collection-rotation": "Collection Rotation",
  "/feedback": "Customer Intelligence", "/feedback/new": "Add Customer Signal", "/monitoring": "Customer Intelligence",
};

function routeIsActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const title = pageTitles[pathname] || "Reef Ops";
  return (
    <div className="reef-shell">
      <button className={`reef-backdrop ${menuOpen ? "is-visible" : ""}`} aria-label="Close navigation" onClick={() => setMenuOpen(false)} />
      <aside className={`reef-sidebar ${menuOpen ? "is-open" : ""}`}>
        <div className="reef-brand">
          <div className="reef-brand-mark"><span /></div>
          <div><p>Corals Anonymous</p><strong>Reef Ops</strong></div>
          <button className="reef-sidebar-close" onClick={() => setMenuOpen(false)} aria-label="Close navigation"><ReefIcon name="close" /></button>
        </div>
        <nav className="reef-navigation" aria-label="Primary navigation">
          {navigation.map((group) => (
            <div className="reef-nav-group" key={group.label}>
              <p className="reef-nav-label">{group.label}</p>
              {group.items.map((item) => {
                const active = routeIsActive(pathname, item.href);
                return <Link className={`reef-nav-link ${active ? "reef-nav-link-active" : ""}`} href={item.href} key={item.href} onClick={() => setMenuOpen(false)}>
                  <span className="reef-nav-icon"><ReefIcon name={item.icon} /></span><span>{item.label}</span><i className="reef-nav-glow" />
                </Link>;
              })}
            </div>
          ))}
        </nav>
        <div className="reef-sidebar-footer"><span className="reef-status-orb" /><div><strong>Production</strong><span>Corals Anonymous</span></div></div>
      </aside>
      <div className="reef-main">
        <header className="reef-topbar">
          <div className="reef-topbar-left">
            <button className="reef-menu-button" onClick={() => setMenuOpen(true)} aria-label="Open navigation"><ReefIcon name="menu" /></button>
            <div><span className="reef-topbar-context">Reef Ops</span><strong>{title}</strong></div>
          </div>
          <div className="reef-topbar-status"><span className="reef-live-dot" /> Shopify operations</div>
        </header>
        <main className="reef-content">{children}</main>
      </div>
    </div>
  );
}
