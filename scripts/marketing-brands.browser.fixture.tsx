import React from "react";
import { createRoot } from "react-dom/client";
import MarketingDashboard from "../app/our-klaviyo/MarketingDashboard";
import MarketingBrandWorkspace from "../app/our-klaviyo/MarketingBrand";
import { marketingBrand } from "../lib/marketing/brands";

const query = new URLSearchParams(location.search);
const tab = location.pathname.split("/").filter(Boolean)[1] || "campaigns";
const initialBrand = query.has("brand") ? marketingBrand(query.get("brand")).id : undefined;
createRoot(document.getElementById("root")!).render(
  <MarketingBrandWorkspace tab={tab} initialBrand={initialBrand}><MarketingDashboard tab={tab} /></MarketingBrandWorkspace>,
);
