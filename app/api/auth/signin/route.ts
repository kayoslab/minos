/** Sign-in: generate PKCE, stash verifier+state in a short-lived
 * cookie, redirect to Cognito's hosted UI. */
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import {
  buildAuthorizeUrl,
  generatePkce,
  generateState,
} from "@/agent/lib/cognito-pkce";

const SCOPES = [
  "openid",
  "dante-agents/read:projects",
  "dante-agents/read:customers",
  "dante-agents/read:reports",
  "dante-agents/read:employees",
  "dante-agents/read:salaries",
];

const PENDING_COOKIE =
  process.env.NODE_ENV === "production"
    ? "__Host-dante-oauth-pending"
    : "dante-oauth-pending";

export async function GET(req: Request) {
  const cognitoDomain = process.env.DANTE_COGNITO_DOMAIN;
  const clientId = process.env.DANTE_COGNITO_AGENT_CLIENT_ID;
  if (!cognitoDomain || !clientId) {
    return NextResponse.json(
      { error: "OAuth not configured" },
      { status: 500 },
    );
  }

  const { verifier, challenge } = generatePkce();
  const state = generateState();

  const c = await cookies();
  // Short-lived cookie carrying the verifier + state. Read once on
  // the callback and immediately cleared. httpOnly + SameSite=Lax so
  // it survives the Cognito round-trip redirect.
  c.set(PENDING_COOKIE, JSON.stringify({ verifier, state }), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });

  const callbackUrl = new URL("/api/auth/callback", req.url).toString();
  const authorize = buildAuthorizeUrl({
    cognitoDomain,
    clientId,
    callbackUrl,
    scopes: SCOPES,
    state,
    codeChallenge: challenge,
  });

  return NextResponse.redirect(authorize);
}
