/** Sign-out: clear the session cookie and redirect to /login. */
import { NextResponse } from "next/server";

import { clearSessionCookie } from "@/lib/session";

export async function POST(req: Request) {
  await clearSessionCookie();
  return NextResponse.redirect(new URL("/login", req.url));
}

// GET fallback so a stray link redirect also signs out.
export async function GET(req: Request) {
  return POST(req);
}
