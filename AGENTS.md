# eve Agent App

This project uses the eve framework. Before writing code, read the relevant guide
from the installed eve package docs at `node_modules/eve/docs/`.
If package docs are unavailable, use https://eve.dev/docs as a fallback.

# Dante Alighieri — analyst-style agent over Dante

Read-only analyst on top of Dante (act digital's Personio-backed project +
allocation tool). End users sign in once via the Cognito hosted UI (the same
sign-in screen they'd use on the Dante web app, MFA mandatory). The same
Cognito access token authenticates the browser → EVE route AND is re-used by
EVE's outbound Dante connection — one sign-in, one consent, both sides
authorized.

Scopes are subset by a Pre Token Generation Lambda on the Cognito side.
Employees can grant `read:projects`, `read:customers`, `read:employees`.
Managers add `read:reports` + `read:salaries`.

## Topology

The project is a **Next.js + EVE hybrid** via `withEve()` (`next.config.ts`).
One Vercel deploy serves:

- `app/` — Next.js pages (`/login`, `/chat`).
- `app/api/auth/[...nextauth]/` — Auth.js endpoints (Cognito provider).
- `/eve/v1/*` — EVE channel routes, mounted by `withEve()`.

Same origin → cookies set by Auth.js are sent on every EVE request without
CORS gymnastics.

## File map

```
agent/                          (EVE agent — unchanged from POC)
  agent.ts
  instructions.md
  channels/eve.ts                route auth: localDev + Auth.js cookie + Cognito bearer
  connections/dante.ts           OpenAPI connection w/ interactive Cognito OAuth
  lib/cognito-pkce.ts            PKCE helpers
  lib/token-store.ts             in-memory cache, seeded by the channel AuthFn

app/                            (Next.js App Router)
  layout.tsx
  page.tsx                       redirects to /chat or /login
  login/page.tsx                 Cognito sign-in entry
  chat/page.tsx                  the main chat — guarded by auth()
  api/auth/[...nextauth]/route.ts

components/
  chat.tsx                       useEveAgent + message list + composer
  hitl-request.tsx               renders parked HITL (approval / ask_question)
  connection-prompt.tsx          renders parked authorization.required
  sign-out-button.tsx

lib/
  auth/config.ts                 Auth.js Cognito provider + token refresh
  auth/index.ts                  NextAuth singleton (handlers, auth, signIn, signOut)
  auth/actions.ts                "use server" wrappers (sign-out)
  auth/next-auth.d.ts            Session + JWT type augmentation
  eve-route-auth.ts              channel AuthFn: cookie + bearer + cache-seed side-effect

middleware.ts                   CSP + per-request nonce + cookie-based auth gate
next.config.ts                  withEve() + static security headers
```

## Sign-in flow

1. User opens `https://dante-alighieri.vercel.app/`.
2. Middleware sees no Auth.js cookie → redirect to `/login`.
3. User clicks **Sign in with Cognito** → server action `signIn("cognito", …)`.
4. Auth.js drives the OAuth Authorization Code flow with PKCE:
   - Redirects to `https://auth.dante.actdigital.eu/oauth2/authorize?…`
   - Cognito hosted UI: MFA challenge, consent screen listing `dante-agents/*` scopes.
   - Pre Token Generation Lambda subsets scopes against the user's Cognito group.
5. Cognito redirects back to `/api/auth/callback/cognito?code=…&state=…`.
6. Auth.js exchanges the code, encrypts `{access_token, refresh_token, expires_at}` onto a JWT cookie.
7. Cookie is httpOnly, Secure, SameSite=Lax. The browser never sees the access token in JS.
8. User lands on `/chat`.

## Browser → EVE → Dante (one token, two effects)

1. `useEveAgent` calls `POST /eve/v1/session`. Browser sends the Auth.js cookie automatically.
2. Channel walk in `agent/channels/eve.ts`:
   - `localDev()` skips (not loopback).
   - `authJsCookie()` runs: reads the cookie via `auth()`, pulls the Cognito access token,
     verifies it against Cognito's JWKS, returns `SessionAuthContext` AND side-effect
     populates the connection's token cache by `sub`.
3. EVE runs the agent. Model picks a tool (e.g. `dante__listProjects`).
4. Dante connection's `getToken({principal})` finds the cached token by sub → returns it.
   No second OAuth flow.
5. Connection calls `https://dante.actdigital.eu/api/agent/projects` with `Authorization:
   Bearer <token>`. Dante's `requireAgentSession` verifies the same token (same JWKS, same
   `client_id`), re-checks role hierarchy against the requested scope, returns data.

## OAuth callback URLs registered on Cognito

`agent_callback_urls` in Dante's `terraform/envs/prod/variables.tf`:

- `http://localhost:3000/eve/v1/connections/dante/auth/callback` — local TUI / interactive
   auth fallback.
- `http://localhost:8765/callback` — `scripts/get-test-token.ts` listener.
- `https://dante-alighieri.vercel.app/eve/v1/connections/dante/auth/callback` — deployed
   EVE interactive auth fallback.
- `https://dante-alighieri.vercel.app/api/auth/callback/cognito` — **NEW**: Auth.js
   callback for the browser sign-in flow. Add this to tfvars before first deploy.

## Local dev

```bash
cp .env.example .env.local
# Fill AUTH_SECRET (openssl rand -base64 64) and DANTE_COGNITO_AGENT_CLIENT_ID
# (terraform output -raw agent_client_id from terraform/envs/prod in Dante).
npm install
npm run dev
```

The dev server boots Next at `http://localhost:3000` and proxies `/eve/v1/*` to the
EVE runtime in the same process. `localDev()` route auth admits loopback hosts so a TUI
on the same machine also works (`npx eve`).

## Production deploy

1. **Vercel env vars** (Production scope):
   ```
   AUTH_SECRET                       openssl rand -base64 64 (different from dev)
   DANTE_COGNITO_ISSUER              cognito-idp.<region>.amazonaws.com/<pool>
   DANTE_COGNITO_DOMAIN              https://auth.dante.actdigital.eu
   DANTE_COGNITO_AGENT_CLIENT_ID     terraform output -raw agent_client_id
   DANTE_API_BASE_URL                https://dante.actdigital.eu
   AI_GATEWAY_API_KEY                <from Vercel AI Gateway>
   ```
2. **Cognito callback** — add `https://dante-alighieri.vercel.app/api/auth/callback/cognito`
   to `agent_callback_urls` in Dante's tfvars. Push to main; GHA applies.
3. `vercel deploy --prod`.

## Token cache caveat (still POC quality)

`agent/lib/token-store.ts` is in-process memory. The channel AuthFn re-seeds it on every
browser request, so cold starts that drop the cache are recovered on the next message.
For non-browser callers (the test-token script), a cold start still triggers the
interactive auth fallback. Acceptable for the demo; swap to Vercel KV before any
serious scaling.

## What's still missing for production-grade

- Persistent token cache (Vercel KV) — drop-in replace `agent/lib/token-store.ts`.
- Per-user audit logging in EVE (we currently rely on Dante-side audit).
- Per-tool unit tests + an `evals/` suite.
- Rate limit at the EVE channel layer (today only Dante-side limits apply).
