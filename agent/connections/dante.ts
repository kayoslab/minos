/** Connection: Dante (`/api/agent/*`).
 *
 * Pulls the OpenAPI document from the running Dante API and turns
 * each operation into a model-facing tool. Authentication is
 * Cognito-backed OAuth (Authorization Code with PKCE) — every
 * end-user signs in to Dante through the same hosted UI they'd use
 * on the web, and the issued access token carries the scope subset
 * their Cognito group permits.
 *
 * Token lifecycle:
 *   1. `getToken` is called before every tool invocation. We look up
 *      the cached pair for this principal. If we have an unexpired
 *      access token, return it. If we have a refresh token, exchange
 *      it for a fresh access token. If we have nothing (first-time
 *      caller, or refresh failed), throw
 *      `ConnectionAuthorizationRequiredError` and EVE drives the
 *      consent flow.
 *   2. `startAuthorization` runs when the user is about to be
 *      redirected. We generate a PKCE pair + state, build the
 *      Cognito authorize URL, hand both the URL (for the user) and
 *      the PKCE verifier + state (for our completeAuthorization
 *      callback) to EVE.
 *   3. `completeAuthorization` runs after Cognito redirects back to
 *      the EVE-minted callback URL with `?code=…&state=…`. We
 *      validate state, exchange the code for tokens, persist them,
 *      and return the access token for the parked turn.
 *
 * Per-user isolation: `userId(principal)` comes from EVE's route auth
 * (Vercel OIDC or whatever the channel resolves). All token cache
 * lookups + writes use that id verbatim.
 *
 * The Cognito hosted UI is already MFA-gated for the actual Dante
 * users (mandatory TOTP at the user-pool level), so we inherit
 * MFA on the agent integration for free. Anyone using EVE who's
 * not in Cognito can't get past the consent screen at all. */

import {
  ConnectionAuthorizationFailedError,
  ConnectionAuthorizationRequiredError,
  type ConnectionPrincipal,
  defineInteractiveAuthorization,
  defineOpenAPIConnection,
} from "eve/connections";

import {
  buildAuthorizeUrl,
  exchangeCodeForToken,
  generatePkce,
  generateState,
  refreshAccessToken,
} from "#lib/cognito-pkce.js";
import {
  getCachedToken,
  putCachedToken,
  removeCachedToken,
} from "#lib/token-store.js";

const CONNECTION_NAME = "dante";

// Env-driven configuration. Required for the OAuth flow to work; the
// runtime fails closed if any of them is missing.
function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new Error(
      `dante connection: env ${name} is not set. Configure it in ` +
        `Vercel project settings (or .env.local for local dev).`,
    );
  }
  return v;
}

const COGNITO_DOMAIN = requireEnv("DANTE_COGNITO_DOMAIN");
const COGNITO_CLIENT_ID = requireEnv("DANTE_COGNITO_AGENT_CLIENT_ID");
const DANTE_API_BASE_URL = requireEnv("DANTE_API_BASE_URL");

/** Fully-qualified scopes we request at /authorize. The Pre Token
 * Generation Lambda on Cognito's side subsets these against the
 * user's group at issuance time — an employee user consenting here
 * still receives only `read:projects` + `read:customers` in the
 * issued token. We request the union; Cognito hands back the
 * intersection. */
const REQUESTED_SCOPES = [
  "openid",
  "dante-agents/read:projects",
  "dante-agents/read:customers",
  "dante-agents/read:reports",
  "dante-agents/read:employees",
  "dante-agents/read:salaries",
] as const;

/** Refresh proactively when the cached access token is within this
 * window of expiry. Cognito access tokens have 1h lifetimes by
 * default; 90s margin avoids racing the wire clock and the Lambda
 * cold start on the Pre Token Generation trigger. */
const REFRESH_LEEWAY_MS = 90_000;

type ResumePayload = {
  verifier: string;
  state: string;
};

/** Interactive auth is `principalType: "user"`, so the runtime
 * guarantees the principal is the user variant — but TypeScript
 * still sees the union with `{ type: "app" }`. Narrow once, fail
 * loudly on the impossible branch. */
function userId(principal: ConnectionPrincipal): string {
  if (principal.type !== "user") {
    throw new ConnectionAuthorizationFailedError(CONNECTION_NAME, {
      reason: "principal_not_user",
      retryable: false,
    });
  }
  return principal.id;
}

