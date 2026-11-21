import { isDashboardRequestAuthorized } from "../dashboard-request-auth";

function originOf(value: string | undefined) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.origin : null;
  } catch { return null; }
}

/** Use the dashboard's access setting; browser writes still need a matching origin. */
export function isSkuSyncAuthorized(request: Request, mutation = false) {
  if (!isDashboardRequestAuthorized(request)) return false;
  if (!mutation) return true;
  if (request.headers.get("sec-fetch-site") === "cross-site") return false;
  const origin = request.headers.get("origin");
  if (origin === null) return true;

  // Next can expose its internal URL here when a browser is using Railway's public hostname.
  // Use configured public URLs, not client-supplied host or forwarding headers.
  const railwayUrls = [process.env.RAILWAY_PUBLIC_DOMAIN, process.env.RAILWAY_SERVICE_REEF_OPS_DASHBOARD_URL]
    .flatMap(domain => domain?.trim() ? [`https://${domain.trim()}`] : []);
  return [request.url, process.env.REEF_OPS_PUBLIC_URL, process.env.APP_BASE_URL, ...railwayUrls]
    .some(url => originOf(url) === origin);
}
