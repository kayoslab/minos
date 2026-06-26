import { eveChannel } from "eve/channels/eve";
import { localDev, vercelOidc } from "eve/channels/auth";

import { sessionCookie, cognitoBearer } from "@/lib/eve-route-auth";

/** Route auth for `/eve/v1/session*` and friends.
 *
 * Walk order — first match wins, each `null` falls through:
 *
 *   1. `localDev()` — loopback hostname (TUI on the same machine).
 *   2. `sessionCookie()` — the browser chat. Reads the
 *      `__Host-dante-at` cookie (raw Cognito access token JWT).
 *   3. `cognitoBearer()` — `Authorization: Bearer <token>` for the
 *      one-shot test script and machine callers.
 *   4. `vercelOidc()` — `npx eve dev <remote>` in remote mode sends
 *      a Vercel OIDC token. Accepted so the developer TUI can reach
 *      the agent against the deployed instance. Tokens whose
 *      `project_id` matches this project authenticate as
 *      principalType `"user"` (Vercel `external_sub`) or as a
 *      `"runtime"` service principal; the Dante connection's
 *      `getToken` only honors `"user"` and otherwise triggers the
 *      OAuth handshake (URL shown in the TUI; user clicks it,
 *      signs in via Cognito, callback completes, in-Lambda cache
 *      holds the token for the rest of the session).
 *
 * Browser (paths 2/3) land on the same Cognito access token and pass
 * it through the principal attributes so the Dante connection can
 * read it from the request context — no cross-process cache needed.
 * The TUI (path 4) doesn't carry a Cognito token, so its Dante calls
 * fall through to the connection's interactive OAuth flow. */
export default eveChannel({
  auth: [localDev(), sessionCookie(), cognitoBearer(), vercelOidc()],
});
