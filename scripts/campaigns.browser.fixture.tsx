import React from "react";
import { createRoot } from "react-dom/client";
import MarketingDashboard from "../app/our-klaviyo/MarketingDashboard";
import MarketingBrandWorkspace from "../app/our-klaviyo/MarketingBrand";
import { marketingBrand } from "../lib/marketing/brands";

const query = new URLSearchParams(location.search);
const tab = query.get("tab") || "campaigns";
const brand = query.get("brand");
const dashboard = <MarketingDashboard tab={tab} />;
createRoot(document.getElementById("root")!).render(
  brand ? <MarketingBrandWorkspace tab={tab} initialBrand={marketingBrand(brand).id}>{dashboard}</MarketingBrandWorkspace> : dashboard,
);
