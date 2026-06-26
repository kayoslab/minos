"use client";

/** Render the Dante connection's `authorization.required` event.
 *
 * Should be RARE in practice — the route-auth AuthFn (`authJsCookie`)
 * seeds the connection's token cache on every browser request, so
 * the connection's getToken finds a cached token instead of throwing
 * `ConnectionAuthorizationRequiredError`.
 *
 * When it does happen (boot race, cache miss after a sign-out and
 * sign-in), the user clicks the link, completes the consent in a new
 * tab, and the parked turn resumes automatically once the Cognito
 * redirect lands on `/eve/v1/connections/dante/auth/callback`. */
export function ConnectionPrompt({
  request,
}: {
  request: { url?: string; displayName?: string };
}) {
  const label = request.displayName ?? "Dante";
  const url = request.url;
  return (
    <article
      style={{
        alignSelf: "flex-start",
        maxWidth: "85%",
        padding: "1rem 1.25rem",
        background: "#1d1d2c",
        border: "1px solid #3a3a55",
        borderRadius: 12,
        fontSize: "0.92rem",
        lineHeight: 1.5,
      }}
    >
      <header
        style={{
          fontSize: "0.7rem",
          color: "#a09cf2",
          marginBottom: "0.5rem",
          textTransform: "uppercase",
          letterSpacing: "0.05em",
        }}
      >
        Sign-in required
      </header>
      <p style={{ margin: 0 }}>
        Open the link below to sign in to {label}. Once you&apos;re
        signed in, this conversation continues automatically.
      </p>
      {url && (
        <p style={{ margin: "0.75rem 0 0" }}>
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            style={{
              color: "#a09cf2",
              fontWeight: 500,
              textDecoration: "underline",
            }}
          >
            Sign in to {label} →
          </a>
        </p>
      )}
    </article>
  );
}
