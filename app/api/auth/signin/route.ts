/** Sign-in: generate PKCE, stash verifier+state in a short-lived
 * cookie attached DIRECTLY to the redirect response, redirect to
 * Cognito's hosted UI.
 *
 * See the matching comment on `callback/route.ts` for why we don't
 * use `cookies().set()` + a separately-built redirect: mutations on
 * `cookies()` don't ride along on a fresh `NextResponse.redirect`. */
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
  // Write scopes for the PDF-ingestion workflows. Cognito's Pre
  // Token Generation Lambda strips anything the user's group doesn't
  // permit; non-managers get a session with read-only scopes back.
  // Keep this list in sync with agent/connections/dante.ts.
  "dante-agents/write:customers",
  "dante-agents/write:frameworks",
  "dante-agents/write:projects",
  "dante-agents/write:allocations",
  "dante-agents/write:time_tracking",
  "dante-agents/write:freelancers",
];

const PENDING_COOKIE =
  process.env.NODE_ENV === "production"
    ? "__Host-dante-oauth-pending"
    : "dante-oauth-pending";

const PENDING_OPTS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge: 600,
};

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

  const callbackUrl = new URL("/api/auth/callback", req.url).toString();
  const authorize = buildAuthorizeUrl({
    cognitoDomain,
    clientId,
    callbackUrl,
    scopes: SCOPES,
    state,
    codeChallenge: challenge,
  });

  // Attach the pending cookie DIRECTLY to the redirect response. A
  // `cookies().set` mutation is silently dropped on a fresh
  // `NextResponse.redirect`.
  const response = NextResponse.redirect(authorize);
  response.cookies.set(
    PENDING_COOKIE,
    JSON.stringify({ verifier, state }),
    PENDING_OPTS,
  );
  return response;
}
