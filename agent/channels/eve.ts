import { eveChannel } from "eve/channels/eve";
import { localDev, vercelOidc } from "eve/channels/auth";

import { cognitoAccessToken } from "#lib/cognito-auth.js";

/** Route auth for `/eve/v1/session*` and friends.
 *
 * Walk order matters — each entry that doesn't recognize the caller
 * returns null and the walk falls through to the next. First match
 * wins.
 *
 *   localDev()           — loopback hostname → synthetic local-dev
 *                          principal. Used by `eve dev` + the TUI on
 *                          the same machine.
 *   vercelOidc()         — Vercel-issued OIDC bearer. Used by Vercel's
 *                          own TUI/CLI talking to a deployed agent,
 *                          and by any Vercel-to-Vercel traffic.
 *   cognitoAccessToken() — Cognito agent app client access token,
 *                          presented as Authorization: Bearer.
 *                          Same token the agent re-uses on the
 *                          outbound Dante connection — one sign-in,
 *                          one consent, one token covers both ends.
 *
 * No `placeholderAuth()` and no `none()`. */
const issuer = process.env.DANTE_COGNITO_ISSUER;
const agentClientId = process.env.DANTE_COGNITO_AGENT_CLIENT_ID;
if (!issuer || !agentClientId) {
  throw new Error(
    "DANTE_COGNITO_ISSUER and DANTE_COGNITO_AGENT_CLIENT_ID must be set " +
      "on the Vercel project (Production scope). They are read at boot " +
      "by the route-auth walk.",
  );
}

export default eveChannel({
  auth: [
    localDev(),
    vercelOidc(),
    cognitoAccessToken({ issuer, agentClientId }),
  ],
});
