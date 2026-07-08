import { redirect } from "next/navigation";

import { Chat } from "@/components/chat";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

/** Chat page. Guarded by the session cookie — unauth'd or
 * refresh-failed users bounce back to /login. The chat itself is a
 * client component (uses `useEveAgent`). */
export default async function ChatPage() {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }
  return <Chat />;
}
