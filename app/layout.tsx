import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
  title: "Dante Alighieri — analyst over Dante",
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
      <body
        style={{
          margin: 0,
          fontFamily:
            "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
          background: "#0b0d12",
          color: "#e7eaf0",
          minHeight: "100vh",
        }}
      >
        {children}
      </body>
    </html>
  );
}
