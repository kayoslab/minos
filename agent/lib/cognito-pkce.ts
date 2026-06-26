/** Minimal PKCE helpers for the Cognito OAuth Authorization Code flow.
 *
 * EVE's `defineInteractiveAuthorization` mints the callback URL and
 * parks the turn during the redirect; this module owns the actual
 * Cognito-specific URL construction and code-for-token exchange.
 *
 * No external deps — Node's `node:crypto` and the standard `fetch`
 * are enough. Each helper is small and side-effect-free so they're
 * easy to unit-test if we ever pin them down with a `lib/__tests__`
 * suite. */
import { createHash, randomBytes } from "node:crypto";

export type PkcePair = {
  /** Random secret kept by the client; sent to Cognito at /token. */
  verifier: string;
  /** sha256(verifier), base64url-encoded; sent to Cognito at /authorize. */
  challenge: string;
};

/** Generate a PKCE verifier + S256 challenge.
 *
 * Cognito expects the verifier to be 43–128 chars from the URL-safe
 * alphabet. 32 random bytes base64url-encoded come out at 43 chars. */
export function generatePkce(): PkcePair {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export type AuthorizeUrlInput = {
  /** Cognito hosted-UI base — e.g. `https://auth.dante.actdigital.eu`. */
  cognitoDomain: string;
  /** The agent app client id from Cognito. */
  clientId: string;
  /** EVE-minted callback URL that Cognito redirects back to. */
  callbackUrl: string;
  /** Fully-qualified scopes (e.g. `["openid", "dante-agents/read:projects"]`). */
  scopes: readonly string[];
  /** Random state — opaque to Cognito, included verbatim on the
   * callback so we can verify the response belongs to our request. */
  state: string;
  /** PKCE S256 challenge from `generatePkce()`. */
  codeChallenge: string;
};

export function buildAuthorizeUrl(input: AuthorizeUrlInput): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: input.clientId,
    redirect_uri: input.callbackUrl,
    scope: input.scopes.join(" "),
    state: input.state,
    code_challenge: input.codeChallenge,
    code_challenge_method: "S256",
  });
  return `${input.cognitoDomain}/oauth2/authorize?${params.toString()}`;
}

export type TokenExchangeInput = {
  cognitoDomain: string;
  clientId: string;
  callbackUrl: string;
  /** Auth code returned by Cognito on the callback. */
  code: string;
  /** The PKCE verifier paired with the challenge used at /authorize. */
  codeVerifier: string;
};

export type CognitoTokenResponse = {
  access_token: string;
  expires_in: number;
  /** Refresh token — Cognito only returns this on the initial code
   * exchange and on refresh; cache it so we can mint new access tokens
   * for the next ~30 days without re-prompting the user. */
  refresh_token?: string;
  token_type: "Bearer";
  /** Only present when the `openid` scope was requested. */
  id_token?: string;
  /** Space-separated list — what Cognito actually issued after the
   * Pre Token Generation Lambda's scope-subsetting ran. */
  scope?: string;
};

/** POST /oauth2/token with grant_type=authorization_code. */
export async function exchangeCodeForToken(
  input: TokenExchangeInput,
): Promise<CognitoTokenResponse> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: input.clientId,
    code: input.code,
    redirect_uri: input.callbackUrl,
    code_verifier: input.codeVerifier,
  });
  const res = await fetch(`${input.cognitoDomain}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(
      `Cognito token exchange failed: ${res.status} ${detail.slice(0, 200)}`,
    );
  }
  return (await res.json()) as CognitoTokenResponse;
}

export type RefreshInput = {
  cognitoDomain: string;
  clientId: string;
  refreshToken: string;
};

/** POST /oauth2/token with grant_type=refresh_token. Note: the
 * response from refresh does NOT include a new refresh_token (Cognito
 * keeps the original); preserve the one we already cached. */
export async function refreshAccessToken(
  input: RefreshInput,
): Promise<CognitoTokenResponse> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: input.clientId,
    refresh_token: input.refreshToken,
  });
  const res = await fetch(`${input.cognitoDomain}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(
      `Cognito refresh failed: ${res.status} ${detail.slice(0, 200)}`,
    );
  }
  return (await res.json()) as CognitoTokenResponse;
}

/** Generate cryptographically-random opaque state for the OAuth
 * round-trip. Cognito echoes this back on the callback so we can
 * detect a mismatched/spoofed redirect. */
export function generateState(): string {
  return randomBytes(16).toString("base64url");
}
