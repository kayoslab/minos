import { eveChannel } from "eve/channels/eve";
import { localDev } from "eve/channels/auth";

import { sessionCookie, cognitoBearer } from "@/lib/eve-route-auth";

/** Route auth for `/eve/v1/session*` and friends.
 *
 * Walk order — first match wins, each `null` falls through:
 *
 *   1. `localDev()` — loopback hostname (TUI on the same machine).
 *   2. `sessionCookie()` — the browser chat. Auth.js cookie carries
 *      a verified Cognito access token; we extract + re-verify.
 *   3. `cognitoBearer()` — `Authorization: Bearer <token>` for the
 *      one-shot test script and machine callers.
 *
 * Both 2 and 3 land on the SAME Cognito access token and, as a side
 * effect, populate the Dante connection's token cache so a
 * downstream tool call doesn't re-OAuth. One user sign-in → both
 * the EVE route and the outbound Dante call are authorized.
 *
 * No `placeholderAuth()` and no `none()`. */
export default eveChannel({
  auth: [localDev(), sessionCookie(), cognitoBearer()],
});
