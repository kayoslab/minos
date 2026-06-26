/** Token cache keyed by EVE principal id.
 *
 * Holds the Cognito refresh token + last-known access token + expiry
 * so `getToken()` on the Dante connection can answer fast without
 * round-tripping to Cognito on every tool call. We expose a tiny
 * surface (`get`, `put`, `remove`) so the storage backend is easy to
 * swap when this grows up.
 *
 * **POC**: in-memory Map. Survives within a single Vercel Function
 * instance only — a cold start loses the cache and the next tool
 * call from that user re-runs the consent flow. Acceptable for the
 * first end-to-end demo because the OAuth flow is fast (Cognito UI
 * is already logged in via cookies on the user's browser).
 *
 * **Before production rollout**: swap to durable storage. The
 * shortest path is Vercel KV (Upstash Redis), keyed by
 * `dante:tokens:<principalId>`. The wire shape below is intentionally
 * close to what we'd store in KV so the swap is mechanical.
 *
 * Per-principal isolation is required: each end-user has their own
 * Dante account and Cognito-issued tokens. Cross-user reuse would be
 * an authorization bug. */

export type CachedToken = {
  /** Cognito access token JWT. Carries the scopes the Pre Token
   * Generation Lambda left after subsetting against the user's group. */
  accessToken: string;
  /** Cognito refresh token. Lasts 30 days by default (see the agent
   * app client config in `terraform/modules/cognito`). Used to mint
   * new access tokens silently. */
  refreshToken: string;
  /** Wall-clock ms timestamp at which `accessToken` stops being valid.
   * We refresh proactively if `Date.now() + leewayMs > expiresAt`. */
  expiresAt: number;
};

const cache = new Map<string, CachedToken>();

export function getCachedToken(principalId: string): CachedToken | undefined {
  return cache.get(principalId);
}

export function putCachedToken(
  principalId: string,
  token: CachedToken,
): void {
  cache.set(principalId, token);
}

export function removeCachedToken(principalId: string): void {
  cache.delete(principalId);
}
