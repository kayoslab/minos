/** Signed direct-upload endpoint for chat attachments (PDFs).
 *
 * Why direct-to-Blob and not a Next-side multipart route: PDFs can
 * run tens of MB. Routing them through a Vercel Function would burn
 * memory + execution time on every upload. `handleUpload` from
 * `@vercel/blob/client` mints a short-lived client-side upload token,
 * the browser PUTs directly to Vercel Blob, and we get an
 * authenticated callback with the resulting URL.
 *
 * The route is called in TWO phases by `handleUpload`:
 *   1. `blob.generate-client-token` — from the browser. We check the
 *      session cookie here via `onBeforeGenerateToken` and only mint
 *      a token for signed-in users; we pin the pathname to a
 *      per-user prefix and clamp content type + size.
 *   2. `blob.upload-completed` — from Vercel Blob's infrastructure
 *      AFTER the upload finishes. This call has no user cookie but
 *      is authenticated by `BLOB_READ_WRITE_TOKEN`, which
 *      `handleUpload` verifies internally.
 *
 * The proxy MUST treat `/api/upload` as public so the second-phase
 * callback isn't redirected to /login. See proxy.ts. */
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextResponse } from "next/server";

import { getSession } from "@/lib/session";

const ALLOWED_TYPES = ["application/pdf"];
const MAX_BYTES = 25 * 1024 * 1024;

export async function POST(request: Request): Promise<NextResponse> {
  const body = (await request.json()) as HandleUploadBody;

  try {
    const result = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname) => {
        // Session check happens HERE, not at the top of the handler,
        // because the second-phase callback from Vercel Blob has no
        // cookies and shouldn't be 401'd. Token-generation is the
        // only phase that needs an authenticated user.
        const session = await getSession();
        if (!session) {
          throw new Error("Not signed in.");
        }
        if (!pathname.startsWith(`uploads/${session.cognito_sub}/`)) {
          throw new Error(
            `Disallowed upload pathname — must start with uploads/${session.cognito_sub}/.`,
          );
        }
        return {
          allowedContentTypes: ALLOWED_TYPES,
          maximumSizeInBytes: MAX_BYTES,
          // Carry the principal through so the completion callback
          // could (in future) audit-log who uploaded what without
          // re-reading the cookie.
          tokenPayload: JSON.stringify({
            cognito_sub: session.cognito_sub,
          }),
        };
      },
      onUploadCompleted: async () => {
        // No-op — the browser receives the resulting URL synchronously
        // and ships it to EVE on the next agent.send. We don't need
        // server-side bookkeeping here yet; add audit + retention
        // policy when more than the chat flow uses Blob.
      },
    });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 400 },
    );
  }
}
