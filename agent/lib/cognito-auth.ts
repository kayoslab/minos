/** Cognito-backed route auth for the eve channel.
 *
 * Verifies a Cognito access token presented as `Authorization: Bearer
 * ...`. Same token the EVE agent then re-uses on the outbound Dante
 * connection — one user sign-in, one consent screen, one token that
 * covers both "let me into the EVE agent" AND "let the agent call
 * Dante on my behalf".
 *
 * The token must:
 *   - be signed by the configured Cognito user pool (JWKS check)
 *   - carry `token_use: "access"` (not an ID token)
 *   - carry `client_id` matching the agent app client (a token from
 *     a different client — e.g. the web app — is rejected)
 *   - not be expired
 *
 * Failure modes are conflated to a single `null` return: the auth
 * walk falls through and the request gets a 401 with no detail
 * about *why* the token was rejected. Diagnostics live in CloudWatch
 * (server side) and the agent's own OAuth flow (client side). */
import {
  createRemoteJWKSet,
  jwtVerify,
  type JWTPayload,
} from "jose";

import type { AuthFn } from "eve/channels/auth";

type Config = {
  /** Cognito user pool issuer URL, e.g.
   * `https://cognito-idp.eu-central-1.amazonaws.com/eu-central-1_XXX`. */
  issuer: string;
  /** Agent app client ID. Tokens from any other client are rejected. */
  agentClientId: string;
};

/** AuthFn factory. The JWKS is created lazily on first request so a
 * missing env var surfaces as a route-level 401 rather than a
 * worker-killing module-load crash. The set itself caches keys for
 * ~10 minutes; key rotation just costs one miss. */
export function cognitoAccessToken(config: Config): AuthFn<Request> {
  const jwks = createRemoteJWKSet(
    new URL(`${config.issuer}/.well-known/jwks.json`),
  );
  return async (request) => {
    const header = request.headers.get("authorization");
    const match = /^Bearer\s+(.+)$/i.exec(header ?? "");
    const token = match?.[1]?.trim();
    if (!token) return null;
    let payload: JWTPayload;
    try {
      ({ payload } = await jwtVerify(token, jwks, {
        issuer: config.issuer,
      }));
    } catch {
      return null;
    }
    if (payload.token_use !== "access") return null;
    if (payload.client_id !== config.agentClientId) return null;
    const sub = typeof payload.sub === "string" ? payload.sub : null;
    if (!sub) return null;
    // Project a SessionAuthContext. The runtime uses `principalId`
    // to scope per-user state (including the connection token
    // cache) — so the `sub` we hand back here is the SAME id Dante
    // sees when audit-logging the agent's tool calls. Cleanly
    // matched user identity across both flows.
    return {
      authenticator: "cognito-agent-client",
      principalId: sub,
      principalType: "user",
      attributes: {
        client_id: config.agentClientId,
        ...(typeof payload.username === "string"
          ? { username: payload.username }
          : {}),
      },
    };
  };
}
