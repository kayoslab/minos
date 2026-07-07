import { redirect } from "next/navigation";

import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

/** Login. A signed-in user hitting this page is bounced to /chat;
 * otherwise we surface a single button that GETs /api/auth/signin,
 * which generates PKCE + state and redirects to the Cognito hosted
 * UI. Cognito eventually redirects back to /api/auth/callback. */
export default async function LoginPage(props: {
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await getSession();
  if (session) {
    redirect("/chat");
  }
  const { error } = await props.searchParams;

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "1rem",
      }}
    >
      <div
        style={{
          maxWidth: 420,
          width: "100%",
          padding: "2rem",
          background: "#13161e",
          borderRadius: 12,
          border: "1px solid #232831",
        }}
      >
        <h1
          style={{
            margin: 0,
            fontSize: "1.5rem",
            fontWeight: 600,
            letterSpacing: "-0.01em",
          }}
        >
          Minos
        </h1>
        <p
          style={{
            marginTop: "0.5rem",
            color: "#8d94a3",
            fontSize: "0.95rem",
          }}
        >
          AI analyst over the Dante project tool. Sign in with your act
          digital account.
        </p>
        {error && (
          <p
            style={{
              marginTop: "1rem",
              padding: "0.75rem",
              background: "#3a1a1a",
              border: "1px solid #5a2a2a",
              borderRadius: 8,
              color: "#f2b8b8",
              fontSize: "0.85rem",
            }}
          >
            Sign-in failed: {error}
          </p>
        )}
        <form action="/api/auth/signin" method="GET" style={{ marginTop: "1.5rem" }}>
          <button
            type="submit"
            style={{
              width: "100%",
              padding: "0.85rem 1rem",
              background: "#3b82f6",
              border: "none",
              borderRadius: 8,
              color: "white",
              fontSize: "0.95rem",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Sign in with Cognito
          </button>
        </form>
        <p
          style={{
            marginTop: "1rem",
            color: "#5b6473",
            fontSize: "0.75rem",
            lineHeight: 1.5,
          }}
        >
          You&apos;ll be redirected to the Dante hosted sign-in (MFA
          required). The agent reads only data your role can see on the
          Dante web app.
        </p>
      </div>
    </main>
  );
}
