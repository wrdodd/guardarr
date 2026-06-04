import { getToken } from "next-auth/jwt";
import { NextRequest, NextResponse } from "next/server";

// Gate the API and authenticated pages behind a valid NextAuth session.
// Without this, /api/* (e.g. GET /api/settings) was reachable unauthenticated.
//
// IMPORTANT exclusions (must stay public, or sign-in breaks):
//   /api/auth/*       — NextAuth endpoints
//   /api/plex-auth/*  — the Plex PIN/OAuth login flow (used while logged OUT)
const PUBLIC_API_PREFIXES = ["/api/auth", "/api/plex-auth"];
const PROTECTED_PAGES = ["/settings", "/users", "/rules", "/activity", "/library-access"];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });

  // Protect API routes (except the public auth/login-flow ones)
  if (pathname.startsWith("/api/")) {
    const isPublic = PUBLIC_API_PREFIXES.some((p) => pathname.startsWith(p));
    if (!isPublic && !token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.next();
  }

  // Protect authenticated pages — redirect to /login when signed out
  if (PROTECTED_PAGES.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
    if (!token) {
      const loginUrl = new URL("/login", request.url);
      return NextResponse.redirect(loginUrl);
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/api/:path*", "/settings/:path*", "/users/:path*", "/rules/:path*", "/activity/:path*", "/library-access/:path*"],
};
