import type { Metadata } from "next";
import "./globals.css";
import { AppShell } from "./AppShell";

export const metadata: Metadata = {
  title: "Reef Ops | Corals Anonymous",
  description: "Internal Shopify operations platform for Corals Anonymous.",
};

const themeScript = `
  (() => {
    try {
      const saved = localStorage.getItem("reef-ops-theme");
      const systemTheme = window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
      const theme = saved === "light" || saved === "dark" ? saved : systemTheme;
      document.documentElement.dataset.theme = theme;
      document.documentElement.style.colorScheme = theme;
    } catch {
      document.documentElement.dataset.theme = "dark";
    }
  })();
`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: themeScript }} /></head>
      <body><AppShell>{children}</AppShell></body>
    </html>
  );
}
