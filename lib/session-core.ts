/** Framework-agnostic session encryption + cookie parsing.
 *
 * Lives here (not in lib/session.ts) so the EVE channel code can use
 * it. EVE bundles channel files with its own bundler (Nitro), which
 * doesn't understand `next/headers`. Anything that crosses the EVE
 * bundle boundary must only depend on jose + the Node standard
 * library.
 *
 * `lib/session.ts` (the Next-side facade) re-uses the encrypt /
 * decrypt primitives here and adds the `cookies()`-based read/write
 * helpers Next.js pages and route handlers want. */
import { createHash } from "node:crypto";

import { EncryptJWT, jwtDecrypt } from "jose";

export const SESSION_COOKIE_NAME =
  process.env.NODE_ENV === "production"
    ? "__Host-dante-session"
    : "dante-session";

export type Session = {
  cognito_sub: string;
  email?: string;
  access_token: string;
  refresh_token: string;
  /** Unix seconds. */
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

/** Parse a `Cookie` request header and return the value of
 * `SESSION_COOKIE_NAME`, or null if absent. */
export function readSessionCookieFromHeader(
  cookieHeader: string | null,
): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const [k, ...rest] = part.split("=");
    if (k?.trim() === SESSION_COOKIE_NAME) {
      return decodeURIComponent(rest.join("=").trim());
    }
  }
  return null;
}
