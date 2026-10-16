import { NextResponse, type NextRequest } from "next/server";

// When SITE_PASSWORD is set (as it should be on any public deployment), the
// whole site asks for it, so strangers cannot spend the API budget. Locally,
// with no password set, nothing changes.
export function middleware(request: NextRequest) {
  const password = process.env.SITE_PASSWORD;
  if (!password) return NextResponse.next();

  const header = request.headers.get("authorization") ?? "";
  if (header.startsWith("Basic ")) {
    try {
      const decoded = atob(header.slice(6));
      const given = decoded.slice(decoded.indexOf(":") + 1);
      if (given === password) return NextResponse.next();
    } catch {
      // Malformed header: fall through and ask again.
    }
  }
  return new NextResponse("Password required.", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Mappy Moments", charset="UTF-8"' },
  });
}

export const config = {
  // Everything except Next's own static files.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
