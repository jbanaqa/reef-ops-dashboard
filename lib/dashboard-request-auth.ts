import crypto from "node:crypto";

function equal(left: string, right: string) {
  const a = Buffer.from(left); const b = Buffer.from(right);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function isDashboardRequestAuthorized(request: Request) {
  const expectedUser = process.env.DASHBOARD_USERNAME;
  const expectedPassword = process.env.DASHBOARD_PASSWORD;
  const authorization = request.headers.get("authorization");
  if (!expectedUser || !expectedPassword || !authorization?.startsWith("Basic ")) return false;
  try {
    const decoded = Buffer.from(authorization.slice(6), "base64").toString("utf8");
    const separator = decoded.indexOf(":");
    if (separator < 0) return false;
    return equal(decoded.slice(0, separator), expectedUser) && equal(decoded.slice(separator + 1), expectedPassword);
  } catch { return false; }
}
