import type { NextConfig } from "next";
import { withEve } from "eve/next";

/** Same-origin EVE + Next.js. `withEve()` proxies `/eve/v1/*` to the
 * EVE runtime in dev and bundles it into the same Vercel deploy in
 * prod. The browser only ever sees one origin, so cookies set by
 * Auth.js are sent on every EVE request without CORS gymnastics. */
const nextConfig: NextConfig = {
  experimental: {
    // Required for the `forbidden()` helper if we ever use it in
    // route handlers. Cheap to leave on.
    authInterrupts: true,
  },
  async headers() {
    return [
      {
        // Static security headers on every response. CSP is set
        // per-request in middleware so each HTML response carries a
        // fresh nonce.
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "no-referrer" },
          {
            key: "Permissions-Policy",
            value:
              "camera=(), microphone=(), geolocation=(), payment=(), " +
              "usb=(), accelerometer=(), gyroscope=(), magnetometer=()",
          },
          ...(process.env.NODE_ENV === "production"
            ? [
                {
                  key: "Strict-Transport-Security",
                  value: "max-age=31536000; includeSubDomains; preload",
                },
              ]
            : []),
        ],
      },
    ];
  },
};

export default withEve(nextConfig);
