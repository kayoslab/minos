"use client";

import { useEffect, useState } from "react";

/** Landing page for a re-sign-in opened in a popup.
 *
 * When a session fully expires, the chat opens the Cognito flow in a
 * popup so the in-memory transcript in the opener tab survives. On
 * success the callback lands here (cookies freshly set), we notify the
 * opener and close. Opened as a normal tab (no opener) — e.g. the popup
 * was blocked and we fell back to a full redirect — we just go to the
 * chat. */
export default function AuthComplete() {
  const [closed, setClosed] = useState(true);

  useEffect(() => {
    const opener = window.opener as Window | null;
    if (!opener) {
      window.location.replace("/chat");
      return;
    }
    opener.postMessage("minos:reauthenticated", window.location.origin);
    window.close();
    // Some browsers refuse window.close() on a window they didn't open
    // via script; if we're still here a tick later, show a hint.
    const t = setTimeout(() => setClosed(false), 400);
    return () => clearTimeout(t);
  }, []);

  return (
    <main
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        height: "100dvh",
        padding: "2rem",
        textAlign: "center",
        color: "#8d94a3",
        fontFamily:
          "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
        fontSize: "0.9rem",
      }}
    >
      {closed
        ? "Signed in — returning to your chat…"
        : "Signed in. You can close this window and return to your chat."}
    </main>
  );
}
