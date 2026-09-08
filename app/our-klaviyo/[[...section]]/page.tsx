import { notFound } from "next/navigation";
import MarketingDashboard from "../MarketingDashboard";
export default async function Page({ params }: { params: Promise<{ section?: string[] }> }) {
  const { section } = await params;
  const tab = section?.[0] || "overview";
  if ((section?.length || 0) > 1 || !["overview", "campaigns", "flows", "forms", "audiences", "templates", "analytics", "settings"].includes(tab)) notFound();
  return <MarketingDashboard tab={tab} />;
}
