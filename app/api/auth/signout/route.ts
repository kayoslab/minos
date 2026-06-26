/** Sign-out: clear BOTH session cookies on the redirect response
 * itself (a `cookies().delete()` won't ride along on a fresh
 * `NextResponse.redirect`) and use status 303 so the browser
 * converts the POST into a GET on /login. With the default 307 the
 * browser would re-POST /login → /chat → 200, which looks to the
 * user as if signing out did nothing. */
import { NextResponse } from "next/server";

import {
  ACCESS_TOKEN_COOKIE_NAME,
  SESSION_COOKIE_NAME,
} from "@/lib/session-core";

function signOutResponse(req: Request) {
  const response = NextResponse.redirect(new URL("/login", req.url), 303);
  // The cookies use the `__Host-` prefix in production. To delete a
  // `__Host-` cookie the deletion Set-Cookie header MUST itself
  // satisfy the prefix's invariants — Secure + Path=/ + no Domain —
  // otherwise the browser silently ignores it and the cookie sticks
  // around. Mirror the original cookie options exactly.
  const deleteOpts = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: 0,
  };
  response.cookies.set(SESSION_COOKIE_NAME, "", deleteOpts);
  response.cookies.set(ACCESS_TOKEN_COOKIE_NAME, "", deleteOpts);
  return response;
}

export async function POST(req: Request) {
  return signOutResponse(req);
}

export async function GET(req: Request) {
  return signOutResponse(req);
}
