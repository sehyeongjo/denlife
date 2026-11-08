import { normalizeRates } from "@/lib/ledger";
import { cookies } from "next/headers";
import { configuredPassword, SESSION_COOKIE, verifySession } from "@/lib/auth";

export async function GET() {
  if (
    !verifySession(
      (await cookies()).get(SESSION_COOKIE)?.value,
      configuredPassword(),
    )
  )
    return Response.json(
      { error: "다시 접속해 주세요." },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  try {
    const response = await fetch(
      "https://api.frankfurter.dev/v2/rates?base=DKK",
      {
        cache: "no-store",
        signal: AbortSignal.timeout(12_000),
      },
    );
    if (!response.ok) throw new Error("Exchange provider unavailable");
    return Response.json(normalizeRates(await response.json()), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return Response.json(
      {
        error:
          "환율을 불러오지 못했어요. 다시 시도하거나 환율을 직접 입력해 주세요.",
      },
      { status: 502 },
    );
  }
}
