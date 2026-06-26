import { redirect } from "next/navigation";

import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

/** Landing: bounce to /chat when signed in, /login otherwise. */
export default async function Home() {
  const session = await getSession();
  redirect(session ? "/chat" : "/login");
}
