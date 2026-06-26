/** Next-side session helpers — wrap `cookies()` from `next/headers`.
 *
 * Anything that crosses the EVE bundle boundary (e.g. the channel
 * AuthFn) must NOT import from here — use `lib/session-core.ts`
 * directly. EVE's bundler doesn't resolve `next/headers`. */
import { cookies } from "next/headers";

import {
  decryptSession,
  encryptSession,
  SESSION_COOKIE_NAME,
  type Session,
} from "./session-core";

export type { Session } from "./session-core";

const COOKIE_OPTS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge: 60 * 60 * 24 * 7,
};

export async function setSessionCookie(s: Session): Promise<void> {
  const c = await cookies();
  const token = await encryptSession(s);
  c.set(SESSION_COOKIE_NAME, token, COOKIE_OPTS);
}

export async function clearSessionCookie(): Promise<void> {
  const c = await cookies();
  c.delete(SESSION_COOKIE_NAME);
}

/** Refresh a Cognito access token via the refresh token. */
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

/** Read and (if needed) refresh the session. Returns null when not
 * signed in or when refresh has failed. */
export async function getSession(): Promise<Session | null> {
  const c = await cookies();
  const raw = c.get(SESSION_COOKIE_NAME)?.value;
  if (!raw) return null;
  const session = await decryptSession(raw);
  if (!session) return null;

  const now = Math.floor(Date.now() / 1000);
  if (now < session.expires_at - 30) {
    return session;
  }

  const refreshed = await refreshAccessToken(session.refresh_token);
  if (!refreshed) {
    await clearSessionCookie();
    return null;
  }
  const updated: Session = {
    ...session,
    access_token: refreshed.access_token,
    expires_at: now + refreshed.expires_in,
  };
  await setSessionCookie(updated);
  return updated;
}
