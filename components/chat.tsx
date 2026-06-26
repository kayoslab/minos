"use client";

import { useState } from "react";
import { useEveAgent } from "eve/react";

import { HitlRequest } from "./hitl-request";
import { ConnectionPrompt } from "./connection-prompt";
import { SignOutButton } from "./sign-out-button";

/** Browser chat against the EVE agent. Same-origin via withEve(), so
 * the Auth.js session cookie rides on every /eve/v1/* request — no
 * explicit credential plumbing on the client. */
export function Chat({ userName }: { userName: string }) {
  const agent = useEveAgent();
  const [draft, setDraft] = useState("");
  const isBusy =
    agent.status === "submitted" || agent.status === "streaming";

  // Look at the latest message for a parked HITL request (approval or
  // ask_question). The EVE docs put it on the dynamic-tool part's
  // toolMetadata. We render the request inline and pass it to
  // <HitlRequest>; that component answers via the same `send` call.
  const pendingHitl = findPendingHitlRequest(agent.data.messages);

  // The Dante connection's interactive auth surfaces as an
  // `authorization.required` event. With the cookie-AuthFn cache
  // seeding it should be RARE (only when the cache was cleared or
  // the agent boot raced ahead of the cookie), but we still handle
  // it gracefully.
  const pendingConnectionAuth = findPendingConnectionAuth(agent.events);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const message = draft.trim();
    if (!message || isBusy) return;
    setDraft("");
    try {
      await agent.send({ message });
    } catch {
      // hook surfaces the error via `agent.status === "error"`;
      // we don't need to do anything else here.
    }
  };

  return (
    <main
      style={{
        maxWidth: 880,
        margin: "0 auto",
        padding: "1rem 1.25rem",
        // Hard 100vh + dvh fallback for mobile browsers whose URL bar
        // collapses 100vh past the viewport — without this the input
        // sits below the bottom edge and the Send button can't be
        // clicked. `height` (not minHeight) bounds the flex column so
        // the transcript scrolls internally, not the page.
        height: "100dvh",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          paddingBottom: "1rem",
          borderBottom: "1px solid #232831",
          flexShrink: 0,
        }}
      >
        <div>
          <h1
            style={{
              margin: 0,
              fontSize: "1.1rem",
              fontWeight: 600,
              letterSpacing: "-0.01em",
            }}
          >
            Dante Alighieri
          </h1>
          <p style={{ margin: "0.15rem 0 0", fontSize: "0.75rem", color: "#5b6473" }}>
            Signed in as <code>{userName}</code>
          </p>
        </div>
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
          <button
            type="button"
            onClick={() => agent.reset()}
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
            New chat
          </button>
          <SignOutButton />
        </div>
      </header>

      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          padding: "1.25rem 0",
          display: "flex",
          flexDirection: "column",
          gap: "1rem",
        }}
      >
        {agent.data.messages.length === 0 && (
          <p style={{ color: "#5b6473", fontSize: "0.9rem", marginTop: "1rem" }}>
            Ask about projects, customers, rentability, or employees. Examples:{" "}
            <em>&ldquo;What are our biggest projects?&rdquo;</em>,{" "}
            <em>&ldquo;Show me VW&apos;s rentability for June.&rdquo;</em>
          </p>
        )}
        {agent.data.messages.map((message) => (
          <MessageBubble key={message.id} message={message} />
        ))}
        {isBusy && <ThinkingIndicator status={agent.status} />}
        {pendingConnectionAuth && (
          <ConnectionPrompt request={pendingConnectionAuth} />
        )}
        {pendingHitl && (
          <HitlRequest
            request={pendingHitl}
            onAnswer={async (response) => {
              try {
                await agent.send({ inputResponses: [response] });
              } catch {
                /* surfaced via status */
              }
            }}
          />
        )}
        {agent.status === "error" && agent.error && (
          <div
            style={{
              padding: "0.75rem 1rem",
              background: "#3a1a1a",
              border: "1px solid #5a2a2a",
              borderRadius: 8,
              color: "#f2b8b8",
              fontSize: "0.85rem",
            }}
          >
            {agent.error.message || "The agent ran into a problem."}
          </div>
        )}
      </div>

      <form
        onSubmit={onSubmit}
        style={{
          paddingTop: "1rem",
          flexShrink: 0,
          borderTop: "1px solid #232831",
        }}
      >
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            disabled={isBusy}
            placeholder="Ask Dante…"
            style={{
              flex: 1,
              minWidth: 0,
              padding: "0.85rem 1rem",
              background: "#13161e",
              border: "1px solid #2c3340",
              borderRadius: 8,
              color: "#e7eaf0",
              fontSize: "0.95rem",
            }}
          />
          <button
            type="submit"
            disabled={isBusy || draft.trim().length === 0}
            style={{
              padding: "0.85rem 1.5rem",
              background: isBusy ? "#2b3340" : "#3b82f6",
              border: "none",
              borderRadius: 8,
              color: "white",
              fontSize: "0.95rem",
              fontWeight: 600,
              cursor: isBusy ? "not-allowed" : "pointer",
              flexShrink: 0,
            }}
          >
            {isBusy ? "…" : "Send"}
          </button>
        </div>
      </form>
    </main>
  );
}

