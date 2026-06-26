"use client";

import { useState } from "react";

import type { PendingHitl } from "./chat";

/** Render a parked HITL request: render the prompt, render any
 * provided options as buttons, render a freeform input when allowed.
 *
 * The submitted response shape matches what `useEveAgent.send` wants
 * in `inputResponses[]`:
 *
 *   { requestId, optionId? , value? }
 *
 * An option click sends { requestId, optionId }. A freeform answer
 * sends { requestId, value }. */
export function HitlRequest({
  request,
  onAnswer,
}: {
  request: PendingHitl;
  onAnswer: (response: {
    requestId: string;
    optionId?: string;
    value?: string;
  }) => Promise<void>;
}) {
  const [freeform, setFreeform] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const onPick = async (optionId: string) => {
    if (submitting) return;
    setSubmitting(true);
    try {
      await onAnswer({ requestId: request.requestId, optionId });
    } finally {
      setSubmitting(false);
    }
  };

  const onFreeform = async (e: React.FormEvent) => {
    e.preventDefault();
    const value = freeform.trim();
    if (!value || submitting) return;
    setSubmitting(true);
    try {
      await onAnswer({ requestId: request.requestId, value });
      setFreeform("");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <article
      style={{
        alignSelf: "flex-start",
        maxWidth: "85%",
        padding: "1rem 1.25rem",
        background: "#1d240e",
        border: "1px solid #3a4a18",
        borderRadius: 12,
        fontSize: "0.92rem",
        lineHeight: 1.5,
      }}
    >
      <header
        style={{
          fontSize: "0.7rem",
          color: "#d2c266",
          marginBottom: "0.5rem",
          textTransform: "uppercase",
          letterSpacing: "0.05em",
        }}
      >
        Action required
      </header>
      <p style={{ margin: 0, whiteSpace: "pre-wrap" }}>{request.prompt}</p>

      {request.options && request.options.length > 0 && (
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: "0.5rem",
            marginTop: "0.85rem",
          }}
        >
          {request.options.map((opt) => (
            <button
              key={opt.id}
              type="button"
              onClick={() => onPick(opt.id)}
              disabled={submitting}
              style={{
                padding: "0.5rem 0.85rem",
                background: "#3b82f6",
                border: "none",
                borderRadius: 6,
                color: "white",
                fontSize: "0.85rem",
                fontWeight: 500,
                cursor: submitting ? "not-allowed" : "pointer",
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}

      {request.allowFreeform && (
        <form
          onSubmit={onFreeform}
          style={{ display: "flex", gap: "0.5rem", marginTop: "0.85rem" }}
        >
          <input
            value={freeform}
            onChange={(e) => setFreeform(e.target.value)}
            disabled={submitting}
            placeholder="Type your answer…"
            style={{
              flex: 1,
              padding: "0.55rem 0.75rem",
              background: "#13161e",
              border: "1px solid #2c3340",
              borderRadius: 6,
              color: "#e7eaf0",
              fontSize: "0.9rem",
            }}
          />
          <button
            type="submit"
            disabled={submitting || freeform.trim().length === 0}
            style={{
              padding: "0.55rem 1rem",
              background: "#3b82f6",
              border: "none",
              borderRadius: 6,
              color: "white",
              fontSize: "0.85rem",
              fontWeight: 500,
              cursor: submitting ? "not-allowed" : "pointer",
            }}
          >
            Send
          </button>
        </form>
      )}
    </article>
  );
}
