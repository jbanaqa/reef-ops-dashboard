import React from "react";
import { createRoot } from "react-dom/client";
import MarketingDashboard from "../app/our-klaviyo/MarketingDashboard";
createRoot(document.getElementById("root")!).render(
  <MarketingDashboard
    tab={new URLSearchParams(location.search).get("tab") || "campaigns"}
  />,
);
