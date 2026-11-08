import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { configuredPassword, SESSION_COOKIE, verifySession } from "@/lib/auth";
import LoginForm from "@/components/login-form";

export default async function LoginPage() {
  const password = configuredPassword();
  if (verifySession((await cookies()).get(SESSION_COOKIE)?.value, password))
    redirect("/");
  return <LoginForm configured={Boolean(password)} />;
}
