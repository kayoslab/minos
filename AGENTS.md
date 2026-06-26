# eve Agent App

This project uses the eve framework. Before writing code, read the relevant guide
from the installed eve package docs. In most installs, those docs are at
`node_modules/eve/docs/`. In workspaces or local package installs, resolve the
installed `eve` package location first and read its `docs/` directory. If
package docs are unavailable, use https://eve.dev/docs as a fallback.

# Dante Alighieri — agent over the Dante project tool

Reads-only analyst on top of Dante (act digital's Personio-backed project +
allocation tool). The agent calls Dante's `/api/agent/*` endpoints over OAuth,
so end-users sign in to Dante through the same Cognito hosted UI they'd use on
the web app (MFA mandatory). Scopes are subset by a Pre Token Generation Lambda
on the Cognito side: an employee user can only ever grant `read:projects` and
`read:customers`; managers add `read:reports`, `read:employees`, `read:salaries`.

Stack:

- `agent/connections/dante.ts` — OpenAPI connection. Spec fetched from
  `${DANTE_API_BASE_URL}/api/agent/openapi.json` at boot; each operation
  materializes as `dante__<operationId>`.
- `agent/lib/cognito-pkce.ts` — PKCE helpers (verifier, S256 challenge,
  authorize URL build, token exchange, refresh).
- `agent/lib/token-store.ts` — in-memory token cache keyed by EVE principal id.
  **Swap to Vercel KV before production**: a cold start drops the cache today.
- `agent/instructions.md` — Dante-aware system prompt.

## Local dev

```
cp .env.example .env.local
# Fill DANTE_COGNITO_AGENT_CLIENT_ID from `terraform output -raw agent_client_id`
# (run from terraform/envs/prod in the Dante repo).
npm install
npm run dev
```

`localDev()` route auth is active under loopback, so the EVE TUI works without
a Vercel OIDC token. Browser callers in production need real route auth — see
the eve channel setup below.

## OAuth callback URL

`defineInteractiveAuthorization` mints the callback URL at runtime, surfaced
verbatim on the `authorization.required` event. It follows the framework's
fixed shape:

  `<DEPLOY_BASE_URL>/eve/v1/connections/dante/auth/callback`

For the deployed Vercel agent that's
`https://<deploy>.vercel.app/eve/v1/connections/dante/auth/callback`.
This URL **must** be in Cognito's `agent_callback_urls` allowlist (set via
`terraform/envs/prod/prod.auto.tfvars` in the Dante repo). If you serve preview
deploys with their own URLs, add each one (Cognito doesn't accept wildcards on
callback URLs).

## Production deploy

1. Set the env vars in Vercel project settings (Production scope):
   - `DANTE_API_BASE_URL=https://dante.actdigital.eu`
   - `DANTE_COGNITO_DOMAIN=https://auth.dante.actdigital.eu`
   - `DANTE_COGNITO_AGENT_CLIENT_ID=<from terraform>`
2. Add the deploy's callback URL to `agent_callback_urls` in Dante's tfvars,
   `cd terraform/envs/prod && git commit && push` (GHA applies).
3. Update `agent/channels/eve.ts` to use real route auth before the first
   browser/external caller — the scaffold `placeholderAuth()` returns 401 in
   production.
4. Deploy to Vercel.

## What's missing for production-grade

- Persistent token cache (Vercel KV) — replace `agent/lib/token-store.ts`.
- Real route auth on `agent/channels/eve.ts` (vercelOidc or a Cognito-backed
  AuthFn so end-users sign in to the EVE agent itself, not just to Dante).
- Per-tool unit tests + an `evals/` suite.
