"use client";

import { useRef, useState } from "react";
import { useEveAgent } from "eve/react";
import { upload } from "@vercel/blob/client";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { HitlRequest } from "./hitl-request";
import { ConnectionPrompt } from "./connection-prompt";
import { SignOutButton } from "./sign-out-button";

type StagedPdf = {
  url: string;
  filename: string;
  bytes: number;
};

/** Browser chat against the EVE agent. Same-origin via withEve(), so
 * the session cookie rides on every /eve/v1/* request — no explicit
 * credential plumbing on the client. */
export function Chat({ userName }: { userName: string }) {
  const agent = useEveAgent();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState("");
  const [staged, setStaged] = useState<StagedPdf | null>(null);
  const [uploadState, setUploadState] = useState<
    { kind: "idle" } | { kind: "uploading"; filename: string } | { kind: "error"; message: string }
  >({ kind: "idle" });
  const isBusy =
    agent.status === "submitted" || agent.status === "streaming";

  const pendingHitl = findPendingHitlRequest(agent.data.messages);
  const pendingConnectionAuth = findPendingConnectionAuth(agent.events);

  const onPickFile = () => {
    if (isBusy || uploadState.kind === "uploading") return;
    fileInputRef.current?.click();
  };

  const onFileChosen = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // reset so picking the same file twice re-triggers
    if (!file) return;
    if (file.type !== "application/pdf") {
      setUploadState({ kind: "error", message: "Only PDFs are supported." });
      return;
    }
    if (file.size > 25 * 1024 * 1024) {
      setUploadState({
        kind: "error",
        message: `${file.name} is ${(file.size / 1024 / 1024).toFixed(1)} MB — limit is 25 MB.`,
      });
      return;
    }
    setUploadState({ kind: "uploading", filename: file.name });
    try {
      const safeName = file.name.replace(/[^A-Za-z0-9._-]/g, "_");
      const blob = await upload(`uploads/${safeName}`, file, {
        access: "public",
        handleUploadUrl: "/api/upload",
        contentType: "application/pdf",
      });
      setStaged({ url: blob.url, filename: file.name, bytes: file.size });
      setUploadState({ kind: "idle" });
    } catch (err) {
      setUploadState({
        kind: "error",
        message: `Upload failed: ${(err as Error).message}`,
      });
    }
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const message = draft.trim();
    if (!message && !staged) return;
    if (isBusy) return;

    const stagedSnapshot = staged;
    setDraft("");
    setStaged(null);

    try {
      if (stagedSnapshot) {
        // Multi-part user content: text prompt + PDF file part. The
        // model (Claude Sonnet 4.6) reads PDFs natively via vision —
        // no separate parser needed. Filename rides along so the
        // model can refer to it in its response.
        const userContent = [
          { type: "text" as const, text: message || `Please process the attached file: ${stagedSnapshot.filename}` },
          {
            type: "file" as const,
            mediaType: "application/pdf",
            filename: stagedSnapshot.filename,
            data: new URL(stagedSnapshot.url),
          },
        ];
        await agent.send({ message: userContent });
      } else {
        await agent.send({ message });
      }
    } catch {
      /* surfaced via status */
    }
  };

  return (
    <>
      {/* Root holds the chat shell at a guaranteed viewport size — the
          earlier dvh-only approach left the input below the fold on
          some browsers (URL bar / soft keyboard quirks), so we lock
          html/body to the visible viewport in <head> and use
          position:fixed for the input bar as a hard guarantee. */}
      <main
        style={{
          position: "fixed",
          inset: 0,
          maxWidth: 880,
          margin: "0 auto",
          padding: "1rem 1.25rem 0",
          display: "flex",
          flexDirection: "column",
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
              Minos
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
            padding: "1.25rem 0 5.5rem",
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
      </main>

      {/* Input bar is position:fixed so it always sits at the bottom
          of the visible viewport, on top of any soft keyboard and
          regardless of dvh/vh quirks. The transcript area above
          reserves padding-bottom (~5.5rem) so the last message
          isn't hidden behind it. */}
      <form
        onSubmit={onSubmit}
        style={{
          position: "fixed",
          left: 0,
          right: 0,
          bottom: 0,
          background: "#0b0d12",
          borderTop: "1px solid #232831",
          padding: "0.85rem 1.25rem",
          paddingBottom: "calc(0.85rem + env(safe-area-inset-bottom, 0px))",
        }}
      >
        <div
          style={{
            maxWidth: 880,
            margin: "0 auto",
            display: "flex",
            flexDirection: "column",
            gap: "0.5rem",
          }}
        >
          {(staged || uploadState.kind !== "idle") && (
            <AttachmentRow
              staged={staged}
              uploadState={uploadState}
              onClear={() => {
                setStaged(null);
                setUploadState({ kind: "idle" });
              }}
            />
          )}
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/pdf"
              hidden
              onChange={onFileChosen}
            />
            <button
              type="button"
              onClick={onPickFile}
              disabled={isBusy || uploadState.kind === "uploading"}
              title="Attach a PDF (framework agreement, purchase order, freelancer bill)"
              aria-label="Attach a PDF"
              style={{
                padding: "0.85rem 0.9rem",
                background: "#13161e",
                border: "1px solid #2c3340",
                borderRadius: 8,
                color: "#8d94a3",
                fontSize: "1.05rem",
                cursor:
                  isBusy || uploadState.kind === "uploading"
                    ? "not-allowed"
                    : "pointer",
                flexShrink: 0,
                lineHeight: 1,
              }}
            >
              {/* Paperclip glyph. Avoid an SVG dep — Unicode is plenty. */}
              📎
            </button>
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              disabled={isBusy}
              placeholder={
                staged
                  ? "Add a note for this PDF (optional) and press Send…"
                  : "Ask Minos…"
              }
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
              disabled={
                isBusy ||
                (draft.trim().length === 0 && !staged) ||
                uploadState.kind === "uploading"
              }
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
        </div>
      </form>
    </>
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
      <span aria-hidden style={{ display: "inline-flex", gap: "3px" }}>
        <Dot delay="0s" />
        <Dot delay="0.15s" />
        <Dot delay="0.3s" />
      </span>
      {label}…
    </div>
  );
}

function AttachmentRow({
  staged,
  uploadState,
  onClear,
}: {
  staged: StagedPdf | null;
  uploadState:
    | { kind: "idle" }
    | { kind: "uploading"; filename: string }
    | { kind: "error"; message: string };
  onClear: () => void;
}) {
  let body: React.ReactNode;
  let tone = "#2c3340";
  if (uploadState.kind === "uploading") {
    body = (
      <>
        <span style={{ display: "inline-flex", gap: "3px" }}>
          <Dot delay="0s" />
          <Dot delay="0.15s" />
          <Dot delay="0.3s" />
        </span>
        <span>Uploading {uploadState.filename}…</span>
      </>
    );
  } else if (uploadState.kind === "error") {
    tone = "#5a2a2a";
    body = <span style={{ color: "#f2b8b8" }}>{uploadState.message}</span>;
  } else if (staged) {
    body = (
      <>
        <span aria-hidden>📄</span>
        <span>
          <strong style={{ color: "#e7eaf0" }}>{staged.filename}</strong>{" "}
          <span style={{ color: "#5b6473" }}>
            · {(staged.bytes / 1024).toFixed(0)} KB
          </span>
        </span>
      </>
    );
  } else {
    return null;
  }
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "0.5rem",
        padding: "0.4rem 0.6rem",
        background: "#13161e",
        border: `1px solid ${tone}`,
        borderRadius: 8,
        color: "#8d94a3",
        fontSize: "0.82rem",
      }}
    >
      {body}
      <button
        type="button"
        onClick={onClear}
        title="Remove attachment"
        aria-label="Remove attachment"
        style={{
          marginLeft: "auto",
          padding: "0.15rem 0.5rem",
          background: "transparent",
          border: "1px solid #2c3340",
          borderRadius: 4,
          color: "#8d94a3",
          fontSize: "0.75rem",
          cursor: "pointer",
        }}
      >
        ✕
      </button>
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
        {isUser ? "You" : "Minos"}
      </header>
      {message.parts.map((part, i) => {
        if (part.type === "text") {
          return <MarkdownText key={i} text={part.text} />;
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
              <div style={{ marginTop: "0.5rem" }}>
                <MarkdownText text={part.text} />
              </div>
            </details>
          );
        }
        if (part.type === "dynamic-tool") {
          return <ToolCallChip key={i} part={part} />;
        }
        return null;
      })}
    </article>
  );
}

