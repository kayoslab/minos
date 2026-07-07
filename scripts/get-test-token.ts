#!/usr/bin/env tsx
/** One-shot Cognito PKCE flow for testing the deployed EVE agent.
 *
 * Runs the same Authorization Code flow `agent/connections/dante.ts`
 * runs at session time, but here on the developer's laptop, with a
 * local HTTP listener as the redirect URI. Prints the access token
 * on success so you can curl the deployed EVE agent:
 *
 *   ACCESS_TOKEN=$(tsx scripts/get-test-token.ts)
 *   curl -X POST https://minos.vercel.app/eve/v1/session \
 *     -H "Authorization: Bearer $ACCESS_TOKEN" \
 *     -H "Content-Type: application/json" \
 *     -d '{"message":"List the active projects in Dante."}'
 *
 * Configuration is read from the same env vars the agent uses:
 *   DANTE_COGNITO_DOMAIN, DANTE_COGNITO_AGENT_CLIENT_ID
 * Plus an optional `--port` (default 8765) for the local listener.
 *
 * The PKCE verifier never leaves this process; the auth code is
 * single-use; the cached token isn't persisted. Re-run when the
 * token expires (1h by default). */
import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";

const COGNITO_DOMAIN = mustEnv("DANTE_COGNITO_DOMAIN");
const CLIENT_ID = mustEnv("DANTE_COGNITO_AGENT_CLIENT_ID");
const PORT = Number.parseInt(
  process.env.GET_TOKEN_PORT ?? process.argv.find((a) => /^--port=\d+$/.test(a))?.split("=")[1] ?? "8765",
  10,
);
const REDIRECT_URI = `http://localhost:${PORT}/callback`;
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
    console.error(`get-test-token: env ${name} is not set. Source .env.local or export it.`);
    process.exit(2);
  }
  return v;
}

function base64url(buf: Buffer): string {
  return buf.toString("base64url");
}

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
console.error(
  "Reminder: add 'http://localhost:" +
    PORT +
    "/callback' to `agent_callback_urls` in Dante's tfvars and " +
    "push to main before the first run — Cognito rejects redirect_uri " +
    "values not on its allowlist.",
);

const server = createServer(async (req, res) => {
  if (!req.url?.startsWith("/callback")) {
    res.writeHead(404).end();
    return;
  }
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const code = url.searchParams.get("code");
  const returnedState = url.searchParams.get("state");
  const error = url.searchParams.get("error");
  if (error) {
    res.writeHead(400, { "content-type": "text/plain" }).end(
      `Cognito returned: ${error}`,
    );
    console.error(`Cognito returned: ${error}`);
    server.close();
    process.exit(1);
  }
  if (!code || returnedState !== state) {
    res.writeHead(400, { "content-type": "text/plain" }).end(
      "Missing code or state mismatch.",
    );
    console.error("Missing code or state mismatch.");
    server.close();
    process.exit(1);
  }
  // Exchange the code for tokens.
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
      res.writeHead(500, { "content-type": "text/plain" }).end(
        `Token exchange failed: ${tokenRes.status} ${detail}`,
      );
      console.error(`Token exchange failed: ${tokenRes.status} ${detail}`);
      server.close();
      process.exit(1);
    }
    const json = (await tokenRes.json()) as {
      access_token: string;
      expires_in: number;
      scope?: string;
    };
    res
      .writeHead(200, { "content-type": "text/html" })
      .end(
        "<html><body><p>Signed in. You can close this tab.</p></body></html>",
      );
    // The access token is what you bearer to EVE. Print it to stdout
    // so `ACCESS_TOKEN=$(tsx scripts/get-test-token.ts)` captures it.
    process.stdout.write(json.access_token + "\n");
    console.error("");
    console.error(`Token expires in ${json.expires_in}s.`);
    if (json.scope) console.error(`Scopes issued: ${json.scope}`);
    server.close();
    setTimeout(() => process.exit(0), 100);
  } catch (e) {
    res.writeHead(500, { "content-type": "text/plain" }).end(
      `Internal error: ${(e as Error).message}`,
    );
    console.error(e);
    server.close();
    process.exit(1);
  }
});

server.listen(PORT);
