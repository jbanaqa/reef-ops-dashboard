"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ReefIcon } from "./ReefIcon";

const navigation = [
  { label: "Workspace", items: [{ href: "/", label: "Overview", icon: "dashboard" }] },
  { label: "Inventory & demand", items: [
    { href: "/inventory-monitor", label: "Inventory monitor", icon: "inventory" },
    { href: "/restock-waitlist", label: "Restock alerts", icon: "restock" },
    { href: "/reorder-planner", label: "Reorder planner", icon: "reorder" },
  ] },
  { label: "Merchandising", items: [
    { href: "/collection-rotation", label: "Collection rotation", icon: "rotation" },
    { href: "/species-library", label: "Species library", icon: "species" },
  ] },
  { label: "Customer insights", items: [{ href: "/feedback", label: "Customer intelligence", icon: "intelligence" }] },
];
const marketingSections = ["overview", "campaigns", "flows", "forms", "audiences", "templates", "analytics", "settings"];
const pageTitles: Record<string, string> = {
  "/": "Overview", "/inventory-monitor": "Inventory monitor", "/restock-waitlist": "Restock alerts",
  "/reorder-planner": "Reorder planner", "/reorder-planner/upload": "Upload supplier inventory",
  "/reorder-planner/mappings": "Product mappings", "/collection-rotation": "Collection rotation",
  "/species-library": "Species library", "/feedback": "Customer intelligence", "/feedback/new": "Add customer signal", "/monitoring": "Brand monitoring",
};
export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const sidebar = useRef<HTMLElement>(null);
  const isMarketing = pathname.startsWith("/our-klaviyo");
  const section = pathname.split("/")[2] || "overview";
  const title = isMarketing ? `Our Klaviyo / ${section[0].toUpperCase() + section.slice(1)}` : pageTitles[pathname] || "Reef Ops";
  useEffect(() => {
    if (!menuOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    sidebar.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setMenuOpen(false); requestAnimationFrame(() => menuButton.current?.focus()); }
      if (event.key === "Tab") {
        const elements = Array.from(sidebar.current?.querySelectorAll<HTMLElement>('a[href],button,summary') || []).filter(el => el.getClientRects().length > 0);
        const first = elements[0], last = elements[elements.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => { document.body.style.overflow = previous; document.removeEventListener("keydown", onKey); };
  }, [menuOpen]);
  return <div className="reef-shell">
    <a href="#workspace" className="reef-skip">Skip to workspace</a>
    <button className={`reef-backdrop ${menuOpen ? "is-visible" : ""}`} aria-label="Close navigation" onClick={() => setMenuOpen(false)} tabIndex={-1} />
    <aside ref={sidebar} id="workspace-navigation" className={`reef-sidebar ${menuOpen ? "is-open" : ""}`} aria-label="Workspace navigation">
      <div className="reef-brand"><Link href="/" aria-label="Reef Ops home" onClick={() => setMenuOpen(false)}><span className="reef-brand-mark">r<sup>°</sup></span><span className="reef-wordmark">reef<span>ops</span><small>CORALS<br />ANONYMOUS</small></span></Link><button className="reef-sidebar-close" onClick={() => { setMenuOpen(false); requestAnimationFrame(() => menuButton.current?.focus()); }} aria-label="Close navigation"><ReefIcon name="close" /></button></div>
      <nav className="reef-navigation" aria-label="Primary navigation">
        {navigation.map(group => <div className="reef-nav-group" key={group.label}><p className="reef-nav-label">{group.label}</p>{group.items.map(item => { const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href); return <Link key={item.href} href={item.href} aria-current={active ? "page" : undefined} className={`reef-nav-link ${active ? "reef-nav-link-active" : ""}`} onClick={() => setMenuOpen(false)}><ReefIcon name={item.icon} size={19} /><span>{item.label}</span></Link>; })}</div>)}
        <div className="reef-nav-group"><p className="reef-nav-label">Customer marketing</p><details className="reef-marketing-nav" open={isMarketing || undefined}><summary><ReefIcon name="mail" size={19} /><span>Our Klaviyo</span><span className="reef-chevron">⌄</span></summary><div className="reef-subnav">{marketingSections.map(item => { const href = `/our-klaviyo/${item}`; const active = isMarketing && section === item; return <Link key={item} href={href} aria-current={active ? "page" : undefined} className={active ? "is-active" : ""} onClick={() => setMenuOpen(false)}>{item[0].toUpperCase() + item.slice(1)}</Link>; })}</div></details></div>
      </nav>
      <div className="reef-sidebar-footer"><span className="reef-avatar">CA</span><div><strong>Corals Anonymous</strong><small>Operations workspace</small></div></div>
    </aside>
    <div className="reef-main" inert={menuOpen || undefined}>
      <header className="reef-topbar"><div className="reef-topbar-left"><button ref={menuButton} className="reef-menu-button" onClick={() => setMenuOpen(true)} aria-label="Open navigation" aria-expanded={menuOpen} aria-controls="workspace-navigation"><ReefIcon name="menu" /></button><span className="reef-topbar-context">Workspace</span><span className="reef-breadcrumb-slash">/</span><strong>{title}</strong></div><span className="reef-store-label"><ReefIcon name="shop" size={16} /> Corals Anonymous</span></header>
      <main id="workspace" tabIndex={-1} className="reef-content">{children}</main>
      <footer className="reef-page-footer"><span>Reef Ops <i>/</i> Corals Anonymous</span><span>Your operations, in one place.</span></footer>
    </div>
  </div>;
}
