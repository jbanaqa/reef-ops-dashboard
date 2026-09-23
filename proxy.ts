import { NextRequest, NextResponse } from "next/server";

export function proxy(request: NextRequest) {
  const publicOrigin = process.env.MARKETING_UNSUBSCRIBE_ORIGIN;
  const requestHost = request.headers.get("host")?.split(":", 1)[0]?.toLowerCase();
  if (publicOrigin && requestHost === new URL(publicOrigin).hostname.toLowerCase()) {
    if (request.nextUrl.pathname !== "/api/marketing/unsubscribe")
      return new NextResponse("Not found", { status: 404 });
    return NextResponse.next();
  }
  if (request.nextUrl.pathname.startsWith("/api/")) return NextResponse.next();
  if (process.env.DASHBOARD_AUTH_DISABLED === "true")
    return NextResponse.next();
  const username = process.env.DASHBOARD_USERNAME;
  const password = process.env.DASHBOARD_PASSWORD;

  if (!username || !password) {
    return new NextResponse("Dashboard login is not configured.", {
      status: 503,
    });
  }

  const authorization = request.headers.get("authorization");

  if (authorization?.startsWith("Basic ")) {
    const credentials = atob(authorization.slice(6));
    const separator = credentials.indexOf(":");

    const suppliedUsername = credentials.slice(0, separator);
    const suppliedPassword = credentials.slice(separator + 1);

    if (
      suppliedUsername === username &&
      suppliedPassword === password
    ) {
      return NextResponse.next();
    }
  }

  return new NextResponse("Login required.", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="Reef Ops"',
    },
  });
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
