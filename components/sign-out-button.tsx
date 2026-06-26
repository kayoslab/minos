/** Sign-out button. POSTs to /api/auth/signout which clears the
 * session cookie and redirects to /login. */
export function SignOutButton() {
  return (
    <form action="/api/auth/signout" method="POST">
      <button
        type="submit"
        style={{
          padding: "0.4rem 0.75rem",
          background: "transparent",
          border: "1px solid #2c3340",
          borderRadius: 6,
          color: "#8d94a3",
          fontSize: "0.8rem",
          cursor: "pointer",
        }}
      >
        Sign out
      </button>
    </form>
  );
}
