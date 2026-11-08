import { cookies } from "next/headers";
import { sameOrigin, SESSION_COOKIE } from "@/lib/auth";

export async function POST(request: Request) {
  if (!sameOrigin(request))
    return Response.json(
      { error: "허용되지 않은 요청입니다." },
      { status: 403 },
    );
  (await cookies()).set(SESSION_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return Response.json(
    { ok: true },
    { headers: { "Cache-Control": "no-store" } },
  );
}
