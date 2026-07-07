import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
  title: "Minos — analyst over Dante",
  description:
    "AI analyst over the Dante project tool. Sign in with your act " +
    "digital account; the agent reads only data your role can see on " +
    "the web.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <style
          // Keyframes can't ride inline style props; they need a
          // rule. CSP allows 'unsafe-inline' for styles so a static
          // tag here is fine.
          dangerouslySetInnerHTML={{
            __html: `@keyframes dante-dot-pulse {
              0%, 80%, 100% { opacity: 0.25; transform: scale(0.85); }
              40% { opacity: 1; transform: scale(1); }
            }`,
          }}
        />
      </head>
      <body
        style={{
          margin: 0,
          fontFamily:
            "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
          background: "#0b0d12",
          color: "#e7eaf0",
          // No body scroll — the chat manages its own scrollable
          // transcript area. Anchoring the chat to the visible
          // viewport requires html/body to be exactly viewport-sized.
          height: "100%",
          overflow: "hidden",
        }}
      >
        {children}
      </body>
    </html>
  );
}
