/** Framework-agnostic session encryption + cookie parsing.
 *
 * Lives here (not in lib/session.ts) so the EVE channel code can use
 * it. EVE bundles channel files with its own bundler (Nitro), which
 * doesn't understand `next/headers`. Anything that crosses the EVE
 * bundle boundary must only depend on jose + the Node standard
 * library.
 *
 * The browser session is split across TWO cookies:
 *   - `__Host-dante-session` — small JWE holding the *identity*
 *     (cognito_sub, email) and the *refresh token*. ~1 KB after
 *     encryption.
 *   - `__Host-dante-at` — the raw Cognito access token JWT,
 *     ~1.5–2 KB. Already signed by Cognito; no extra encryption.
 *     httpOnly + Secure + SameSite=Lax + Path=/ — same hardening as
 *     the session cookie.
 *
 * Why split: a single combined JWE blob lands ~4.5 KB, which the
 * browser silently drops (per-cookie 4 KB limit). Keeping the
 * tokens in separate cookies fits each under the limit. */
import { createHash } from "node:crypto";

import { EncryptJWT, jwtDecrypt } from "jose";

const isProd = process.env.NODE_ENV === "production";

export const SESSION_COOKIE_NAME = isProd
  ? "__Host-dante-session"
  : "dante-session";

export const ACCESS_TOKEN_COOKIE_NAME = isProd
  ? "__Host-dante-at"
  : "dante-at";

export type Session = {
  cognito_sub: string;
  email?: string;
  refresh_token: string;
  /** Unix seconds when the session itself expires (cookie max-age
   * relative anchor). Not tied to the access token's exp — that's
   * tracked on the access-token cookie's own max-age. */
  expires_at: number;
};

let cachedKey: Uint8Array | null = null;

function getKey(): Uint8Array {
  if (cachedKey) return cachedKey;
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    throw new Error(
      "AUTH_SECRET not set. Generate with `openssl rand -base64 64` " +
        "and set on the Vercel project (Production scope).",
    );
  }
  cachedKey = createHash("sha256")
    .update(new TextEncoder().encode(secret))
    .digest() as Uint8Array;
  return cachedKey;
}

export async function encryptSession(s: Session): Promise<string> {
  return new EncryptJWT(s as unknown as Record<string, unknown>)
    .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .encrypt(getKey());
}

export async function decryptSession(raw: string): Promise<Session | null> {
  try {
    const { payload } = await jwtDecrypt(raw, getKey());
    return payload as unknown as Session;
  } catch {
    return null;
  }
}

function readCookieFromHeader(
  cookieHeader: string | null,
  name: string,
): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const [k, ...rest] = part.split("=");
    if (k?.trim() === name) {
      return decodeURIComponent(rest.join("=").trim());
    }
  }
  return null;
}

/** Read `__Host-dante-session` off a raw `Cookie` request header. */
export function readSessionCookieFromHeader(
  cookieHeader: string | null,
): string | null {
  return readCookieFromHeader(cookieHeader, SESSION_COOKIE_NAME);
}

/** Read `__Host-dante-at` (the raw Cognito access token JWT) off a
 * raw `Cookie` request header. */
export function readAccessTokenFromHeader(
  cookieHeader: string | null,
): string | null {
  return readCookieFromHeader(cookieHeader, ACCESS_TOKEN_COOKIE_NAME);
}
