import { notFound } from "next/navigation";
import MarketingDashboard from "../MarketingDashboard";
import MarketingBrandWorkspace from "../MarketingBrand";
import { marketingBrand } from "@/lib/marketing/brands";
export default async function Page({ params, searchParams }: { params: Promise<{ section?: string[] }>; searchParams: Promise<{ brand?: string | string[] }> }) {
  const { section } = await params;
  const tab = section?.[0] || "overview";
  if ((section?.length || 0) > 1 || !["overview", "campaigns", "flows", "forms", "audiences", "templates", "analytics", "settings"].includes(tab)) notFound();
  const { brand } = await searchParams;
  let initialBrand;
  try { initialBrand = brand === undefined ? undefined : marketingBrand(brand).id; }
  catch { notFound(); }
  return <MarketingBrandWorkspace key={initialBrand || "remembered-brand"} tab={tab} initialBrand={initialBrand}><MarketingDashboard tab={tab} /></MarketingBrandWorkspace>;
}
