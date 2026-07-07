# Minos

> *Stavvi Minòs orribilmente, e ringhia: essamina le colpe ne l'intrata;
> giudica e manda secondo ch'avvinghia.*
> — Inferno, Canto V

There stands Minos, horribly, and snarls: he examines the transgressions at
the entrance, judges, and dispatches each according to how he coils his tail.
He is the one who decides where every soul is assigned. So does this.

Minos is the intake-and-assignment agent that sits in front of
[Dante](../dante), act digital deutschland's Personio-backed project and
allocation tool. You talk to it in plain language — and when you drop a
contract PDF (framework agreement, purchase order, freelancer bill) into the
chat, it **examines** the paperwork, **classifies** what it's looking at,
**routes** the people and projects to the right records, and **writes** the
assignment back into Dante on your behalf. It also answers questions about the
practice's projects, customers, and rentability along the way.

It is named after the judge of the second circle, whose entire job was to
examine each arriving soul, weigh the case, and — with a precise number of
coils of his tail — assign it to exactly the right destination. A tool that
validates inputs, classifies documents, resolves the correct person, and
records where each assignment belongs could not ask for a better patron.

Everything Minos does, it does **as you**. It signs in with your token and can
only see and mutate what your role permits — Minos judges, but only within the
authority Dante has already granted the person standing at the gate.

---

## What it does

You sign in once through the Cognito hosted UI — the same sign-in screen you'd
use on Dante itself, MFA mandatory, no exceptions. That single Cognito token
then does double duty: it authenticates your browser to the agent **and** is
re-used by the agent's outbound connection back to Dante. One sign-in, one
consent, both doors open. No second OAuth descent.

What you're allowed to touch is decided upstream, not here. A Pre Token
Generation Lambda on the Cognito side subsets your scopes against your Cognito
group before Minos ever sees a token:

- **Employees** may grant `read:projects`, `read:customers`, `read:employees`.
- **Managers** additionally get `read:reports` and `read:salaries`.

Because Minos re-uses *your* token rather than some almighty service account,
Dante re-verifies every single request against the same JWKS and re-checks the
role hierarchy on its own side. Minos cannot conjure access you don't have, nor
write a record your role can't write. The judge examines; the gate still
enforces the sentence.

---

## Architecture, at altitude

The whole thing is a **Next.js + EVE hybrid**, stitched together by `withEve()`
in `next.config.ts` and served from a single Vercel deploy. Three things, one
origin — which means the cookies Auth.js sets ride along on every agent request
with none of the usual CORS theatre.

```
Browser ──(Auth.js cookie)──▶ /eve/v1/session
                                   │
                    channel auth  (agent/channels/eve.ts)
             verifies the Cognito token against Cognito's JWKS,
             then side-effects the token into a cache keyed by `sub`
                                   │
                             the EVE agent runs
                                   │
              dante connection getToken(sub) ──▶ cached token
                                   │
        GET/POST https://dante.actdigital.eu/api/agent/*  (Bearer <token>)
                                   │
           Dante re-verifies the SAME token, re-checks the role,
                    and only then reads or writes data
```

One deploy serves all three of:

- `app/` — Next.js App Router pages (`/login`, `/chat`).
- `app/api/auth/[...nextauth]/` — Auth.js endpoints (Cognito provider).
- `/eve/v1/*` — EVE channel routes, mounted by `withEve()`.

### Repository layout

```
agent/                     EVE agent — the part that examines and assigns
  agent.ts
  instructions.md
  channels/eve.ts          route auth: localDev + Auth.js cookie + Cognito bearer
  connections/dante.ts     OpenAPI connection w/ interactive Cognito OAuth
  lib/cognito-pkce.ts      PKCE helpers
  lib/token-store.ts       in-memory token cache, seeded by the channel AuthFn

app/                       Next.js App Router
  layout.tsx
  page.tsx                 redirects to /chat or /login
  login/page.tsx           Cognito sign-in entry
  chat/page.tsx            the main chat — guarded by auth()
  api/auth/[...nextauth]/route.ts
  api/cron/cleanup-uploads route the daily blob-retention cron hits

components/
  chat.tsx                 useEveAgent + message list + composer (PDF upload)
  hitl-request.tsx         renders parked HITL (approval / ask_question)
  connection-prompt.tsx    renders parked authorization.required
  sign-out-button.tsx

lib/
  auth/                    Auth.js Cognito provider, token refresh, server actions
  eve-route-auth.ts        channel AuthFn: cookie + bearer + cache-seed side-effect

middleware.ts              CSP + per-request nonce + cookie-based auth gate
next.config.ts             withEve() + static security headers
```

---

## Local development

```bash
cp .env.example .env.local
# Fill in:
#   AUTH_SECRET                    openssl rand -base64 64
#   DANTE_COGNITO_AGENT_CLIENT_ID  terraform output -raw agent_client_id
#                                  (from terraform/envs/prod in the Dante repo)
npm install
npm run dev
```

Next boots at `http://localhost:3000` and proxies `/eve/v1/*` to the EVE
runtime in the same process. Route auth admits loopback hosts, so a terminal
client on the same machine works too (`npm run tui`) — hold court by TUI if the
browser isn't your idea of a good time.

Useful npm scripts:

| Command             | What it does                                   |
| ------------------- | ---------------------------------------------- |
| `npm run dev`       | Next.js dev server (with EVE proxied in)       |
| `npm run build`     | Production build                               |
| `npm run start`     | Serve the production build                     |
| `npm run typecheck` | `tsc`, so the types suffer instead of you      |
| `npm run tui`       | Terminal chat client against the local agent   |

Requires **Node.js 24.x**.

---

## Deploying to production

Deployed on Vercel. Production-scope environment variables:

```
AUTH_SECRET                    openssl rand -base64 64 (distinct from dev — do not reuse)
DANTE_COGNITO_ISSUER           cognito-idp.<region>.amazonaws.com/<pool>
DANTE_COGNITO_DOMAIN           https://auth.dante.actdigital.eu
DANTE_COGNITO_AGENT_CLIENT_ID  terraform output -raw agent_client_id
DANTE_API_BASE_URL             https://dante.actdigital.eu
AI_GATEWAY_API_KEY             from Vercel AI Gateway
```

> The `DANTE_*` variables point at the **upstream Dante** system (its Cognito
> pool and API) — they keep the Dante name because that's the service they
> address, not this app.

Before the first deploy, the Auth.js callback URL
`https://minos.vercel.app/api/auth/callback/cognito` must be present in
`agent_callback_urls` in Dante's `terraform/envs/prod/variables.tf`. Forget
this and the sign-in loop closes on itself with the special cruelty reserved
for OAuth redirect mismatches.

---

## Circles we haven't climbed out of yet

Still POC-quality in a few honest places:

- **The token cache (`agent/lib/token-store.ts`) is in-process memory.** The
  channel AuthFn re-seeds it on every browser request, so a cold start that
  drops the cache is quietly recovered on your next message. Fine for a demo;
  swap in a persistent store (Vercel KV) before anyone calls this "scale."
- **No per-user audit logging in EVE** — we lean on Dante's own audit trail for
  now.
- **No `evals/` suite and no per-tool unit tests.** The docket is unproofed.
- **No rate limit at the EVE channel layer** — today only Dante's own limits
  apply.

---

## License

Proprietary — © act digital deutschland. All rights reserved. Copy it, sell it,
or reverse-engineer it without written consent and Minos will coil his tail an
uncomfortable number of times. See [`LICENSE.md`](./LICENSE.md).