/** Markdown renderer with project styles applied to common elements.
 * Tables come from remark-gfm (used for `getFpBurndown`-style outputs
 * the model often formats as a markdown table). */
function MarkdownText({ text }: { text: string }) {
  return (
    <div className="dante-md" style={{ overflowWrap: "anywhere" }}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: (props) => (
            <p style={{ margin: "0.35rem 0", whiteSpace: "pre-wrap" }} {...props} />
          ),
          ul: (props) => (
            <ul
              style={{ margin: "0.35rem 0", paddingLeft: "1.25rem" }}
              {...props}
            />
          ),
          ol: (props) => (
            <ol
              style={{ margin: "0.35rem 0", paddingLeft: "1.25rem" }}
              {...props}
            />
          ),
          li: (props) => <li style={{ margin: "0.15rem 0" }} {...props} />,
          h1: (props) => (
            <h3 style={{ margin: "0.6rem 0 0.3rem", fontSize: "1rem" }} {...props} />
          ),
          h2: (props) => (
            <h4 style={{ margin: "0.5rem 0 0.25rem", fontSize: "0.95rem" }} {...props} />
          ),
          h3: (props) => (
            <h5 style={{ margin: "0.5rem 0 0.25rem", fontSize: "0.9rem" }} {...props} />
          ),
          a: (props) => (
            <a
              style={{ color: "#7aa7ff", textDecoration: "underline" }}
              target="_blank"
              rel="noreferrer noopener"
              {...props}
            />
          ),
          code: ({ children, ...props }) => {
            // Inline vs fenced — react-markdown passes `inline` only on
            // inline `code`. For fenced blocks `<pre>` wraps it.
            const isInline = !String(children).includes("\n");
            if (isInline) {
              return (
                <code
                  style={{
                    background: "#1e2330",
                    padding: "0.05rem 0.35rem",
                    borderRadius: 4,
                    fontSize: "0.85em",
                  }}
                  {...props}
                >
                  {children}
                </code>
              );
            }
            return (
              <code
                style={{
                  display: "block",
                  background: "#0e1118",
                  padding: "0.75rem",
                  borderRadius: 6,
                  fontSize: "0.85em",
                  overflowX: "auto",
                }}
                {...props}
              >
                {children}
              </code>
            );
          },
          pre: (props) => (
            <pre
              style={{
                margin: "0.5rem 0",
                background: "transparent",
                padding: 0,
              }}
              {...props}
            />
          ),
          table: (props) => (
            <div style={{ overflowX: "auto", margin: "0.5rem 0" }}>
              <table
                style={{
                  borderCollapse: "collapse",
                  fontSize: "0.85em",
                  width: "100%",
                }}
                {...props}
              />
            </div>
          ),
          th: (props) => (
            <th
              style={{
                border: "1px solid #2c3340",
                padding: "0.35rem 0.55rem",
                background: "#1a1f2b",
                textAlign: "left",
              }}
              {...props}
            />
          ),
          td: (props) => (
            <td
              style={{ border: "1px solid #2c3340", padding: "0.35rem 0.55rem" }}
              {...props}
            />
          ),
          blockquote: (props) => (
            <blockquote
              style={{
                margin: "0.35rem 0",
                borderLeft: "3px solid #2c3340",
                paddingLeft: "0.75rem",
                color: "#8d94a3",
              }}
              {...props}
            />
          ),
          hr: () => (
            <hr
              style={{
                border: "none",
                borderTop: "1px solid #232831",
                margin: "0.75rem 0",
              }}
            />
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

/** Tool-call chip — gives the user the same context the TUI shows
 * inline ("✓ tool_name args → result"). The model's own text parts
 * already explain what happened in prose, but seeing the calls is
 * useful for diagnosing why an answer is sparse. */
function ToolCallChip({ part }: { part: { toolName?: string; state?: string; input?: unknown; output?: unknown } }) {
  const toolName = part.toolName ?? "tool";
  const state = part.state ?? "completed";
  return (
    <details
      style={{
        marginTop: "0.5rem",
        fontSize: "0.78rem",
        color: "#8d94a3",
        border: "1px solid #232831",
        borderRadius: 6,
        background: "#0e1118",
      }}
    >
      <summary
        style={{
          cursor: "pointer",
          padding: "0.4rem 0.6rem",
          display: "flex",
          gap: "0.4rem",
          alignItems: "center",
        }}
      >
        <span aria-hidden>
          {state === "completed" ? "✓" : state === "error" ? "⨯" : "▸"}
        </span>
        <code style={{ color: "#a8b1c1" }}>{toolName}</code>
      </summary>
      <div style={{ padding: "0 0.6rem 0.6rem", fontSize: "0.75rem" }}>
        {part.input !== undefined && (
          <div style={{ marginTop: "0.35rem" }}>
            <div style={{ color: "#5b6473" }}>input</div>
            <pre
              style={{
                margin: "0.15rem 0 0",
                fontSize: "0.75rem",
                overflowX: "auto",
                color: "#c1c7d3",
              }}
            >
              {safeStringify(part.input)}
            </pre>
          </div>
        )}
        {part.output !== undefined && (
          <div style={{ marginTop: "0.35rem" }}>
            <div style={{ color: "#5b6473" }}>output</div>
            <pre
              style={{
                margin: "0.15rem 0 0",
                fontSize: "0.75rem",
                overflowX: "auto",
                color: "#c1c7d3",
                maxHeight: "12rem",
              }}
            >
              {safeStringify(part.output)}
            </pre>
          </div>
        )}
      </div>
    </details>
  );
}

function safeStringify(v: unknown): string {
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
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
    if (e?.type === "authorization.completed") return null;
  }
  return null;
}
