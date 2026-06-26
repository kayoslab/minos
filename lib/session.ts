/** Next-side session helpers — wrap `cookies()` from `next/headers`.
 *
 * Anything that crosses the EVE bundle boundary (e.g. the channel
 * AuthFn) must NOT import from here — use `lib/session-core.ts`
 * directly. EVE's bundler doesn't resolve `next/headers`. */
import { decodeJwt } from "jose";
import { cookies } from "next/headers";

import {
  ACCESS_TOKEN_COOKIE_NAME,
  decryptSession,
  encryptSession,
  SESSION_COOKIE_NAME,
  type Session,
} from "./session-core";

export type { Session } from "./session-core";

const SESSION_COOKIE_OPTS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge: 60 * 60 * 24 * 7,
};

function accessTokenCookieOpts(maxAgeSec: number) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: maxAgeSec,
  };
}

export async function setSessionCookie(s: Session): Promise<void> {
  const c = await cookies();
  const token = await encryptSession(s);
  c.set(SESSION_COOKIE_NAME, token, SESSION_COOKIE_OPTS);
}

export async function clearSessionCookie(): Promise<void> {
  const c = await cookies();
  c.delete(SESSION_COOKIE_NAME);
  c.delete(ACCESS_TOKEN_COOKIE_NAME);
}

async function refreshAccessToken(
  refreshToken: string,
): Promise<{ access_token: string; expires_in: number } | null> {
  const domain = process.env.DANTE_COGNITO_DOMAIN;
  const clientId = process.env.DANTE_COGNITO_AGENT_CLIENT_ID;
  if (!domain || !clientId) return null;
  try {
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      client_id: clientId,
      refresh_token: refreshToken,
    });
    const res = await fetch(`${domain}/oauth2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      access_token: string;
      expires_in: number;
    };
    return { access_token: data.access_token, expires_in: data.expires_in };
  } catch {
    return null;
  }
}

/** Return the signed-in user's session, or null. Does NOT refresh
 * the access token — the access token rides in its own cookie and
 * its expiry is tracked there. Use `getAccessToken()` to obtain
 * (and lazy-refresh) the bearer. */
export async function getSession(): Promise<Session | null> {
  const c = await cookies();
  const raw = c.get(SESSION_COOKIE_NAME)?.value;
  if (!raw) return null;
  return decryptSession(raw);
}

/** Return a current Cognito access token, refreshing via the
 * refresh token in the session cookie if the access-token cookie is
 * missing, expired, or near-expiry. Updates the access-token cookie
 * on refresh. Returns null when the session is missing or refresh
 * fails. */
export async function getAccessToken(): Promise<string | null> {
  const c = await cookies();
  const at = c.get(ACCESS_TOKEN_COOKIE_NAME)?.value;
  if (at) {
    try {
      const payload = decodeJwt(at);
      if (typeof payload.exp === "number" && payload.exp * 1000 > Date.now() + 30_000) {
        return at;
      }
    } catch {
      // fall through to refresh
    }
  }

  const session = await getSession();
  if (!session) return null;

  const refreshed = await refreshAccessToken(session.refresh_token);
  if (!refreshed) return null;

  c.set(
    ACCESS_TOKEN_COOKIE_NAME,
    refreshed.access_token,
    accessTokenCookieOpts(refreshed.expires_in),
  );
  return refreshed.access_token;
}
