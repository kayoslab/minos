/** OAuth callback: validate state, exchange code for tokens, set
 * BOTH session cookies on the redirect response directly, then
 * redirect to /chat.
 *
 * Cookies are split across two names — see `lib/session-core.ts` for
 * why. Setting them via `cookies().set()` from `next/headers` and
 * returning a fresh `NextResponse.redirect()` silently drops the
 * Set-Cookie header, so we attach them to the response object
 * directly. */
import { decodeJwt } from "jose";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { exchangeCodeForToken } from "@/agent/lib/cognito-pkce";
import {
  ACCESS_TOKEN_COOKIE_NAME,
  encryptSession,
  SESSION_COOKIE_NAME,
} from "@/lib/session-core";

const PENDING_COOKIE =
  process.env.NODE_ENV === "production"
    ? "__Host-dante-oauth-pending"
    : "dante-oauth-pending";

const isProd = process.env.NODE_ENV === "production";

const SESSION_COOKIE_OPTS = {
  httpOnly: true,
  secure: isProd,
  sameSite: "lax" as const,
  path: "/",
  maxAge: 60 * 60 * 24 * 7,
};

function accessTokenCookieOpts(maxAgeSec: number) {
  return {
    httpOnly: true,
    secure: isProd,
    sameSite: "lax" as const,
    path: "/",
    maxAge: maxAgeSec,
  };
}

function bounceToLogin(req: Request, reason: string) {
  const response = NextResponse.redirect(
    new URL(`/login?error=${encodeURIComponent(reason)}`, req.url),
  );
  response.cookies.set(PENDING_COOKIE, "", { maxAge: 0, path: "/" });
  return response;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const oauthError = url.searchParams.get("error");

  if (oauthError) return bounceToLogin(req, oauthError);
  if (!code || !state) return bounceToLogin(req, "missing_code");

  const c = await cookies();
  const pendingRaw = c.get(PENDING_COOKIE)?.value;
  if (!pendingRaw) return bounceToLogin(req, "missing_state");

  let pending: { verifier?: string; state?: string };
  try {
    pending = JSON.parse(pendingRaw);
  } catch {
    return bounceToLogin(req, "corrupt_state");
  }

  if (
    !pending.verifier ||
    !pending.state ||
    pending.state !== state
  ) {
    return bounceToLogin(req, "state_mismatch");
  }

  const cognitoDomain = process.env.DANTE_COGNITO_DOMAIN;
  const clientId = process.env.DANTE_COGNITO_AGENT_CLIENT_ID;
  if (!cognitoDomain || !clientId) {
    return bounceToLogin(req, "not_configured");
  }

  const callbackUrl = new URL("/api/auth/callback", req.url).toString();
  let tokens;
  try {
    tokens = await exchangeCodeForToken({
      cognitoDomain,
      clientId,
      callbackUrl,
      code,
      codeVerifier: pending.verifier,
    });
  } catch {
    return bounceToLogin(req, "token_exchange_failed");
  }

  if (!tokens.refresh_token) {
    return bounceToLogin(req, "no_refresh_token");
  }

  let payload: { sub?: string; username?: string; email?: string };
  try {
    payload = decodeJwt(tokens.access_token) as typeof payload;
  } catch {
    return bounceToLogin(req, "bad_access_token");
  }
  if (!payload.sub) {
    return bounceToLogin(req, "missing_sub");
  }

  const sessionToken = await encryptSession({
    cognito_sub: payload.sub,
    email: payload.username ?? payload.email,
    refresh_token: tokens.refresh_token,
    expires_at: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7,
  });

  const response = NextResponse.redirect(new URL("/chat", req.url));
  response.cookies.set(SESSION_COOKIE_NAME, sessionToken, SESSION_COOKIE_OPTS);
  response.cookies.set(
    ACCESS_TOKEN_COOKIE_NAME,
    tokens.access_token,
    accessTokenCookieOpts(tokens.expires_in),
  );
  response.cookies.set(PENDING_COOKIE, "", { maxAge: 0, path: "/" });
  return response;
}
