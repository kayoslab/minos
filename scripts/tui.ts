#!/usr/bin/env tsx
/** Drive the EVE TUI against the deployed agent AS THE LOGGED-IN
 * USER — not as the Vercel project service principal.
 *
 * Why this exists: `npx eve dev <remote>` injects a Vercel OIDC
 * bearer that resolves on the server as `principalType: "service"`.
 * The Dante connection is user-scoped via
 * `defineInteractiveAuthorization` and refuses service callers. So
 * out of the box the TUI can chat with the model but every Dante
 * tool call fails.
 *
 * What this does:
 *   1. Runs the same Cognito Authorization Code + PKCE flow as
 *      `scripts/get-test-token.ts`. Opens a browser, listens on
 *      :8765, captures the access token + refresh token. MFA happens
 *      on Cognito's hosted UI. The PKCE verifier never leaves this
 *      process.
 *   2. Starts a localhost reverse proxy on :8766 that forwards every
 *      request to `https://minos.vercel.app`, overwriting
 *      the Authorization header with `Bearer <cognito-access-token>`.
 *      The channel's `cognitoBearer()` then resolves the caller as
 *      `principalType: "user"` — same principal the browser chat
 *      uses — so Dante tools work.
 *   3. Spawns `npx eve dev http://localhost:8766` as a child process
 *      and forwards its stdio. The TUI thinks it's talking to a
 *      local agent; the proxy is what reaches prod.
 *   4. Refreshes the access token in the background ~30 s before
 *      expiry so a long TUI session doesn't 401 mid-turn.
 *
 * Run with `npm run tui` (added to package.json). */
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { createServer, request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";

const COGNITO_DOMAIN = mustEnv("DANTE_COGNITO_DOMAIN");
const CLIENT_ID = mustEnv("DANTE_COGNITO_AGENT_CLIENT_ID");
const TARGET_URL = process.env.MINOS_TUI_TARGET ?? "https://minos.vercel.app";
const CALLBACK_PORT = Number.parseInt(process.env.MINOS_TUI_CALLBACK_PORT ?? "8765", 10);
const PROXY_PORT = Number.parseInt(process.env.MINOS_TUI_PROXY_PORT ?? "8766", 10);
const REDIRECT_URI = `http://localhost:${CALLBACK_PORT}/callback`;
const SCOPES = [
  "openid",
  "dante-agents/read:projects",
  "dante-agents/read:customers",
  "dante-agents/read:reports",
  "dante-agents/read:employees",
  "dante-agents/read:salaries",
].join(" ");

function mustEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`tui: env ${name} is not set. Source .env.local or export it.`);
    process.exit(2);
  }
  return v;
}

function base64url(buf: Buffer): string {
  return buf.toString("base64url");
}

type TokenSet = {
  access_token: string;
  refresh_token: string;
  expires_at: number;
};

async function signInInteractive(): Promise<TokenSet> {
  const verifier = base64url(randomBytes(32));
  const challenge = base64url(createHash("sha256").update(verifier).digest());
  const state = base64url(randomBytes(16));

  const authorizeUrl = new URL(`${COGNITO_DOMAIN}/oauth2/authorize`);
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("client_id", CLIENT_ID);
  authorizeUrl.searchParams.set("redirect_uri", REDIRECT_URI);
  authorizeUrl.searchParams.set("scope", SCOPES);
  authorizeUrl.searchParams.set("state", state);
  authorizeUrl.searchParams.set("code_challenge", challenge);
  authorizeUrl.searchParams.set("code_challenge_method", "S256");

  console.error("Open this URL in your browser to sign in:");
  console.error("");
  console.error(`  ${authorizeUrl.toString()}`);
  console.error("");
  console.error(`Listening for the callback on ${REDIRECT_URI} ...`);
  console.error("");

  return new Promise<TokenSet>((resolve, reject) => {
    const server = createServer(async (req, res) => {
      if (!req.url?.startsWith("/callback")) {
        res.writeHead(404).end();
        return;
      }
      const url = new URL(req.url, `http://localhost:${CALLBACK_PORT}`);
      const code = url.searchParams.get("code");
      const returnedState = url.searchParams.get("state");
      const error = url.searchParams.get("error");
      if (error) {
        res.writeHead(400, { "content-type": "text/plain" }).end(`Cognito returned: ${error}`);
        server.close();
        reject(new Error(`Cognito returned: ${error}`));
        return;
      }
      if (!code || returnedState !== state) {
        res.writeHead(400, { "content-type": "text/plain" }).end("Missing code or state mismatch.");
        server.close();
        reject(new Error("Missing code or state mismatch."));
        return;
      }
      try {
        const body = new URLSearchParams({
          grant_type: "authorization_code",
          client_id: CLIENT_ID,
          code,
          redirect_uri: REDIRECT_URI,
          code_verifier: verifier,
        });
        const tokenRes = await fetch(`${COGNITO_DOMAIN}/oauth2/token`, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: body.toString(),
        });
        if (!tokenRes.ok) {
          const detail = await tokenRes.text();
          res
            .writeHead(500, { "content-type": "text/plain" })
            .end(`Token exchange failed: ${tokenRes.status} ${detail}`);
          server.close();
          reject(new Error(`Token exchange failed: ${tokenRes.status} ${detail}`));
          return;
        }
        const json = (await tokenRes.json()) as {
          access_token: string;
          refresh_token?: string;
          expires_in: number;
        };
        if (!json.refresh_token) {
          res.writeHead(500, { "content-type": "text/plain" }).end("No refresh token.");
          server.close();
          reject(new Error("Cognito did not return a refresh token."));
          return;
        }
        res
          .writeHead(200, { "content-type": "text/html" })
          .end("<html><body><p>Signed in. You can close this tab.</p></body></html>");
        server.close();
        resolve({
          access_token: json.access_token,
          refresh_token: json.refresh_token,
          expires_at: Math.floor(Date.now() / 1000) + json.expires_in,
        });
      } catch (e) {
        res.writeHead(500, { "content-type": "text/plain" }).end(`Internal error: ${(e as Error).message}`);
        server.close();
        reject(e);
      }
    });
    server.listen(CALLBACK_PORT);
  });
}

