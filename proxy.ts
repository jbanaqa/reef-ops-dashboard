import { NextRequest, NextResponse } from "next/server";

export function proxy(request: NextRequest) {
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
    "/((?!api|_next/static|_next/image|favicon.ico).*)",
  ],
};