/** Per-request CSP + nonce + route gate.
 *
 * Every HTML response gets a fresh nonce attached to script-src so we
 * can drop `'unsafe-inline'` entirely. The nonce is also forwarded on
 * the REQUEST headers — Next.js's renderer reads it off the inbound
 * Content-Security-Policy header to tag its bootstrap scripts. Set
 * the policy only on the response and the browser would block
 * hydration.
 *
 * `/eve/v1/*` paths are JSON / SSE only; CSP doesn't apply, skip the
 * nonce work to keep the responses cacheable and the headers small.
 *
 * Route gate: page navigations to anything other than /login and the
 * Auth.js endpoints get bounced to /login when the session is
 * missing or refresh has failed. The actual session check happens
 * inside the page (`auth()` in a Server Component) for now — this
 * middleware just enforces the redirect cheaply at the edge for
 * unauthenticated callers. */
import { NextResponse, type NextRequest } from "next/server";

const PUBLIC_PATHS = ["/login"];

const PUBLIC_PREFIXES = [
  "/api/auth", // Auth.js endpoints
  "/api/upload", // Vercel Blob direct-upload route — must accept the
  //              second-phase completion callback from Blob (no cookie);
  //              the route's own onBeforeGenerateToken gates token
  //              generation on a valid session.
  "/api/cron", // Vercel Cron jobs — no session cookie; routes verify
  //              `Authorization: Bearer $CRON_SECRET` themselves.
  "/eve/v1", // EVE channel (its own auth walk applies)
  "/_next", // Next.js static assets
  "/favicon", // /favicon.ico
];

function isPublic(pathname: string): boolean {
  if (PUBLIC_PATHS.includes(pathname)) return true;
  return PUBLIC_PREFIXES.some((p) => pathname.startsWith(p));
}

function needsCsp(pathname: string): boolean {
  // HTML pages need CSP; JSON / SSE endpoints don't.
  return (
    !pathname.startsWith("/api/") &&
    !pathname.startsWith("/eve/v1/") &&
    !pathname.startsWith("/_next/")
  );
}

function buildCsp(isDev: boolean): { csp: string; nonce: string } {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const directives = [
    "default-src 'self'",
    // 'strict-dynamic' lets nonced scripts dynamically import more
    // scripts without an explicit allowlist. Dev needs 'unsafe-eval'
    // for the React refresh runtime.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    // Inline styles for the per-element style prop. Could be tightened
    // with hashes if the app picks up a CSS-in-JS lib.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    // EVE talks to same-origin /eve/v1/* (SSE); Cognito and Dante
    // talk through server-side fetches that don't hit the browser's
    // connect-src budget. Allow ws: only in dev for HMR.
    //
    // Vercel Blob: the client `upload()` first hits
    // https://vercel.com/api/blob/?pathname=... to mint a put-url,
    // then PUTs to *.public.blob.vercel-storage.com directly. Without
    // both hosts allowed the browser silently drops the request and
    // the chat sits at "Uploading…" with no exception bubbling up
    // (CSP blocks happen before fetch can throw). Same-origin
    // /api/upload (token handshake) is already covered by 'self'.
    `connect-src 'self' https://vercel.com https://*.public.blob.vercel-storage.com https://blob.vercel-storage.com${isDev ? " ws: wss:" : ""}`,
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self' https://auth.dante.actdigital.eu",
    "object-src 'none'",
    ...(isDev ? [] : ["upgrade-insecure-requests"]),
  ];
  return { csp: directives.join("; "), nonce };
}

export function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;

  // Public routes get no auth gate. Still apply CSP if it's an HTML
  // path (e.g. /login).
  const isAuthBoundary = !isPublic(pathname);

  // Session check is intentionally deferred to the page handler
  // (Server Components do `auth()` to verify + refresh). The
  // middleware can't run Auth.js's full pipeline without dragging
  // the entire jose / node-crypto chain into the edge runtime;
  // doing it once per page render server-side is fine.
  //
  // For the edge gate we just check for the presence of an Auth.js
  // session cookie. A page that requires more (e.g. role gates) still
  // runs `auth()` itself.
  if (isAuthBoundary) {
    const cookieName =
      process.env.NODE_ENV === "production"
        ? "__Host-dante-session"
        : "dante-session";
    const has = req.cookies.has(cookieName);
    if (!has) {
      const callbackUrl = encodeURIComponent(pathname + search);
      return NextResponse.redirect(
        new URL(`/login?callbackUrl=${callbackUrl}`, req.url),
      );
    }
  }

  if (!needsCsp(pathname)) {
    return NextResponse.next();
  }

  const isDev = process.env.NODE_ENV === "development";
  const { csp, nonce } = buildCsp(isDev);

  // Forward the nonce on the request headers — Next.js's renderer
  // reads it off the inbound CSP to tag its bootstrap scripts.
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  // Run on everything except static assets handled by Next directly.
  // The explicit exclude list keeps the middleware off image / font /
  // _next/* paths so static delivery stays fast.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
