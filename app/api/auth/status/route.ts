/** Session status + silent access-token refresh.
 *
 * The browser chat only ever POSTs to /eve/v1/*, which never hits a
 * Next route — so the lazy refresh that tops up the short-lived
 * access-token cookie never runs, and the agent starts 401ing ~an hour
 * in even though the refresh token is good for weeks. The client calls
 * this endpoint when an agent request errors (and on window focus).
 *
 * We either:
 *   - report { authenticated: true } if the access-token cookie is
 *     still valid, or
 *   - use the refresh token from the encrypted session cookie to mint a
 *     fresh access token, set it back on the response, and report
 *     { authenticated: true } (the common ~1h lapse — invisible to the
 *     user), or
 *   - report { authenticated: false } (401) when there's no session or
 *     the refresh token itself is dead, so the client can prompt an
 *     interactive re-sign-in.
 *
 * Public route (see proxy.ts) so it can answer "not authenticated"
 * instead of being bounced to /login. */
import { decodeJwt } from "jose";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { refreshAccessToken } from "@/agent/lib/cognito-pkce";
import {
  ACCESS_TOKEN_COOKIE_NAME,
  SESSION_COOKIE_NAME,
  decryptSession,
} from "@/lib/session-core";

export const dynamic = "force-dynamic";

const isProd = process.env.NODE_ENV === "production";

function accessTokenCookieOpts(maxAgeSec: number) {
  return {
    httpOnly: true,
    secure: isProd,
    sameSite: "lax" as const,
    path: "/",
    maxAge: maxAgeSec,
  };
}

export async function GET() {
  const c = await cookies();

  const at = c.get(ACCESS_TOKEN_COOKIE_NAME)?.value;
  if (at) {
    try {
      const payload = decodeJwt(at);
      if (
        typeof payload.exp === "number" &&
        payload.exp * 1000 > Date.now() + 30_000
      ) {
        return NextResponse.json({ authenticated: true });
      }
    } catch {
      // fall through to refresh
    }
  }

  const raw = c.get(SESSION_COOKIE_NAME)?.value;
  const session = raw ? await decryptSession(raw) : null;
  const cognitoDomain = process.env.DANTE_COGNITO_DOMAIN;
  const clientId = process.env.DANTE_COGNITO_AGENT_CLIENT_ID;
  if (!session || !cognitoDomain || !clientId) {
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }

  try {
    const refreshed = await refreshAccessToken({
      cognitoDomain,
      clientId,
      refreshToken: session.refresh_token,
    });
    const response = NextResponse.json({ authenticated: true });
    response.cookies.set(
      ACCESS_TOKEN_COOKIE_NAME,
      refreshed.access_token,
      accessTokenCookieOpts(refreshed.expires_in),
    );
    return response;
  } catch {
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }
}
