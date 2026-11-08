import LedgerApp from "@/components/ledger-app";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { configuredPassword, SESSION_COOKIE, verifySession } from "@/lib/auth";

export default async function Page() {
  if (
    !verifySession(
      (await cookies()).get(SESSION_COOKIE)?.value,
      configuredPassword(),
    )
  )
    redirect("/login");
  return <LedgerApp />;
}
