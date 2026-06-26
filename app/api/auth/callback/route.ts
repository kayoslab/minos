/** OAuth callback: validate state, exchange code for tokens, set the
 * session cookie, redirect to /chat. Any failure mode redirects to
 * /login with an opaque error message. */
import { decodeJwt } from "jose";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { exchangeCodeForToken } from "@/agent/lib/cognito-pkce";
import { setSessionCookie } from "@/lib/session";

const PENDING_COOKIE =
  process.env.NODE_ENV === "production"
    ? "__Host-dante-oauth-pending"
    : "dante-oauth-pending";

function bounceToLogin(req: Request, reason: string) {
  return NextResponse.redirect(
    new URL(`/login?error=${encodeURIComponent(reason)}`, req.url),
  );
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
  c.delete(PENDING_COOKIE);

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

  // Decode the access token UNVERIFIED here — Cognito just minted it
  // so verification is unnecessary; the channel AuthFn re-verifies
  // against JWKS on every EVE call. We only need `sub` (+ optional
  // username) for the session metadata.
  let payload: { sub?: string; username?: string; email?: string };
  try {
    payload = decodeJwt(tokens.access_token) as typeof payload;
  } catch {
    return bounceToLogin(req, "bad_access_token");
  }
  if (!payload.sub) {
    return bounceToLogin(req, "missing_sub");
  }

  await setSessionCookie({
    cognito_sub: payload.sub,
    email: payload.username ?? payload.email,
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expires_at: Math.floor(Date.now() / 1000) + tokens.expires_in,
  });

  return NextResponse.redirect(new URL("/chat", req.url));
}
