/** Daily retention sweep for chat PDF uploads.
 *
 * Vercel Blob has no native TTL — files live until you delete them.
 * Without a sweep the `uploads/` prefix grows monotonically and we
 * accumulate every PDF anyone ever pasted into chat, billable until
 * the heat death of the universe. This route lists `uploads/`,
 * picks blobs older than `UPLOAD_RETENTION_DAYS` (default 7), and
 * deletes them in batches.
 *
 * Scheduling lives in `vercel.json` → `crons[]`. The schedule
 * (04:00 UTC daily) gives the cleanup a quiet European pre-work
 * window where nothing else is racing for the function pool.
 *
 * Security:
 *   - Production must require `Authorization: Bearer $CRON_SECRET`.
 *     Vercel Crons sign their inbound requests with this header when
 *     `CRON_SECRET` is set on the project. Without the check, anyone
 *     who learns the path can drain the bucket.
 *   - Pre-flight aborts on a missing token and 401s — no list, no
 *     delete, no log of what would have been deleted.
 *   - Pathname filter pins to `uploads/` so an over-eager misconfig
 *     (e.g. retention=0) can never reach blobs outside the chat
 *     upload prefix. */
import { del, list } from "@vercel/blob";
import { NextResponse } from "next/server";

const PREFIX = "uploads/";
const DEFAULT_RETENTION_DAYS = 7;
const BATCH_SIZE = 100;

export async function GET(request: Request): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "CRON_SECRET not set on project; refusing to run." },
      { status: 500 },
    );
  }
  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const retentionDays = Number.parseInt(
    process.env.UPLOAD_RETENTION_DAYS ?? String(DEFAULT_RETENTION_DAYS),
    10,
  );
  if (!Number.isFinite(retentionDays) || retentionDays < 1) {
    return NextResponse.json(
      { error: `Invalid UPLOAD_RETENTION_DAYS: ${process.env.UPLOAD_RETENTION_DAYS}` },
      { status: 500 },
    );
  }
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

  let scanned = 0;
  let kept = 0;
  const toDelete: string[] = [];
  let cursor: string | undefined;

  do {
    const page = await list({ prefix: PREFIX, cursor, limit: 1000 });
    for (const blob of page.blobs) {
      scanned++;
      if (!blob.pathname.startsWith(PREFIX)) continue;
      if (blob.uploadedAt < cutoff) {
        toDelete.push(blob.url);
      } else {
        kept++;
      }
    }
    cursor = page.cursor;
  } while (cursor);

  let deleted = 0;
  for (let i = 0; i < toDelete.length; i += BATCH_SIZE) {
    const batch = toDelete.slice(i, i + BATCH_SIZE);
    await del(batch);
    deleted += batch.length;
  }

  return NextResponse.json({
    ok: true,
    retentionDays,
    cutoff: cutoff.toISOString(),
    scanned,
    kept,
    deleted,
  });
}