async function refreshAccessToken(refreshToken: string): Promise<TokenSet | null> {
  try {
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      client_id: CLIENT_ID,
      refresh_token: refreshToken,
    });
    const res = await fetch(`${COGNITO_DOMAIN}/oauth2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { access_token: string; expires_in: number };
    return {
      access_token: json.access_token,
      // Cognito doesn't rotate the refresh token on this grant.
      refresh_token: refreshToken,
      expires_at: Math.floor(Date.now() / 1000) + json.expires_in,
    };
  } catch {
    return null;
  }
}

function startProxy(getToken: () => string, targetUrl: string): Promise<void> {
  const upstream = new URL(targetUrl);
  const isHttps = upstream.protocol === "https:";
  const requestFn = isHttps ? httpsRequest : httpRequest;
  const upstreamPort = upstream.port ? Number(upstream.port) : isHttps ? 443 : 80;

  return new Promise((resolve, reject) => {
    const proxy = createServer((req, res) => {
      // Strip incoming Authorization (vercelOidc, etc.) — we replace
      // it with the Cognito bearer below. Lowercase the key when
      // copying because Node uses lowercase header names internally.
      const fwdHeaders: Record<string, string | string[] | undefined> = {
        ...req.headers,
        host: upstream.host,
        authorization: `Bearer ${getToken()}`,
        // Forward as identity so SSE chunks aren't gzipped through us.
        "accept-encoding": "identity",
      };
      const upstreamReq = requestFn(
        {
          method: req.method,
          hostname: upstream.hostname,
          port: upstreamPort,
          path: req.url,
          headers: fwdHeaders,
        },
        (upstreamRes) => {
          res.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers);
          upstreamRes.pipe(res);
        },
      );
      upstreamReq.on("error", (err) => {
        if (!res.headersSent) res.writeHead(502, { "content-type": "text/plain" });
        res.end(`upstream error: ${err.message}`);
      });
      req.pipe(upstreamReq);
    });
    proxy.on("error", reject);
    proxy.listen(PROXY_PORT, () => {
      console.error(`Proxy listening on http://localhost:${PROXY_PORT} → ${targetUrl}`);
      resolve();
    });
  });
}

async function main() {
  let tokens = await signInInteractive();
  console.error("Signed in.");
  console.error("");

  // Background refresh ~30 s before the access token expires.
  setInterval(async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    if (nowSec < tokens.expires_at - 30) return;
    const refreshed = await refreshAccessToken(tokens.refresh_token);
    if (refreshed) tokens = refreshed;
    // On failure we keep the old token — the next request 401s and
    // the TUI surfaces it; better than terminating mid-session.
  }, 15_000).unref();

  await startProxy(() => tokens.access_token, TARGET_URL);

  const child = spawn("npx", ["eve", "dev", `http://localhost:${PROXY_PORT}`], {
    stdio: "inherit",
    env: process.env,
  });
  const cleanup = () => {
    if (!child.killed) child.kill("SIGTERM");
  };
  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);
  child.on("exit", (code) => {
    process.exit(code ?? 0);
  });
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
