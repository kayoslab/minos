/** Hybrid route auth for the eve channel:
 *
 *   1. `Authorization: Bearer <Cognito access token>` — used by the
 *      one-shot test script, server-to-server, and any future
 *      machine caller.
 *   2. `auth.js` session cookie — used by the browser chat. The
 *      Cognito access token sits inside the encrypted JWT cookie
 *      Auth.js manages; we pull it out via `auth()` and verify it
 *      the same way as a header bearer.
 *
 * Both paths converge on the SAME validated Cognito access token,
 * which we then use to:
 *   a. Build the SessionAuthContext for the channel walk (so the
 *      runtime knows who's calling).
 *   b. Side-effect-populate the Dante connection's token cache
 *      indexed by the user's Cognito sub. The connection's getToken
 *      then returns the cached value instead of throwing
 *      `ConnectionAuthorizationRequiredError` and starting a second
 *      OAuth flow. One user sign-in → both ends authorized.
 *
 * Failure modes are conflated to `null` (the walk falls through to
 * the next entry or 401s). Diagnostics are server-side only — the
 * browser sees an opaque 401 like any failed auth. */
import {
  createRemoteJWKSet,
  jwtVerify,
  type JWTPayload,
} from "jose";
import type { AuthFn } from "eve/channels/auth";

import {
  decryptSession,
  readSessionCookieFromHeader,
} from "@/lib/session-core";
import { putCachedToken } from "@/agent/lib/token-store";

const issuer = process.env.DANTE_COGNITO_ISSUER;
const agentClientId = process.env.DANTE_COGNITO_AGENT_CLIENT_ID;
if (!issuer || !agentClientId) {
  throw new Error(
    "DANTE_COGNITO_ISSUER and DANTE_COGNITO_AGENT_CLIENT_ID must be set.",
  );
}

/** Lazy JWKS set — created on first use so a missing env var
 * doesn't take down the whole worker at module load. */
let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;
function getJwks() {
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));
  }
  return jwks;
}

const BEARER_RE = /^Bearer\s+(.+)$/i;

/** Verify a Cognito access token JWT. Returns the payload on success,
 * null on any failure (bad signature, wrong issuer, wrong client,
 * not an access token, expired). */
async function verifyCognitoAccessToken(
  token: string,
): Promise<JWTPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getJwks(), { issuer: issuer! });
    if (payload.token_use !== "access") return null;
    if (payload.client_id !== agentClientId) return null;
    return payload;
  } catch {
    return null;
  }
}

/** Project the verified Cognito payload into a SessionAuthContext.
 * Side-effect: prime the Dante connection's token cache so the
 * downstream tool call doesn't re-OAuth.
 *
 * The access token is the SAME credential the connection sends
 * outbound to Dante — Cognito's PreTokenGen Lambda has already
 * subset the scopes to what the user's group permits, so it's
 * safe to re-present it as-is. */
function buildAuthContext(token: string, payload: JWTPayload) {
  const sub = typeof payload.sub === "string" ? payload.sub : null;
  if (!sub) return null;

  // Cache the access token under the user's Cognito sub. Expiry
  // matches the JWT's `exp`. No refresh token — when this access
  // token expires, the next browser request will arrive with a
  // fresh one (Auth.js refreshes the cookie's token), which
  // re-seeds the cache here.
  const expiresAt =
    typeof payload.exp === "number" ? payload.exp * 1000 : Date.now() + 60_000;
  putCachedToken(sub, {
    accessToken: token,
    expiresAt,
    // Empty string rather than undefined so the connection's
    // refresh path is a clear no-op. Browser flow gets fresh
    // access tokens via Auth.js, not via the connection layer.
    refreshToken: "",
  });

  return {
    authenticator: "cognito-agent-client",
    principalId: sub,
    principalType: "user" as const,
    attributes: {
      client_id: agentClientId!,
      ...(typeof payload.username === "string"
        ? { username: payload.username }
        : {}),
    },
  };
}

/** Bearer-header path. Server-to-server, the test-token script,
 * future native clients. */
export function cognitoBearer(): AuthFn<Request> {
  return async (request) => {
    const header = request.headers.get("authorization");
    const match = BEARER_RE.exec(header ?? "");
    const token = match?.[1]?.trim();
    if (!token) return null;
    const payload = await verifyCognitoAccessToken(token);
    if (!payload) return null;
    return buildAuthContext(token, payload);
  };
}

/** Cookie path. Read the session cookie OFF THE REQUEST directly —
 * we can't import `next/headers` here because EVE bundles channel
 * code with its own bundler (Nitro) that doesn't resolve Next
 * helpers. Same encryption format as `lib/session.ts`'s
 * `setSessionCookie`; both use `lib/session-core.ts`. */
export function sessionCookie(): AuthFn<Request> {
  return async (request) => {
    const raw = readSessionCookieFromHeader(request.headers.get("cookie"));
    if (!raw) return null;
    const session = await decryptSession(raw);
    if (!session) return null;
    // The session cookie's access token might be near-expiry; we
    // don't refresh in the route-auth path (refresh is the Next
    // pages' job via `getSession()`). If it IS expired, JWKS
    // verification fails and we fall through to 401 — the browser
    // then hits a Next page → getSession() refreshes → next EVE
    // call works.
    const token = session.access_token;
    const payload = await verifyCognitoAccessToken(token);
    if (!payload) return null;
    return buildAuthContext(token, payload);
  };
}