function ThinkingIndicator({ status }: { status: string }) {
  const label = status === "submitted" ? "Thinking" : "Responding";
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        alignSelf: "flex-start",
        display: "flex",
        alignItems: "center",
        gap: "0.6rem",
        padding: "0.6rem 0.9rem",
        background: "#13161e",
        border: "1px solid #232831",
        borderRadius: 12,
        color: "#8d94a3",
        fontSize: "0.85rem",
      }}
    >
      <span
        aria-hidden
        style={{
          display: "inline-flex",
          gap: "3px",
        }}
      >
        <Dot delay="0s" />
        <Dot delay="0.15s" />
        <Dot delay="0.3s" />
      </span>
      {label}…
    </div>
  );
}

function Dot({ delay }: { delay: string }) {
  return (
    <span
      style={{
        width: 6,
        height: 6,
        borderRadius: "50%",
        background: "#5b6473",
        animation: "dante-dot-pulse 1s infinite ease-in-out",
        animationDelay: delay,
        display: "inline-block",
      }}
    />
  );
}

function MessageBubble({
  message,
}: {
  message: import("eve/react").EveMessage;
}) {
  const isUser = message.role === "user";
  return (
    <article
      style={{
        alignSelf: isUser ? "flex-end" : "flex-start",
        maxWidth: "85%",
        padding: "0.75rem 1rem",
        background: isUser ? "#1d2840" : "#13161e",
        border: "1px solid",
        borderColor: isUser ? "#2d416a" : "#232831",
        borderRadius: 12,
        fontSize: "0.92rem",
        lineHeight: 1.5,
      }}
    >
      <header style={{ fontSize: "0.7rem", color: "#5b6473", marginBottom: "0.25rem" }}>
        {isUser ? "You" : "Dante"}
      </header>
      {message.parts.map((part, i) => {
        if (part.type === "text") {
          return (
            <p key={i} style={{ margin: 0, whiteSpace: "pre-wrap" }}>
              {part.text}
            </p>
          );
        }
        if (part.type === "reasoning") {
          return (
            <details
              key={i}
              style={{
                marginTop: "0.5rem",
                fontSize: "0.8rem",
                color: "#8d94a3",
              }}
            >
              <summary style={{ cursor: "pointer" }}>Reasoning</summary>
              <p style={{ margin: "0.5rem 0 0", whiteSpace: "pre-wrap" }}>
                {part.text}
              </p>
            </details>
          );
        }
        return null;
      })}
    </article>
  );
}

// ---------------------------------------------------------------------------
// HITL + connection-prompt extractors
// ---------------------------------------------------------------------------

type EveMessage = import("eve/react").EveMessage;

export type PendingHitl = {
  requestId: string;
  prompt: string;
  options?: { id: string; label: string }[];
  allowFreeform?: boolean;
};

function findPendingHitlRequest(
  messages: readonly EveMessage[],
): PendingHitl | null {
  const last = messages.at(-1);
  if (!last) return null;
  for (const part of last.parts) {
    if (part.type !== "dynamic-tool") continue;
    const eve = (part.toolMetadata as { eve?: { inputRequest?: PendingHitl } } | undefined)?.eve;
    const req = eve?.inputRequest;
    if (req) return req;
  }
  return null;
}

function findPendingConnectionAuth(events: ReadonlyArray<unknown>): {
  url?: string;
  displayName?: string;
} | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i] as {
      type?: string;
      data?: { challenge?: { url?: string; displayName?: string } };
    };
    if (e?.type === "authorization.required" && e.data?.challenge) {
      return e.data.challenge;
    }
    // Stop walking once the same session was clearly resumed past it.
    if (e?.type === "authorization.completed") return null;
  }
  return null;
}