export default defineOpenAPIConnection({
  description:
    "Dante: read-only project, customer, and rentability data for the " +
    "act digital consulting practice. Use to answer questions about " +
    "active projects, monthly P&L, and customer rentability. Requires " +
    "the caller to sign in to Dante via Cognito; the issued token's " +
    "scope set determines which operations are callable.",
  // Fetched at agent build/runtime. Update Dante → next EVE build picks
  // up the new operations automatically.
  spec: `${DANTE_API_BASE_URL}/api/agent/openapi.json`,
  // The spec's `servers[0].url` already includes `/api/agent`. We pin
  // it here so a future change to the spec (e.g. a versioned
  // `/api/agent/v2`) doesn't accidentally retarget the connection.
  baseUrl: `${DANTE_API_BASE_URL}/api/agent`,
  auth: defineInteractiveAuthorization<ResumePayload>({
    /** Probed before every tool call. The doc warns this is
     * pre-call only — a token revoked mid-flight surfaces as a 401
     * on the actual HTTP request; EVE handles that case via
     * `ctx.requireAuth(...)` in the tool implementation. For
     * generated OpenAPI operations we don't have an `execute` to
     * patch — the connection's invariant is "if Cognito accepted the
     * token at issuance, it stays valid for the access-token
     * lifetime", and the proactive refresh below covers the rest. */
    async getToken({ principal }) {
      const cached = getCachedToken(userId(principal));
      if (!cached) {
        throw new ConnectionAuthorizationRequiredError(CONNECTION_NAME);
      }
      // Fresh enough? Hand it over.
      if (Date.now() + REFRESH_LEEWAY_MS < cached.expiresAt) {
        return {
          token: cached.accessToken,
          expiresAt: cached.expiresAt,
        };
      }
      // Expired-or-near. Refresh silently.
      try {
        const refreshed = await refreshAccessToken({
          cognitoDomain: COGNITO_DOMAIN,
          clientId: COGNITO_CLIENT_ID,
          refreshToken: cached.refreshToken,
        });
        const newExpiresAt = Date.now() + refreshed.expires_in * 1000;
        putCachedToken(userId(principal), {
          accessToken: refreshed.access_token,
          // Cognito's refresh response does NOT return a new refresh
          // token; keep the original.
          refreshToken: cached.refreshToken,
          expiresAt: newExpiresAt,
        });
        return {
          token: refreshed.access_token,
          expiresAt: newExpiresAt,
        };
      } catch {
        // Refresh failed — most likely the user (or admin) revoked
        // the token, or the 30-day cap elapsed. Wipe the bad cache
        // entry and prompt for fresh consent.
        removeCachedToken(userId(principal));
        throw new ConnectionAuthorizationRequiredError(CONNECTION_NAME);
      }
    },

    /** Runs in a durable step. EVE provides the callback URL it
     * minted on the framework webhook; we hand back the Cognito
     * authorize URL for the user's browser plus the PKCE verifier +
     * opaque state we'll need on the callback. */
    async startAuthorization({ callbackUrl }) {
      const { verifier, challenge } = generatePkce();
      const state = generateState();
      return {
        challenge: {
          url: buildAuthorizeUrl({
            cognitoDomain: COGNITO_DOMAIN,
            clientId: COGNITO_CLIENT_ID,
            callbackUrl,
            scopes: REQUESTED_SCOPES,
            state,
            codeChallenge: challenge,
          }),
          displayName: "Dante",
        },
        resume: { verifier, state },
      };
    },

    /** Cognito redirected back with `?code=…&state=…`. Validate the
     * state echoes what we sent, exchange the code for tokens, and
     * cache them so subsequent tool calls flow through `getToken`'s
     * fast path. */
    async completeAuthorization({ resume, callback, callbackUrl, principal }) {
      if (!resume) {
        throw new ConnectionAuthorizationFailedError(CONNECTION_NAME, {
          reason: "missing_resume_state",
          retryable: false,
        });
      }
      const returnedState = callback.params.state;
      if (returnedState !== resume.state) {
        // State mismatch suggests CSRF / cross-flow contamination —
        // bail loudly and don't retry automatically.
        throw new ConnectionAuthorizationFailedError(CONNECTION_NAME, {
          reason: "state_mismatch",
          retryable: false,
        });
      }
      const code = callback.params.code;
      if (typeof code !== "string" || code.length === 0) {
        throw new ConnectionAuthorizationFailedError(CONNECTION_NAME, {
          reason: "missing_authorization_code",
          retryable: false,
        });
      }
      const tokens = await exchangeCodeForToken({
        cognitoDomain: COGNITO_DOMAIN,
        clientId: COGNITO_CLIENT_ID,
        callbackUrl,
        code,
        codeVerifier: resume.verifier,
      });
      if (!tokens.refresh_token) {
        // Cognito always returns a refresh token on the initial
        // authorization-code exchange. Its absence indicates the
        // app client was configured without refresh — surface
        // explicitly rather than caching half a credential.
        throw new ConnectionAuthorizationFailedError(CONNECTION_NAME, {
          reason: "no_refresh_token",
          retryable: false,
        });
      }
      const expiresAt = Date.now() + tokens.expires_in * 1000;
      putCachedToken(userId(principal), {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresAt,
      });
      return {
        token: tokens.access_token,
        expiresAt,
      };
    },
  }),
});
