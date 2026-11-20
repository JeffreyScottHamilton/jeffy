import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { AUTH_COOKIE, gatePassword, isAuthorized } from "@/lib/server/auth";

export async function proxy(request: NextRequest) {
  if (!gatePassword()) return NextResponse.next();
  const { pathname } = request.nextUrl;
  if (pathname === "/unlock" || pathname === "/api/unlock") return NextResponse.next();
  if (await isAuthorized(request.cookies.get(AUTH_COOKIE)?.value)) return NextResponse.next();
  if (pathname.startsWith("/api/")) {
    return NextResponse.json(
      { error: { code: "unauthorized", message: "Locked.", retryable: false } },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }
  return NextResponse.redirect(new URL("/unlock", request.url));
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg).*)"],
};
