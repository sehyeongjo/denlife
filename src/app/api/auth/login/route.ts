import { cookies } from "next/headers";
import {
  configuredPassword,
  createSession,
  LoginLimiter,
  passwordMatches,
  sameOrigin,
  SESSION_COOKIE,
  SESSION_SECONDS,
} from "@/lib/auth";

const limiter = new LoginLimiter();

export async function POST(request: Request) {
  const headers = { "Cache-Control": "no-store" };
  if (!sameOrigin(request))
    return Response.json(
      { error: "허용되지 않은 요청입니다." },
      { status: 403, headers },
    );
  const password = configuredPassword();
  if (!password)
    return Response.json(
      {
        error:
          "접속 비밀번호가 설정되지 않았어요. 서버 환경변수를 확인해 주세요.",
      },
      { status: 503, headers },
    );

  const key =
    process.env.VERCEL === "1"
      ? request.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
        "unknown"
      : "local";
  const retryAfter = limiter.attempt(key);
  if (retryAfter)
    return Response.json(
      { error: `${retryAfter}초 후 다시 시도해 주세요.` },
      {
        status: 429,
        headers: { ...headers, "Retry-After": String(retryAfter) },
      },
    );

  let input: unknown;
  try {
    const raw = await request.text();
    if (raw.length > 2048)
      return Response.json(
        { error: "비밀번호를 확인해 주세요." },
        { status: 400, headers },
      );
    input = JSON.parse(raw);
  } catch {
    return Response.json(
      { error: "비밀번호를 확인해 주세요." },
      { status: 400, headers },
    );
  }
  if (
    typeof input !== "object" ||
    input === null ||
    !("password" in input) ||
    typeof input.password !== "string" ||
    !input.password.length ||
    input.password.length > 1024 ||
    !passwordMatches(input.password, password)
  )
    return Response.json(
      { error: "비밀번호가 맞지 않아요." },
      { status: 401, headers },
    );

  limiter.clear(key);
  (await cookies()).set(SESSION_COOKIE, createSession(password), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_SECONDS,
  });
  return Response.json({ ok: true }, { headers });
}
